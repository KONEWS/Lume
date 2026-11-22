#include <jni.h>
#include <string>
#include "local_media.hpp"
std::string mobileRoom(const std::string&);
// Byte arrays preserve UTF-8 titles and avoid JNI's modified UTF-8 encoding.
extern "C" JNIEXPORT jbyteArray JNICALL Java_local_lume_receiver_MobileHost_nativeRoom(JNIEnv* e,jclass,jbyteArray request){
    auto len=e->GetArrayLength(request);std::string command(len,'\0');
    e->GetByteArrayRegion(request,0,len,reinterpret_cast<jbyte*>(command.data()));
    auto reply=mobileRoom(command);
    auto out=e->NewByteArray(reply.size());
    e->SetByteArrayRegion(out,0,reply.size(),reinterpret_cast<const jbyte*>(reply.data()));return out;
}
extern "C" JNIEXPORT jbyteArray JNICALL Java_local_lume_receiver_LocalAudio_nativeMedia(JNIEnv* e,jclass,jbyteArray path,jbyteArray channel,jint block,jbyteArray identity){
    auto read=[&](jbyteArray a){std::string value(e->GetArrayLength(a),'\0');e->GetByteArrayRegion(a,0,value.size(),reinterpret_cast<jbyte*>(value.data()));return value;};
    auto bytes=mobileMedia(read(path),read(channel),block,read(identity));auto result=e->NewByteArray(bytes.size());
    e->SetByteArrayRegion(result,0,bytes.size(),reinterpret_cast<const jbyte*>(bytes.data()));return result;
}
