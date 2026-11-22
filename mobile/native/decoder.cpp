#define MA_NO_DEVICE_IO
#define MA_NO_ENGINE
#define MA_NO_RESOURCE_MANAGER
#define MA_NO_NODE_GRAPH
#define MA_NO_ENCODING
#define MA_NO_GENERATION
#define MINIAUDIO_IMPLEMENTATION
#include "vendor/miniaudio.h"
#include "decoder.hpp"
#include <list>
#include <mutex>
#include <vector>
#include <algorithm>
#ifdef __ANDROID__
#include <cerrno>
#include <climits>
#include <fcntl.h>
#include <limits>
#include <sys/stat.h>
#include <unistd.h>
#endif
constexpr int frames=4*48000;
struct Decoder::Impl {
    ma_decoder decoder{};
    ma_uint64 length=0,cursor=0;
    bool open=false;
    std::mutex lock;
    std::list<std::pair<int,std::vector<int16_t>>> blocks;
#ifdef __ANDROID__
    int fileDescriptor=-1;
    ma_int64 byteCursor=0;
    static ma_result read(ma_decoder* decoder,void* output,size_t bytes,size_t* readBytes){
        auto& source=*static_cast<Impl*>(decoder->pUserData);
        if(readBytes)*readBytes=0;
        if(!bytes)return MA_SUCCESS;
        const auto remaining=std::numeric_limits<ma_int64>::max()-source.byteCursor;
        const auto count=std::min(bytes,static_cast<size_t>(std::min<ma_int64>(remaining,SSIZE_MAX)));
        if(!count)return MA_AT_END;
        ssize_t received;
        do{received=pread64(source.fileDescriptor,output,count,source.byteCursor);}while(received<0&&errno==EINTR);
        if(received<0)return MA_IO_ERROR;
        source.byteCursor+=received;
        if(readBytes)*readBytes=static_cast<size_t>(received);
        return received?MA_SUCCESS:MA_AT_END;
    }
    static ma_result seek(ma_decoder* decoder,ma_int64 offset,ma_seek_origin origin){
        auto& source=*static_cast<Impl*>(decoder->pUserData);
        ma_int64 base=0;
        if(origin==ma_seek_origin_current)base=source.byteCursor;
        else if(origin==ma_seek_origin_end){
            struct stat64 info{};
            if(fstat64(source.fileDescriptor,&info)<0||info.st_size<0)return MA_BAD_SEEK;
            base=info.st_size;
        }else if(origin!=ma_seek_origin_start)return MA_BAD_SEEK;
        if(offset < -base || offset > std::numeric_limits<ma_int64>::max()-base)return MA_BAD_SEEK;
        source.byteCursor=base+offset;
        return MA_SUCCESS;
    }
    bool openDescriptor(const std::string& file,const ma_decoder_config& config){
        constexpr auto prefix="/proc/self/fd/";
        const size_t start=sizeof("/proc/self/fd/")-1;
        if(file.compare(0,start,prefix)!=0||file.size()==start)return false;
        int original=0;
        for(size_t i=start;i<file.size();++i){
            const int digit=file[i]-'0';
            if(digit<0||digit>9||original>(INT_MAX-digit)/10)return false;
            original=original*10+digit;
        }
        // SAF grants access to this descriptor. Reopening its /proc path can be
        // denied; pread also keeps our decoder cursor separate from Java's fd.
        do{fileDescriptor=fcntl(original,F_DUPFD_CLOEXEC,0);}while(fileDescriptor<0&&errno==EINTR);
        return fileDescriptor>=0&&ma_decoder_init(read,seek,this,&config,&decoder)==MA_SUCCESS;
    }
#endif
    ~Impl(){
        if(open)ma_decoder_uninit(&decoder);
#ifdef __ANDROID__
        if(fileDescriptor>=0)close(fileDescriptor);
#endif
    }
};
Decoder::Decoder(const std::string& file):data(new Impl){
    auto config=ma_decoder_config_init(ma_format_s16,2,48000);
#ifdef __ANDROID__
    if(file.rfind("/proc/self/fd/",0)==0)data->open=data->openDescriptor(file,config);
    else
#endif
    data->open=ma_decoder_init_file(file.c_str(),&config,&data->decoder)==MA_SUCCESS;
    if(data->open && ma_decoder_get_length_in_pcm_frames(&data->decoder,&data->length)==MA_SUCCESS)
        duration=double(data->length)/48000.;
}
Decoder::~Decoder()=default;
std::string Decoder::block(int index,const std::string& channel){
    auto& d=*data;std::lock_guard<std::mutex> guard(d.lock);
    const auto start=ma_uint64(index)*frames;
    if(!d.open||start>=d.length)return {};
    auto it=std::find_if(d.blocks.begin(),d.blocks.end(),[&](auto& v){return v.first==index;});
    if(it==d.blocks.end()){
        if(d.cursor!=start&&ma_decoder_seek_to_pcm_frame(&d.decoder,start)!=MA_SUCCESS)return {};
        ma_uint64 count=std::min<ma_uint64>(frames,d.length-start),read=0;
        std::vector<int16_t> samples(count*2);
        ma_decoder_read_pcm_frames(&d.decoder,samples.data(),count,&read);d.cursor=start+read;
        if(!read)return {};
        samples.resize(read*2);d.blocks.emplace_front(index,std::move(samples));
        if(d.blocks.size()>8)d.blocks.pop_back();
    }else d.blocks.splice(d.blocks.begin(),d.blocks,it);
    auto& s=d.blocks.front().second;
    std::string bytes(reinterpret_cast<const char*>(s.data()),s.size()*2);
    if(channel!="stereo"){
        const bool left=channel=="left",right=channel=="right";
        for(size_t i=0;i<s.size();i+=2){
            int16_t v=left?s[i]:right?s[i+1]:(int(s[i])+s[i+1])/2;
            memcpy(bytes.data()+i*2,&v,2);memcpy(bytes.data()+i*2+2,&v,2);
        }
    }
    return bytes;
}
