#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>

namespace lume {
// A completion callback alone also fires after seeking to the end. Require an
// uninterrupted pass from zero, with enough active time, and consume it once.
class PlayCompletion {
    double elapsed=0;
    int64_t since=0;
    bool running=false, eligible=true, consumed=false;
public:
    void reset(){elapsed=0;since=0;running=false;eligible=true;consumed=false;}
    void play(int64_t time){if(!running){since=time;running=true;}}
    void pause(int64_t time){if(running){elapsed+=std::max<int64_t>(0,time-since)/1000.;running=false;}}
    void seek(double position,int64_t time){
        const bool resume=running;
        if(position==0){reset();if(resume)play(time);}else eligible=false;
    }
    bool finish(double duration,int64_t time){
        pause(time);
        if(consumed)return false;
        consumed=true;
        return eligible && std::isfinite(duration) && duration>0 &&
            elapsed>=duration-std::min(.25,duration*.01);
    }
};
}
