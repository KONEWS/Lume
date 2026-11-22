package local.lume.receiver;

import android.content.Context;
import android.net.Uri;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.*;

final class PhoneSource {
    private final Context context;
    private volatile Map<String,LibraryPlayer.Song> catalog=Collections.emptyMap();
    private volatile JSONArray titles=new JSONArray();
    private String lastToken="";
    PhoneSource(Context context){this.context=context;}
    void publish(List<LibraryPlayer.Song> songs){
        Map<String,LibraryPlayer.Song> entries=new LinkedHashMap<>();
        JSONArray next=new JSONArray();
        for(LibraryPlayer.Song s:songs){
            if(s.hidden)continue;
            String id=UUID.nameUUIDFromBytes(s.uri.getBytes(StandardCharsets.UTF_8)).toString();
            entries.put(id,s);
            try{next.put(new JSONObject().put("id",id).put("title",s.title));}
            catch(org.json.JSONException ignored){}
        }
        catalog=entries;titles=next;
    }
    JSONArray songs(){return titles;}
    List<LibraryPlayer.Song> localSongs(){return new ArrayList<>(catalog.values());}
    void requested(JSONObject req,String host,String cookie){
        if(req==null)return;
        String token=req.optString("token");
        if(token.equals(lastToken)||!token.matches("[0-9a-f-]{36}"))return;
        lastToken=token;
        LibraryPlayer.Song song=catalog.get(req.optString("songId"));
        new Thread(()->send(song,host+"/api/source-data/"+token,cookie),"lume-library-upload").start();
    }
    private void send(LibraryPlayer.Song song,String url,String cookie){
        try(InputStream stream=song==null?null:context.getContentResolver().openInputStream(Uri.parse(song.uri))){
            if(stream==null)throw new IOException("文件无法读取");
            byte[] block=new byte[256*1024];long offset=0;
            while(true){
                int used=0;
                while(used<block.length){int n=stream.read(block,used,block.length-used);if(n<0)break;used+=n;}
                boolean end=used<block.length;
                if(!write(url+"?offset="+offset+"&end="+(end?1:0),cookie,block,used,"PUT"))return;
                offset+=used;if(end)return;
            }
        }catch(Exception e){try{write(url+"/fail",cookie,new byte[0],0,"POST");}catch(Exception ignored){}}
    }
    private boolean write(String url,String cookie,byte[] block,int size,String method)throws IOException{
        HttpURLConnection h=(HttpURLConnection)new URL(url).openConnection();
        try{
            h.setInstanceFollowRedirects(false);h.setConnectTimeout(3500);h.setReadTimeout(12000);
            h.setRequestMethod(method);h.setRequestProperty("Cookie",cookie);h.setRequestProperty("Content-Type","application/octet-stream");
            h.setDoOutput(true);h.setFixedLengthStreamingMode(size);
            try(OutputStream out=h.getOutputStream()){out.write(block,0,size);}
            int status=h.getResponseCode();
            if(status==404||status==409)return false;
            if(status!=200)throw new IOException("发送失败");
            return true;
        }finally{h.disconnect();}
    }
}

