package local.lume.receiver;

import android.content.Context;

import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;

import java.util.UUID;
import java.util.concurrent.*;

final class RoomReceiver {
    interface Listener { void snapshot(JSONObject data); void skin(JSONObject skin); void show(String status, String title, String channel); }
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Context context;
    private final Listener listener;
    private final PhoneSource source;
    private final LocalAudio localAudio;
    private volatile int sourceAck=-1;
    private String deviceId="";
    private ScheduledExecutorService worker;
    private volatile int generation;
    private String base="",cookie="";
    
    private JSONObject latest,trackDetails;
    private String detailsKey="",loadingKey="";
    private long detailsRetry;
    private static byte[] get(String host,String path,String auth)throws Exception{
        if(!path.startsWith("/")||path.startsWith("//"))throw new IOException("Invalid detail path");
        for(int redirect=0;redirect<4;redirect++){
            HttpURLConnection connection=(HttpURLConnection)new URL(host+path).openConnection();
            try{
                connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(2500);connection.setReadTimeout(3500);
                connection.setRequestProperty("Cookie",auth);
                int status=connection.getResponseCode();
                if(status==302||status==301){path=connection.getHeaderField("Location");if(path==null||!path.startsWith("/")||path.startsWith("//"))throw new IOException("Invalid redirect");continue;}
                if(status!=200)throw new IOException("Details "+status);
                ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] chunk=new byte[8192];int n;
                try(InputStream in=connection.getInputStream()){while((n=in.read(chunk))!=-1){if(out.size()+n>6*1024*1024)throw new IOException("Details too large");out.write(chunk,0,n);}}
                return out.toByteArray();
            }finally{connection.disconnect();}
        }
        throw new IOException("Too many redirects");
    }
    private void loadDetails(int gen,String url,String auth,JSONObject data){
        String id=data.optString("trackId"),token=data.optString("detailToken"),key=id+"/"+token;
        if(id.isEmpty())return;
        if(key.equals(detailsKey)&&trackDetails!=null){try{data.put("roomDetails",trackDetails);}catch(Exception ignored){}return;}
        if(key.equals(loadingKey)||SystemClock.elapsedRealtime()<detailsRetry)return;
        loadingKey=key;
        new Thread(()->{
            JSONObject result=null;
            try{
                if(!token.isEmpty())result=new JSONObject(new String(get(url,"/api/track-details/"+UriEncode(id)+"/"+UriEncode(token),auth),StandardCharsets.UTF_8));
                else{
                    result=new JSONObject(new String(get(url,"/api/lyrics/"+UriEncode(id),auth),StandardCharsets.UTF_8));
                    byte[] art=get(url,"/artwork/"+UriEncode(id),auth);
                    String mime=java.net.URLConnection.guessContentTypeFromStream(new ByteArrayInputStream(art));
                    if(mime==null)mime=new String(art,0,Math.min(200,art.length),StandardCharsets.UTF_8).contains("<svg")?"image/svg+xml":"image/webp";
                    result.put("cover","data:"+mime+";base64,"+android.util.Base64.encodeToString(art,android.util.Base64.NO_WRAP));
                }
                result.put("id",id);
            }catch(Exception ignored){result=null;}
            final JSONObject ready=result;
            main.post(()->{
                if(gen!=generation)return;
                if(loadingKey.equals(key))loadingKey="";
                if(latest==null||!latest.optString("trackId").equals(id)||!latest.optString("detailToken").equals(token))return;
                if(ready==null){detailsRetry=SystemClock.elapsedRealtime()+2000;return;}
                trackDetails=ready;detailsKey=key;detailsRetry=0;
                try{latest.put("roomDetails",ready);}catch(Exception ignored){}
                listener.snapshot(latest);
            });
        },"lume-track-details").start();
    }
    private static String UriEncode(String value){return android.net.Uri.encode(value);}

    Runnable catalogCover(String id,String revision,String visible,java.util.function.Consumer<String> reply){
        final int gen=generation;
        final String url=base,auth=cookie;
        return ()->{
            String payload="";
            if(gen==generation && !auth.isEmpty() && id.matches("[A-Za-z0-9_-]+") && revision.matches("[a-f0-9]{32}"))try{
                String hint=visible.length()<=1024 && visible.matches("[A-Za-z0-9_,-]+")?"?visible="+UriEncode(visible):"";
                payload=new String(get(url,"/api/catalog-cover/"+revision+"/"+id+hint,auth),StandardCharsets.UTF_8);
            }catch(Exception ignored){}
            reply.accept(gen==generation?payload:"");
        };
    }

    
    private volatile PcmOutput output;
    private long lastGood;
    private volatile int libraryVersion=-1;
    private final String profile;
    private long clockBase=Long.MAX_VALUE, clockWindow;
    private void clockSample(long midpoint,long rtt,long server){
        long offset=server-midpoint;
        if(clockBase==Long.MAX_VALUE||SystemClock.elapsedRealtime()-clockWindow>10000){clockBase=offset;clockWindow=SystemClock.elapsedRealtime();bestRtt=rtt;}
        else if(rtt<=bestRtt){clockBase=offset;bestRtt=rtt;}
    }
    private long bestRtt;

    RoomReceiver(Context context, Listener listener,PhoneSource source) {this.source=source; this.context=context; this.listener=listener;this.localAudio=new LocalAudio(context,source);
      android.content.SharedPreferences prefs=context.getSharedPreferences("receiver",0);
      profile=prefs.getString("profile",UUID.randomUUID().toString());
      prefs.edit().putString("profile",profile).apply();
    }
    int savedDelay(){return context.getSharedPreferences("receiver",0).getInt("routeDelay",0);}
    String savedChannel(){return context.getSharedPreferences("receiver",0).getString("routeChannel","right");}
    void saveRoute(String channel,int delay){
        if(!java.util.Arrays.asList("left","right","mono","stereo").contains(channel))return;
        delay=Math.max(-1000,Math.min(1000,delay));
        if(delay!=savedDelay()||!savedChannel().equals(channel))
            context.getSharedPreferences("receiver",0).edit().putInt("routeDelay",delay).putString("routeChannel",channel).apply();
    }
    static String host(String value) throws Exception {
        URI uri = new URI(value.contains("://")?value.trim():"http://"+value.trim());
        if (!"http".equals(uri.getScheme()) || uri.getHost()==null || uri.getUserInfo()!=null ||
            uri.getQuery()!=null || uri.getFragment()!=null || !(uri.getPath().isEmpty() || uri.getPath().equals("/")))
            throw new IOException("请填写主机显示的局域网地址");
        return "http://"+uri.getRawAuthority();
    }
    private static final class Reply { JSONObject data; String cookie; }
    private static Reply post(String host,String path,JSONObject data,String cookie) throws Exception {
        HttpURLConnection http=(HttpURLConnection)new URL(host+path).openConnection();
        try {
            http.setInstanceFollowRedirects(false); http.setConnectTimeout(2500); http.setReadTimeout(2200);
            http.setRequestMethod("POST"); http.setDoOutput(true);
            http.setRequestProperty("Content-Type","application/json");
            if(!cookie.isEmpty())http.setRequestProperty("Cookie",cookie);
            try(OutputStream out=http.getOutputStream()){ out.write(data.toString().getBytes(StandardCharsets.UTF_8)); }
            int code=http.getResponseCode();
            if(code!=200)throw new IOException(code==401?"配对码错误或会话已过期":code==404?"请更新 Windows 播放器到 0.2":"主机响应 "+code);
            Reply result=new Reply(); String set=http.getHeaderField("Set-Cookie");
            result.cookie=set==null?"":set.split(";",2)[0];
            try(BufferedReader reader=new BufferedReader(new InputStreamReader(http.getInputStream(),StandardCharsets.UTF_8))){
                StringBuilder json=new StringBuilder();String line;
                while((line=reader.readLine())!=null)json.append(line);
                result.data=new JSONObject(json.toString());
            }
            return result;
        } finally { http.disconnect(); }
    }
    void connect(String address,String code) {
        connect(address,code,"","");
    }
    static class PreparedInvite {
        final String id="native-"+UUID.randomUUID();
        String cookie;
    }
    static PreparedInvite prepareInvite(JSONObject offer)throws Exception {
        String url=host(offer.getString("url"));
        PreparedInvite ready=new PreparedInvite();
        ready.cookie=post(url,"/api/join/invite",offer,"").cookie;
        if(ready.cookie.isEmpty())throw new IOException("邀请已失效");
        JSONObject state=post(url,"/api/receiver",new JSONObject().put("id",ready.id).put("platform","Android").put("model",MobileHost.MODEL),ready.cookie).data;
        if(!state.has("trackId")||!state.has("outputs"))throw new IOException("空间尚未就绪");
        return ready;
    }
    void connect(String address,String code,String inviteToken,String deviceId) {connect(address,code,inviteToken,deviceId,null);}
    void connect(String address,String code,String inviteToken,String deviceId,PreparedInvite prepared) {
        disconnect();
        final int gen=generation;
        final String id=prepared!=null?prepared.id:"native-"+UUID.randomUUID();
        this.deviceId=id;
        worker=Executors.newSingleThreadScheduledExecutor();
        ScheduledExecutorService session=worker;
        session.execute(()->{
            try {
                String url=host(address);
                String auth;
                if(prepared!=null)auth=prepared.cookie;
                else if(!inviteToken.isEmpty()){
                    try{auth=post(url,"/api/join/invite",new JSONObject().put("inviteToken",inviteToken).put("deviceId",deviceId),"").cookie;}
                    catch(Exception e){throw new IOException("邀请已失效或连接失败，请让房主重新邀请",e);}
                }else if(code.isEmpty()){
                    Reply ticket=post(url,"/api/join/request",new JSONObject().put("platform","Android").put("model",MobileHost.MODEL),"");
                    auth="";
                    for(int i=0;i<65 && gen==generation;i++){
                        Thread.sleep(850);Reply reply=post(url,"/api/join/status",ticket.data,"");
                        if(!reply.cookie.isEmpty()){auth=reply.cookie;break;}
                        if("deny".equals(reply.data.optString("decision")))throw new IOException("主机已忽略请求");
                    }
                }else auth=post(url,"/api/pair",new JSONObject().put("code",code),"").cookie;
                final String token=auth;
                if(auth.isEmpty())throw new IOException("未取得配对会话");
                if(gen!=generation)return;
                main.post(()->{if(gen==generation){base=url;cookie=token;}});
                session.scheduleWithFixedDelay(()->poll(gen,url,token,id),0,180,TimeUnit.MILLISECONDS);
            } catch(Exception e){fail(gen,e);}
        });
    }
    private void poll(int gen,String url,String auth,String id){
        if(gen!=generation)return;
        try{
            JSONObject body=new JSONObject().put("id",id).put("model",MobileHost.MODEL).put("profile",profile).put("savedChannel",savedChannel()).put("savedDelayMs",savedDelay()).put("libraryVersion",libraryVersion).put("platform","Android");
            org.json.JSONArray local=source.songs();if(sourceAck!=local.length())body.put("sourceSongs",local);
            PcmOutput active=output;if(active!=null)body.put("bufferMs",active.ahead).put("gaps",active.gaps).put("underflows",active.underflows);
            long before=SystemClock.elapsedRealtime();
            JSONObject data=post(url,"/api/receiver",body,auth).data;lastGood=SystemClock.elapsedRealtime();
            long after=lastGood,stamp=(before+after)/2;
            if(gen!=generation)return;
            localAudio.select(data.optString("trackId"),data.optString("audioIdentity"),data.optLong("audioBytes"));
            LocalAudio.Match match=localAudio.current();
            data.put("localSong",match==null?JSONObject.NULL:match.song).put("localTrackId",match==null?"":data.optString("trackId"));
            if(gen!=generation)return;
            sourceAck=data.optInt("sourceAck",local.length());source.requested(data.optJSONObject("transfer"),url,auth);
            libraryVersion=data.optInt("libraryVersion",-1);
            main.post(()->{if(gen==generation){latest=data;loadDetails(gen,url,auth,data);clockSample(stamp,after-before,data.optLong("serverTime"));listener.snapshot(data);listener.skin(data.optJSONObject("skin"));apply();}});
        }catch(Exception e){if(SystemClock.elapsedRealtime()-lastGood>5500)fail(gen,e);}
    }
    void action(JSONObject input){
        final String url=base,token=cookie;final int gen=generation;
        if(worker==null||token.isEmpty())return;
        worker.execute(()->{try{post(url,"/api/action",input,token);}catch(Exception e){main.post(()->{
            if(gen==generation)listener.show("操作失败 · "+e.getMessage(),"",latest==null?"":latest.optString("channel"));
        });}});
    }
    private void fail(int gen,Exception e){ main.post(()->{if(gen==generation){disconnect();listener.show("连接失败 · "+e.getMessage(),"","");}}); }
    // Match the PCM presentation clock, rather than displaying a stale poll sample.
    double playbackPosition(){
        if(latest==null)return 0;
        double position=latest.optDouble("position",0);
        if(latest.optBoolean("roomPlaying") && clockBase!=Long.MAX_VALUE)
            position+=(SystemClock.elapsedRealtime()-(latest.optLong("serverTime")-clockBase)-latest.optInt("delayMs"))/1000.0;
        return Math.max(0,Math.min(latest.optDouble("duration",0),position));
    }
    private void apply(){
        if(latest==null)return;
        String path=latest.optString("media");
        if(!path.isEmpty()){
            if(output==null)output=new PcmOutput();
            output.update(base+path.replace("/api/receiver-media/","/api/pcm/"),cookie,latest.optBoolean("playing"),latest.optDouble("position"),
              latest.optDouble("duration"),latest.optInt("delayMs"),latest.optDouble("volume"),latest.optLong("serverTime")-clockBase,localAudio.current(),latest.optString("channel"));
        }else resetPlayer();
        String status=!latest.optBoolean("enabled")?"输出已停用":latest.optBoolean("playing")?"正在播放":"已连接 · 已暂停";
        listener.show(status,latest.optString("roomTrack"),latest.optString("channel"));
    }
    private void resetPlayer(){if(output!=null){output.close();output=null;}}
    void disconnect(){
        localAudio.clear();
        generation++;detailsKey="";loadingKey="";detailsRetry=0;trackDetails=null;libraryVersion=-1;sourceAck=-1;clockBase=Long.MAX_VALUE;
        if(worker!=null){worker.shutdownNow();worker=null;}
        String url=base,auth=cookie,id=deviceId;
        if(!auth.isEmpty())new Thread(()->{
            try{post(url,"/api/receiver",new JSONObject().put("id",id).put("platform","Android").put("leave",true),auth);}
            catch(Exception ignored){ /* The host also expires disconnected devices. */ }
        }).start();
        resetPlayer();latest=null;cookie="";base="";deviceId="";
    }
}
