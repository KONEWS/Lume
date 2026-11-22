#include "local_media.hpp"
#include "media_sha256.hpp"
#include "decoder.hpp"
#include "vendor/json.hpp"
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <cerrno>
#include <climits>
#include <mutex>
#include <map>
#include <set>
#include <thread>
using Json=nlohmann::json;
namespace {
int suppliedDescriptor(const std::string& path){
#ifdef __ANDROID__
    const std::string prefix="/proc/self/fd/";if(path.rfind(prefix,0)==0&&path.size()>prefix.size()){
        int fd=0;for(size_t i=prefix.size();i<path.size();i++){int d=path[i]-'0';if(d<0||d>9||fd>(INT_MAX-d)/10)return -1;fd=fd*10+d;}return fd;
    }
#endif
    return -1;
}
std::string stamp(const std::string& path){struct stat s{};int fd=suppliedDescriptor(path);if((fd>=0?fstat(fd,&s):stat(path.c_str(),&s))!=0||!S_ISREG(s.st_mode)||s.st_size<=0)return {};return path+":"+std::to_string(s.st_dev)+":"+std::to_string(s.st_ino)+":"+std::to_string(s.st_size)+":"+std::to_string(s.st_mtim.tv_sec)+":"+std::to_string(s.st_mtim.tv_nsec)+":"+std::to_string(s.st_ctim.tv_sec)+":"+std::to_string(s.st_ctim.tv_nsec);}
struct Cache {std::mutex lock;std::map<std::string,std::string> hashes;std::set<std::string> pending;std::string decoderKey;std::shared_ptr<Decoder> decoder;};
// Workers capture this storage, so shutdown never destroys their mutex mid-read.
std::shared_ptr<Cache> cache(){static auto value=std::make_shared<Cache>();return value;}
std::string fingerprint(const std::string& path){
    auto key=stamp(path);if(key.empty())return "{}";auto c=cache();
    {std::lock_guard<std::mutex> guard(c->lock);auto it=c->hashes.find(key);if(it!=c->hashes.end())return it->second;}
    // SAF descriptors must be duplicated, never reopened via /proc. Positional
    // reads keep Java's descriptor offset and the decoder's cursor untouched.
    int supplied=suppliedDescriptor(path);
    struct File {int fd;~File(){if(fd>=0)close(fd);}} input{supplied>=0?fcntl(supplied,F_DUPFD_CLOEXEC,0):open(path.c_str(),O_RDONLY|O_CLOEXEC)};
    if(input.fd<0)return "{}";
    MediaSha256 hash;char block[65536];uint64_t size=0;
    for(;;){ssize_t n;do{n=pread(input.fd,block,sizeof(block),size);}while(n<0&&errno==EINTR);if(n<0)return "{}";if(!n)break;hash.add(block,size_t(n));size+=n;}
    if(key!=stamp(path))return "{}";
    auto result=Json({{"audioIdentity","sha256:"+hash.finish()},{"audioBytes",size}}).dump();
    std::lock_guard<std::mutex> guard(c->lock);if(c->hashes.size()>=128)c->hashes.erase(c->hashes.begin());c->hashes[key]=result;return result;
}
}
std::string peekMediaIdentity(const std::string& path){
    auto key=stamp(path);if(key.empty())return "{}";auto c=cache();std::lock_guard<std::mutex> guard(c->lock);
    auto it=c->hashes.find(key);if(it!=c->hashes.end())return it->second;
    if(c->pending.size()<2&&c->pending.insert(key).second)std::thread([c,path,key]{try{fingerprint(path);}catch(...){}std::lock_guard<std::mutex> guard(c->lock);c->pending.erase(key);}).detach();
    return "{}";
}
std::string mobileMedia(const std::string& path,const std::string& channel,int block,const std::string& identity){
    try{
        if(block<0)return fingerprint(path);
        if(!identity.empty()&&Json::parse(peekMediaIdentity(path)).value("audioIdentity","")!=identity)return {};
        if(channel!="left"&&channel!="right"&&channel!="mono"&&channel!="stereo")return {};
        auto key=stamp(path);if(key.empty()||block>1000000)return {};
        auto c=cache();std::shared_ptr<Decoder> decoder;
        {std::lock_guard<std::mutex> guard(c->lock);if(c->decoderKey!=key){c->decoder=std::make_shared<Decoder>(path);c->decoderKey=key;}decoder=c->decoder;}
        return decoder->block(block,channel);
    }catch(...){return block<0?"{}":"";}
}
