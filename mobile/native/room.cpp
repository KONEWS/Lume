#include "vendor/httplib.h"
#include "vendor/json.hpp"
#include <arpa/inet.h>
#ifdef __ANDROID__
#include <android/multinetwork.h>
#endif
#include <ifaddrs.h>
#include <net/if.h>
#include <poll.h>
#include <fcntl.h>
#include <random>
#include <list>
#include <condition_variable>
#include <set>
#include "decoder.hpp"
#include "local_media.hpp"
#include "audio_facts.hpp"
#include "playback_order.hpp"
#include "play_completion.hpp"
#include "peer_exchange.hpp"
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
// The foreground page owns the responder. UDP reads must keep running when
// ArkUI throttles page timers. Only invitation presentation needs the UI.
class NearbyPhone {
    int fd=-1;
    std::string id;
    int64_t retryAt=0;
    std::mutex mutex;
    Json state,pending;
    struct Challenge {std::string nonce,proof;int64_t until;};
    std::map<uint64_t,Challenge> challenges;
    Json offer;
    sockaddr_in sender{};
    in_pktinfo offerRoute{};
    int64_t offerUntil=0;
    static void replyTo(int fd,sockaddr_in peer,in_pktinfo route,std::string data){
        route.ipi_addr={};
        alignas(cmsghdr) char control[CMSG_SPACE(sizeof(route))]{};
        iovec vec{data.data(),data.size()};msghdr answer{};
        answer.msg_name=&peer;answer.msg_namelen=sizeof(peer);answer.msg_iov=&vec;answer.msg_iovlen=1;
        if(route.ipi_ifindex){
            answer.msg_control=control;answer.msg_controllen=sizeof(control);auto* header=CMSG_FIRSTHDR(&answer);
            header->cmsg_level=IPPROTO_IP;header->cmsg_type=IP_PKTINFO;header->cmsg_len=CMSG_LEN(sizeof(route));
            memcpy(CMSG_DATA(header),&route,sizeof(route));if(sendmsg(fd,&answer,0)>=0)return;
        }
        sendto(fd,data.data(),data.size(),0,reinterpret_cast<sockaddr*>(&peer),sizeof(peer));
    }
    std::atomic<bool> listening{false};
    std::thread reader;
public:
    void stop(){
        listening=false;if(reader.joinable())reader.join();
        if(fd>=0)close(fd);
        fd=-1; id.clear(); retryAt=0;pending=Json::object();offer=Json::object();offerUntil=0;challenges.clear();
    }
    ~NearbyPhone(){stop();}
    Json feedback(const Json& action){
        std::lock_guard<std::mutex> guard(mutex);
        if(!offerUntil||action.value("offerId","")!=offer.value("offerId",""))return Json::object();
        auto status=action.value("status","");
        if(status!="shown" && status!="declined" && status!="expired" && status!="accept")return Json::object();
        if(now()>=offerUntil)status="expired";
        if(status=="accept"){
            auto result=offer;offerUntil=0;offer=Json::object();return result;
        }
        replyTo(fd,sender,offerRoute,Json({{"service","lume-invite-status/1"},{"status",status},
            {"id",id},{"inviteToken",offer.value("inviteToken","")}}).dump());
        if(status!="shown"){offerUntil=0;offer=Json::object();}
        return Json::object();
    }
    Json poll(const Json& update){
        {std::lock_guard<std::mutex> g(mutex);state=update;}
        if(fd<0){
            if(now()<retryAt)return Json::object();
            retryAt=now()+3000;
            fd=socket(AF_INET,SOCK_DGRAM,0);
            if(fd<0)return {{"listenerError",errno}};
            int flags=fcntl(fd,F_GETFL,0);if(flags>=0)fcntl(fd,F_SETFL,flags|O_NONBLOCK);
            int yes=1;setsockopt(fd,IPPROTO_IP,IP_PKTINFO,&yes,sizeof(yes));
            sockaddr_in local{};local.sin_family=AF_INET;local.sin_port=htons(46324);
            if(bind(fd,reinterpret_cast<sockaddr*>(&local),sizeof(local))<0){
                int reason=errno;close(fd);fd=-1;return {{"listenerError",reason}};
            }
            id=localPhoneId();
            listening=true;reader=std::thread([this]{
                while(listening){
                    pollfd p{fd,POLLIN,0};if(::poll(&p,1,150)<=0)continue;
                    std::lock_guard<std::mutex> g(mutex);
                    try{auto invite=readPackets();if(invite.contains("url"))pending=std::move(invite);}catch(const Json::exception&){}
                }
            });
        }
        std::lock_guard<std::mutex> g(mutex);
        Json result=Json::object();result.swap(pending);pending=Json::object();return now()<offerUntil&&result.is_object()?result:Json::object();
    }
private:
    Json readPackets(){
        for(int i=0;i<12;++i){
            char buf[9216];sockaddr_in peer{};
            alignas(cmsghdr) char control[CMSG_SPACE(sizeof(in_pktinfo))]{};
            iovec vec{buf,sizeof(buf)};msghdr packetMsg{};packetMsg.msg_name=&peer;packetMsg.msg_namelen=sizeof(peer);
            packetMsg.msg_iov=&vec;packetMsg.msg_iovlen=1;packetMsg.msg_control=control;packetMsg.msg_controllen=sizeof(control);
            const auto n=recvmsg(fd,&packetMsg,MSG_DONTWAIT);
            if(n<=0)break;
            const auto packet=Json::parse(buf,buf+n,nullptr,false);
            if(!packet.is_object())continue;
            const auto service=packet.value("service","");
            const auto availability=state.value("availability","available");
            in_pktinfo route{};
            for(auto* c=CMSG_FIRSTHDR(&packetMsg);c;c=CMSG_NXTHDR(&packetMsg,c)){
                if(c->cmsg_level==IPPROTO_IP && c->cmsg_type==IP_PKTINFO && c->cmsg_len>=CMSG_LEN(sizeof(route))){
                    memcpy(&route,CMSG_DATA(c),sizeof(route));break;
                }
            }
            const uint64_t endpoint=(uint64_t(peer.sin_addr.s_addr)<<16)|peer.sin_port;
            for(auto it=challenges.begin();it!=challenges.end();)if(it->second.until<=now())it=challenges.erase(it);else ++it;
            if(service=="lume-find-phone/1"){
                const auto nonce=packet.value("nonce","");
                if(nonce.size()!=24 || (availability!="available"&&!packet.value("includeBusy",false)))continue;
                if(!challenges.count(endpoint)&&challenges.size()>=128)continue;
                auto& challenge=challenges[endpoint];
                if(challenge.nonce!=nonce){challenge.nonce=nonce;challenge.proof=token();}
                challenge.until=now()+60000;
                auto reply=Json({{"service","lume-phone/1"},{"nonce",nonce},{"id",id},{"inviteProof",challenge.proof},
                    {"platform",state.at("platform")},{"model",state.value("model",state.at("platform").get<std::string>())},{"availability",availability}}).dump();
                replyTo(fd,peer,route,reply);
            }else if(service=="lume-invite/1" && (availability=="hosting"||availability=="available") && packet.value("id","")==id){
                auto challenge=challenges.find(endpoint);
                if(challenge==challenges.end()||now()<offerUntil)continue;
                auto proof=packet.value("inviteProof",""),secret=packet.value("inviteToken","");
                if((!proof.empty()||availability=="hosting") && proof!=challenge->second.proof)continue;
                if(availability=="hosting" && secret.size()!=32)continue;
                const int hostPort=packet.value("port",0);
                char address[INET_ADDRSTRLEN];
                if(hostPort<1||hostPort>65535||!inet_ntop(AF_INET,&peer.sin_addr,address,sizeof(address)))continue;
                challenges.erase(challenge);offerUntil=now()+30000;sender=peer;offerRoute=route;
                offer={{"url",std::string("http://")+address+":"+std::to_string(hostPort)},{"name",packet.value("name","播放空间")},
                    {"inviteToken",secret},{"deviceId",id},{"offerId",token()},{"switchHost",availability=="hosting"}};
                return offer;
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
    std::function<void(const Json&)> changed;
    int64_t savedAt=0;
    void saveRecords(){if(changed&&!records.empty())changed(records.back());if(file.empty())return;auto path=file+".records",tmp=path+".tmp";std::ofstream out(tmp);out<<records.dump();out.close();if(out)std::rename(tmp.c_str(),path.c_str());}
public:
    void onChange(std::function<void(const Json&)> fn){std::lock_guard<std::mutex> guard(mutex);changed=std::move(fn);}
    Json latest(){std::lock_guard<std::mutex> guard(mutex);return records.empty()?Json::array():Json::array({records.back()});}
    Json sessionRecords(const std::string& current,const std::string& previous){
        std::lock_guard<std::mutex> guard(mutex);Json result=Json::array();
        for(auto it=records.rbegin();it!=records.rend();++it){
            auto id=it->value("session","");if(id==current||id==previous)result.push_back(*it);
            if(result.size()==(previous.empty()||current==previous?1:2))break;
        }
        return result;
    }
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
        records.back().update(personal::origin());
        for(const auto* key:{"artist","album","format","quality","sampleRate","bitDepth","duration","source","sourceType","sourceName"})if(metadata.contains(key))records.back()[key]=metadata[key];
        records.back()["playModeSource"]=metadata.value("source","local")=="room"?"room":"local";records.back()["source"]=metadata.value("source","local");records.back()["sourceType"]=metadata.value("sourceType","track");
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
    const std::string roomId=token();
    std::map<std::string,Ticket> tickets;
    PhoneInvites invitations;
    std::set<std::string> sessions;
    std::map<std::string,Json> devices;
    std::map<std::string,std::pair<int64_t,int>> attempts;
    Json songs=Json::array(), catalog=Json::array();
    std::string coverRevision;
    std::set<std::string> coverIds;
    std::list<std::string> coverRequests;
    std::condition_variable coverReady;
    unsigned coverWaiters=0;
    std::map<std::string,std::string> thumbnails;
    std::list<std::string> coverOrder;
    size_t coverBytes=0;
    int version=0, selected=-1;
    std::shared_ptr<Decoder> decoder;
    std::string detailId, detailToken, detailCover, detailLyrics, detailSource;
    Json detailAudio=Json::object();
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
            detailId.clear();detailToken.clear();detailLyrics.clear();detailCover.clear();detailSource.clear();detailAudio=Json::object();
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
            peer.erase("hostInterface");
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
        std::set<std::string> candidates;ifaddrs* list=nullptr;
        if(getifaddrs(&list)==0){
            for(auto* a=list;a;a=a->ifa_next){
                if(!a->ifa_addr||a->ifa_addr->sa_family!=AF_INET||(a->ifa_flags&IFF_LOOPBACK)||!(a->ifa_flags&IFF_UP))continue;
                const std::string iface=a->ifa_name;
                if(iface.rfind("wlan",0)!=0 && iface.rfind("softap",0)!=0 && iface.rfind("ap",0)!=0 && iface.rfind("eth",0)!=0)continue;
                char address[INET_ADDRSTRLEN];auto& ip=reinterpret_cast<sockaddr_in*>(a->ifa_addr)->sin_addr;
                auto v=ntohl(ip.s_addr);
                if((v>>24)!=10&&(v>>16)!=0xc0a8&&(v>>20)!=0xac1)continue;
                if(inet_ntop(AF_INET,&ip,address,sizeof(address)))candidates.insert(address);
            }
            freeifaddrs(list);
        }
        return candidates.size()==1?*candidates.begin():"";
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
        server.Get("/api/info",[this](const Request& req,Response& res){
            in_addr ip{};if(inet_pton(AF_INET,req.remote_addr.c_str(),&ip)==1){std::lock_guard<std::mutex> g(lock);invitations.remember(ip.s_addr);}
            sendJson(res,{{"service","lume-room/1"},{"roomName",name},{"roomId",roomId}});
        });
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
            if(b.contains("model")&&b.at("model").is_string()&&!b.at("model").get_ref<const std::string&>().empty()){device["name"]=b.at("model");device["model"]=b.at("model");}
            device["seen"]=time;
            if(req.local_addr.rfind("127.",0)!=0 && !req.local_addr.empty())device["hostInterface"]=req.local_addr;
            const std::string channel=device.at("channel");
            const bool enabled=device.at("enabled"),muted=device.at("muted");
            Json state={{"serverTime",time},{"position",position(time)},{"duration",decoder?decoder->duration:0.},
              {"roomPlaying",playing},{"shuffle",shuffle},{"playMode",shuffle?"shuffle":repeatOne?"repeatOne":"sequence"},{"playing",playing&&enabled},{"volume",muted?0.0:device.at("volume").get<double>()},{"enabled",enabled},{"channel",channel},{"delayMs",device.at("delayMs")},{"selfId",device.at("id")},{"outputs",members()},{"pending",requests()},
              {"trackId",trackId()},{"roomTrack",selected<0?std::string():songs[selected].at("title").get<std::string>()},{"libraryVersion",version},
              {"completion",history.event()},{"currentSession",playSession},{"playRecords",history.sessionRecords(playSession,device.value("previousSession",""))},{"media",decoder?"/api/receiver-media/"+trackId()+"/"+channel:""},{"roomError",error}};
            state["hostAddress"]=req.local_addr;
            device["previousSession"]=playSession;
            if(detailId==trackId() && !detailToken.empty())state["detailToken"]=detailToken;
            if(selected>=0)state.update(Json::parse(peekMediaIdentity(songs[selected].at("path"))));
            if(b.value("libraryVersion",-1)!=version)state["catalog"]=catalog;
            sendJson(res,state);
        });
        server.Get(R"(/api/catalog-cover/([a-f0-9]{32})/([A-Za-z0-9_-]+))",[this](const Request& req,Response& res){
            std::unique_lock<std::mutex> guard(lock);
            if(!allowed(req,res))return;
            const auto id=req.matches[2].str();
            const auto revision=req.matches[1].str();
            if(revision!=coverRevision || !coverIds.count(id)){res.status=404;return;}
            const auto enqueue=[&](const std::string& next){
                if(coverRequests.size()<16 && coverIds.count(next) && !thumbnails.count(next) &&
                    std::find(coverRequests.begin(),coverRequests.end(),next)==coverRequests.end())coverRequests.push_back(next);
            };
            enqueue(id);
            const auto visible=req.get_param_value("visible");
            if(visible.size()<=1024){
                std::istringstream ids(visible);
                std::string next;
                for(int n=0;n<12 && std::getline(ids,next,',');++n)enqueue(next);
            }
            // At most two image readers wait; control and audio retain their workers.
            if(!thumbnails.count(id) && coverWaiters<2){
                ++coverWaiters;
                coverReady.wait_for(guard,std::chrono::milliseconds(850),[&]{return !active || coverRevision!=revision || thumbnails.count(id);});
                --coverWaiters;
                if(!active || coverRevision!=revision){res.status=404;return;}
            }
            auto found=thumbnails.find(id);
            if(found!=thumbnails.end()){
                coverOrder.remove(id);coverOrder.push_back(id);
                sendJson(res,{{"cover",found->second}});return;
            }
            sendJson(res,{{"pending",true}});
        });
        server.Get(R"(/api/track-details/([A-Za-z0-9_-]+)/([a-f0-9]+))",[this](const Request& req,Response& res){
            std::lock_guard<std::mutex> guard(lock);
            if(!allowed(req,res))return;
            if(req.matches[1].str()!=trackId() || detailId!=trackId() || req.matches[2].str()!=detailToken){res.status=404;return;}
            res.set_header("Cache-Control","no-store");
            sendJson(res,{{"cover",detailCover},{"lyrics",detailLyrics},{"lyricsSource",detailSource},{"audioInfo",detailAudio}});
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
        int fd=socket(AF_INET,SOCK_DGRAM,0);
        int yes=1;setsockopt(fd,SOL_SOCKET,SO_BROADCAST,&yes,sizeof(yes));setsockopt(fd,SOL_SOCKET,SO_REUSEADDR,&yes,sizeof(yes));
        sockaddr_in addr{};addr.sin_family=AF_INET;addr.sin_port=htons(46322);
        if(fd>=0 && bind(fd,(sockaddr*)&addr,sizeof(addr))<0){close(fd);fd=-1;}
        auto msg=Json({{"service","lume-room/1"},{"port",port},{"name",name},{"guest",true},{"roomId",roomId}}).dump();int64_t next=0;
        while(active){
            // Device queries and replies must advance even if the page's status timer is suspended.
            {std::lock_guard<std::mutex> g(lock);invitations.poll();}
            if(fd>=0 && now()>=next){
                sockaddr_in dest{};dest.sin_family=AF_INET;dest.sin_port=htons(46323);dest.sin_addr.s_addr=INADDR_BROADCAST;
                sendto(fd,msg.data(),msg.size(),0,(sockaddr*)&dest,sizeof(dest));next=now()+1100;
            }
            pollfd p{fd,POLLIN,0};if(poll(&p,1,200)<=0)continue;
            char buf[48];sockaddr_in peer{};socklen_t size=sizeof(peer);
            auto n=recvfrom(fd,buf,sizeof(buf),0,(sockaddr*)&peer,&size);
            if(n==15&&std::string(buf,n)=="LUME_DISCOVER_1"){
                {std::lock_guard<std::mutex> g(lock);invitations.remember(peer.sin_addr.s_addr);}
                sendto(fd,msg.data(),msg.size(),0,(sockaddr*)&peer,size);
            }
        }
        if(fd>=0)close(fd);
    }
public:
    Room(){routes();}
    ~Room(){active=false;coverReady.notify_all();server.stop();if(http.joinable())http.join();if(beacon.joinable())beacon.join();if(playing&&decoder)history.sample(playSession,std::clamp(position(now()),0.,decoder->duration),false,true);}
    void update(const Json& items){
        std::lock_guard<std::mutex> guard(lock);
        auto old=trackId();songs=items;selected=-1;catalog=Json::array();
        coverRevision=token();coverIds.clear();coverRequests.clear();thumbnails.clear();coverOrder.clear();coverBytes=0;
        coverReady.notify_all();
        detailId.clear();detailToken.clear();detailCover.clear();detailLyrics.clear();
        for(auto& song:songs){
            Json entry={{"id",song.at("id")},{"title",song.at("title")},{"coverRevision",coverRevision}};
            coverIds.insert(song.at("id").get<std::string>());
            for(const auto* key:{"artist","album","folder","quality","bytes","fileName","format","codec","sampleRate","bitrate","year","duration","trackNumber","discNumber","modifiedAt","addedAt","hasLyrics","hasSideLyrics","hasSideCover"})if(song.contains(key))entry[key]=song[key];
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
        Json result={{"roomId",roomId},{"pin",pin},{"address",lan},{"port",port},{"pending",requests()},{"outputs",members()},{"shuffle",shuffle},{"playMode",shuffle?"shuffle":repeatOne?"repeatOne":"sequence"},{"error",error},{"completion",history.event()}};
        for(const auto& entry:devices)if(entry.second.contains("hostInterface")){result["address"]=entry.second.at("hostInterface");break;}
        result["coverRevision"]=coverRevision;result["coverRequests"]=coverRequests;
        result.update(invitations.state());return result;
    }
    void setThumbnail(const Json& b){
        std::lock_guard<std::mutex> guard(lock);
        const auto id=b.value("id",""),cover=b.value("cover","");
        auto request=std::find(coverRequests.begin(),coverRequests.end(),id);
        if(b.value("coverRevision","")!=coverRevision || request==coverRequests.end() || cover.size()>1500000)return;
        coverRequests.erase(request);
        thumbnails[id]=cover;coverBytes+=cover.size();coverOrder.push_back(id);
        coverReady.notify_all();
        while(coverOrder.size()>256 || coverBytes>8*1024*1024){
            const auto oldest=coverOrder.front();coverOrder.pop_front();
            coverBytes-=thumbnails.at(oldest).size();thumbnails.erase(oldest);
        }
    }
    void searchPhones(const Json& request){std::lock_guard<std::mutex> guard(lock);invitations.search(request);}
    void invitePhone(const Json& b){
        std::lock_guard<std::mutex> guard(lock);
        invitations.invite(b.value("id",""),personal::origin().value("originDeviceName",name),port);
    }
    void setDetails(const Json& b){
        std::lock_guard<std::mutex> guard(lock);
        const auto id=b.value("id",""),cover=b.value("cover",""),lyrics=b.value("lyrics",""),source=b.value("lyricsSource","unknown");
        if(id.empty() || id!=trackId() || b.value("coverRevision",coverRevision)!=coverRevision || cover.size()>3000000 || lyrics.size()>2097152)return;
        const Json audio=b.value("audioInfo",Json::object());
        if(detailId==id && detailCover==cover && detailLyrics==lyrics && detailSource==source && detailAudio==audio)return;
        detailAudio=audio;
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
        if(type=="deviceIdentity")return personal::origin().dump();
        if(type=="openHistory"){
            std::string file=b.at("path");history.open(file);
            personal::command({{"op","init"},{"dir",file.substr(0,file.find_last_of('/'))},{"name",b.value("name","澄音设备")}});
            history.onChange([](const Json& row){personal::ingest(Json::array({row}));});
            personal::ingest(history.recordSnapshot());return history.snapshot().dump();
        }
        if(type=="personal")return personal::command(b).dump();
        if(type=="historyEvent")return history.event().dump();
        if(type=="historyRecords"){
            personal::ingest(history.latest());
            if(b.contains("current"))personal::command({{"op","observe"},{"current",b["current"]},{"rows",b.value("rows",Json::array())},{"playing",b.value("playing",false)}});
            auto merged=personal::records();return Json{{"records",merged.empty()?history.recordSnapshot():merged}}.dump();
        }
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
        if(type=="inviteFeedback")return nearby.feedback(b).dump();
        if(type=="nearby")return nearby.poll(b).dump();
        if(type=="nearbyStop"){nearby.stop();return "{}";}
        if(type=="start"){
            if(!room){auto next=std::make_unique<Room>();if(!next->open(b))return R"({"error":"无法创建空间，请检查网络或端口占用"})";room=std::move(next);}
        }else if(type=="stop")room.reset();
        else if(type=="catalogThumbnail"&&room){room->setThumbnail(b);return "{}";}
        else if(type=="trackDetails"&&room){room->setDetails(b);return "{}";}
        else if(type=="decide"&&room)room->decide(b);
        else if(type=="searchPhones"&&room)room->searchPhones(b);
        else if(type=="invitePhone"&&room)room->invitePhone(b);
        else if(type=="update"&&room)room->update(b.at("songs"));
        return room?room->info().dump():"{}";
    }catch(const std::exception&){return R"({"error":"空间操作失败"})";}
}
