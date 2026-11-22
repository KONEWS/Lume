#include "vendor/httplib.h"
#include "vendor/json.hpp"
#include <arpa/inet.h>
#ifdef __ANDROID__
#include <android/multinetwork.h>
#endif
#include <ifaddrs.h>
#include <net/if.h>
#include <poll.h>
#include <random>
#include <list>
#include <set>
#include "decoder.hpp"
#include "local_media.hpp"
#include "audio_facts.hpp"
#include "playback_order.hpp"
#include "play_completion.hpp"
#include <cstdio>
#include <ctime>
#include "guest_assets.hpp"

using Json = nlohmann::json;
using Request = httplib::Request;
using Response = httplib::Response;
namespace {
constexpr int port = 46321;
int64_t now() { return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count(); }
int64_t wallNow() {return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();}
std::string token() {
    std::random_device random;
    std::ostringstream out;
    for (int i=0;i<4;i++) out << std::hex << std::setw(8) << std::setfill('0') << random();
    return out.str();
}
void sendJson(Response& res, const Json& value) {
    res.set_header("Cache-Control","no-store");
    res.set_content(value.dump(),"application/json");
}
#include "phone_invites.hpp"
// Poll with the UI heartbeat so discovery follows the foreground player's lifetime.
class NearbyPhone {
    int fd=-1;
    std::string id;
    int64_t retryAt=0;
public:
    void stop(){
        if(fd>=0)close(fd);
        fd=-1; id.clear(); retryAt=0;
    }
    ~NearbyPhone(){stop();}
    Json poll(const Json& state){
        if(fd<0){
            if(now()<retryAt)return Json::object();
            retryAt=now()+3000;
            fd=socket(AF_INET,SOCK_DGRAM,0);
            if(fd<0)return Json::object();
            sockaddr_in local{};local.sin_family=AF_INET;local.sin_port=htons(46324);
            if(bind(fd,reinterpret_cast<sockaddr*>(&local),sizeof(local))<0){
                close(fd);fd=-1;return Json::object();
            }
            id=token();
        }
        for(int i=0;i<12;++i){
            char buf[1024];sockaddr_in peer{};socklen_t size=sizeof(peer);
            const auto n=recvfrom(fd,buf,sizeof(buf),MSG_DONTWAIT,reinterpret_cast<sockaddr*>(&peer),&size);
            if(n<=0)break;
            const auto packet=Json::parse(buf,buf+n,nullptr,false);
            if(!packet.is_object())continue;
            const auto service=packet.value("service","");
            if(service=="lume-find-phone/1"){
                auto nonce=packet.value("nonce","");
                if(nonce.size()!=24)continue;
                auto reply=Json({{"service","lume-phone/1"},{"nonce",nonce},{"id",id},
                    {"platform",state.at("platform")},{"model",state.at("model")}}).dump();
                sendto(fd,reply.data(),reply.size(),0,reinterpret_cast<sockaddr*>(&peer),size);
            }else if(service=="lume-invite/1" && packet.value("id","")==id){
                const int hostPort=packet.value("port",0);
                if(hostPort<1||hostPort>65535)continue;
                char address[INET_ADDRSTRLEN];
                if(!inet_ntop(AF_INET,&peer.sin_addr,address,sizeof(address)))continue;
                return {{"url",std::string("http://")+address+":"+std::to_string(hostPort)},{"name",packet.value("name","播放空间")},
                    {"inviteToken",packet.value("inviteToken","")},{"deviceId",id}};
            }
        }
        return Json::object();
    }
};
class PlayHistory {
    std::mutex mutex;
    std::string file;
    Json counts=Json::object(), last=Json::object(), records=Json::array();
    std::map<std::string,std::pair<int64_t,double>> samples;
    int64_t savedAt=0;
    void saveRecords(){if(file.empty())return;auto path=file+".records",tmp=path+".tmp";std::ofstream out(tmp);out<<records.dump();out.close();if(out)std::rename(tmp.c_str(),path.c_str());}
public:
    void open(const std::string& path){
        std::lock_guard<std::mutex> guard(mutex);if(file==path)return;
        file=path;std::ifstream input(file);Json loaded=Json::object();
        if(input)loaded=Json::parse(input,nullptr,false);
        counts=loaded.is_object()?std::move(loaded):Json::object();
        std::ifstream log(file+".records");if(log){auto data=Json::parse(log,nullptr,false);if(data.is_array())records=std::move(data);}
    }
    int get(const std::string& id){std::lock_guard<std::mutex> guard(mutex);return counts.value(id,0);}
    Json snapshot(){std::lock_guard<std::mutex> guard(mutex);return counts;}
    Json event(){std::lock_guard<std::mutex> guard(mutex);return last;}
    Json recordSnapshot(){std::lock_guard<std::mutex> guard(mutex);return records;}
    void begin(const std::string& session,const std::string& id,const std::string& title,int64_t at=0,const Json& metadata=Json::object()){
        std::lock_guard<std::mutex> guard(mutex);if(session.empty())return;
        for(const auto& r:records)if(r.value("session","")==session)return;
        records.push_back({{"session",session},{"id",id},{"title",title},{"startedAt",at?at:wallNow()},{"completed",false},{"listenedMs",0},{"days",Json::object()}});
        for(const auto* key:{"artist","album","format","quality","sampleRate","bitDepth","duration","source","sourceType","sourceName"})if(metadata.contains(key))records.back()[key]=metadata[key];
        records.back()["source"]=metadata.value("source","local");records.back()["sourceType"]=metadata.value("sourceType","track");
        samples[session]={now()-(at?std::max<int64_t>(0,wallNow()-at):0),0};saveRecords();
    }
    void sample(const std::string& session,double position,bool anchor=false,bool flush=false){
        std::lock_guard<std::mutex> guard(mutex);if(!samples.count(session)||!std::isfinite(position))return;
        auto& previous=samples[session];const auto time=now();const double progress=(position-previous.second)*1000,elapsed=double(time-previous.first);previous={time,position};
        auto record=std::find_if(records.begin(),records.end(),[&](const auto& r){return r.value("session","")==session;});if(record==records.end())return;
        if(!anchor&&progress>0&&progress<=elapsed+1000){
            const auto ms=int64_t(progress),end=wallNow();auto cursor=end-ms;
            (*record)["listenedMs"]=record->value("listenedMs",int64_t(0))+ms;
            (*record)["lastHeardAt"]=end;
            while(cursor<end){time_t seconds=cursor/1000;tm date{};localtime_r(&seconds,&date);char key[16],hour[20];std::strftime(key,sizeof(key),"%Y-%m-%d",&date);std::strftime(hour,sizeof(hour),"%Y-%m-%dT%H",&date);date.tm_hour++;date.tm_min=0;date.tm_sec=0;date.tm_isdst=-1;auto next=std::min<int64_t>(end,int64_t(std::mktime(&date))*1000);if(next<=cursor)break;
                auto& days=(*record)["days"];days[key]=days.value(key,int64_t(0))+next-cursor;if(!record->contains("hours"))(*record)["hours"]=Json::object();auto& hours=(*record)["hours"];hours[hour]=hours.value(hour,int64_t(0))+next-cursor;cursor=next;}
        }
        if(flush||time-savedAt>5000){saveRecords();savedAt=time;}
    }
    int add(const std::string& id,const std::string& publicId,double duration,const std::string& session){
        std::lock_guard<std::mutex> guard(mutex);
        auto record=std::find_if(records.begin(),records.end(),[&](const auto& r){return r.value("session","")==session;});
        if(record==records.end()||record->value("completed",false))return counts.value(id,0);
        (*record)["completed"]=true;(*record)["completedAt"]=wallNow();saveRecords();
        int n=counts.value(id,0)+1;counts[id]=n;
        last={{"eventId",session},{"id",publicId},{"duration",duration},{"at",wallNow()},{"startedAt",(*record)["startedAt"]}};
        if(!file.empty()){
            auto tmp=file+".tmp";std::ofstream out(tmp);out<<counts.dump();out.close();
            if(out)std::rename(tmp.c_str(),file.c_str());
        }
        return n;
    }
};
PlayHistory history;
lume::PlayCompletion localCompletion;
std::string localSession,localHistoryId,localTitle;
Json localMetadata=Json::object();
struct Ticket { std::string secret, platform, model, decision; int64_t expiry; };
class Room {
    httplib::Server server;
    std::thread http, beacon;
    std::atomic<bool> active{false};
    std::mutex lock;
    std::string pin, name, error;
    std::map<std::string,Ticket> tickets;
    PhoneInvites invitations;
    std::set<std::string> sessions;
    std::map<std::string,Json> devices;
    std::map<std::string,std::pair<int64_t,int>> attempts;
    Json songs=Json::array(), catalog=Json::array();
    int version=0, selected=-1;
    std::shared_ptr<Decoder> decoder;
    std::string detailId, detailToken, detailCover, detailLyrics, detailSource;
    lume::PlayCompletion completion;
    std::string playSession;
    bool playing=false;
    bool shuffle=false, repeatOne=false;
    std::mt19937 shuffleRandom{std::random_device{}()};
    double offset=0;
    int64_t start=0;
    std::string trackId() const {return selected<0?"":songs[selected].at("id").get<std::string>();}
    double position(int64_t t) const { return offset+(playing?(t-start)/1000.0:0); }
    int nextIndex(int direction=1) { return lume::nextTrackIndex(selected,int(songs.size()),direction,shuffle,shuffleRandom); }
    bool choose(int index,bool play) {
        if(index<0 || index>=int(songs.size()))return false;
        if(playing&&decoder)history.sample(playSession,std::clamp(position(now()),0.,decoder->duration),false,true);
        if(selected!=index){
            auto next=std::make_shared<Decoder>(songs[index].at("path").get<std::string>());
            if(next->duration<=0){error="无法在空间播放这首歌，请选择 MP3、FLAC 或 WAV 文件";return false;}
            selected=index;decoder=next;
            detailId.clear();detailToken.clear();detailLyrics.clear();detailCover.clear();detailSource.clear();
        }
        completion.reset();
        playSession=token();
        if(play)completion.play(now()+1000);
        error.clear();offset=0;playing=play;start=now()+1000;return true;
    }
    void tick(int64_t time){
        if(playing&&selected>=0&&time>=start){auto metadata=songs[selected];metadata["source"]="room";metadata["duration"]=decoder?decoder->duration:0.;history.begin(playSession,songs[selected].value("historyId",trackId()),songs[selected].value("title",""),wallNow()-std::max<int64_t>(0,time-start),metadata);}
        if(playing&&decoder&&time>=start)history.sample(playSession,std::min(position(time),decoder->duration));
        if(playing && decoder && position(time)>=decoder->duration){
            if(completion.finish(decoder->duration,time)){
                catalog[selected]["playCount"]=history.add(songs[selected].value("historyId",trackId()),trackId(),decoder->duration,playSession);++version;
            }
            playing=false;offset=decoder->duration;
            choose(repeatOne?selected:nextIndex(),true);
        }
    }
    void session(Response& res){
        auto value="lume_session="+token();
        if(sessions.size()>=128){res.status=429;return;}
        sessions.insert(value);res.set_header("Set-Cookie",value+"; Path=/; HttpOnly; SameSite=Strict");
    }
    bool allowed(const Request& req, Response& res) {
        if(sessions.count(req.get_header_value("Cookie")))return true;
        res.status=401;return false;
    }
    void prune(){
        for(auto it=tickets.begin();it!=tickets.end();) if(it->second.expiry<now())it=tickets.erase(it);else ++it;
        for(auto it=devices.begin();it!=devices.end();) if(it->second.value("seen",int64_t(0))+6000<now())it=devices.erase(it);else ++it;
    }
    Json members() const {
        Json list=Json::array();
        for(const auto& entry:devices){
            Json peer=entry.second;
            peer.erase("seen");
            list.push_back(std::move(peer));
        }
        return list;
    }
    Json requests() const {
        Json list=Json::array();
        for(const auto& [id,t]:tickets)if(t.decision=="pending")
            list.push_back({{"id",id},{"platform",t.platform},{"name",t.model.empty()?t.platform:t.model}});
        return list;
    }
    bool patchOutput(const Json& b) {
        const auto it=std::find_if(devices.begin(),devices.end(),[&](const auto& item){return item.second["id"]==b.value("id","");});
        if(it==devices.end() || !b.contains("patch") || !b["patch"].is_object())return false;
        Json updated=it->second;
        for(const auto& [key,v]:b["patch"].items()){
            if(key=="channel" && (v=="left"||v=="right"||v=="stereo"||v=="mono"))updated[key]=v;
            else if(key=="delayMs" && v.is_number_integer() && v>=-1000 && v<=1000)updated[key]=v;
            else if(key=="volume" && v.is_number() && v>=0 && v<=1)updated[key]=v;
            else if((key=="enabled"||key=="muted") && v.is_boolean())updated[key]=v;
            else return false;
        }
        it->second=std::move(updated);return true;
    }
    std::string addresses(){
        std::string result;ifaddrs* list=nullptr;
        if(getifaddrs(&list)==0){
            for(auto* a=list;a;a=a->ifa_next){
                if(!a->ifa_addr||a->ifa_addr->sa_family!=AF_INET||(a->ifa_flags&IFF_LOOPBACK)||!(a->ifa_flags&IFF_UP))continue;
                char address[INET_ADDRSTRLEN];auto& ip=reinterpret_cast<sockaddr_in*>(a->ifa_addr)->sin_addr;
                auto v=ntohl(ip.s_addr);
                if((v>>24)!=10&&(v>>16)!=0xc0a8&&(v>>20)!=0xac1)continue;
                if(inet_ntop(AF_INET,&ip,address,sizeof(address))){if(!result.empty())result+=" · ";result+=std::string(address)+":"+std::to_string(port);}
            }
            freeifaddrs(list);
        }
        return result;
    }
    std::string lan;
    void routes(){
        server.set_payload_max_length(1024*1024);
        server.set_read_timeout(3,0);server.set_write_timeout(4,0);server.set_keep_alive_timeout(2);
        server.new_task_queue=[](){return new httplib::ThreadPool(5,40);};
        server.Get("/",[](auto&,auto& res){
            res.set_header("Content-Security-Policy","default-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; frame-ancestors 'none'");
            res.set_content(guestHtml,"text/html; charset=utf-8");
        });
        server.Get("/guest.js",[](auto&,auto& res){res.set_content(guestJs,"text/javascript");});
        server.Get("/outputs.js",[](auto&,auto& res){res.set_content(outputJs,"text/javascript");});
        server.Get("/api/info",[this](auto&,auto& res){sendJson(res,{{"service","lume-room/1"},{"roomName",name}});});
        server.Get("/api/outputs",[this](const Request& req,Response& res){
            std::lock_guard<std::mutex> guard(lock);if(!allowed(req,res))return;
            prune();Json peers=Json::array();for(auto& p:devices)peers.push_back(p.second);
            sendJson(res,{{"outputs",peers},{"trackId",trackId()},{"position",position(now())},{"playing",playing},{"error",error}});
        });
        server.Post(R"(/api/(pair|join/request|join/status|join/invite|receiver|action))",[this](const Request& req,Response& res){
            std::lock_guard<std::mutex> guard(lock);
            Json b=Json::parse(req.body,nullptr,false);
            if(!b.is_object()){res.status=400;return;}
            prune();
            if(req.path=="/api/join/invite"){
                if(sessions.size()>=128){res.status=429;return;}
                if(!invitations.accept(b.value("inviteToken",""),b.value("deviceId",""),req.remote_addr)){res.status=403;return;}
                session(res);sendJson(res,Json::object());return;
            }
            if(req.path=="/api/pair"){
                const auto time=now();
                for(auto it=attempts.begin();it!=attempts.end();)if(it->second.first<=time)it=attempts.erase(it);else ++it;
                auto& a=attempts[req.remote_addr];
                if(!a.first)a.first=time+60000;
                if(a.second>=12){res.status=429;return;}
                if(b.value("code","")!=pin){++a.second;res.status=401;return;}
                session(res);sendJson(res,Json::object());return;
            }
            if(req.path=="/api/join/request"){
                const auto platform=b.value("platform","");
                if(platform!="Android"&&platform!="HarmonyOS"&&platform!="Windows"){res.status=400;return;}
                if(tickets.size()>=32){res.status=429;return;}
                auto id=token(),secret=token();tickets[id]={secret,platform,b.value("model",""),"pending",now()+60000};
                sendJson(res,{{"id",id},{"secret",secret}});return;
            }
            if(req.path=="/api/join/status"){
                auto it=tickets.find(b.value("id",""));
                if(it==tickets.end()||it->second.secret!=b.value("secret","")){res.status=404;return;}
                auto decision=it->second.decision;
                if(decision=="allow")session(res);
                if(decision!="pending")tickets.erase(it);
                sendJson(res,{{"decision",decision}});return;
            }
            if(!allowed(req,res))return;
            const auto time=now();tick(time);
            if(req.path=="/api/action"){
                auto type=b.value("type",""), id=b.value("trackId","");
                if(type=="output"){
                    if(!patchOutput(b)){res.status=400;return;}
                }else if(type=="join-allow"||type=="join-deny"){
                    auto ticket=tickets.find(b.value("value",""));
                    if(ticket==tickets.end()||ticket->second.decision!="pending"){res.status=404;return;}
                    ticket->second.decision=type=="join-allow"?"allow":"deny";
                }else if(type=="play"&&!id.empty()){
                    auto it=std::find_if(songs.begin(),songs.end(),[&](auto& s){return s.at("id")==id;});
                    if(it==songs.end()){res.status=404;return;}
                    choose(int(it-songs.begin()),true);
                }else if(type=="playMode"){
                    auto mode=b.value("mode","");
                    if(mode!="sequence"&&mode!="repeatOne"&&mode!="shuffle"){res.status=400;return;}
                    shuffle=mode=="shuffle";repeatOne=mode=="repeatOne";
                }else if(type=="shuffle"){
                    if(!b.contains("value")||!b["value"].is_boolean()){res.status=400;return;}
                    shuffle=b["value"].get<bool>();repeatOne=false;
                }else if(type=="next"||type=="previous"){
                    choose(nextIndex(type=="next"?1:-1),true);
                }else if(type=="play"&&selected<0)choose(0,true);
                else if(type=="play"&&!playing){if(decoder&&offset>=decoder->duration){offset=0;completion.reset();}
                    start=time+700;completion.play(start);playing=true;}
                else if(type=="pause"){offset=std::max(0.,position(time));completion.pause(time);playing=false;history.sample(playSession,offset,false,true);}
                else if(type=="seek"&&decoder){offset=std::clamp(b.value("position",0.),0.,decoder->duration);start=time;completion.seek(offset,time);history.sample(playSession,offset,true,true);}
                sendJson(res,Json::object());return;
            }
            const auto key=req.get_header_value("Cookie");
            if(b.value("leave",false)){devices.erase(key);sessions.erase(key);sendJson(res,Json::object());return;}
            auto platform=b.value("platform","");
            auto& device=devices[key];
            if(device.is_null()){
                auto route=b.value("savedChannel",platform=="Android"?"right":platform=="Windows"?"stereo":"left");
                if(route!="left" && route!="right" && route!="mono" && route!="stereo")route="stereo";
                device={{"id",token()},{"platform",platform},{"name",b.value("model",platform)},
                    {"model",b.value("model",platform)},{"channel",route},{"delayMs",std::clamp(b.value("savedDelayMs",0),-1000,1000)},
                    {"muted",false},{"enabled",true},{"volume",1.0}};
            }
            device["seen"]=time;
            const std::string channel=device.at("channel");
            const bool enabled=device.at("enabled"),muted=device.at("muted");
            Json state={{"serverTime",time},{"position",position(time)},{"duration",decoder?decoder->duration:0.},
              {"roomPlaying",playing},{"shuffle",shuffle},{"playMode",shuffle?"shuffle":repeatOne?"repeatOne":"sequence"},{"playing",playing&&enabled},{"volume",muted?0.0:device.at("volume").get<double>()},{"enabled",enabled},{"channel",channel},{"delayMs",device.at("delayMs")},{"selfId",device.at("id")},{"outputs",members()},{"pending",requests()},
              {"trackId",trackId()},{"roomTrack",selected<0?std::string():songs[selected].at("title").get<std::string>()},{"libraryVersion",version},
              {"completion",history.event()},{"playRecords",history.recordSnapshot()},{"media",decoder?"/api/receiver-media/"+trackId()+"/"+channel:""},{"roomError",error}};
            if(detailId==trackId() && !detailToken.empty())state["detailToken"]=detailToken;
            if(selected>=0)state.update(Json::parse(peekMediaIdentity(songs[selected].at("path"))));
            if(b.value("libraryVersion",-1)!=version)state["catalog"]=catalog;
            sendJson(res,state);
        });
        server.Get(R"(/api/track-details/([A-Za-z0-9_-]+)/([a-f0-9]+))",[this](const Request& req,Response& res){
            std::lock_guard<std::mutex> guard(lock);
            if(!allowed(req,res))return;
            if(req.matches[1].str()!=trackId() || detailId!=trackId() || req.matches[2].str()!=detailToken){res.status=404;return;}
            res.set_header("Cache-Control","no-store");
            sendJson(res,{{"cover",detailCover},{"lyrics",detailLyrics},{"lyricsSource",detailSource}});
        });
        server.Get(R"(/api/listen/([A-Za-z0-9_-]+)/(left|right|mono|stereo))",[this](const Request& req,Response& res){
            std::shared_ptr<Decoder> source;
            {std::lock_guard<std::mutex> guard(lock);if(!allowed(req,res))return;
             if(req.matches[1].str()!=trackId()||!decoder){res.status=404;return;}source=decoder;}
            const uint64_t bytes=uint64_t(std::llround(source->duration*48000))*4;
            if(bytes>UINT32_MAX-36){res.status=413;return;}
            std::string header="RIFF";
            auto le=[&](uint32_t value,int width){for(int i=0;i<width;i++)header.push_back(char(value>>(8*i)));};
            le(bytes+36,4);header+="WAVEfmt ";le(16,4);le(1,2);le(2,2);le(48000,4);le(192000,4);le(4,2);le(16,2);header+="data";le(bytes,4);
            auto channel=req.matches[2].str();
            res.set_content_provider(bytes+header.size(),"audio/wav",[source,channel,header](size_t offset,size_t count,httplib::DataSink& sink){
                if(offset<header.size())return sink.write(header.data()+offset,std::min(count,header.size()-offset));
                constexpr size_t blockBytes=4*48000*4;
                offset-=header.size();
                auto chunk=source->block(int(offset/blockBytes),channel);
                size_t pos=offset%blockBytes;
                return pos<chunk.size() && sink.write(chunk.data()+pos,std::min(count,chunk.size()-pos));
            });
        });
        server.Get(R"(/api/pcm/([A-Za-z0-9_-]+)/(left|right|mono|stereo)/([0-9]{1,7}))",[this](const Request& req, Response& res){
            std::shared_ptr<Decoder> source;
            {std::lock_guard<std::mutex> guard(lock);if(!allowed(req,res))return;
             if(req.matches[1].str()!=trackId()||!decoder){res.status=404;return;}source=decoder;}
            auto bytes=source->block(std::stoi(req.matches[3]),req.matches[2]);
            if(bytes.empty()){res.status=404;return;}
            res.set_content(std::move(bytes),"application/octet-stream");
        });
    }
    void advertise(){
        int fd=socket(AF_INET,SOCK_DGRAM,0);if(fd<0)return;
        int yes=1;setsockopt(fd,SOL_SOCKET,SO_BROADCAST,&yes,sizeof(yes));setsockopt(fd,SOL_SOCKET,SO_REUSEADDR,&yes,sizeof(yes));
        sockaddr_in addr{};addr.sin_family=AF_INET;addr.sin_port=htons(46322);
        if(bind(fd,(sockaddr*)&addr,sizeof(addr))<0){close(fd);return;}
        auto msg=Json({{"service","lume-room/1"},{"port",port},{"name",name},{"guest",true}}).dump();int64_t next=0;
        while(active){
            if(now()>=next){
                sockaddr_in dest{};dest.sin_family=AF_INET;dest.sin_port=htons(46323);dest.sin_addr.s_addr=INADDR_BROADCAST;
                sendto(fd,msg.data(),msg.size(),0,(sockaddr*)&dest,sizeof(dest));next=now()+1100;
            }
            pollfd p{fd,POLLIN,0};if(poll(&p,1,200)<=0)continue;
            char buf[48];sockaddr_in peer{};socklen_t size=sizeof(peer);
            auto n=recvfrom(fd,buf,sizeof(buf),0,(sockaddr*)&peer,&size);
            if(n==15&&std::string(buf,n)=="LUME_DISCOVER_1")sendto(fd,msg.data(),msg.size(),0,(sockaddr*)&peer,size);
        }
        close(fd);
    }
public:
    Room(){routes();}
    ~Room(){active=false;server.stop();if(http.joinable())http.join();if(beacon.joinable())beacon.join();if(playing&&decoder)history.sample(playSession,std::clamp(position(now()),0.,decoder->duration),false,true);}
    void update(const Json& items){
        std::lock_guard<std::mutex> guard(lock);
        auto old=trackId();songs=items;selected=-1;catalog=Json::array();
        for(auto& song:songs){
            Json entry={{"id",song.at("id")},{"title",song.at("title")}};
            for(const auto* key:{"artist","album","folder","quality","bytes","fileName","year","duration","trackNumber","discNumber","modifiedAt","addedAt","hasLyrics","hasSideLyrics","hasSideCover"})if(song.contains(key))entry[key]=song[key];
            entry["playCount"]=history.get(song.value("historyId",song.at("id").get<std::string>()));
            catalog.push_back(std::move(entry));if(song.at("id")==old)selected=int(catalog.size())-1;
        }
        ++version;if(selected<0){decoder.reset();playing=false;offset=0;}
    }
    bool open(const Json& b){
        name=b.at("name");shuffle=b.value("shuffle",false);repeatOne=b.value("playMode","")=="repeatOne";lan=addresses();update(b.at("songs"));
        std::random_device rng;pin=std::to_string(std::uniform_int_distribution<int>(100000,999999)(rng));
        if(!server.bind_to_port("0.0.0.0",port))return false;
        active=true;http=std::thread([this]{server.listen_after_bind();});server.wait_until_ready();
        beacon=std::thread([this]{advertise();});return true;
    }
    Json info(){
        std::lock_guard<std::mutex> guard(lock);prune();
        Json result={{"pin",pin},{"address",lan},{"port",port},{"pending",requests()},{"outputs",members()},{"shuffle",shuffle},{"playMode",shuffle?"shuffle":repeatOne?"repeatOne":"sequence"},{"error",error},{"completion",history.event()}};
        result.update(invitations.state());return result;
    }
    void searchPhones(const Json& request){std::lock_guard<std::mutex> guard(lock);invitations.search(request);}
    void invitePhone(const Json& b){std::lock_guard<std::mutex> guard(lock);invitations.invite(b.value("id",""),name,port);}
    void setDetails(const Json& b){
        std::lock_guard<std::mutex> guard(lock);
        const auto id=b.value("id",""),cover=b.value("cover",""),lyrics=b.value("lyrics",""),source=b.value("lyricsSource","unknown");
        if(id.empty() || id!=trackId() || cover.size()>3000000 || lyrics.size()>2097152)return;
        if(detailId==id && detailCover==cover && detailLyrics==lyrics && detailSource==source)return;
        detailId=id;detailCover=cover;detailLyrics=lyrics;detailSource=source;detailToken=token();
    }
    void decide(const Json& b){std::lock_guard<std::mutex> guard(lock);auto it=tickets.find(b.value("id",""));if(it!=tickets.end())it->second.decision=b.value("enabled",false)?"allow":"deny";}
};
NearbyPhone nearby;
std::unique_ptr<Room> room;
std::mutex admin;
}
std::string mobileRoom(const std::string& command){
    std::lock_guard<std::mutex> guard(admin);
    try{
        auto b=Json::parse(command);auto type=b.value("type","");
        if(type=="audioFacts")return audio_facts::inspect(b.at("path"),b.value("format","")).dump();
        if(type=="openHistory"){history.open(b.at("path"));return history.snapshot().dump();}
        if(type=="historyEvent")return history.event().dump();
        if(type=="historyRecords")return Json{{"records",history.recordSnapshot()}}.dump();
        if(type=="playbackEvent"){
            const auto session=b.value("session",""),event=b.value("event","");
            if(event=="begin"){localSession=session;localHistoryId=b.value("id","");localTitle=b.value("title","");localMetadata=b.value("metadata",Json::object());localCompletion.reset();}
            else if(!session.empty() && session==localSession){
                if(event=="play"){localMetadata["duration"]=b.value("trackDuration",0.);history.begin(session,localHistoryId,localTitle,0,localMetadata);localCompletion.play(now());}
                history.sample(session,b.value("cursor",0.),event=="seeked",event!="sample");
                if(event=="seek")history.sample(session,b.value("position",0.),true,true);
                if(event=="pause")localCompletion.pause(now());
                else if(event=="seek")localCompletion.seek(b.value("position",0.),now());
                else if(event=="complete" && localCompletion.finish(b.value("duration",0.),now()))
                    history.add(localHistoryId,localHistoryId,b.value("duration",0.),session);
                else if(event=="stop")localSession.clear();
            }
            return history.snapshot().dump();
        }
        if(type=="history")return history.snapshot().dump();
        if(type=="nearby")return nearby.poll(b).dump();
        if(type=="nearbyStop"){nearby.stop();return "{}";}
        if(type=="start"){
            if(!room){auto next=std::make_unique<Room>();if(!next->open(b))return R"({"error":"无法创建空间，请检查网络或端口占用"})";room=std::move(next);}
        }else if(type=="stop")room.reset();
        else if(type=="trackDetails"&&room){room->setDetails(b);return "{}";}
        else if(type=="decide"&&room)room->decide(b);
        else if(type=="searchPhones"&&room)room->searchPhones(b);
        else if(type=="invitePhone"&&room)room->invitePhone(b);
        else if(type=="update"&&room)room->update(b.at("songs"));
        return room?room->info().dump():"{}";
    }catch(const std::exception&){return R"({"error":"空间操作失败"})";}
}
