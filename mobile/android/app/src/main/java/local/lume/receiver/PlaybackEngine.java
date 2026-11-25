package local.lume.receiver;

import android.app.*;
import android.content.*;
import android.graphics.*;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.*;
import android.util.Base64;
import java.io.*;
import java.nio.ByteBuffer;
import java.util.concurrent.*;
import java.util.HashSet;
import java.util.Set;
import java.util.HashMap;
import java.util.Map;
import org.json.*;

// One transport for the UI, launcher and media session, independent of Activity lifetime.
final class PlaybackEngine implements RoomReceiver.Listener {
    private static PlaybackEngine instance;
    static PlaybackEngine get(Context context) {
        if (instance == null) instance = new PlaybackEngine(context.getApplicationContext());
        return instance;
    }
    final Context app;
    final LibraryPlayer local;
    final MobileHost host;
    final RoomReceiver room;
    ReceiverScreen screen;
    JSONObject snapshot;
    JSONArray catalog = new JSONArray();
    String id="", title="", artist="", artKey=null;
    String favoriteKey="";
    private final Set<String> favorites;
    private final Map<String,String> roomArtists=new HashMap<>();
    boolean playing, serviceRequested;
    long duration, position, sampledAt;
    Bitmap cover;
    private final ExecutorService covers=Executors.newSingleThreadExecutor();
    private final Handler main=new Handler(Looper.getMainLooper());
    private final SharedPreferences prefs;
    private PlaybackEngine(Context app) {
        this.app=app; prefs=app.getSharedPreferences("system-player",0);
        favorites=new HashSet<>(prefs.getStringSet("favoriteKeys",java.util.Collections.emptySet()));
        host=new MobileHost(app);
        local=new LibraryPlayer(app,()->{sync();if(screen!=null)screen.localChanged();});
        String last=prefs.getString("localId","");
        for(int i=0;i<local.songs.size();i++)if(last.equals(local.songs.get(i).uri)&&!local.songs.get(i).hidden){local.index=i;break;}
        room=new RoomReceiver(app,this,local.source);
    }
    public void snapshot(JSONObject data) {
        snapshot=data;
        if(data.optJSONArray("catalog")!=null){
            catalog=data.optJSONArray("catalog");roomArtists.clear();
            for(int i=0;i<catalog.length();i++){JSONObject song=catalog.optJSONObject(i);
                if(song!=null)roomArtists.put(song.optString("id"),song.optString("artist"));}
        }
        if(screen!=null)screen.snapshot(data);
        sync();
    }
    public void skin(JSONObject skin){if(screen!=null)screen.skin(skin);}
    public void show(String status,String title,String route){
        if(screen!=null)screen.show(status,title,route);
        else if(status.startsWith("连接失败")){if(host.active)host.stop();clearRoom();}
    }
    void clearRoom(){snapshot=null;catalog=new JSONArray();roomArtists.clear();sync();}
    void detach(ReceiverScreen owner){
        if(screen!=owner)return;
        screen=null;
        if(snapshot==null && !playing && !local.ready){room.disconnect();host.stop();}
    }
    boolean favorite(){return favorites.contains(favoriteKey);}
    JSONArray favoriteKeys(){return new JSONArray(favorites);}
    void importFavorites(JSONArray legacy){
        if(legacy==null || prefs.getBoolean("favoritesImported",false))return;
        // Before the first WebView opens, the set records widget toggles relative to the legacy state.
        for(int i=0;i<legacy.length();i++){
            String key=legacy.optString(i);
            if(!key.isEmpty()&&!favorites.add(key))favorites.remove(key);
        }
        prefs.edit().putBoolean("favoritesImported",true).putStringSet("favoriteKeys",new HashSet<>(favorites)).apply();
        PlayerWidget.render(app,this);
    }
    void setFavorite(String key,boolean value){
        if(key.isEmpty())return;
        if(value)favorites.add(key);else favorites.remove(key);
        prefs.edit().putStringSet("favoriteKeys",new HashSet<>(favorites)).apply();
        if(screen!=null)screen.sendFavorites();
        PlayerWidget.render(app,this);
    }
    void prepareService(){
        if(serviceRequested)return;
        serviceRequested=true;
        try{app.startForegroundService(new Intent(app,PlaybackService.class));}
        catch(IllegalStateException ex){serviceRequested=false;}
    }
    void command(String action) {
        if((screen!=null && screen.switchingPlayback()) || (host.active && snapshot==null))return;
        boolean active=snapshot!=null?snapshot.optBoolean("roomPlaying"):local.ready && local.audio.isPlaying();
        if("toggle".equals(action))action=active?"pause":"play";
        if(!"play".equals(action)&&!"pause".equals(action)&&!"next".equals(action)&&!"previous".equals(action))return;
        if(!"pause".equals(action)&&(snapshot!=null||!local.songs.isEmpty()))prepareService();
        if(snapshot!=null){try{room.action(new JSONObject().put("type",action));}catch(JSONException ignored){}return;}
        if("next".equals(action)||"previous".equals(action))local.step("next".equals(action)?1:-1);
        else if(active!="play".equals(action))local.toggle();
    }
    void sync(){
        if(local==null || room==null)return;
        JSONObject s=snapshot,details=s==null?null:s.optJSONObject("roomDetails");
        LibraryPlayer.Song song=local.index>=0&&local.index<local.songs.size()?local.songs.get(local.index):null;
        if(song!=null&&song.hidden)song=null;
        String track=s!=null?s.optString("trackId"):song==null?"":song.uri;
        String label=s!=null?s.optString("roomTrack"):song==null?"":song.title;
        if(s!=null){
            JSONObject match=s.optJSONObject("localSong");
            song=local.source.find(match!=null?match.optString("hostId",match.optString("id")):host.active?track:"");
        }
        String by=song==null?"":song.artist;
        if(s!=null && by.isEmpty())by=roomArtists.getOrDefault(track,"");
        String scope=s==null?"local":host.active?"本机空间":app.getSharedPreferences("appearance",0).getString("host","");
        String nextFavorite=track.isEmpty()?"":new JSONArray().put(scope).put(track).toString().replace("\\/","/");
        boolean scopeChanged=!nextFavorite.equals(favoriteKey);
        favoriteKey=nextFavorite;
        boolean active=s!=null?s.optBoolean("roomPlaying"):local.ready&&local.audio.isPlaying();
        long ms=s!=null?(long)(s.optDouble("duration",0)*1000):local.ready?local.audio.getDuration():0;
        long pos=s!=null?(long)(room.playbackPosition()*1000):local.ready?local.audio.getCurrentPosition():0;
        String remote=details!=null&&track.equals(details.optString("id"))?details.optString("cover"):"";
        String sourceKey=song==null?"":song.uri+"|"+song.scanStamp+"|"+song.coverUri+"|"+song.facts.optString("coverStamp")+"|"+song.facts.optLong("modifiedAt");
        String key=s==null?sourceKey:"room|"+track+"|"+sourceKey+"|"+s.optString("audioIdentity")+"|"+s.optString("detailToken")+"|"+remote.hashCode();
        boolean artChanged=!key.equals(artKey);
        boolean changed=scopeChanged||artChanged||!track.equals(id)||!label.equals(title)||active!=playing||ms!=duration||!by.equals(artist);
        long now=SystemClock.elapsedRealtime();
        boolean seek=Math.abs(pos-position-(playing?now-sampledAt:0))>1250;
        if(!changed&&!seek)return;
        if(s==null&&!track.isEmpty()&&!track.equals(id))prefs.edit().putString("localId",track).apply();
        id=track;title=label;artist=by;playing=active;duration=ms;position=pos;sampledAt=now;
        if(artChanged){
            boolean cold=artKey==null;artKey=key;cover=null;
            final LibraryPlayer.Song source=song;
            if(cold && key.equals(prefs.getString("coverKey",null)))
                cover=BitmapFactory.decodeFile(new File(app.getCacheDir(),"media-cover.jpg").getPath());
            if(!track.isEmpty()&&cover==null)covers.execute(()->loadCover(key,source,remote));
        }
        if(active)prepareService();
        if(changed)PlayerWidget.render(app,this);
        if(PlaybackService.current!=null)PlaybackService.current.refresh(changed);
    }
    private void loadCover(String key,LibraryPlayer.Song song,String remote){
        File cached=new File(app.getCacheDir(),"media-cover.jpg");
        Bitmap bitmap=null;
        try{
            if(key.equals(prefs.getString("coverKey",null)))bitmap=BitmapFactory.decodeFile(cached.getPath());
            if(bitmap==null){
                ImageDecoder.Source src=null;
                if(song!=null){
                    MediaMetadataRetriever r=new MediaMetadataRetriever();
                    try{r.setDataSource(app,Uri.parse(song.uri));byte[] bytes=r.getEmbeddedPicture();
                        if(bytes!=null)src=ImageDecoder.createSource(ByteBuffer.wrap(bytes));
                    }catch(Exception ignored){}finally{r.release();}
                    if(src==null&&!song.coverUri.isEmpty())src=ImageDecoder.createSource(app.getContentResolver(),Uri.parse(song.coverUri));
                }
                if(src==null&&remote.startsWith("data:image/")&&remote.indexOf(',')>0){
                    src=ImageDecoder.createSource(ByteBuffer.wrap(Base64.decode(remote.substring(remote.indexOf(',')+1),Base64.DEFAULT)));
                }
                if(src!=null)bitmap=ImageDecoder.decodeBitmap(src,(decoder,info,source)->{
                    int w=info.getSize().getWidth(),h=info.getSize().getHeight();
                    float scale=Math.min(1f,320f/Math.max(w,h));
                    decoder.setTargetSize(Math.max(1,Math.round(w*scale)),Math.max(1,Math.round(h*scale)));
                    decoder.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE);
                });
                if(bitmap!=null){
                    File tmp=new File(app.getCacheDir(),"media-cover.new");
                    try(FileOutputStream out=new FileOutputStream(tmp)){bitmap.compress(Bitmap.CompressFormat.JPEG,88,out);}
                    if(tmp.renameTo(cached))prefs.edit().putString("coverKey",key).apply();
                }
            }
        }catch(Exception ignored){}
        final Bitmap art=bitmap;
        main.post(()->{if(key.equals(artKey)&&art!=null){cover=art;PlayerWidget.render(app,this);
            if(PlaybackService.current!=null)PlaybackService.current.refresh(true);}});
    }
}
