#include "../mobile/native/audio_facts.hpp"
#include <iostream>
int main(int argc,char** argv){
    for(int i=1;i<argc;i++){
        try{std::cout<<audio_facts::inspect(argv[i],std::string(argv[i]).substr(std::string(argv[i]).find_last_of('.')+1)).dump()<<std::endl;}
        catch(const std::exception& e){std::cerr<<e.what()<<std::endl;return 1;}
    }
}
