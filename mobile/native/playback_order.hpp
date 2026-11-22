#pragma once
#include <random>

namespace lume {
// One stepping policy for the room's buttons and natural track completion.
inline int nextTrackIndex(int current, int count, int direction, bool shuffle, std::mt19937& random) {
    if (count <= 0) return -1;
    const bool selected = current >= 0 && current < count;
    if (shuffle && count > 1) {
        const int pick = std::uniform_int_distribution<int>(0, count - (selected ? 2 : 1))(random);
        return selected && pick >= current ? pick + 1 : pick;
    }
    if (!selected) return direction < 0 ? count - 1 : 0;
    return (current + (direction < 0 ? -1 : 1) + count) % count;
}
}
