#pragma once
#include "vendor/json.hpp"
namespace personal {
using Json = nlohmann::json;
Json command(const Json& request);
void ingest(const Json& records);
Json records();
Json origin();
}
