#include "../mobile/native/audio_facts.hpp"
#include <iostream>
#ifndef _WIN32
#include <fcntl.h>
#include <unistd.h>
#endif
int main(int argc,char** argv){
    for(int i=1;i<argc;i++){
        std::string path=argv[i];
#ifndef _WIN32
        int fd=open(path.c_str(),O_RDONLY);
        if(fd<0)return 2;
        if(lseek(fd,1,SEEK_SET)!=1)return 3;
        path="/proc/self/fd/"+std::to_string(fd);
#endif
        // Both migration and Harmony's copied files lose their extension.
        std::cout<<audio_facts::inspect(path,"").dump()<<std::endl;
#ifndef _WIN32
        if(lseek(fd,0,SEEK_CUR)!=1)return 4;
        close(fd);
#endif
    }
}
