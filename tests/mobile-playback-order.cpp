#include "../mobile/native/playback_order.hpp"
#include <cassert>
#include <set>
#include <iostream>

int main() {
    std::mt19937 random(83942);
    assert(lume::nextTrackIndex(-1, 0, 1, false, random) == -1);
    assert(lume::nextTrackIndex(-1, 0, 1, true, random) == -1);
    for (bool shuffle : {false, true}) {
        assert(lume::nextTrackIndex(-1, 1, 1, shuffle, random) == 0);
        assert(lume::nextTrackIndex(0, 1, -1, shuffle, random) == 0);
    }
    assert(lume::nextTrackIndex(-1, 4, 1, false, random) == 0);
    assert(lume::nextTrackIndex(-1, 4, -1, false, random) == 3);
    assert(lume::nextTrackIndex(1, 4, 1, false, random) == 2);
    assert(lume::nextTrackIndex(0, 4, -1, false, random) == 3);
    assert(lume::nextTrackIndex(3, 4, 1, false, random) == 0);
    for (int direction : {-1, 1}) {
        for (int current = 0; current < 4; ++current) {
            std::set<int> visited;
            for (int n = 0; n < 200; ++n) {
                const int next = lume::nextTrackIndex(current, 4, direction, true, random);
                assert(next >= 0 && next < 4 && next != current);
                visited.insert(next);
            }
            assert(visited.size() == 3);
        }
    }
    // Disabling shuffle immediately resumes the current queue's order.
    const int picked = lume::nextTrackIndex(1, 4, 1, true, random);
    assert(lume::nextTrackIndex(picked, 4, 1, false, random) == (picked + 1) % 4);
    std::cout << "PASS: empty/single, ordered wrap, random exclusion and resume order\n";
}
