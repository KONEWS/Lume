#include "decoder.hpp"
#include <cassert>
#include <fcntl.h>
#include <iostream>
#include <string>
#include <unistd.h>

// Android: run with a seekable WAV/FLAC/MP3 file lasting at least 16 seconds.
int main(int argc,char** argv){
    assert(argc==2);
    Decoder baseline(argv[1]);
    assert(baseline.duration>=16);
    int original=open(argv[1],O_RDONLY);
    assert(original>=0&&lseek(original,123,SEEK_SET)==123);
    int replacement=-1;
    {
        Decoder fromDescriptor("/proc/self/fd/"+std::to_string(original));
        assert(fromDescriptor.duration==baseline.duration);
        assert(fromDescriptor.block(0,"stereo")==baseline.block(0,"stereo"));
        assert(fromDescriptor.block(2,"stereo")==baseline.block(2,"stereo"));
        assert(fromDescriptor.block(1,"left")==baseline.block(1,"left"));
        assert(lseek(original,0,SEEK_CUR)==123);
        close(original);
        replacement=open(argv[1],O_RDONLY);
        assert(replacement>=0);
        assert(fromDescriptor.block(3,"stereo")==baseline.block(3,"stereo"));
    }
    assert(fcntl(replacement,F_GETFD)>=0);
    close(replacement);
    Decoder closed("/proc/self/fd/"+std::to_string(replacement));
    assert(closed.duration==0&&closed.block(0,"stereo").empty());
    for(const auto path:{"/proc/self/fd/-1","/proc/self/fd/99999999999999999999999","/proc/self/fd/1bad"}){
        Decoder invalid(path);assert(invalid.duration==0);
    }
    std::cout<<"PASS descriptor decoding, independent cursor, seeks, duplicate lifetime, invalid descriptors\n";
}
