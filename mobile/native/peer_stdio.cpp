#include "peer_exchange.hpp"
#include <iostream>
int main(){
    std::string line;
    while(std::getline(std::cin,line)){
        try{
            auto result=personal::command(personal::Json::parse(line));
            std::cout<<result.dump()<<std::endl;
        }catch(const std::exception&){std::cout<<"{\"error\":\"invalid request\"}"<<std::endl;}
    }
}
