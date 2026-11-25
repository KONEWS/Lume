package local.lume.receiver;

import android.os.SystemClock;
import org.json.JSONObject;
import org.json.JSONArray;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

final class Discovery {
    interface Result {void found(String name,String url,String roomId,boolean live);}
    static final class Session {
        private volatile boolean stopped;
        private DatagramSocket socket;
        private HttpURLConnection http;
        synchronized boolean attach(DatagramSocket value){if(stopped){value.close();return false;}socket=value;return true;}
        synchronized boolean attach(HttpURLConnection value){if(stopped){value.disconnect();return false;}http=value;return true;}
        synchronized void stop(){stopped=true;if(socket!=null)socket.close();if(http!=null)http.disconnect();}
    }
    private static String wireId(String id){return id.matches("[a-f0-9]{32}")?id:"";}
    private static String identity(JSONObject info,String url){
        String id=wireId(info.optString("roomId"));
        if(!id.isEmpty())return id;
        JSONArray aliases=info.optJSONArray("urls");
        if(aliases==null || aliases.length()>64)return "";
        SortedSet<String> urls=new TreeSet<>();
        for(int i=0;i<aliases.length();i++){
            String alias=aliases.optString(i);
            if(alias.matches("http://[0-9.]{7,15}:[0-9]{1,5}"))urls.add(alias);
        }
        return urls.contains(url)&&urls.size()>1?"legacy:"+new JSONArray(urls).toString()+":"+info.optString("roomName"):"";
    }
    private static JSONObject info(Session session,String url){
        HttpURLConnection h=null;
        try{
            h=(HttpURLConnection)new URL(url+"/api/info").openConnection();
            if(!session.attach(h))return null;
            h.setConnectTimeout(700);h.setReadTimeout(700);h.setInstanceFollowRedirects(false);
            try(InputStream input=h.getInputStream()){
                ByteArrayOutputStream bytes=new ByteArrayOutputStream();byte[] block=new byte[4096];
                for(int n;(n=input.read(block))!=-1;){
                    if(bytes.size()+n>65536)return null;
                    bytes.write(block,0,n);
                }
                JSONObject data=new JSONObject(new String(bytes.toByteArray(),StandardCharsets.UTF_8));
                return "lume-room/1".equals(data.optString("service"))?data:null;
            }
        }catch(Exception ignored){return null;}finally{if(h!=null)h.disconnect();}
    }
    static Session search(String saved,Result found,Runnable finished) {
        Session session=new Session();
        android.os.Handler timer=new android.os.Handler(android.os.Looper.getMainLooper());
        Runnable timeout=session::stop;
        timer.postDelayed(timeout,30000);
        final long end=SystemClock.elapsedRealtime()+30000;
        new Thread(()->{
          try {
            Map<String,String> identities=new HashMap<>();
            if(!saved.isEmpty())try{
                String url=RoomReceiver.host(saved);
                JSONObject data=info(session,url);
                if(!session.stopped&&data!=null){
                    String id=identity(data,url);identities.put(url,id);
                    found.found(data.optString("roomName"),url,id,false);
                }
            }catch(Exception ignored){}
            try(DatagramSocket sock=new DatagramSocket(null)){
                if(!session.attach(sock))return;
                sock.setReuseAddress(true);sock.bind(new InetSocketAddress(46323));sock.setBroadcast(true);sock.setSoTimeout(450);
                byte[] query="LUME_DISCOVER_1".getBytes(StandardCharsets.US_ASCII);
                Set<InetAddress> targets=new HashSet<>();
                Set<InetAddress> confirmed=new HashSet<>();
                targets.add(InetAddress.getByName("255.255.255.255"));
                for(NetworkInterface iface:Collections.list(NetworkInterface.getNetworkInterfaces()))
                    for(InterfaceAddress a:iface.getInterfaceAddresses())if(a.getBroadcast()!=null)targets.add(a.getBroadcast());
                while(!session.stopped&&SystemClock.elapsedRealtime()<end){
                    for(InetAddress addr:targets)try{sock.send(new DatagramPacket(query,query.length,addr,46322));}catch(Exception ignored){}
                    DatagramPacket packet=new DatagramPacket(new byte[9216],9216);
                    try{
                        sock.receive(packet);JSONObject data=new JSONObject(new String(packet.getData(),0,packet.getLength(),StandardCharsets.UTF_8));
                        int port=data.optInt("port");
                        if(!session.stopped&&"lume-room/1".equals(data.optString("service"))&&port>0&&port<=65535){
                            if(packet.getPort()==46322&&confirmed.size()<64&&confirmed.add(packet.getAddress())){
                                sock.send(new DatagramPacket(query,query.length,packet.getAddress(),46322));
                            }
                            String url="http://"+packet.getAddress().getHostAddress()+":"+port,id=wireId(data.optString("roomId"));
                            if(id.isEmpty()){
                                if(!identities.containsKey(url)&&identities.size()<64){
                                    JSONObject metadata=info(session,url);
                                    identities.put(url,metadata==null?"":identity(metadata,url));
                                }
                                id=identities.getOrDefault(url,"");
                            }
                            if(!session.stopped)found.found(data.optString("name"),url,id,true);
                        }
                        Thread.sleep(200);
                    }catch(SocketTimeoutException ignored){}catch(org.json.JSONException ignored){}
                }
            }catch(Exception ignored){}
          } finally {session.stop();timer.removeCallbacks(timeout);finished.run();}
        },"lume-discovery").start();
        return session;
    }
}

