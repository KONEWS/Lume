#include "../mobile/native/room.cpp"
#include "../mobile/native/media_sha256.hpp"
#include "../mobile/native/local_media.hpp"
#include <iostream>
int main(){
 std::string line;
 while(std::getline(std::cin,line)){
  try{
   auto b=Json::parse(line);
   if(b.value("type","")=="media-test"){
    if(b.contains("text")){auto s=b.at("text").get<std::string>();MediaSha256 hash;hash.add(s.data(),s.size());std::cout<<Json({{"sha256",hash.finish()}}).dump()<<std::endl;continue;}
    auto path=b.value("path","");int block=b.value("block",-1);
    auto bytes=mobileMedia(path,b.value("channel","stereo"),block,b.value("identity",""));
    if(block<0)std::cout<<bytes<<std::endl;
    else {MediaSha256 hash;hash.add(bytes.data(),bytes.size());std::cout<<Json({{"size",bytes.size()},{"sha256",hash.finish()}}).dump()<<std::endl;}
   }else std::cout<<mobileRoom(line)<<std::endl;
  }catch(...){std::cout<<"{}"<<std::endl;}
 }
}
