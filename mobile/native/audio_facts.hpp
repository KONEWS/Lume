#pragma once
#include "vendor/json.hpp"
#include <algorithm>
#include <array>
#include <cctype>
#include <cstdint>
#include <fstream>
#include <string>
#include <vector>
#ifndef _WIN32
#include <cerrno>
#include <charconv>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#endif

namespace audio_facts {
using Json = nlohmann::json;
using Bytes = std::vector<unsigned char>;
inline const char* losslessQuality(uint32_t sampleRate, unsigned bitDepth) {
    return sampleRate >= 48000 && bitDepth >= 24 ? "hires" : "lossless";
}
inline uint32_t number(const unsigned char* p, bool little=false) {
    if(little) return uint32_t(p[0]) | uint32_t(p[1])<<8 | uint32_t(p[2])<<16 | uint32_t(p[3])<<24;
    return uint32_t(p[0])<<24 | uint32_t(p[1])<<16 | uint32_t(p[2])<<8 | p[3];
}
inline uint32_t synchsafe(const unsigned char* p) {
    return (p[0]&127u)<<21 | (p[1]&127u)<<14 | (p[2]&127u)<<7 | (p[3]&127u);
}
inline bool textAt(const Bytes& b,size_t offset,const std::string& value) {
    return offset<=b.size() && value.size()<=b.size()-offset && std::equal(value.begin(),value.end(),b.begin()+offset);
}
inline bool read(std::ifstream& f,uint64_t at,Bytes& b,size_t count) {
    f.clear();f.seekg(at);b.resize(count);
    return count==0 || bool(f.read(reinterpret_cast<char*>(b.data()),count));
}
inline void utf8(std::string& s,uint32_t c){
    if(c<128)s+=char(c);
    else if(c<2048){s+=char(192|(c>>6));s+=char(128|(c&63));}
    else if(c<65536){s+=char(224|(c>>12));s+=char(128|((c>>6)&63));s+=char(128|(c&63));}
    else{s+=char(240|(c>>18));s+=char(128|((c>>12)&63));s+=char(128|((c>>6)&63));s+=char(128|(c&63));}
}
inline std::string tagText(const Bytes& b,size_t pos,size_t end,unsigned encoding){
    std::string s;end=std::min(end,b.size());
    if(encoding==1||encoding==2){
        bool little=false;
        if(pos+2<=end&&b[pos]==255&&b[pos+1]==254){little=true;pos+=2;}
        else if(pos+2<=end&&b[pos]==254&&b[pos+1]==255)pos+=2;
        for(;pos+1<end;pos+=2){
            uint32_t c=little?b[pos]|b[pos+1]<<8:b[pos]<<8|b[pos+1];if(!c)break;
            if(c>=0xd800&&c<=0xdbff&&pos+3<end){
                uint32_t low=little?b[pos+2]|b[pos+3]<<8:b[pos+2]<<8|b[pos+3];
                if(low>=0xdc00&&low<=0xdfff){c=0x10000+((c-0xd800)<<10)+(low-0xdc00);pos+=2;}
            }
            utf8(s,c>=0xd800&&c<=0xdfff?0xfffd:c);
        }
    }else for(;pos<end&&b[pos];pos++){if(encoding==0)utf8(s,b[pos]);else s+=char(b[pos]);}
    const auto first=s.find_first_not_of(" \t\r\n");if(first==std::string::npos)return "";
    return s.substr(first,s.find_last_not_of(" \t\r\n")-first+1);
}
inline void tag(Json& out,const std::string& key,const std::string& value){
    if(value.empty()||value=="<unknown>"||out.contains(key))return;
    try{Json(value).dump();out[key]=value;}catch(const Json::exception&){}
}
#ifndef _WIN32
inline bool read(int fd,uint64_t at,Bytes& b,size_t count){
    b.resize(count);
    size_t done=0;
    while(done<count){
        auto n=pread(fd,b.data()+done,count-done,at+done);
        if(n<0&&errno==EINTR)continue;
        if(n<=0)return false;
        done+=static_cast<size_t>(n);
    }
    return true;
}
#endif
template<class Source>
inline void id3(Source& f,uint64_t at,uint64_t end,Json& out){
    Bytes h;if(end-at<10 || !read(f,at,h,10) || !textAt(h,0,"ID3"))return;
    unsigned version=h[3];if(version<2 || version>4 || (h[5]&0xc0))return;
    uint64_t pos=at+10,limit=pos+synchsafe(h.data()+6);
    if(limit>end)return;
    const unsigned width=version==2?6:10;
    while(pos+width<=limit){
        if(!read(f,pos,h,width))return;
        if(!h[0])break;
        const uint32_t n=version==2?(h[3]<<16|h[4]<<8|h[5]):version==3?number(h.data()+4):synchsafe(h.data()+4);
        if(!n || n>limit-pos-width)return;
        if(textAt(h,0,"USLT")||textAt(h,0,"SYLT")||(version==2&&(textAt(h,0,"ULT")||textAt(h,0,"SLT")))){
            out["hasLyrics"]=true;
        }
        // Some taggers (including FFmpeg) store lyrics as user-defined ID3 text.
        if(textAt(h,0,version==2?"TXX":"TXXX")&&n<=1024*1024&&(version==2||h[9]==0)){
            Bytes payload;
            if(read(f,pos+width,payload,n)&&payload[0]<=3){
                auto name=tagText(payload,1,n,payload[0]);
                std::transform(name.begin(),name.end(),name.begin(),[](unsigned char c){return std::toupper(c);});
                if(name=="LYRICS"||name=="USLT"||name=="UNSYNCEDLYRICS"||name=="SYNCEDLYRICS"){
                    const size_t step=payload[0]==1||payload[0]==2?2:1;
                    for(size_t p=1;p+step<=n;p+=step){
                        if(payload[p]==0&&(step==1||payload[p+1]==0)){
                            if(!tagText(payload,p+step,n,payload[0]).empty())out["hasLyrics"]=true;
                            break;
                        }
                    }
                }
            }
        }
        std::string key;
        if(textAt(h,0,version==2?"TT2":"TIT2"))key="title";
        if(textAt(h,0,version==2?"TP1":"TPE1"))key="artist";
        if(textAt(h,0,version==2?"TP2":"TPE2"))key="albumArtist";
        if(textAt(h,0,version==2?"TAL":"TALB"))key="album";
        if(textAt(h,0,version==2?"TRK":"TRCK"))key="trackNumber";
        if(textAt(h,0,version==2?"TPA":"TPOS"))key="discNumber";
        if(textAt(h,0,version==2?"TYE":"TYER")||textAt(h,0,"TDRC"))key="year";
        // Do not interpret compressed/encrypted frame payloads as plain text.
        if(!key.empty()&&n<=1024*1024&&(version==2||h[9]==0)){
            Bytes payload;if(read(f,pos+width,payload,n)&&payload[0]<=3)tag(out,key,tagText(payload,1,n,payload[0]));
        }
        pos+=width+n;
    }
    if(!out.contains("hasLyrics"))out["hasLyrics"]=false;
}
inline void comments(const Bytes& b,size_t pos,Json& out){
    if(pos+4>b.size())return;
    auto vendor=number(b.data()+pos,true);pos+=4;
    if(vendor>b.size()-pos || b.size()-pos-vendor<4)return;
    pos+=vendor;auto entries=number(b.data()+pos,true);pos+=4;
    while(entries--){
        if(b.size()-pos<4)return;
        auto size=number(b.data()+pos,true);pos+=4;if(size>b.size()-pos)return;
        std::string key;
        for(size_t i=0;i<size && i<48;i++){
            if(b[pos+i]=='='){
                if(i+1<size&&(key=="LYRICS"||key=="UNSYNCEDLYRICS"||key=="SYNCEDLYRICS"))out["hasLyrics"]=true;
                const std::string field=key=="TRACKNUMBER"?"trackNumber":key=="DISCNUMBER"?"discNumber":(key=="YEAR"||key=="DATE")?"year":key=="TITLE"?"title":key=="ARTIST"?"artist":key=="ALBUM"?"album":(key=="ALBUMARTIST"||key=="ALBUM ARTIST")?"albumArtist":"";
                if(!field.empty())tag(out,field,tagText(b,pos+i+1,pos+size,3));break;
            }
            key+=static_cast<char>(std::toupper(b[pos+i]));
        }
        pos+=size;
    }
    if(!out.value("hasLyrics",false))out["hasLyrics"]=false;
}
template<class Source>
inline void mp4(Source& f,uint64_t pos,uint64_t end,Json& out,int depth=0){
    Bytes h;if(depth>8)return;
    while(end-pos>=8 && read(f,pos,h,8)){
        uint64_t n=number(h.data()),header=8;
        std::string type(h.begin()+4,h.end());
        if(n==1){if(!read(f,pos+8,h,8))return;n=uint64_t(number(h.data()))<<32|number(h.data()+4);header=16;}
        if(!n)n=end-pos;
        if(n<header||n>end-pos)return;
        auto start=pos+header,limit=pos+n;
        const std::string field=type==std::string("\xa9" "nam",4)?"title":type==std::string("\xa9" "ART",4)?"artist":type==std::string("\xa9" "alb",4)?"album":type=="aART"?"albumArtist":"";
        if(!field.empty()&&limit-start>=16&&read(f,start,h,16)&&textAt(h,4,"data")){
            const auto size=number(h.data());const auto encoding=number(h.data()+8)&0xffffff;
            Bytes value;if(size>=16&&size<=limit-start&&size<=1024*1024&&read(f,start+16,value,size-16)&&(encoding==1||encoding==2))tag(out,field,tagText(value,0,value.size(),encoding==2?2:3));
        }
        if(type==std::string("\xa9" "lyr",4) && n>header+16)out["hasLyrics"]=true;
        else if(type=="stsd" && limit-start>=16 && read(f,start+12,h,4)){
            if(textAt(h,0,"alac")){
                out["quality"]="lossless";
                // An ALAC sample entry contains its original rate and depth in the codec configuration.
                Bytes entry;
                const uint64_t sample=start+8;
                if(limit-sample>=36 && read(f,sample,entry,36)){
                    unsigned version=entry[16]<<8|entry[17];
                    uint64_t size=number(entry.data());
                    uint64_t offset=version==0?36:version==1?52:size;
                    if(size<=limit-sample){
                        while(offset<=size && size-offset>=8 && read(f,sample+offset,entry,8)){
                            uint32_t boxSize=number(entry.data());
                            if(boxSize<8 || boxSize>size-offset)break;
                            if(textAt(entry,4,"alac") && boxSize>=36 && read(f,sample+offset+12,entry,24)){
                                out["quality"]=losslessQuality(number(entry.data()+20),entry[5]);
                                break;
                            }
                            offset+=boxSize;
                        }
                    }
                }
            }
            if(textAt(h,0,"mp4a"))out["quality"]="lossy";
        }else if(type=="moov"||type=="trak"||type=="mdia"||type=="minf"||type=="stbl"||type=="udta"||type=="ilst"||type=="meta"){
            if(type=="meta")start+=4;
            if(start<=limit)mp4(f,start,limit,out,depth+1);
        }
        pos=limit;
    }
}
template<class Source>
inline Json inspectSource(Source& f,uint64_t end){
    Json out=Json::object();
    Bytes b;if(!read(f,0,b,std::min<uint64_t>(end,42)))return out;
    out["bytes"]=end;out["factsVersion"]=3;out["quality"]="unknown";
    if(textAt(b,0,"fLaC")){
        uint64_t pos=4;out["quality"]="lossless";bool last=false;
        while(!last && end-pos>=4 && read(f,pos,b,4)){
            last=b[0]&128;auto type=b[0]&127;auto n=uint32_t(b[1]<<16|b[2]<<8|b[3]);pos+=4;
            if(n>end-pos)return out;
            if(type==0 && n>=34 && read(f,pos,b,34)){
                const unsigned rate=b[10]<<12|b[11]<<4|b[12]>>4,bits=((b[12]&1)<<4|b[13]>>4)+1;
                out["quality"]=losslessQuality(rate,bits);
            }
            if(type==4 && n<=4*1024*1024 && read(f,pos,b,n))comments(b,0,out);
            pos+=n;
        }
        if(last&&!out.contains("hasLyrics"))out["hasLyrics"]=false;
    }else if(textAt(b,0,"RIFF") && textAt(b,8,"WAVE")){
        out["hasLyrics"]=false;
        for(uint64_t pos=12;end-pos>=8 && read(f,pos,b,8);){
            auto n=number(b.data()+4,true);std::string type(b.begin(),b.begin()+4);pos+=8;
            if(n>end-pos)break;
            if(type=="fmt "&&n>=16&&read(f,pos,b,std::min<uint32_t>(n,40))){
                auto fmt=b[0]|b[1]<<8,bits=b[14]|b[15]<<8;
                // WAVE_FORMAT_EXTENSIBLE stores its actual PCM/float subtype in the GUID.
                if(fmt==0xfffe&&b.size()>=40&&b[16]>=22)fmt=b[24]|b[25]<<8;
                if(fmt==1||fmt==3)out["quality"]=losslessQuality(number(b.data()+4,true),bits);
            }else if(type=="ID3 "||type=="id3 ")id3(f,pos,pos+n,out);
            else if(type=="LIST"&&n>=4&&n<=1024*1024&&read(f,pos,b,n)&&textAt(b,0,"INFO")){
                for(size_t p=4;p+8<=b.size();){
                    const auto size=number(b.data()+p+4,true);if(size>b.size()-p-8)break;
                    const std::string key=textAt(b,p,"INAM")?"title":textAt(b,p,"IART")?"artist":textAt(b,p,"IPRD")?"album":"";
                    if(!key.empty())tag(out,key,tagText(b,p+8,p+8+size,3));p+=8+size+(size&1);
                }
            }
            if(n+(n&1ull)>end-pos)break;
            pos+=n+(n&1ull);
        }
    }else if(textAt(b,4,"ftyp")){out["hasLyrics"]=false;mp4(f,0,end,out);}
    else if(textAt(b,0,"OggS")){
        Bytes packet,laces,page;uint64_t pos=0;unsigned packets=0;
        while(pos+27<=end&&pos<8*1024*1024&&packets<3&&read(f,pos,b,27)&&textAt(b,0,"OggS")){
            unsigned segments=b[26];pos+=27;if(!read(f,pos,laces,segments))break;pos+=segments;
            size_t size=0;for(auto n:laces)size+=n;
            if(size>end-pos||!read(f,pos,page,size))break;pos+=size;size_t offset=0;
            for(auto n:laces){
                if(packet.size()+n>4*1024*1024)return out;
                packet.insert(packet.end(),page.begin()+offset,page.begin()+offset+n);offset+=n;
                if(n<255){
                    if(textAt(packet,0,"OpusHead")||textAt(packet,0,std::string("\1vorbis",7)))out["quality"]="lossy";
                    if(textAt(packet,0,"OpusTags"))comments(packet,8,out);
                    if(textAt(packet,0,std::string("\3vorbis",7)))comments(packet,7,out);
                    packet.clear();packets++;
                }
            }
        }
    }else if(textAt(b,0,"ID3") || (b.size()>=2 && b[0]==255 && (b[1]&224)==224)){
        const bool hasId3=textAt(b,0,"ID3");
        uint64_t audio=hasId3&&b.size()>=10?10ull+synchsafe(b.data()+6)+((b[3]==4&&(b[5]&16))?10:0):0;
        if(hasId3)id3(f,0,end,out);
        // Descriptor paths and saved song titles have no extension. Inspect the audio
        // header after ID3 instead of relying on the filename hint during migration.
        Bytes frame;
        if(audio<=end&&end-audio>=4&&read(f,audio,frame,4)&&frame[0]==255&&(frame[1]&224)==224){
            const bool mpeg=(frame[1]&24)!=8&&(frame[1]&6)!=0&&(frame[2]&240)!=0&&(frame[2]&240)!=240&&(frame[2]&12)!=12;
            const bool adts=(frame[1]&246)==240&&(frame[2]&60)!=60;
            if(mpeg||adts){out["quality"]="lossy";if(!hasId3)out["hasLyrics"]=false;}
        }
    }
    // ID3v1 remains a useful fallback for older MP3 libraries.
    if(end>=128&&read(f,end-128,b,128)&&textAt(b,0,"TAG")){
        tag(out,"title",tagText(b,3,33,0));tag(out,"artist",tagText(b,33,63,0));tag(out,"album",tagText(b,63,93,0));
    }
    return out;
}
inline Json inspect(const std::string& path,const std::string&){
#ifndef _WIN32
    constexpr char prefix[]="/proc/self/fd/";
    if(path.compare(0,sizeof(prefix)-1,prefix)==0){
        int fd=-1;
        const auto end=path.data()+path.size();
        const auto parsed=std::from_chars(path.data()+sizeof(prefix)-1,end,fd);
        struct stat info{};
        if(parsed.ec!=std::errc{}||parsed.ptr!=end||fd<0||fstat(fd,&info)!=0||
           !S_ISREG(info.st_mode)||info.st_size<=0)return Json::object();
        // The caller keeps its granted descriptor alive throughout this synchronous call.
        return inspectSource(fd,static_cast<uint64_t>(info.st_size));
    }
#endif
    std::ifstream file(path,std::ios::binary|std::ios::ate);
    if(!file)return Json::object();
    const auto length=file.tellg();
    if(length<0)return Json::object();
    return inspectSource(file,static_cast<uint64_t>(length));
}
}

