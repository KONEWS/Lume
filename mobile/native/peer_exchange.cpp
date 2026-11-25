#include "vendor/httplib.h"
#include "peer_exchange.hpp"
#include "vendor/monocypher.h"
#include "vendor/utf8proc/utf8proc.h"
#include <filesystem>
#include <fstream>
#include <set>
#ifdef _WIN32
#include <iphlpapi.h>
#include <bcrypt.h>
#else
#include <ifaddrs.h>
#include <net/if.h>
#endif

namespace personal {
namespace fs = std::filesystem;
namespace {
using Clock = std::chrono::steady_clock;
using Bytes = std::vector<uint8_t>;
constexpr int port = 46327;
constexpr size_t chunkSize = 256 * 1024;
constexpr size_t binaryChunkSize = 2 * 1024 * 1024;
constexpr size_t packetLimit = 1024 * 1024;
constexpr int64_t fileLimit = 500LL * 1024 * 1024;
constexpr int chunkTimeoutSeconds = 20;
const char* service = "lume-personal/1";
std::string hex(const uint8_t* bytes, size_t n) {
    std::string out(n*2,'0'); const char digits[]="0123456789abcdef";
    for(size_t i=0;i<n;i++){out[2*i]=digits[bytes[i]>>4]; out[2*i+1]=digits[bytes[i]&15];}
    return out;
}
Bytes unhex(const std::string& s) {
    if(s.size()%2) throw std::invalid_argument("hex");
    auto nib=[](char c)->int {if(c>='0'&&c<='9')return c-'0';if(c>='a'&&c<='f')return c-'a'+10;throw std::invalid_argument("hex");};
    Bytes out(s.size()/2);for(size_t i=0;i<out.size();i++)out[i]=uint8_t(nib(s[i*2])*16+nib(s[i*2+1]));
    return out;
}
Bytes randomBytes(size_t n) {
    Bytes out(n);
#ifdef _WIN32
    if(BCryptGenRandom(nullptr,out.data(),ULONG(n),BCRYPT_USE_SYSTEM_PREFERRED_RNG)!=0)throw std::runtime_error("random");
#else
    std::ifstream rng("/dev/urandom",std::ios::binary);
    if(!rng.read(reinterpret_cast<char*>(out.data()),n))throw std::runtime_error("random");
#endif
    return out;
}
std::string randomId(){auto b=randomBytes(16);return hex(b.data(),b.size());}
bool validId(const std::string& s,size_t n){return s.size()==n&&s.find_first_not_of("0123456789abcdef")==s.npos;}
void atomicWrite(const fs::path& file,const Json& value){
    auto tmp=file;tmp+=".tmp";std::ofstream out(tmp,std::ios::binary|std::ios::trunc);out<<value.dump();out.close();
    if(!out)throw std::runtime_error("设备存储写入失败");
#ifdef _WIN32
    if(!MoveFileExW(tmp.c_str(),file.c_str(),MOVEFILE_REPLACE_EXISTING|MOVEFILE_WRITE_THROUGH))throw std::runtime_error("设备存储更新失败");
#else
    fs::rename(tmp,file);
#endif
}
Json load(const fs::path& file,const Json& fallback){
    if(!fs::exists(file))return fallback;
    std::ifstream in(file,std::ios::binary);return Json::parse(in);
}
struct Network {uint32_t ip,mask;};
std::vector<Network> networks(){
    std::vector<Network> result;
#ifdef _WIN32
    ULONG len=16000;Bytes buf(len);
    for(int tries=0;tries<3;tries++){
        auto list=reinterpret_cast<IP_ADAPTER_ADDRESSES*>(buf.data());
        auto rc=GetAdaptersAddresses(AF_INET,GAA_FLAG_INCLUDE_PREFIX,nullptr,list,&len);
        if(rc==ERROR_BUFFER_OVERFLOW){buf.resize(len);continue;}
        if(rc==NO_ERROR)for(auto a=list;a;a=a->Next){
            if(a->OperStatus!=IfOperStatusUp||a->IfType==IF_TYPE_SOFTWARE_LOOPBACK)continue;
            for(auto u=a->FirstUnicastAddress;u;u=u->Next){
                int p=u->OnLinkPrefixLength;if(p<1||p>32)continue;
                result.push_back({reinterpret_cast<sockaddr_in*>(u->Address.lpSockaddr)->sin_addr.s_addr,htonl(0xffffffffu<<(32-p))});
            }
        }
        break;
    }
#else
    ifaddrs* list=nullptr;if(getifaddrs(&list))return result;
    for(auto a=list;a;a=a->ifa_next){
        if(!a->ifa_addr||a->ifa_addr->sa_family!=AF_INET||!a->ifa_netmask||!(a->ifa_flags&IFF_UP)||(a->ifa_flags&(IFF_LOOPBACK|IFF_POINTOPOINT)))continue;
        result.push_back({reinterpret_cast<sockaddr_in*>(a->ifa_addr)->sin_addr.s_addr,reinterpret_cast<sockaddr_in*>(a->ifa_netmask)->sin_addr.s_addr});
    }
    freeifaddrs(list);
#endif
    return result;
}
std::string ipText(uint32_t ip){in_addr addr{};addr.s_addr=ip;char buf[INET_ADDRSTRLEN]{};inet_ntop(AF_INET,&addr,buf,sizeof(buf));return buf;}
bool localAddress(const std::string& address){
    in_addr ip{};if(inet_pton(AF_INET,address.c_str(),&ip)!=1)return false;
    if((ntohl(ip.s_addr)>>24)==127)return true;
    for(const auto& n:networks())if(n.mask&&(ip.s_addr&n.mask)==(n.ip&n.mask))return true;
    return false;
}
// Count extended grapheme clusters in one shared implementation on all three platforms.
struct DisplayName {std::string value;size_t count=0;};
DisplayName displayName(const std::string& raw){
    size_t start=raw.size(),end=0,count=0;
    utf8proc_int32_t previous=-1,state=0;
    for(size_t i=0;i<raw.size();){
        utf8proc_int32_t cp;
        const auto n=utf8proc_iterate(reinterpret_cast<const uint8_t*>(raw.data()+i),raw.size()-i,&cp);
        if(n<=0)throw std::runtime_error("设备名称包含无效字符");
        const auto category=utf8proc_category(cp);
        if(category==UTF8PROC_CATEGORY_CC||category==UTF8PROC_CATEGORY_ZL||category==UTF8PROC_CATEGORY_ZP)
            throw std::runtime_error("设备名称请使用单行文字");
        if(category!=UTF8PROC_CATEGORY_ZS&&cp!=0xfeff){start=std::min(start,i);end=i+n;}
        i+=n;
    }
    if(end<=start)return {};
    for(size_t i=start;i<end;){
        utf8proc_int32_t cp;
        const auto n=utf8proc_iterate(reinterpret_cast<const uint8_t*>(raw.data()+i),end-i,&cp);
        if(previous<0||utf8proc_grapheme_break_stateful(previous,cp,&state))++count;
        previous=cp;i+=n;
    }
    return {raw.substr(start,end-start),count};
}
struct Peer {std::string name,address,epoch;uint64_t cursor=0;Clock::time_point seen{},synced{};};
struct Pairing {std::string ticket,challenge,name,address,state;Clock::time_point expires;};
struct Offer {std::string to;Json info;std::shared_ptr<std::ifstream> input;};
struct Engine {
    fs::path directory,inbox;
    Bytes secret;std::string id,name,bindAddress,epoch=randomId();
    std::string customName;
    std::mutex nameLock;
    uint64_t nameRevision=0,displayVersion=0;
    std::string label(){std::lock_guard<std::mutex> g(nameLock);return customName.empty()?name:customName;}
    Json grants,ready;std::map<std::string,Peer> peers;
    std::map<std::string,Pairing> inbound,outbound;
    std::map<std::string,Json> ledger;
    std::map<uint64_t,std::string> changes;std::map<std::string,uint64_t> versions;uint64_t revision=0;
    bool dirty=false;Clock::time_point lastSave{};
    std::map<std::string,Offer> sent;
    std::map<std::string,Json> offered;
    std::set<std::string> accepted,declined;
    Json recent=Json::array();
    void finished(Json info,const std::string& direction,const std::string& status){
        info["direction"]=direction;info["status"]=status;recent.push_back(std::move(info));
        if(recent.size()>32)recent.erase(recent.begin());
    }
    std::string message;
    std::mutex lock;std::atomic<bool> running{true};httplib::Server server;std::thread http,worker;
    Engine(const Json& b):directory(fs::u8path(b.at("dir").get<std::string>())),inbox(directory/"received"),name(b.at("name")){
        fs::create_directories(inbox);
        // Consent is session-scoped. A new process cannot resume an old partial file.
        for(const auto& item:fs::directory_iterator(inbox)){
            if(item.path().extension()==".part" && validId(item.path().stem().u8string(),96)){
                std::error_code ec;fs::remove(item.path(),ec);
            }
        }
        auto file=directory/"personal-devices.json";
        auto config=load(file,Json::object());
        secret=config.contains("key")?unhex(config.at("key")):randomBytes(32);
        if(secret.size()!=32)throw std::runtime_error("设备密钥损坏");
        uint8_t pub[32];crypto_x25519_public_key(pub,secret.data());id=hex(pub,32);
        displayVersion=config.value("displayVersion",uint64_t(0));customName=config.value("displayName","");grants=config.value("grants",Json::object());saveConfig();
        for(auto& item:grants.items()){auto& p=peers[item.key()];p.name=item.value().at("name");p.address=item.value().at("address");}
        ready=load(directory/"received.json",Json::object());
        auto rows=load(directory/"personal-history.json",Json::array());
        for(auto& row:rows){
            // Older ledgers defaulted missing source information to local.
            // Original sessions written by the mobile player also carry "source".
            if(row.is_object() && row.value("playModeSource","")=="local" && !row.contains("source") && !validId(row.value("originDeviceId",""),64))
                row.erase("playModeSource");
            merge(row);
        }
        dirty=false;
        // Requests carry commands. Chunk replies use their negotiated binary or legacy size limit.
        server.set_payload_max_length(packetLimit);server.set_read_timeout(chunkTimeoutSeconds,0);server.set_write_timeout(chunkTimeoutSeconds,0);
        server.new_task_queue=[](){return new httplib::ThreadPool(3,24);};
        server.Get("/personal/info",[this](const httplib::Request& req,httplib::Response& res){
            if(!localAddress(req.remote_addr)){res.status=403;return;}
            auto key=req.get_header_value("X-Lume-Device");
            if(validId(key,64)&&key!=id){std::lock_guard<std::mutex> g(lock);
                if(peers.count(key)||peers.size()<128){auto& p=peers[key];p.address=req.remote_addr;if(p.name.empty())p.name="澄音设备";p.seen=Clock::now();}}
            res.set_content(Json{{"service",service},{"id",id},{"name",this->label()}}.dump(),"application/json");
        });
        server.Post("/personal/v1",[this](const httplib::Request& req,httplib::Response& res){
            try{
                if(!localAddress(req.remote_addr))throw std::runtime_error("network");
                auto peer=req.get_header_value("X-Lume-Device");
                std::lock_guard<std::mutex> g(lock);
                if(!validId(peer,64)||peer==id)throw std::runtime_error("device");
                auto key=sharedKey(peer);auto plain=open(req.body,key,"request");
                auto cmd=Json::parse(plain);
                std::string body;
                if(cmd.at("op")=="pair")body=pairReply(peer,req.remote_addr,cmd).dump();
                else{
                    if(!grants.contains(peer))throw std::runtime_error("authorization");
                    body=cmd.at("op")=="chunk2"?readChunk(peer,cmd,binaryChunkSize):serve(peer,cmd).dump();
                }
                res.set_content(seal(body,key,"reply"+req.body.substr(0,24)),"application/octet-stream");
                peers[peer].seen=Clock::now();peers[peer].address=req.remote_addr;
            }catch(...){res.status=403;}
        });
        auto bind=b.value("bind","0.0.0.0");bindAddress=bind;
        if(server.bind_to_port(bind,port)){
            http=std::thread([this]{server.listen_after_bind();});server.wait_until_ready();
        }else message="个人设备端口 46327 被占用，正在等待重试";
        worker=std::thread([this,bind]{work(bind);});
    }
    ~Engine(){running=false;if(worker.joinable())worker.join();server.stop();if(http.joinable())http.join();try{flush();}catch(...){}crypto_wipe(secret.data(),secret.size());}
    void saveConfig(){atomicWrite(directory/"personal-devices.json",Json{{"key",hex(secret.data(),secret.size())},{"grants",grants},{"displayName",customName},{"displayVersion",displayVersion}});}
    void allowPeer(const std::string& peer,const std::string& label,const std::string& address){
        auto next=grants;next[peer]={{"name",label},{"address",address}};
        atomicWrite(directory/"personal-devices.json",Json{{"key",hex(secret.data(),secret.size())},{"grants",next},{"displayName",customName},{"displayVersion",displayVersion}});grants.swap(next);++nameRevision;
        auto& p=peers[peer];p.name=label;p.address=address;p.seen=Clock::now();
    }
    Json pairReply(const std::string& peer,const std::string& address,const Json& cmd){
        const auto ticket=cmd.value("ticket",""),label=cmd.value("name",""),proof=cmd.value("challenge","");
        if(cmd.value("target","")!=id||!validId(ticket,32)||label.empty()||label.size()>8192)throw std::runtime_error("pair");
        auto it=inbound.find(peer);const auto now=Clock::now();
        if(it==inbound.end()||it->second.expires<=now||it->second.ticket!=ticket){
            if(!proof.empty())return {{"state","expired"}};
            if(it!=inbound.end()&&it->second.expires>now&&it->second.state=="pending")return {{"state","busy"}};
            if(it==inbound.end()&&inbound.size()>=64)throw std::runtime_error("pair");
            it=inbound.insert_or_assign(peer,Pairing{ticket,randomId(),label,address,"challenge",now+std::chrono::seconds(120)}).first;
        }
        auto& p=it->second;
        if(proof.empty())return {{"state","challenge"},{"challenge",p.challenge},{"name",this->label()}};
        if(proof!=p.challenge)throw std::runtime_error("pair");
        if(p.state=="challenge")p.state=grants.contains(peer)?"approved":"pending";
        if(p.state=="approved"&&cmd.value("commit",false)){
            allowPeer(peer,p.name,p.address);p.state="paired";message="双方已授权";
        }
        // Keep completed decisions available for an initiator retry, without reopening the prompt.
        return {{"state",p.state},{"name",this->label()}};
    }
    void checkPairings(){
        std::vector<std::pair<std::string,Pairing>> pending;
        {std::lock_guard<std::mutex> g(lock);const auto now=Clock::now();
         for(auto it=inbound.begin();it!=inbound.end();)if(it->second.expires<=now){
             if(it->second.state=="pending")message="授权请求已过期";it=inbound.erase(it);
         }else ++it;
         for(auto it=outbound.begin();it!=outbound.end();)if(it->second.expires<=now){
             message="授权请求已过期，请确认对方在线并使用新版澄音";it=outbound.erase(it);
         }else{pending.push_back(*it);++it;}}
        for(const auto& entry:pending)try{
            const auto& peer=entry.first;const auto& p=entry.second;auto client=peerClient(p.address);
            Json query={{"op","pair"},{"target",peer},{"ticket",p.ticket},{"challenge",p.challenge},{"commit",p.state=="commit"},{"name",this->label()}};
            auto reply=request(*client,peer,query);
            std::lock_guard<std::mutex> g(lock);auto it=outbound.find(peer);
            if(it==outbound.end()||it->second.ticket!=p.ticket||it->second.expires<=Clock::now())continue;
            auto state=reply.value("state","");
            if(state=="challenge"&&validId(reply.value("challenge",""),32))it->second.challenge=reply.at("challenge");
            else if(state=="approved"&&!p.challenge.empty())it->second.state="commit";
            else if(state=="paired"&&p.state=="commit"){allowPeer(peer,reply.value("name",p.name),p.address);outbound.erase(it);message="双方已授权";}
            else if(state=="rejected"||state=="expired"||state=="busy"){
                outbound.erase(it);message=state=="rejected"?"对方已拒绝授权":state=="busy"?"对方已有待确认的请求":"授权请求已过期";
            }
        }catch(const std::exception&){}
    }
    Bytes sharedKey(const std::string& peer){
        auto pk=unhex(peer);if(pk.size()!=32)throw std::invalid_argument("key");
        Bytes ikm(96),key(32);crypto_x25519(ikm.data(),secret.data(),pk.data());
        if(std::all_of(ikm.begin(),ikm.begin()+32,[](uint8_t x){return x==0;}))throw std::invalid_argument("key");
        auto pair=unhex(std::min(peer,id)+std::max(peer,id));std::copy(pair.begin(),pair.end(),ikm.begin()+32);
        crypto_blake2b(key.data(),32,ikm.data(),ikm.size());crypto_wipe(ikm.data(),ikm.size());return key;
    }
    std::string seal(const std::string& plain,const Bytes& key,const std::string& ad){
        auto nonce=randomBytes(24);std::string out(40+plain.size(),0);auto p=reinterpret_cast<uint8_t*>(out.data());
        std::copy(nonce.begin(),nonce.end(),p);crypto_aead_lock(p+40,p+24,key.data(),p,(const uint8_t*)ad.data(),ad.size(),(const uint8_t*)plain.data(),plain.size());return out;
    }
    std::string open(const std::string& body,const Bytes& key,const std::string& ad,size_t limit=packetLimit){
        if(body.size()<40||body.size()>limit)throw std::runtime_error("packet");
        std::string plain(body.size()-40,0);auto p=(const uint8_t*)body.data();
        if(crypto_aead_unlock((uint8_t*)plain.data(),p+24,key.data(),p,(const uint8_t*)ad.data(),ad.size(),p+40,plain.size()))throw std::runtime_error("decrypt");return plain;
    }
    void merge(Json row){
        if(!row.is_object()||!row.contains("startedAt")||!row["startedAt"].is_number()||!row.contains("session")||!row["session"].is_string())return;
        const std::string sid=row.at("session");if(sid.empty()||sid.size()>160)return;
        auto mode=row.value("playModeSource",std::string());
        if(mode!="room" && mode!="local")mode=row.value("source",std::string());
        if(mode!="room" && mode!="local")mode="unknown";
        auto it=ledger.find(sid);
        if(it!=ledger.end()){
            auto& old=it->second;
            // Preserve authorship independently of which replica listened longer.
            const Json* author=validId(old.value("originDeviceId",""),64)?&old:&row;
            const std::string originId=author->value("originDeviceId","");
            const std::string originName=author->value("originDeviceName","");
            const auto& alias=old.value("originDeviceId","")==originId&&
                (row.value("originDeviceId","")!=originId||old.value("originNameVersion",uint64_t(0))>=row.value("originNameVersion",uint64_t(0)))?old:row;
            const auto aliasVersion=alias.value("originNameVersion",uint64_t(0));
            const auto aliasName=alias.value("originDisplayName","");
            const auto previousMode=old.value("playModeSource",std::string());
            if(previousMode=="room" || (mode=="unknown" && previousMode=="local"))mode=previousMode;
            bool complete=old.value("completed",false)||row.value("completed",false);
            auto completion=std::max(old.value("completedAt",int64_t(0)),row.value("completedAt",int64_t(0)));
            if(old.value("listenedMs",0.)>=row.value("listenedMs",0.))row=old;
            if(validId(originId,64)){row["originDeviceId"]=originId;row["originDeviceName"]=originName;}
            if(aliasVersion&&!aliasName.empty()){row["originNameVersion"]=aliasVersion;row["originDisplayName"]=aliasName;}
            else{row.erase("originNameVersion");row.erase("originDisplayName");}
            row["completed"]=complete;if(completion)row["completedAt"]=completion;
        }
        // Only the originating device advances its display-name version. Its own
        // history carries that update through the existing authenticated relay.
        if(row.value("originDeviceId","")==id&&displayVersion){
            row["originNameVersion"]=displayVersion;row["originDisplayName"]=label();
        }
        row["playModeSource"]=mode;
        if(mode=="local" && !row.contains("source") && !validId(row.value("originDeviceId",""),64))row["source"]="local";
        if(it!=ledger.end()){
            if(row==it->second)return;
            changes.erase(versions[sid]);
        }
        ledger[sid]=std::move(row);changes[++revision]=sid;versions[sid]=revision;dirty=true;
    }
    Json rows(bool display=false){
        Json result=Json::array();for(auto& item:ledger){
            result.push_back(item.second);
            if(!display)continue;
            auto& row=result.back();const auto owner=row.value("originDeviceId","");
            if(owner==id)row["originDeviceName"]=label();
            else if(grants.contains(owner))row["originDeviceName"]=grants[owner].at("name");
            else if(validId(owner,64)&&row.value("originNameVersion",uint64_t(0))>0&&!row.value("originDisplayName","").empty())
                row["originDeviceName"]=row.at("originDisplayName");
        }
        std::sort(result.begin(),result.end(),[](const Json& a,const Json& b){return a.at("startedAt")<b.at("startedAt");});
        return result;
    }
    void flush(){if(dirty){atomicWrite(directory/"personal-history.json",rows());dirty=false;lastSave=Clock::now();}}
    Json serve(const std::string& peer,const Json& b){
        auto op=b.at("op").get<std::string>();
        if(op=="sync"){
            uint64_t cursor=b.value("epoch","")==epoch?b.value("cursor",uint64_t(0)):0;
            Json page=Json::array(),offers=Json::array();size_t size=0;
            for(auto it=changes.upper_bound(cursor);it!=changes.end()&&page.size()<96&&size<380000;++it){
                const auto& row=ledger.at(it->second);size+=row.dump().size();page.push_back(row);cursor=it->first;
            }
            for(auto& item:sent)if(item.second.to==peer)offers.push_back(item.second.info);
            return {{"rows",page},{"name",this->label()},{"binaryChunks",true},{"epoch",epoch},{"cursor",cursor},{"offers",offers},{"more",cursor<revision}};
        }
        auto tid=b.at("id").get<std::string>();auto it=sent.find(tid);
        if(it==sent.end()||it->second.to!=peer)throw std::runtime_error("offer");
        auto& s=it->second;
        if(op=="finish"||op=="decline"){message=op=="finish"?"对方已收到歌曲":"对方已拒绝歌曲";
            if(op=="finish")s.info["received"]=s.info.at("bytes");finished(s.info,"send",message);sent.erase(it);return Json::object();}
        if(op!="chunk")throw std::runtime_error("range");
        auto data=readChunk(peer,b,chunkSize);
        return {{"data",hex(reinterpret_cast<const uint8_t*>(data.data()),data.size())}};
    }
    std::string readChunk(const std::string& peer,const Json& b,size_t block){
        auto it=sent.find(b.at("id").get<std::string>());if(it==sent.end()||it->second.to!=peer)throw std::runtime_error("offer");
        auto& s=it->second;
        int64_t offset=b.at("offset"),bytes=s.info.at("bytes");
        if(offset<0||offset>=bytes)throw std::runtime_error("range");
        s.info["received"]=offset;s.info["active"]=true;
        std::string data(size_t(std::min<int64_t>(block,bytes-offset)),0);
        s.input->clear();
        if(offset==0||offset+int64_t(data.size())==bytes){
            s.input->seekg(0,std::ios::end);
            if(s.input->tellg()!=bytes){message="歌曲大小已变化，请重新发送";finished(s.info,"send",message);sent.erase(it);throw std::runtime_error("size changed");}
        }
        s.input->seekg(offset);
        if(!s.input->read(data.data(),data.size())){message="歌曲读取中断，请重新发送";finished(s.info,"send",message);sent.erase(it);throw std::runtime_error("read");}
        return data;
    }
    std::unique_ptr<httplib::Client> peerClient(const std::string& address){
        if(!localAddress(address))throw std::runtime_error("network");
        auto client=std::make_unique<httplib::Client>(address,port);
        client->set_connection_timeout(2,0);client->set_read_timeout(chunkTimeoutSeconds,0);client->set_write_timeout(chunkTimeoutSeconds,0);
        client->set_keep_alive(true);
        if(bindAddress!="0.0.0.0")client->set_socket_options([this](socket_t sock){httplib::detail::bind_ip_address(sock,bindAddress);});
        return client;
    }
    std::string requestBody(httplib::Client& client,const std::string& peer,const Json& b,size_t limit){
        auto key=sharedKey(peer);
        httplib::Request req;req.method="POST";req.path="/personal/v1";
        req.headers={{"X-Lume-Device",id},{"Content-Type","application/octet-stream"}};
        req.body=seal(b.dump(),key,"request");
        std::string packet;
        req.content_receiver=[&](const char* data,size_t count,uint64_t,uint64_t total){
            if(total>limit||count>limit-packet.size())return false;
            packet.append(data,count);return true;
        };
        auto reply=client.send(req);
        if(!reply||reply->status!=200)throw std::runtime_error("offline");
        return open(packet,key,"reply"+req.body.substr(0,24),limit);
    }
    Json request(httplib::Client& client,const std::string& peer,const Json& b){
        return Json::parse(requestBody(client,peer,b,packetLimit));
    }
    void transfer(const std::string& peer,httplib::Client& client,const Json& offer,bool binary){
        const std::string tid=offer.at("id");if(!validId(tid,32))return;
        if(!offer.at("bytes").is_number_integer()||offer.at("bytes")<1||offer.at("bytes")>fileLimit||!supported(offer.at("ext"))){
            request(client,peer,{{"op","decline"},{"id",tid}});
            std::lock_guard<std::mutex> g(lock);message="已拒绝接收：歌曲格式无效或大小不在 500 MiB 以内";return;
        }
        const int64_t size=offer.at("bytes");
        const std::string key=peer+tid;bool done=false,skip=false;
        {
            std::lock_guard<std::mutex> g(lock);if(!grants.contains(peer))return;
            done=ready.contains(key);skip=declined.count(key);
            if(!done&&!skip){auto entry=offered.emplace(key,offer);entry.first->second["peer"]=peer;if(!accepted.count(key))return;}
        }
        if(skip||done){request(client,peer,{{"op",skip?"decline":"finish"},{"id",tid}});std::lock_guard<std::mutex> g(lock);offered.erase(key);declined.erase(key);return;}
        auto tmp=inbox/(key+".part");int64_t offset=fs::exists(tmp)?int64_t(fs::file_size(tmp)):0;
        if(offset>size){fs::remove(tmp);offset=0;}
        std::ofstream out(tmp,std::ios::binary|std::ios::app);
        auto diskError=[&](){if(out.is_open())out.close();std::error_code ec;fs::remove(tmp,ec);
            std::lock_guard<std::mutex> g(lock);message="歌曲无法写入，请检查剩余空间后重新接收";finished(offered[key],"receive",message);accepted.erase(key);offered[key]["received"]=0;};
        if(!out){diskError();return;}
        for(int n=0;running&&n<16&&offset<size;n++){
            {std::lock_guard<std::mutex> g(lock);if(!grants.contains(peer)||!accepted.count(key))return;}
            std::string data;
            try{
                Json query={{"op",binary?"chunk2":"chunk"},{"id",tid},{"offset",offset}};
                if(binary)data=requestBody(client,peer,query,binaryChunkSize+40);
                else{auto legacy=unhex(request(client,peer,query).at("data"));data.assign(legacy.begin(),legacy.end());}
            }
            catch(...){std::lock_guard<std::mutex> g(lock);message="传输中断，正在等待重新连接";throw;}
            if(data.size()!=size_t(std::min<int64_t>(binary?binaryChunkSize:chunkSize,size-offset)))throw std::runtime_error("chunk");
            out.write((char*)data.data(),data.size());if(!out){diskError();return;}offset+=data.size();
            {std::lock_guard<std::mutex> g(lock);offered[key]["received"]=offset;}
        }
        out.close();if(!out||fs::file_size(tmp)!=uintmax_t(offset)){diskError();return;}
        std::lock_guard<std::mutex> g(lock);if(!grants.contains(peer))return;
        offered[key]["received"]=offset;message="正在接收歌曲";
        if(offset==size){
            auto ext=offer.at("ext").get<std::string>();if(!supported(ext))throw std::runtime_error("format");
            auto file=key+"."+ext;auto dest=inbox/file;if(!fs::exists(dest))fs::rename(tmp,dest);else fs::remove(tmp);
            ready[key]=offer;ready[key]["peer"]=peer;ready[key]["received"]=size;ready[key]["file"]=file;atomicWrite(directory/"received.json",ready);offered.erase(key);accepted.erase(key);message="已收到歌曲，等待加入本机曲库";
        }
    }
    static bool supported(const std::string& ext){static const std::set<std::string> exts{"mp3","wav","flac","m4a","aac","ogg","opus","webm","mp4"};return exts.count(ext);}
    bool sync(const std::string& peer){
        std::string addr;Json query;
        {std::lock_guard<std::mutex> g(lock);if(!grants.contains(peer))return false;auto& p=peers.at(peer);addr=p.address;query={{"op","sync"},{"cursor",p.cursor},{"epoch",p.epoch}};}
        auto client=peerClient(addr);
        auto data=request(*client,peer,query);std::set<std::string> current;
        {
            std::lock_guard<std::mutex> g(lock);if(!grants.contains(peer))return false;
            for(auto& row:data.at("rows"))merge(row);flush();
            auto& p=peers.at(peer);p.epoch=data.at("epoch");p.cursor=data.at("cursor");p.synced=p.seen=Clock::now();
            const auto label=data.value("name","");
            if(!label.empty()&&label.size()<=8192 && (p.name!=label||grants[peer].value("name","")!=label)){
                grants[peer]["name"]=label;saveConfig();p.name=label;++nameRevision;
            }
            for(auto& offer:data.at("offers"))current.insert(peer+offer.at("id").get<std::string>());
            for(auto it=offered.begin();it!=offered.end();)if(it->second.value("peer","")==peer&&!current.count(it->first)){
                if(accepted.count(it->first))finished(it->second,"receive","传输已中止，发送方已结束请求");
                std::error_code ec;fs::remove(inbox/(it->first+".part"),ec);accepted.erase(it->first);declined.erase(it->first);it=offered.erase(it);
            }else ++it;
        }
        for(auto& offer:data.at("offers"))transfer(peer,*client,offer,data.value("binaryChunks",false));
        std::lock_guard<std::mutex> g(lock);return data.value("more",false)||!accepted.empty();
    }
    void discover(socket_t udp,const std::string& bind){
        auto body=Json{{"service",service},{"id",id},{"name",this->label()}}.dump();
        std::set<uint32_t> targets{INADDR_BROADCAST};for(auto n:networks())if(n.mask&&~n.mask)targets.insert(n.ip|~n.mask);
        if(bind=="0.0.0.0")for(auto target:targets){sockaddr_in to{};to.sin_family=AF_INET;to.sin_port=htons(port);to.sin_addr.s_addr=target;sendto(udp,body.data(),int(body.size()),0,(sockaddr*)&to,sizeof(to));}
        for(int i=0;i<128;i++){
            char buf[9216];sockaddr_in from{};socklen_t len=sizeof(from);int n=recvfrom(udp,buf,sizeof(buf),0,(sockaddr*)&from,&len);if(n<=0)break;
            auto b=Json::parse(buf,buf+n,nullptr,false);if(!b.is_object()||b.value("service","")!=service)continue;
            std::string key=b.value("id",""),label=b.value("name",""),addr=ipText(from.sin_addr.s_addr);
            if(key==id||!validId(key,64)||label.empty()||label.size()>8192||!localAddress(addr))continue;
            std::lock_guard<std::mutex> g(lock);if(peers.size()>=128&&!peers.count(key))continue;
            auto& p=peers[key];p.address=addr;p.name=grants.contains(key)?grants[key].at("name").get<std::string>():label;p.seen=Clock::now();
        }
    }
    void work(const std::string& bind){
        auto udp=socket(AF_INET,SOCK_DGRAM,0);if(udp!=INVALID_SOCKET){
            int yes=1;setsockopt(udp,SOL_SOCKET,SO_BROADCAST,(const char*)&yes,sizeof(yes));sockaddr_in a{};a.sin_family=AF_INET;a.sin_port=htons(port);inet_pton(AF_INET,bind.c_str(),&a.sin_addr);
            if(::bind(udp,(sockaddr*)&a,sizeof(a))){httplib::detail::close_socket(udp);udp=INVALID_SOCKET;}else httplib::detail::set_nonblocking(udp,true);
        }
        auto nextBeacon=Clock::now(),nextSync=nextBeacon;
        while(running){
            auto now=Clock::now();
            try{
                if(now>=nextBeacon){
                    checkPairings();
                    if(!http.joinable()&&server.bind_to_port(bind,port)){
                        http=std::thread([this]{server.listen_after_bind();});server.wait_until_ready();
                        std::lock_guard<std::mutex> g(lock);message.clear();
                    }
                    if(http.joinable()&&udp!=INVALID_SOCKET)discover(udp,bind);
                    nextBeacon=now+std::chrono::seconds(2);
                }
                if(now>=nextSync){std::vector<std::string> ids;
                    {std::lock_guard<std::mutex> g(lock);if(http.joinable())for(auto& entry:grants.items())ids.push_back(entry.key());if(dirty&&now-lastSave>std::chrono::seconds(2))flush();
                     for(auto it=peers.begin();it!=peers.end();)if(!grants.contains(it->first)&&now-it->second.seen>std::chrono::seconds(15))it=peers.erase(it);else ++it;}
                    bool more=false;for(auto& key:ids)if(running)try{more=sync(key)||more;}catch(...){}
                    nextSync=Clock::now()+std::chrono::milliseconds(more?20:2200);
                }
            }catch(...){}
            std::this_thread::sleep_for(std::chrono::milliseconds(80));
        }
        if(udp!=INVALID_SOCKET)httplib::detail::close_socket(udp);
    }
    Json action(const Json& b){
        std::lock_guard<std::mutex> g(lock);std::string op=b.value("op","status"),peer=b.value("peer","");
        if(op=="checkName"||op=="rename"){
            auto checked=displayName(b.at("displayName").get<std::string>());
            if(op=="checkName")return {{"count",checked.count}};
            if(checked.count>32)throw std::runtime_error("设备名称最多 32 个字");
            if(checked.value.size()>8192)throw std::runtime_error("名称包含过多组合符号，无法在局域网中传送");
            if(customName!=checked.value){
                {
                    std::lock_guard<std::mutex> guard(nameLock);
                    checked.value.swap(customName);++displayVersion;
                    try{saveConfig();}catch(...){--displayVersion;checked.value.swap(customName);throw;}
                }
                ++nameRevision;
                for(auto& item:ledger)if(item.second.value("originDeviceId","")==id)merge(item.second);
                flush();
            }
            message="本机名称已保存";
        }
        if(op=="observe"){
            auto current=b.value("current","");for(auto row:b.at("rows")){
                auto sid=row.value("session","");if(sid.empty())continue;
                if(sid==current&&b.value("playing",false)||ledger.count(sid)&&ledger[sid].value("playModeSource","")=="room"){
                    row["playModeSource"]="room";merge(row);
                }
            }
            return Json::object();
        }
        if(op=="feed"){for(auto& row:b.at("rows"))merge(row);if(b.value("flush",false))flush();return Json::object();}
        if(op=="records")return {{"revision",revision},{"records",rows(true)},{"nameRevision",nameRevision}};
        if(op=="find"){
            auto addr=b.value("address","");if(!localAddress(addr))throw std::runtime_error("请输入同一局域网的 IPv4 地址");
            httplib::Client c(addr,port);c.set_connection_timeout(1,0);c.set_read_timeout(2,0);
            if(bindAddress!="0.0.0.0")c.set_socket_options([this](socket_t sock){httplib::detail::bind_ip_address(sock,bindAddress);});
            auto r=c.Get("/personal/info",{{"X-Lume-Device",id}});if(!r||r->status!=200)throw std::runtime_error("未找到设备");
            auto info=Json::parse(r->body);std::string key=info.at("id");if(!validId(key,64)||key==id||info.at("service")!=service)throw std::runtime_error("请选择另一台澄音设备");
            auto& p=peers[key];p.address=addr;p.name=grants.contains(key)?grants.at(key).at("name"):info.at("name");p.seen=Clock::now();
        }
        if(op=="trust"){
            auto it=peers.find(peer);if(it==peers.end())throw std::runtime_error("设备已离线");
            auto& p=it->second;
            if(!grants.contains(peer)&&!outbound.count(peer))
                outbound.emplace(peer,Pairing{randomId(),"",p.name,p.address,"pending",Clock::now()+std::chrono::seconds(120)});
            message="授权请求已发送，等待对方确认";
        }
        if(op=="approvePair"||op=="rejectPair"){
            auto it=inbound.find(peer);
            if(it==inbound.end()||it->second.expires<=Clock::now()||it->second.state!="pending"||it->second.ticket!=b.value("key",""))
                throw std::runtime_error("授权请求已处理或过期");
            auto& p=it->second;
            if(op=="approvePair"){p.state="approved";message="已同意，等待对方确认连接";}
            else{p.state="rejected";message="已拒绝设备授权";}
        }
        if(op=="forget"){if(grants.erase(peer))++nameRevision;inbound.erase(peer);outbound.erase(peer);saveConfig();for(auto it=sent.begin();it!=sent.end();)if(it->second.to==peer)it=sent.erase(it);else ++it;}
        if(op=="offer"){
            if(!grants.contains(peer)||sent.size()>=32)throw std::runtime_error("请先授权设备，或等待已有传输结束");
            std::string ext=b.at("ext");if(!supported(ext))throw std::runtime_error("暂不支持此音频格式");
            auto input=std::make_shared<std::ifstream>(fs::u8path(b.at("path").get<std::string>()),std::ios::binary|std::ios::ate);
            int64_t bytes=input->tellg();
            if(bytes<=0)throw std::runtime_error("歌曲为空或无法读取");
            if(bytes>fileLimit)throw std::runtime_error("歌曲超过单首上限 500 MiB");
            auto tid=randomId();Json info={{"id",tid},{"title",b.at("title")},{"ext",ext},{"bytes",bytes}};sent[tid]={peer,info,input};message="已发送请求，等待对方接收";
        }
        if(op=="accept"||op=="decline"){auto k=b.at("key").get<std::string>();if(!offered.count(k))throw std::runtime_error("传输已结束");if(op=="accept")accepted.insert(k);else{accepted.erase(k);declined.insert(k);}message=op=="accept"?"正在接收歌曲":"已拒绝歌曲";}
        if(op=="imported"){auto k=b.at("key").get<std::string>();if(ready.contains(k)&&!ready[k].value("imported",false)){ready[k]["imported"]=true;atomicWrite(directory/"received.json",ready);message="已保存到本机曲库";finished(ready[k],"receive",message);}}
        Json list=Json::array(),offers=Json::array(),files=Json::array();auto now=Clock::now();
        for(auto& item:peers){auto& p=item.second;bool online=now-p.seen<std::chrono::seconds(12);if(!online&&!grants.contains(item.first))continue;
            list.push_back({{"id",item.first},{"name",p.name},{"address",p.address},{"trusted",grants.contains(item.first)},{"online",online},{"synced",now-p.synced<std::chrono::seconds(12)&&p.synced!=Clock::time_point{}}});}
        for(auto& o:offered)if(grants.contains(o.second.at("peer").get<std::string>())&&!declined.count(o.first)){Json v=o.second;v["key"]=o.first;v["accepting"]=bool(accepted.count(o.first));offers.push_back(v);}
        for(auto& f:ready.items())if(!f.value().value("imported",false)){Json v=f.value();v["key"]=f.key();files.push_back(v);}
        Json addresses=Json::array();for(auto n:networks())addresses.push_back(ipText(n.ip));
        Json outgoing=Json::array();for(auto& entry:sent){auto item=entry.second.info;item["peer"]=entry.second.to;outgoing.push_back(item);}
        for(auto& p:list)p["requestPending"]=outbound.count(p.at("id").get<std::string>())!=0;
        Json prompts=Json::array();for(auto& item:inbound){const auto& p=item.second;if(p.state=="pending"&&p.expires>now)prompts.push_back({{"peer",item.first},{"key",p.ticket},{"name",p.name}});}
        return {{"id",id},{"name",label()},{"defaultName",name},{"customName",customName},{"nameRevision",nameRevision},{"addresses",addresses},{"peers",list},{"pairRequests",prompts},{"offers",offers},{"files",files},{"outgoing",outgoing},{"recent",recent},{"message",message},{"revision",revision}};
    }
};
std::unique_ptr<Engine> engine;
}
Json command(const Json& b){
    try{
        if(b.value("op","")=="init"){if(!engine)engine=std::make_unique<Engine>(b);return origin();}
        if(!engine)return {{"error","个人设备服务尚未启动"}};
        return engine->action(b);
    }catch(const std::exception& e){return {{"error",e.what()}};}
}
void ingest(const Json& rows){if(engine){std::lock_guard<std::mutex> g(engine->lock);for(auto& row:rows)engine->merge(row);}}
Json records(){if(!engine)return Json::array();std::lock_guard<std::mutex> g(engine->lock);return engine->rows(true);}
Json origin(){if(!engine)return Json::object();return {{"originDeviceId",engine->id},{"originDeviceName",engine->label()}};}
}
