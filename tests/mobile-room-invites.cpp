// Runs the real shared room protocol with an empty catalog; decoding is unused.
#include "../mobile/native/room.cpp"
struct Decoder::Impl {};
Decoder::Decoder(const std::string&) {}
Decoder::~Decoder()=default;
std::string Decoder::block(int,const std::string&){return {};}
int main(){std::string line;while(std::getline(std::cin,line))std::cout<<mobileRoom(line)<<std::endl;}
