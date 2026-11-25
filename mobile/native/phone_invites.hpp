#pragma once
inline const std::string& localPhoneId(){static const std::string id=token();return id;}

// Owned by one room: closing the room invalidates every outstanding invitation.
class PhoneInvites {
    struct Peer { Json data; sockaddr_in address; int64_t seen; std::string proof; };
    struct Grant { std::string deviceId, address; int64_t expiry; };
    int fd=-1;
    int64_t end=0, next=0;
    std::string nonce, message;
    std::string confirmingId, invitationRoom;
    int invitationPort=0;
    std::string latestGrant;
    std::set<uint32_t> wifiBroadcasts;
    std::map<uint32_t,int64_t> candidates;
    std::map<std::string,Peer> peers;
    std::map<std::string,Grant> grants;
    void closeSocket(){if(fd>=0)close(fd);fd=-1;}
    void query(){
        const auto data=Json({{"service","lume-find-phone/1"},{"nonce",nonce},{"includeBusy",true}}).dump();
        if(!confirmingId.empty()){
            const auto& address=peers.at(confirmingId).address;
            sendto(fd,data.data(),data.size(),0,reinterpret_cast<const sockaddr*>(&address),sizeof(address));
            return;
        }
        std::set<uint32_t> targets{INADDR_BROADCAST};
        targets.insert(wifiBroadcasts.begin(),wifiBroadcasts.end());
        ifaddrs* list=nullptr;
        if(getifaddrs(&list)==0){
            for(auto* a=list;a;a=a->ifa_next){
                if(!a->ifa_addr || a->ifa_addr->sa_family!=AF_INET || !(a->ifa_flags&IFF_UP) ||
                   (a->ifa_flags&(IFF_LOOPBACK|IFF_POINTOPOINT)))continue;
                if(a->ifa_broadaddr && a->ifa_broadaddr->sa_family==AF_INET && (a->ifa_flags&IFF_BROADCAST)){
                    const auto broadcast=reinterpret_cast<sockaddr_in*>(a->ifa_broadaddr)->sin_addr.s_addr;
                    if(broadcast!=INADDR_ANY)targets.insert(broadcast);
                }
                if(!a->ifa_netmask || a->ifa_netmask->sa_family!=AF_INET)continue;
                const auto mask=reinterpret_cast<sockaddr_in*>(a->ifa_netmask)->sin_addr.s_addr;
                if(mask==0 || ntohl(~mask)<3)continue;
                const auto address=reinterpret_cast<sockaddr_in*>(a->ifa_addr)->sin_addr.s_addr;
                targets.insert(address | ~mask);
            }
            freeifaddrs(list);
        }
        for(auto ip:targets){
            sockaddr_in to{};to.sin_family=AF_INET;to.sin_port=htons(46322);to.sin_addr.s_addr=ip;
            sendto(fd,"LUME_DISCOVER_1",15,0,reinterpret_cast<sockaddr*>(&to),sizeof(to));
        }
        for(auto it=candidates.begin();it!=candidates.end();){
            if(it->second<=now())it=candidates.erase(it);
            else{targets.insert(it->first);++it;}
        }
        for(auto ip:targets){sockaddr_in to{};to.sin_family=AF_INET;to.sin_port=htons(46324);to.sin_addr.s_addr=ip;
            sendto(fd,data.data(),data.size(),0,reinterpret_cast<sockaddr*>(&to),sizeof(to));}
    }
public:
    void remember(uint32_t ip){
        const auto addr=ntohl(ip);
        if(!addr || addr>>24==127 || addr>>28>=14)return;
        if(candidates.size()<64||candidates.count(ip))candidates[ip]=now()+180000;
    }
    ~PhoneInvites(){closeSocket();}
    void search(const Json& request=Json::object()){
        wifiBroadcasts.clear();
#ifdef __ANDROID__
        for(const auto& ip:request.value("wifiGateways",Json::array())){
            if(ip.is_number_unsigned())remember(htonl(ip.get<uint32_t>()));
        }
        for(const auto& ip:request.value("wifiBroadcasts",Json::array())){
            if(ip.is_number_unsigned())wifiBroadcasts.insert(htonl(ip.get<uint32_t>()));
        }
#endif
        closeSocket();peers.clear();end=0;message.clear();confirmingId.clear();
        fd=socket(AF_INET,SOCK_DGRAM,0);
        if(fd<0){message="无法搜索设备，请检查网络后重试";return;}
#ifdef __ANDROID__
        const auto network=request.value("wifiNetwork",uint64_t(0));
        if(network)android_setsocknetwork(network,fd);
#endif
        int yes=1;setsockopt(fd,SOL_SOCKET,SO_BROADCAST,&yes,sizeof(yes));
        sockaddr_in local{};local.sin_family=AF_INET;
        if(bind(fd,reinterpret_cast<sockaddr*>(&local),sizeof(local))<0){closeSocket();message="无法搜索设备，请重试";return;}
        nonce=token().substr(0,24);end=now()+30000;next=0;
        poll();
    }
    void poll(){
        const auto time=now();
        for(auto it=grants.begin();it!=grants.end();)if(it->second.expiry<=time){
            if(it->first==latestGrant)message="邀请已超时，对方未加入";
            it=grants.erase(it);
        }else ++it;
        if(fd<0 || (!end&&grants.empty()))return;
        if(end && confirmingId.empty()){
            for(auto it=peers.begin();it!=peers.end();)if(it->second.seen+6000<=time)it=peers.erase(it);else ++it;
        }
        if(end && time>=end){
            end=0;
            if(!confirmingId.empty()){
                peers.erase(confirmingId);confirmingId.clear();message="设备未回应，请重新搜索";
            }else if(message.empty()){
                message=peers.empty()?"搜索结束，未发现附近设备":"搜索结束，发现 "+std::to_string(peers.size())+" 台附近设备";
            }
            return;
        }
        if(end && time>=next){query();next=time+850;}
        for(int i=0;i<64;++i){
            char buf[9216];sockaddr_in from{};socklen_t size=sizeof(from);
            auto n=recvfrom(fd,buf,sizeof(buf),MSG_DONTWAIT,reinterpret_cast<sockaddr*>(&from),&size);
            if(n<=0)break;
            try{
                const auto b=Json::parse(buf,buf+n);
                if(b.value("service","")=="lume-invite-status/1" && ntohs(from.sin_port)==46324){
                    const auto secret=b.value("inviteToken","");auto grant=grants.find(secret);
                    if(grant==grants.end() || grant->second.deviceId!=b.value("id","") ||
                       inet_addr(grant->second.address.c_str())!=from.sin_addr.s_addr)continue;
                    const auto status=b.value("status","");
                    if(secret==latestGrant){
                        if(status=="shown")message="对方已看到邀请，等待选择";
                        if(status=="declined")message="对方已忽略邀请";
                        if(status=="expired")message="邀请已超时，对方未加入";
                    }
                    if(status=="declined" || status=="expired")grants.erase(grant);
                    continue;
                }
                if(!end)continue;
                if(b.value("service","")=="lume-room/1" && ntohs(from.sin_port)==46322){
                    remember(from.sin_addr.s_addr);continue;
                }
                const auto id=b.value("id","");const auto platform=b.value("platform","");
                if(b.value("service","")!="lume-phone/1" || b.value("nonce","")!=nonce || id.empty() || id.size()>128 || id==localPhoneId() ||
                    (platform!="Android" && platform!="HarmonyOS" && platform!="Windows") || ntohs(from.sin_port)!=46324)continue;
                if(!confirmingId.empty() && (id!=confirmingId || from.sin_addr.s_addr!=peers.at(id).address.sin_addr.s_addr))continue;
                char address[INET_ADDRSTRLEN];if(!inet_ntop(AF_INET,&from.sin_addr,address,sizeof(address)))continue;
                if(peers.size()>=64 && !peers.count(id))continue;
                peers[id]={{{"id",id},{"platform",platform},{"model",b.value("model",platform)},{"address",address},
                    {"availability",b.value("availability","available")},{"hostInvitable",!b.value("inviteProof","").empty()}},from,time,b.value("inviteProof","")};
                if(!confirmingId.empty()){
                    confirmingId.clear();end=0;sendInvitation(id,invitationRoom,invitationPort);break;
                }
            }catch(const std::exception&){}
        }
    }
    void invite(const std::string& id,const std::string& roomName,int roomPort){
        poll();auto it=peers.find(id);
        if(fd<0 || it==peers.end()){message="设备已离线，请重新搜索";return;}
        if(!confirmingId.empty())return;
        if(!end){
            // Keep the finished list. Verify the selected device on the same socket and network before sending.
            confirmingId=id;invitationRoom=roomName;invitationPort=roomPort;
            nonce=token().substr(0,24);end=now()+3500;next=0;message="正在确认设备状态…";poll();return;
        }
        sendInvitation(id,roomName,roomPort);
    }
private:
    void sendInvitation(const std::string& id,const std::string& roomName,int roomPort){
        auto it=peers.find(id);
        const auto role=it->second.data.at("availability");
        if(role!="available" && !(role=="hosting"&&!it->second.proof.empty())){message="对方当前无法接收邀请，请刷新设备状态";return;}
        if(grants.size()>=128){message="邀请过多，请稍后重试";return;}
        auto secret=token();
        auto data=Json({{"service","lume-invite/1"},{"id",id},{"name",roomName},{"port",roomPort},{"inviteProof",it->second.proof},{"inviteToken",secret}}).dump();
        const auto& to=it->second.address;
        if(sendto(fd,data.data(),data.size(),0,reinterpret_cast<const sockaddr*>(&to),sizeof(to))!=ssize_t(data.size())){
            message="邀请发送失败，请重试";return;
        }
        grants[secret]={id,it->second.data.at("address"),now()+60000};
        latestGrant=secret;message="已发出邀请，等待对方回应";
    }
public:
    bool accept(const std::string& secret,const std::string& id,const std::string& address){
        auto it=grants.find(secret);
        if(it==grants.end() || it->second.expiry<=now() || it->second.deviceId!=id || it->second.address!=address)return false;
        if(secret==latestGrant)message="对方已接受邀请";
        grants.erase(it);return true;
    }
    Json state(){
        poll();Json list=Json::array();for(auto& entry:peers)list.push_back(entry.second.data);
        return {{"nearbyPhones",list},{"phoneSearching",end!=0},{"inviteStatus",message}};
    }
};
