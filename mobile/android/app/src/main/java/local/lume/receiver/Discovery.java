package local.lume.receiver;

import android.os.SystemClock;
import org.json.JSONObject;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

final class Discovery {
    interface Result {void found(String name,String url);}
    static final class Session {
        private volatile boolean stopped;
        private DatagramSocket socket;
        private HttpURLConnection http;
        synchronized boolean attach(DatagramSocket value){if(stopped){value.close();return false;}socket=value;return true;}
        synchronized boolean attach(HttpURLConnection value){if(stopped){value.disconnect();return false;}http=value;return true;}
        synchronized void stop(){stopped=true;if(socket!=null)socket.close();if(http!=null)http.disconnect();}
    }
    static Session search(String saved,Result found,Runnable finished) {
        Session session=new Session();
        android.os.Handler timer=new android.os.Handler(android.os.Looper.getMainLooper());
        Runnable timeout=session::stop;
        timer.postDelayed(timeout,30000);
        final long end=SystemClock.elapsedRealtime()+30000;
        new Thread(()->{
          try {
            if(!saved.isEmpty()) {
                HttpURLConnection h=null;
                try {
                    h=(HttpURLConnection)new URL(RoomReceiver.host(saved)+"/api/info").openConnection();
                    if(!session.attach(h))return;
                    h.setConnectTimeout(700);h.setReadTimeout(700);h.setInstanceFollowRedirects(false);
                    try(Scanner s=new Scanner(h.getInputStream(),"UTF-8").useDelimiter("\\A")){
                        JSONObject info=new JSONObject(s.next());
                        if(!session.stopped&&"lume-room/1".equals(info.optString("service")))found.found(info.optString("roomName"),saved);
                    }
                }catch(Exception ignored){}finally{if(h!=null)h.disconnect();}
            }
            try(DatagramSocket sock=new DatagramSocket(null)){
                if(!session.attach(sock))return;
                sock.setReuseAddress(true);sock.bind(new InetSocketAddress(46323));sock.setBroadcast(true);sock.setSoTimeout(450);
                byte[] query="LUME_DISCOVER_1".getBytes(StandardCharsets.US_ASCII);
                Set<InetAddress> targets=new HashSet<>();
                targets.add(InetAddress.getByName("255.255.255.255"));
                for(NetworkInterface iface:Collections.list(NetworkInterface.getNetworkInterfaces()))
                    for(InterfaceAddress a:iface.getInterfaceAddresses())if(a.getBroadcast()!=null)targets.add(a.getBroadcast());
                while(!session.stopped&&SystemClock.elapsedRealtime()<end){
                    for(InetAddress addr:targets)try{sock.send(new DatagramPacket(query,query.length,addr,46322));}catch(Exception ignored){}
                    DatagramPacket packet=new DatagramPacket(new byte[1024],1024);
                    try{
                        sock.receive(packet);JSONObject data=new JSONObject(new String(packet.getData(),0,packet.getLength(),StandardCharsets.UTF_8));
                        int port=data.optInt("port");
                        if(!session.stopped&&"lume-room/1".equals(data.optString("service"))&&port>0&&port<=65535)
                            found.found(data.optString("name"),"http://"+packet.getAddress().getHostAddress()+":"+port);
                        Thread.sleep(200);
                    }catch(SocketTimeoutException ignored){}catch(org.json.JSONException ignored){}
                }
            }catch(Exception ignored){}
          } finally {session.stop();timer.removeCallbacks(timeout);finished.run();}
        },"lume-discovery").start();
        return session;
    }
}

