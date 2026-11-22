#pragma once
#include <string>
#include <memory>
class Decoder {
    struct Impl;
    std::unique_ptr<Impl> data;
public:
    double duration=0;
    explicit Decoder(const std::string& file);
    ~Decoder();
    std::string block(int index,const std::string& channel);
};