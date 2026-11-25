package local.lume.receiver;
import android.content.Context;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import org.json.JSONObject;

final class LocalAudio {
    static {System.loadLibrary("lume");}
    private static native byte[] nativeMedia(byte[] path,byte[] channel,int block,byte[] identity);
    static byte[] block(String path,String channel,int block){return block(path,channel,block,"");}
    static byte[] block(String path,String channel,int block,String identity){return nativeMedia(path.getBytes(StandardCharsets.UTF_8),channel.getBytes(StandardCharsets.UTF_8),block,identity.getBytes(StandardCharsets.UTF_8));}
    private static final ExecutorService readers=Executors.newFixedThreadPool(2);
    static final class Match implements AutoCloseable {
        final ParcelFileDescriptor fd;final String path,identity;final JSONObject song;
        Match(ParcelFileDescriptor fd,JSONObject song,String identity){this.fd=fd;this.path="/proc/self/fd/"+fd.getFd();this.song=song;this.identity=identity;}
        public void close(){try{fd.close();}catch(Exception ignored){}}
    }
    private final Context context;private final PhoneSource source;
    private volatile int generation;private String key="";private volatile Match match;
    LocalAudio(Context context,PhoneSource source){this.context=context;this.source=source;}
    synchronized void select(String track,String identity,long bytes){
        String next=track+"/"+identity;if(next.equals(key))return;
        clear();key=next;final int gen=generation;
        if(!identity.matches("sha256:[a-f0-9]{64}")||bytes<=0)return;
        List<LibraryPlayer.Song> songs=source.localSongs();
        readers.execute(()->{
            for(LibraryPlayer.Song song:songs){
                if(gen!=generation)return;
                if(song.hidden || (song.facts.optLong("bytes",-1)>0&&song.facts.optLong("bytes")!=bytes))continue;
                ParcelFileDescriptor fd=null;
                try{
                    fd=context.getContentResolver().openFileDescriptor(Uri.parse(song.uri),"r");if(fd==null)continue;
                    String path="/proc/self/fd/"+fd.getFd();
                    JSONObject info=new JSONObject(new String(block(path,"stereo",-1),StandardCharsets.UTF_8));
                    if(!identity.equals(info.optString("audioIdentity"))||info.optLong("audioBytes")!=bytes)continue;
                    if(block(path,"stereo",0,identity).length==0)continue;
                    JSONObject metadata=song.coverRecord().put("hostId",UUID.nameUUIDFromBytes(song.uri.getBytes(StandardCharsets.UTF_8)).toString());
                    synchronized(this){if(gen!=generation)return;match=new Match(fd,metadata,identity);fd=null;}return;
                }catch(Exception ignored){}finally{if(fd!=null)try{fd.close();}catch(Exception ignored){}}
            }
        });
    }
    Match current(){return match;}
    synchronized void clear(){generation++;key="";Match old=match;match=null;if(old!=null)old.close();}
}
