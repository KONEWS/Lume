#pragma once
#include <string>
// Negative block requests return UTF-8 identity JSON; other requests return PCM.
std::string mobileMedia(const std::string& path,const std::string& channel,int block,const std::string& identity="");
std::string peekMediaIdentity(const std::string& path);
