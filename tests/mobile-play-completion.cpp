#include "../mobile/native/play_completion.hpp"
#include <cassert>
#include <iostream>
int main(){
    lume::PlayCompletion c;
    c.play(1000);assert(!c.finish(10,1000)); // starting never counts
    c.reset();c.play(1000);assert(!c.finish(10,4000)); // cut short
    c.reset();c.play(1000);c.seek(9.9,2000);assert(!c.finish(10,12000)); // wall time cannot rehabilitate a seek
    c.reset();c.play(1000);c.pause(5000);c.play(15000);assert(c.finish(10,21000));
    assert(!c.finish(10,22000)); // duplicate native completion
    c.reset();c.play(20000);assert(!c.finish(10,21000)); // scheduled future start
    c.reset();c.play(0);c.seek(8,1000);c.seek(0,2000);assert(c.finish(10,12000)); // full replay from zero
    c.reset();c.play(0);c.pause(5000);assert(!c.finish(10,15000)); // paused time excluded
    c.reset();c.play(0);assert(c.finish(10,10000));
    c.reset();c.play(10000);assert(c.finish(10,20000)); // repeat-one independent pass
    c.reset();c.play(0);assert(!c.finish(0,10000));
    std::cout<<"completion: 11 timing, seek, pause, replay and duplicate checks passed\n";
}
