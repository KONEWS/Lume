#include <napi/native_api.h>
#include "local_media.hpp"
#include <ohaudio/native_audiostreambuilder.h>
#include <ohaudio/native_audiorenderer.h>
#include <atomic>
#include <algorithm>
#include <cmath>
#include <memory>
#include <string>
#include <vector>
#include <cstring>
#include <ctime>
std::string mobileRoom(const std::string&);
namespace {
constexpr int blockFrames=192000, slots=8;
struct Block {int key;std::vector<int16_t> pcm;};
struct Clock {int generation;bool playing;double start,duration,gain,intercept;};
double ms(clockid_t id){timespec t{};clock_gettime(id,&t);return t.tv_sec*1000.+t.tv_nsec/1e6;}
struct Output {
    OH_AudioRenderer* renderer=nullptr;
    std::shared_ptr<Block> blocks[slots];
    std::shared_ptr<Clock> clock;
    std::atomic<int> gaps{0};
    uint32_t underflows=0;
    int generation=0,applied=-1;
    int64_t written=0;
    double cursor=NAN,intercept=NAN;
    bool heard=false,inGap=false;
    double lastCheck=-1000;
    void reset(){
        generation++;for(auto& b:blocks)std::atomic_store(&b,std::shared_ptr<Block>());
    }
    void close(){
        if(renderer){OH_AudioRenderer_Stop(renderer);OH_AudioRenderer_Release(renderer);renderer=nullptr;}
        reset();std::atomic_store(&clock,std::shared_ptr<Clock>());
        written=0;cursor=intercept=NAN;lastCheck=-1000;underflows=0;gaps=0;
    }
    static OH_AudioData_Callback_Result write(OH_AudioRenderer*,void* self,void* buffer,int bytes){
        static_cast<Output*>(self)->render(static_cast<int16_t*>(buffer),bytes/4);
        return AUDIO_DATA_CALLBACK_RESULT_VALID;
    }
    bool open(){
        if(renderer)return true;
        OH_AudioStreamBuilder* b=nullptr;
        if(OH_AudioStreamBuilder_Create(&b,AUDIOSTREAM_TYPE_RENDERER)!=AUDIOSTREAM_SUCCESS)return false;
        OH_AudioStreamBuilder_SetSamplingRate(b,48000);OH_AudioStreamBuilder_SetChannelCount(b,2);
        OH_AudioStreamBuilder_SetSampleFormat(b,AUDIOSTREAM_SAMPLE_S16LE);
        OH_AudioStreamBuilder_SetRendererInfo(b,AUDIOSTREAM_USAGE_MUSIC);
        OH_AudioStreamBuilder_SetLatencyMode(b,AUDIOSTREAM_LATENCY_MODE_NORMAL);
        OH_AudioStreamBuilder_SetFrameSizeInCallback(b,960);
        OH_AudioStreamBuilder_SetRendererWriteDataCallback(b,write,this);
        auto rc=OH_AudioStreamBuilder_GenerateRenderer(b,&renderer);OH_AudioStreamBuilder_Destroy(b);
        if(rc!=AUDIOSTREAM_SUCCESS||!renderer)return false;
        if(OH_AudioRenderer_Start(renderer)!=AUDIOSTREAM_SUCCESS){close();return false;}return true;
    }
    void sync(bool play,double start,double duration,double gain){
        double now=ms(CLOCK_BOOTTIME);
        if(now-lastCheck>(std::isfinite(intercept)?700:120)){
            int64_t frame=0,stamp=0;
            if(OH_AudioRenderer_GetTimestamp(renderer,CLOCK_MONOTONIC,&frame,&stamp)==AUDIOSTREAM_SUCCESS&&frame>0){
                auto delta=stamp/1e6-ms(CLOCK_MONOTONIC);
                if(std::abs(delta)<1000){
                    double measured=now+delta-frame/48.;
                    intercept=!std::isfinite(intercept)||std::abs(measured-intercept)>80?measured:intercept+.25*(measured-intercept);
                }
            }
            OH_AudioRenderer_GetUnderflowCount(renderer,&underflows);lastCheck=now;
        }
        std::atomic_store(&clock,std::make_shared<Clock>(Clock{generation,play,start,duration,gain,intercept}));
    }
    void render(int16_t* dst,int frames){
        auto c=std::atomic_load(&clock);auto now=ms(CLOCK_BOOTTIME);
        auto first=written;written+=frames;
        if(!c||!c->playing){memset(dst,0,frames*4);cursor=NAN;return;}
        if(applied!=c->generation){cursor=NAN;heard=inGap=false;applied=c->generation;}
        double at=c->intercept+first/48.;if(!std::isfinite(at)||std::abs(at-now)>500)at=now+40;
        const double target=(at-c->start)*48;double err=target-cursor;
        if(!std::isfinite(cursor)||std::abs(err)>7200){cursor=target;err=0;}
        const double speed=1+std::clamp(std::abs(err)<32?0.:err/24000.,-.04,.04);
        bool missing=false;int key=-1;std::shared_ptr<Block> block;
        for(int i=0;i<frames;i++,cursor+=speed){
            auto out=dst+i*2;
            if(cursor<0||cursor>=c->duration*48000){out[0]=out[1]=0;continue;}
            int64_t frame=int64_t(cursor);int index=int(frame/blockFrames);
            if(index!=key){key=index;block=std::atomic_load(&blocks[key%slots]);}
            auto p=size_t(frame%blockFrames)*2;
            if(!block||block->key!=key||p+1>=block->pcm.size()){out[0]=out[1]=0;missing=true;continue;}
            const auto& s=block->pcm;auto next=p+3<s.size()?p+2:p;double frac=cursor-frame;
            for(int j=0;j<2;j++)out[j]=int16_t((s[p+j]+(s[next+j]-s[p+j])*frac)*c->gain);
            heard=true;
        }
        if(missing&&heard&&!inGap)gaps++;inGap=missing;
    }
};
Output output;
napi_value none(napi_env env){napi_value value;napi_get_undefined(env,&value);return value;}
napi_value roomCall(napi_env env,napi_callback_info info){
    size_t n=1,len=0;napi_value a{},v;napi_get_cb_info(env,info,&n,&a,nullptr,nullptr);
    napi_get_value_string_utf8(env,a,nullptr,0,&len);std::vector<char> buf(len+1);
    napi_get_value_string_utf8(env,a,buf.data(),buf.size(),&len);
    auto result=mobileRoom(std::string(buf.data(),len));napi_create_string_utf8(env,result.data(),result.size(),&v);return v;
}
napi_value put(napi_env env,napi_callback_info info){
    size_t n=2,len=0;napi_value a[2];int index=-1;void* data=nullptr;
    napi_get_cb_info(env,info,&n,a,nullptr,nullptr);napi_get_value_int32(env,a[0],&index);
    napi_get_arraybuffer_info(env,a[1],&data,&len);
    if(data&&index>=0&&len>0&&len<=blockFrames*4&&len%4==0){
        auto b=std::make_shared<Block>();b->key=index;b->pcm.resize(len/2);memcpy(b->pcm.data(),data,len);
        std::atomic_store(&output.blocks[index%slots],b);
    }return none(env);
}
napi_value sync(napi_env env,napi_callback_info info){
    size_t n=4;napi_value a[4],v;bool play=false;double start=0,duration=0,gain=0;
    napi_get_cb_info(env,info,&n,a,nullptr,nullptr);napi_get_value_bool(env,a[0],&play);
    napi_get_value_double(env,a[1],&start);napi_get_value_double(env,a[2],&duration);napi_get_value_double(env,a[3],&gain);
    const bool ok=output.open();if(ok)output.sync(play,start,duration,std::clamp(gain,0.,1.));
    napi_create_int32(env,ok?int(output.underflows):-1,&v);return v;
}
napi_value gaps(napi_env env,napi_callback_info){napi_value v;napi_create_int32(env,output.gaps,&v);return v;}
napi_value reset(napi_env env,napi_callback_info){output.reset();return none(env);}
napi_value closeOutput(napi_env env,napi_callback_info){output.close();return none(env);}
struct MediaWork {napi_async_work work{};napi_deferred promise{};std::string path,channel,identity,bytes;int block=-1;};
napi_value localMedia(napi_env env,napi_callback_info info){
    size_t n=4;napi_value a[4],promise,label;napi_get_cb_info(env,info,&n,a,nullptr,nullptr);
    auto* job=new MediaWork();
    auto read=[&](napi_value value){size_t size=0;napi_get_value_string_utf8(env,value,nullptr,0,&size);std::vector<char> b(size+1);napi_get_value_string_utf8(env,value,b.data(),b.size(),&size);return std::string(b.data(),size);};
    job->path=read(a[0]);job->channel=read(a[1]);napi_get_value_int32(env,a[2],&job->block);
    if(n>3)job->identity=read(a[3]);
    napi_create_promise(env,&job->promise,&promise);napi_create_string_utf8(env,"localMedia",NAPI_AUTO_LENGTH,&label);
    napi_create_async_work(env,nullptr,label,[](napi_env,void* data){auto* j=static_cast<MediaWork*>(data);j->bytes=mobileMedia(j->path,j->channel,j->block,j->identity);},
        [](napi_env env,napi_status,void* data){auto* j=static_cast<MediaWork*>(data);void* bytes=nullptr;napi_value result;napi_create_arraybuffer(env,j->bytes.size(),&bytes,&result);if(!j->bytes.empty())memcpy(bytes,j->bytes.data(),j->bytes.size());napi_resolve_deferred(env,j->promise,result);napi_delete_async_work(env,j->work);delete j;},job,&job->work);
    napi_queue_async_work(env,job->work);return promise;
}
napi_value init(napi_env env,napi_value exports){
    const napi_property_descriptor props[]={
        {"localMedia",nullptr,localMedia},{"room",nullptr,roomCall},{"put",nullptr,put},{"sync",nullptr,sync},{"gaps",nullptr,gaps},{"reset",nullptr,reset},{"close",nullptr,closeOutput}};
    napi_define_properties(env,exports,sizeof(props)/sizeof(*props),props);return exports;
}
napi_module module={1,0,nullptr,init,"lume",nullptr,{0}};
}
extern "C" __attribute__((constructor)) void registerModule(){napi_module_register(&module);}
