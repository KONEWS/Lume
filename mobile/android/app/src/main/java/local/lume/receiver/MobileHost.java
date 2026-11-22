package local.lume.receiver;

import android.app.Activity;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import org.json.*;
import java.io.*;
import java.util.*;
import java.nio.charset.StandardCharsets;

final class MobileHost {
    static {System.loadLibrary("lume");}
    private static native byte[] nativeRoom(byte[] request);
    private final Activity app;
    private final Map<String,ParcelFileDescriptor> files=new HashMap<>();
    static final String MODEL = deviceModel();
    private static String deviceModel(){
        String model=android.os.Build.MODEL, brand=android.os.Build.BRAND;
        if(model==null || model.trim().isEmpty() || "unknown".equalsIgnoreCase(model))return "安卓手机";
        model=model.trim();
        if(brand==null || brand.trim().isEmpty() || "unknown".equalsIgnoreCase(brand)
            || model.regionMatches(true,0,brand.trim(),0,brand.trim().length()))return model;
        return brand.trim()+" "+model;
    }
    volatile boolean active;
    MobileHost(Activity app){this.app=app;}
    static JSONObject call(JSONObject request)throws JSONException{
        return new JSONObject(new String(nativeRoom(request.toString().getBytes(StandardCharsets.UTF_8)),StandardCharsets.UTF_8));
    }
    JSONObject status()throws JSONException{return call(new JSONObject().put("type","status"));}
    void searchPhones()throws JSONException{
        JSONObject request=new JSONObject().put("type","searchPhones");
        android.net.ConnectivityManager manager=app.getSystemService(android.net.ConnectivityManager.class);
        if(manager!=null)try{
            android.net.Network active=manager.getActiveNetwork();
            android.net.Network wifi=null;
            for(android.net.Network network:manager.getAllNetworks()){
                android.net.NetworkCapabilities caps=manager.getNetworkCapabilities(network);
                if(caps==null || !caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI) ||
                   caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_VPN))continue;
                if(wifi==null || network.equals(active))wifi=network;
            }
            android.net.LinkProperties links=wifi==null?null:manager.getLinkProperties(wifi);
            if(links!=null){
                JSONArray broadcasts=new JSONArray();
                for(android.net.LinkAddress link:links.getLinkAddresses()){
                    if(!(link.getAddress() instanceof java.net.Inet4Address))continue;
                    int prefix=link.getPrefixLength();
                    if(prefix<1 || prefix>30)continue;
                    byte[] octets=link.getAddress().getAddress();
                    int address=java.nio.ByteBuffer.wrap(octets).getInt();
                    int broadcast=address | (-1 >>> prefix);
                    broadcasts.put(Integer.toUnsignedLong(broadcast));
                }
                if(broadcasts.length()>0)request.put("wifiNetwork",wifi.getNetworkHandle()).put("wifiBroadcasts",broadcasts);
            }
        }catch(SecurityException ignored){}
        call(request);
    }
    synchronized JSONObject catalog(String type,List<LibraryPlayer.Song> songs)throws Exception{
        JSONArray rows=new JSONArray();
        for(LibraryPlayer.Song s:songs){
            if(s.hidden)continue;
            if(Thread.currentThread().isInterrupted())throw new InterruptedIOException();
            ParcelFileDescriptor fd=files.get(s.uri);
            if(fd==null){
                try{fd=app.getContentResolver().openFileDescriptor(Uri.parse(s.uri),"r");}catch(IOException|SecurityException ex){continue;}
                if(fd==null)continue;files.put(s.uri,fd);
            }
            String id=UUID.nameUUIDFromBytes(s.uri.getBytes(StandardCharsets.UTF_8)).toString();
            rows.put(s.metadata().put("hasSideLyrics",!s.lyricUri.isEmpty()).put("hasSideCover",!s.coverUri.isEmpty()).put("historyId",s.uri).put("path","/proc/self/fd/"+fd.getFd()).put("id",id));
        }
        JSONObject request=new JSONObject().put("type",type).put("name",MODEL+" 的播放空间").put("songs",rows);
        if(type.equals("start"))request.put("shuffle",app.getSharedPreferences("library",0).getBoolean("shuffle",false)).put("playMode",app.getSharedPreferences("library",0).getString("playMode","sequence"));
        JSONObject result=call(request);
        active=result.has("pin");return result;
    }
    synchronized void stop(){
        try{call(new JSONObject().put("type","stop"));}catch(JSONException ignored){}
        active=false;for(ParcelFileDescriptor fd:files.values())try{fd.close();}catch(IOException ignored){}
        files.clear();
    }
}
