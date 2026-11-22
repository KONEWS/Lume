package local.lume.receiver;
import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.media.MediaPlayer;
import android.media.MediaMetadataRetriever;
import android.provider.DocumentsContract;
import android.provider.DocumentsContract.Document;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import java.io.File;
import java.io.InputStream;
import android.provider.OpenableColumns;
import org.json.*;
import java.util.*;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;

final class LibraryPlayer {
    static class Song {
        String title, uri, artist="", album="", folder="";
        String lyricUri="", coverUri="";
        String scanStamp="";
        Boolean taggedTitle=false;
        int metadataVersion=0;
        boolean hidden=false;
        JSONObject facts=new JSONObject();
        Song(String t,String u){title=t;uri=u;}
        static String filenameTitle(String name){return name.replaceFirst("(?i)\\.(mp3|flac|wav|wave|m4a|aac|ogg|opus|wma|aiff|ape|alac)$","");}
        JSONObject metadata() throws JSONException {
            return new JSONObject(facts.toString()).put("title",title).put("artist",artist).put("album",album).put("folder",folder).put("hidden",hidden);
        }
    }
    private final ExecutorService imports=Executors.newSingleThreadExecutor();
    boolean scanning, closed;
    volatile boolean paused;
    synchronized void pauseImport(boolean value){
        if(!scanning)return;
        paused=value;notifyAll();changed.run();
    }
    private synchronized boolean canImport(){
        try{while(paused)wait();}
        catch(InterruptedException e){Thread.currentThread().interrupt();}
        return !Thread.currentThread().isInterrupted();
    }
    String scanStatus="";
    JSONArray scanHistory=new JSONArray();
    private Set<String> blockedFolders=Collections.emptySet();
    private boolean skipShort;
    private ScanFilter scanFilter=new ScanFilter(Collections.emptyList());
    private int shortFiles,excludedFolders,excludedFormats;
    private int unavailableRoots;
    static String folderKey(Uri uri,String doc){
        int volume=doc.indexOf(':');
        if(volume>=0){
            String rest=doc.substring(volume+1);
            doc=doc.substring(0,volume+1)+(rest.isEmpty()||rest.startsWith("/")?"":"/")+rest;
        }
        return "content://"+uri.getAuthority()+"/"+doc;
    }
    private boolean blocked(String folder){
        for(String parent:blockedFolders)if(folder.equals(parent)||folder.startsWith(parent.endsWith("/")?parent:parent+"/"))return true;
        return false;
    }

    volatile int scanDone,scanFound,scanTotal;
    volatile int scanRead,scanUnchanged;
    private JSONObject scanShortCache=new JSONObject();
    int revision;
    JSONObject counts=new JSONObject();
    private static String extension(String name){int i=name.lastIndexOf('.');return i<0?"":name.substring(i+1).toLowerCase(Locale.ROOT);}
    private static String stem(String name){int i=name.lastIndexOf('.');return (i<0?name:name.substring(0,i)).toLowerCase(Locale.ROOT);}
    private long documentSize(Uri uri){
        try(Cursor c=app.getContentResolver().query(uri,new String[]{OpenableColumns.SIZE},null,null,null)){
            if(c!=null&&c.moveToFirst()&&!c.isNull(0))return c.getLong(0);
        }catch(RuntimeException ignored){}
        return -1;
    }
    private long streamSize(Uri uri){
        try(InputStream in=app.getContentResolver().openInputStream(uri)){
            if(in==null)return -1;
            long total=0;byte[] block=new byte[64*1024];int count;
            while(!Thread.currentThread().isInterrupted()){
                count=in.read(block);if(count<0)return total;total+=count;
            }
        }catch(Exception ignored){}
        return -1;
    }
    private JSONObject facts(Uri uri,String name,long reportedSize){
        JSONObject result=new JSONObject();
        long size=reportedSize>=0?reportedSize:documentSize(uri);
        try(ParcelFileDescriptor fd=app.getContentResolver().openFileDescriptor(uri,"r")){
            if(fd!=null){
                if(size<0)size=fd.getStatSize();
                result=MobileHost.call(new JSONObject().put("type","audioFacts").put("path","/proc/self/fd/"+fd.getFd()).put("format",extension(name)));
                result.remove("error");
            }
        }catch(Exception ignored){}
        if(size<0)size=result.optLong("bytes",-1);
        if(size<0)size=streamSize(uri);
        if(size>=0)try{result.put("bytes",size);}catch(JSONException ignored){}
        return result;
    }
    void reloadCounts(){try{counts=MobileHost.call(new JSONObject().put("type","history"));}catch(JSONException ignored){}}
    private void persistSongs(){
        JSONArray list=new JSONArray();
        try{for(Song s:songs)list.put(s.metadata().put("metadataVersion",s.metadataVersion).put("taggedTitle",s.taggedTitle).put("facts",s.facts).put("uri",s.uri).put("lyricUri",s.lyricUri).put("coverUri",s.coverUri).put("scanStamp",s.scanStamp));}catch(JSONException ignored){}
        app.getSharedPreferences("library",0).edit().putString("songs",list.toString()).putString("scanShortCache",scanShortCache.toString()).apply();
    }
    private void refreshLegacyMetadata(List<Song> candidates){
        if(candidates.isEmpty())return;
        imports.execute(()->{
            Map<Song,Song> tags=new HashMap<>();
            for(Song song:candidates){
                if(Thread.currentThread().isInterrupted())return;
                tags.put(song,readSong(Uri.parse(song.uri),song.title,song.folder,-1,false));
            }
            app.runOnUiThread(()->{
                if(closed||tags.isEmpty())return;
                for(Map.Entry<Song,Song> entry:tags.entrySet()){
                    if(songs.contains(entry.getKey()))mergeMetadata(entry.getKey(),entry.getValue());
                }
                revision++;persistSongs();source.publish(songs);changed.run();
            });
        });
    }
    final PhoneSource source;
    final ArrayList<Song> songs=new ArrayList<>();
    private final Activity app;
    private final Runnable changed;
    MediaPlayer audio;int index=0;boolean ready, shuffle;String playMode="sequence";
    String error="";
    LibraryPlayer(Activity app,Runnable changed){
        this.app=app;this.source=new PhoneSource(app);this.changed=changed;
        playMode=app.getSharedPreferences("library",0).getString("playMode",app.getSharedPreferences("library",0).getBoolean("shuffle",false)?"shuffle":"sequence");shuffle=playMode.equals("shuffle");
        List<Song> legacyTitles=new ArrayList<>();
        try{scanShortCache=new JSONObject(app.getSharedPreferences("library",0).getString("scanShortCache","{}"));}catch(JSONException ignored){}
        try{JSONArray list=new JSONArray(app.getSharedPreferences("library",0).getString("songs","[]"));
            for(int i=0;i<list.length();i++){JSONObject s=list.getJSONObject(i);Song song=new Song(s.getString("title"),s.getString("uri"));
                song.taggedTitle=s.optBoolean("taggedTitle");song.hidden=s.optBoolean("hidden");song.metadataVersion=s.optInt("metadataVersion");
                if(!s.has("taggedTitle")&&!Song.filenameTitle(song.title).equals(song.title)){
                    song.taggedTitle=null;
                }
                if(Arrays.asList("asset","demo","demo-moon","demo-forest").contains(song.uri))continue;
                if(s.optJSONObject("facts")!=null)song.facts=s.optJSONObject("facts");
                song.lyricUri=s.optString("lyricUri");song.coverUri=s.optString("coverUri");
                song.scanStamp=s.optString("scanStamp");
                song.artist=cleanTag(s.optString("artist"));song.album=cleanTag(s.optString("album"));song.folder=s.optString("folder",parent(song.uri));songs.add(song);
                if(needsMetadataRefresh(song))legacyTitles.add(song);}}
        catch(JSONException ignored){}
        refreshLegacyMetadata(legacyTitles);
        Set<String> previousFolders=new LinkedHashSet<>();
        for(Song song:songs)try{
            Uri uri=Uri.parse(song.uri);
            if(!DocumentsContract.isTreeUri(uri))continue;
            String root=DocumentsContract.getTreeDocumentId(uri),doc=DocumentsContract.getDocumentId(uri);
            previousFolders.add(folderKey(uri,root));
            int slash=doc.lastIndexOf('/');
            if(slash>=0)previousFolders.add(folderKey(uri,doc.substring(0,slash)));
        }catch(RuntimeException ignored){}
        scanHistory=new JSONArray(previousFolders);
        try{counts=MobileHost.call(new JSONObject().put("type","openHistory").put("path",new File(app.getFilesDir(),"plays.json").getPath()));}catch(Exception ignored){}
        source.publish(songs);
    }
    void pick(){Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT);i.setType("audio/*");i.addCategory(Intent.CATEGORY_OPENABLE);i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,true);app.startActivityForResult(i,81);}
    private void scanOptions(JSONObject options){
            skipShort=options.optBoolean("skipShort",true);
            blockedFolders=new HashSet<>();
            JSONArray list=options.optJSONArray("blocked");
            if(list!=null)for(int i=0;i<list.length();i++)blockedFolders.add(list.optString(i));
            List<String> formats=new ArrayList<>();
            JSONArray formatList=options.optJSONArray("blockedFormats");
            if(formatList!=null)for(int i=0;i<formatList.length();i++)formats.add(formatList.optString(i));
            scanFilter=new ScanFilter(formats);
    }
    void pickFolder(JSONObject options,boolean blockOnly){
        if(!blockOnly){scanOptions(options);unavailableRoots=0;}
        app.startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION),blockOnly?83:82);
    }
    private void rememberRoot(Uri uri){
        Set<String> roots=new HashSet<>(app.getSharedPreferences("library",0).getStringSet("scanRoots",Collections.emptySet()));
        roots.add(uri.toString());
        app.getSharedPreferences("library",0).edit().putStringSet("scanRoots",roots).apply();
    }
    void rescan(JSONObject options){
        if(scanning)return;
        scanOptions(options);unavailableRoots=0;
        Set<String> granted=new HashSet<>();
        for(android.content.UriPermission permission:app.getContentResolver().getPersistedUriPermissions()){
            if(permission.isReadPermission()&&DocumentsContract.isTreeUri(permission.getUri()))granted.add(permission.getUri().toString());
        }
        Set<String> roots=new HashSet<>(app.getSharedPreferences("library",0).getStringSet("scanRoots",Collections.emptySet()));
        // Older versions persisted directory grants without a separate root list.
        if(roots.isEmpty()&&!granted.isEmpty()){
            roots.addAll(granted);app.getSharedPreferences("library",0).edit().putStringSet("scanRoots",roots).apply();
        }
        if(roots.isEmpty()){scanStatus="请先选择音乐文件夹，之后可点击开始扫描复扫。";changed.run();pickFolder(options,false);return;}
        List<Uri> uris=new ArrayList<>();
        for(String root:roots){
            if(!granted.contains(root)){unavailableRoots++;continue;}
            Uri uri=Uri.parse(root);String key=folderKey(uri,DocumentsContract.getTreeDocumentId(uri));
            boolean covered=false;
            for(String other:roots){
                if(other.equals(root)||!granted.contains(other))continue;
                Uri parentUri=Uri.parse(other);String parentKey=folderKey(parentUri,DocumentsContract.getTreeDocumentId(parentUri));
                if(key.startsWith(parentKey.endsWith("/")?parentKey:parentKey+"/")){covered=true;break;}
            }
            if(!covered)uris.add(uri);
        }
        if(uris.isEmpty()){scanStatus="目录授权已失效，请重新选择音乐文件夹。";changed.run();return;}
        scanUris(uris,true,true,0);
    }
    private static String parent(String uri){
        String path=Uri.parse(uri).getLastPathSegment();if(path==null)return "";
        int slash=path.lastIndexOf('/');return slash<0?"":path.substring(0,slash);
    }
    private String key(Uri uri){
        if(DocumentsContract.isDocumentUri(app,uri))return uri.getAuthority()+"/"+DocumentsContract.getDocumentId(uri);
        return uri.toString();
    }
    private static String cleanTag(String value){
        if(value==null)return "";value=value.replace("\u0000","").trim();
        return value.equalsIgnoreCase("<unknown>")?"":value;
    }
    private static boolean needsMetadataRefresh(Song song){
        return song.metadataVersion<1||song.taggedTitle==null||song.facts.optInt("factsVersion")<2||!song.facts.has("sortMetadata");
    }
    private static String scanStamp(String name,long size,long modified){
        // Providers without a reliable timestamp must be re-read, never guessed unchanged.
        return size>=0&&modified>0?"1|"+size+"|"+modified+"|"+name:"";
    }
    private static void mergeMetadata(Song saved,Song measured){
        if(!measured.scanStamp.isEmpty()&&measured.facts.optInt("factsVersion")>=2){
            saved.title=measured.title;saved.taggedTitle=measured.taggedTitle;
            saved.artist=measured.artist;saved.album=measured.album;saved.folder=measured.folder;
            saved.scanStamp=measured.scanStamp;
        }
        if(Boolean.TRUE.equals(measured.taggedTitle)){saved.title=measured.title;saved.taggedTitle=true;}
        else if(saved.taggedTitle==null){saved.title=Song.filenameTitle(saved.title);saved.taggedTitle=false;}
        if(!measured.artist.isEmpty())saved.artist=measured.artist;
        if(!measured.album.isEmpty())saved.album=measured.album;
        if(measured.facts.optInt("factsVersion")>=2){
            saved.facts.remove("embeddedHasLyrics");
        }else if(!measured.scanStamp.isEmpty()&&!measured.scanStamp.equals(saved.scanStamp)){
            saved.facts.remove("factsVersion");
            saved.facts.remove("embeddedHasLyrics");
            saved.facts.remove("quality");
        }
        for(Iterator<String> it=measured.facts.keys();it.hasNext();){String field=it.next();try{
            saved.facts.put(field,measured.facts.get(field));
        }catch(JSONException ignored){}}
        saved.metadataVersion=Math.max(saved.metadataVersion,measured.metadataVersion);
        updateLyricsStatus(saved);
    }
    private static void updateLyricsStatus(Song song){
        try{
            if(!song.lyricUri.isEmpty())song.facts.put("hasLyrics",true);
            else if(song.facts.has("embeddedHasLyrics"))song.facts.put("hasLyrics",song.facts.get("embeddedHasLyrics"));
            else song.facts.remove("hasLyrics");
        }catch(JSONException ignored){}
    }
    private Song readSong(Uri uri,String name,String folder,long size,boolean filterDuration){
        Song song=new Song(Song.filenameTitle(name),uri.toString());song.folder=folder;
        long durationMs=0;
        JSONObject sortFacts=new JSONObject();
        try(Cursor c=app.getContentResolver().query(uri,new String[]{Document.COLUMN_DISPLAY_NAME,Document.COLUMN_LAST_MODIFIED},null,null,null)){
            if(c!=null&&c.moveToFirst()){
                if(!c.isNull(0))name=c.getString(0);
                if(!c.isNull(1))sortFacts.put("modifiedAt",c.getLong(1));
            }
        }catch(Exception ignored){}
        MediaMetadataRetriever reader=new MediaMetadataRetriever();
        try{
            reader.setDataSource(app,uri);
            {
                String value=reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
                if(value!=null)try{
                    durationMs=Long.parseLong(value);
                }catch(NumberFormatException ignored){}
            }
            if(durationMs>0)sortFacts.put("duration",durationMs/1000.0);
            sortFacts.put("year",reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_YEAR));
            sortFacts.put("trackNumber",reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_CD_TRACK_NUMBER));
            sortFacts.put("discNumber",reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DISC_NUMBER));
            String title=reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE);
            if(title!=null&&!title.trim().isEmpty()){song.title=title;song.taggedTitle=true;}
            song.artist=cleanTag(reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST));
            song.album=cleanTag(reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM));
            String albumArtist=cleanTag(reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUMARTIST));
            if(!albumArtist.isEmpty())song.facts.put("albumArtist",albumArtist);
            song.metadataVersion=1;
        }catch(Exception ignored){}finally{try{reader.release();}catch(Exception ignored){}}
        String albumArtist=song.facts.optString("albumArtist");song.facts=facts(uri,name,size);
        try{
            sortFacts.put("fileName",name);
            for(Iterator<String> it=sortFacts.keys();it.hasNext();){String key=it.next();song.facts.put(key,sortFacts.get(key));}
            song.facts.put("sortMetadata",true);
        }catch(JSONException ignored){}
        if(song.facts.has("hasLyrics"))try{song.facts.put("embeddedHasLyrics",song.facts.optBoolean("hasLyrics"));}catch(JSONException ignored){}
        if(song.facts.has("bytes"))song.metadataVersion=1;
        String title=cleanTag(song.facts.optString("title"));
        if(!Boolean.TRUE.equals(song.taggedTitle)&&!title.isEmpty()){song.title=title;song.taggedTitle=true;}
        if(song.artist.isEmpty())song.artist=cleanTag(song.facts.optString("artist"));
        if(song.artist.isEmpty())song.artist=cleanTag(song.facts.optString("albumArtist",albumArtist));
        if(song.album.isEmpty())song.album=cleanTag(song.facts.optString("album"));
        // Both platform and common-parser album values above come from file tags.
        if(ScanFilter.skipsAudio(filterDuration,durationMs,song.album)){shortFiles++;return null;}
        return song;
    }
    private void scanTree(Uri tree,List<Song> found,Set<String> known,int[] skipped,Map<String,String[]> companions,Set<String> history,Map<String,Song> refreshed,Map<String,Song> indexed,Set<String> processed){
        List<String[]> candidates=new ArrayList<>();
        Map<String,String> sidecars=new HashMap<>();
        String root=DocumentsContract.getTreeDocumentId(tree);
        ArrayDeque<String[]> dirs=new ArrayDeque<>();
        dirs.add(new String[]{root,root.substring(Math.max(root.lastIndexOf('/'),root.lastIndexOf(':'))+1)});
        Set<String> visited=new HashSet<>();
        Set<String> completeDirs=new HashSet<>();
        String[] cols={Document.COLUMN_DOCUMENT_ID,Document.COLUMN_DISPLAY_NAME,Document.COLUMN_MIME_TYPE,Document.COLUMN_SIZE,Document.COLUMN_LAST_MODIFIED};
        while(!dirs.isEmpty()&&canImport()){
            String[] dir=dirs.remove();if(!visited.add(dir[0]))continue;
            String directory=folderKey(tree,dir[0]);
            if(blocked(directory)){excludedFolders++;continue;}
            Uri children=DocumentsContract.buildChildDocumentsUriUsingTree(tree,dir[0]);
            try(Cursor c=app.getContentResolver().query(children,cols,null,null,null)){
                if(c==null){skipped[0]++;continue;}
                history.add(directory);
                while(c.moveToNext()){
                    if(!canImport())return;
                    String id=c.getString(0),name=c.getString(1),mime=c.getString(2);
                    if(Document.MIME_TYPE_DIR.equals(mime)){dirs.add(new String[]{id,dir[1]+"/"+name});continue;}
                    if(name.matches("(?i).+\\.(lrc|png|jpe?g|webp)")){
                        sidecars.put(dir[0]+"/"+name.toLowerCase(Locale.ROOT),DocumentsContract.buildDocumentUriUsingTree(tree,id).toString());
                        continue;
                    }
                    if(!(mime!=null&&mime.startsWith("audio/"))&&!name.matches("(?i).+\\.(mp3|m4a|aac|flac|ogg|opus|wav|aif|aiff|wma|alac)"))continue;
                    if(scanFilter.blocksName(name)){excludedFormats++;continue;}
                    Uri file=DocumentsContract.buildDocumentUriUsingTree(tree,id);
                    candidates.add(new String[]{file.toString(),name,dir[1],dir[0]+"/"+stem(name),Long.toString(c.isNull(3)?-1:c.getLong(3)),Long.toString(c.isNull(4)?0:c.getLong(4))});scanFound++;
                }
                completeDirs.add(dir[0]);
            }catch(RuntimeException e){skipped[0]++;}
        }
        scanTotal+=candidates.size();
        for(String[] entry:candidates){
            if(!canImport())return;
            Uri uri=Uri.parse(entry[0]);
            try{
                String id=key(uri),stem=entry[3],dir=stem.substring(0,stem.lastIndexOf('/')+1);
                if(!processed.add(id))continue;
                String lyrics=sidecars.get(stem+".lrc"),cover=null;
                for(String base:new String[]{stem,dir+"cover",dir+"folder",dir+"front"}){
                    for(String ext:new String[]{".jpg",".jpeg",".png",".webp"})if((cover=sidecars.get(base+ext))!=null)break;
                    if(cover!=null)break;
                }
                if(completeDirs.contains(dir.substring(0,dir.length()-1)))companions.put(id,new String[]{lyrics,cover});
                long size=Long.parseLong(entry[4]);
                String stamp=scanStamp(entry[1],size,Long.parseLong(entry[5]));
                Song saved=indexed.get(id);
                boolean sideNeedsFacts=saved!=null&&!saved.lyricUri.isEmpty()&&lyrics==null&&!saved.facts.has("embeddedHasLyrics");
                if(saved!=null&&!stamp.isEmpty()&&stamp.equals(saved.scanStamp)&&!needsMetadataRefresh(saved)&&!sideNeedsFacts){scanUnchanged++;continue;}
                if(saved==null&&skipShort&&!stamp.isEmpty()&&stamp.equals(scanShortCache.optString(id))){shortFiles++;scanUnchanged++;continue;}
                scanRead++;
                Song measured=readSong(uri,entry[1],entry[2],size,saved==null&&skipShort);
                if(measured==null){if(!stamp.isEmpty())scanShortCache.put(id,stamp);continue;}
                scanShortCache.remove(id);measured.scanStamp=stamp;
                if(saved==null&&known.add(id))found.add(measured);else refreshed.put(id,measured);
            }catch(Exception e){skipped[0]++;}finally{scanDone++;}
        }
    }
    void imported(Intent data,boolean tree){
        if(scanning)return;
        unavailableRoots=0;
        List<Uri> uris=new ArrayList<>();
        if(data.getClipData()!=null)for(int i=0;i<data.getClipData().getItemCount();i++)uris.add(data.getClipData().getItemAt(i).getUri());
        else if(data.getData()!=null)uris.add(data.getData());
        scanUris(uris,tree,false,data.getFlags());
    }
    private void scanUris(List<Uri> uris,boolean tree,boolean reusePermission,int permissionFlags){
        scanRead=scanUnchanged=0;
        scanDone=scanTotal=scanFound=shortFiles=excludedFolders=excludedFormats=0;scanning=true;scanStatus=tree?"正在扫描文件夹…":"正在导入…";changed.run();
        Set<String> known=new HashSet<>();
        Map<String,Song> indexed=new HashMap<>();Set<String> processed=new HashSet<>();
        for(Song song:songs){String id=key(Uri.parse(song.uri));known.add(id);indexed.put(id,song);}
        imports.execute(()->{
            Set<String> history=new LinkedHashSet<>();
            Map<String,String[]> companions=new HashMap<>();
            Map<String,Song> refreshed=new HashMap<>();
            List<Song> found=new ArrayList<>();int[] skipped={0};
            if(!tree)scanTotal=uris.size();
            for(Uri uri:uris)try{
                if(!canImport())return;
                if(!reusePermission)app.getContentResolver().takePersistableUriPermission(uri,permissionFlags&(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION));
                if(tree&&!reusePermission)rememberRoot(uri);
                if(tree){scanTree(uri,found,known,skipped,companions,history,refreshed,indexed,processed);continue;}
                boolean fresh=known.add(key(uri));
                String name=uri.getLastPathSegment();
                try(Cursor c=app.getContentResolver().query(uri,new String[]{OpenableColumns.DISPLAY_NAME},null,null,null)){if(c!=null&&c.moveToFirst())name=c.getString(0);}
                Song measured=readSong(uri,name,parent(uri.toString()),-1,false);
                if(fresh)found.add(measured);else refreshed.put(key(uri),measured);
            }catch(RuntimeException e){skipped[0]++;}finally{if(!tree)scanDone++;}
            app.runOnUiThread(()->{
                if(closed)return;
                if(tree)scanHistory=new JSONArray(history);
                for(Song song:found)try{song.facts.put("addedAt",System.currentTimeMillis());}catch(JSONException ignored){}
                songs.addAll(found);
                for(Song s:songs){
                    Song measured=refreshed.get(key(Uri.parse(s.uri)));if(measured!=null)mergeMetadata(s,measured);
                    String[] sides=companions.get(key(Uri.parse(s.uri)));
                    if(sides==null)continue;
                    s.lyricUri=sides[0]==null?"":sides[0];s.coverUri=sides[1]==null?"":sides[1];
                    updateLyricsStatus(s);
                }
                revision++;persistSongs();
                source.publish(songs);scanning=false;paused=false;
                scanStatus="完成，新增 "+found.size()+" 首"+(shortFiles>0?"，跳过短音频 "+shortFiles+" 首":"")+(excludedFormats>0?"，跳过屏蔽格式 "+excludedFormats+" 首":"")+(excludedFolders>0?"，跳过屏蔽目录 "+excludedFolders+" 个":"")+(skipped[0]>0?"，无法读取 "+skipped[0]+" 项":"");
                if(tree)scanStatus+="；枚举 "+scanFound+" 首，读取 "+scanRead+" 首，未变化 "+scanUnchanged+" 首";
                if(unavailableRoots>0)scanStatus+="；"+unavailableRoots+" 个目录授权已失效，请重新选择文件夹";
                changed.run();
            });
        });
    }
    void close(){closed=true;imports.shutdownNow();stop();}
    final ArrayList<Integer> order=new ArrayList<>();
    void setShuffle(boolean enabled){
        setPlayMode(enabled?"shuffle":"sequence");
    }
    void setPlayMode(String mode){
        if(!java.util.Arrays.asList("sequence","repeatOne","shuffle").contains(mode))return;
        playMode=mode;shuffle=mode.equals("shuffle");
        app.getSharedPreferences("library",0).edit().putString("playMode",mode).putBoolean("shuffle",shuffle).apply();changed.run();
    }
    final ArrayList<String> playNext=new ArrayList<>();
    void queueNext(Song song){
        playNext.remove(song.uri);playNext.add(0,song.uri);
        if(order.isEmpty())for(int i=0;i<songs.size();i++)if(!songs.get(i).hidden)order.add(i);
        int target=songs.indexOf(song);order.remove((Integer)target);
        int after=order.indexOf(index);order.add(after<0?0:after+1,target);changed.run();
    }
    void refreshLibrary(){revision++;persistSongs();source.publish(songs);changed.run();}
    void hideSong(Song song){song.hidden=true;playNext.remove(song.uri);order.remove((Integer)songs.indexOf(song));if(songs.indexOf(song)==index){stop();for(int i=0;i<songs.size();i++)if(!songs.get(i).hidden){index=i;break;}}refreshLibrary();}
    void restoreSongs(){for(Song song:songs)song.hidden=false;refreshLibrary();}
    void removeSong(Song song){
        int removed=songs.indexOf(song);if(removed<0)return;
        if(index==removed)stop();songs.remove(removed);playNext.remove(song.uri);
        for(int i=order.size()-1;i>=0;i--){int n=order.get(i);if(n==removed)order.remove(i);else if(n>removed)order.set(i,n-1);}
        if(index>removed)index--;index=Math.max(0,Math.min(index,songs.size()-1));refreshLibrary();
    }
    void step(int offset){
        if(offset>0)while(!playNext.isEmpty()){String id=playNext.remove(0);for(int i=0;i<songs.size();i++)if(songs.get(i).uri.equals(id)&&!songs.get(i).hidden){play(i);return;}}
        if(order.isEmpty())for(int i=0;i<songs.size();i++)if(!songs.get(i).hidden)order.add(i);
        if(order.isEmpty())return;
        int count=order.isEmpty()?songs.size():order.size();
        if(count==0)return;
        if(shuffle && count>1){
            int current=order.isEmpty()?index:order.indexOf(index);
            int choice=java.util.concurrent.ThreadLocalRandom.current().nextInt(current>=0?count-1:count);
            if(current>=0 && choice>=current)choice++;
            play(order.isEmpty()?choice:order.get(choice));return;
        }
        if(order.isEmpty()){play(index+offset);return;}
        int position=order.indexOf(index);
        play(order.get(Math.floorMod(position+offset,order.size())));
    }
    private String playSession="";
    private boolean statisticsSeeking=false;
    void samplePlayback(){if(ready&&!statisticsSeeking)playbackEvent("sample",0);}
    private void playbackEvent(String event,double value){
        try{counts=MobileHost.call(new JSONObject().put("type","playbackEvent").put("session",playSession)
            .put("metadata",songs.isEmpty()?new JSONObject():songs.get(index).metadata()).put("trackDuration",ready?audio.getDuration()/1000.0:0).put("cursor",event.equals("complete")?value:ready?audio.getCurrentPosition()/1000.0:0).put("event",event).put("id",songs.isEmpty()?"":songs.get(index).uri).put("title",songs.isEmpty()?"":songs.get(index).title).put("duration",value).put("position",value));}catch(JSONException ignored){}
    }
    void seek(double seconds){if(ready){playbackEvent("seek",seconds);statisticsSeeking=true;audio.seekTo((int)(seconds*1000));}}
    void play(int n){
        if(songs.isEmpty())return;
        if(songs.get(Math.floorMod(n,songs.size())).hidden){step(1);return;}
        stop();index=(n+songs.size())%songs.size();Song s=songs.get(index);audio=new MediaPlayer();MediaPlayer p=audio;
        playSession=java.util.UUID.randomUUID().toString();playbackEvent("begin",0);
        statisticsSeeking=false;p.setOnSeekCompleteListener(v->{if(p==audio){statisticsSeeking=false;playbackEvent("seeked",0);}});
        try{p.setDataSource(app,Uri.parse(s.uri));
            p.setOnPreparedListener(v->{if(p==audio){ready=true;p.start();
                playbackEvent("play",0);
                changed.run();}});
            p.setOnCompletionListener(v->{if(p==audio){playbackEvent("complete",p.getDuration()/1000.0);if(playMode.equals("repeatOne"))play(index);else step(1);}});
            p.setOnErrorListener((v,w,x)->{if(p==audio){stop();error="这首音乐无法播放";changed.run();}return true;});
            p.prepareAsync();error="";
        }catch(Exception e){stop();error="这首音乐无法打开";}changed.run();
    }
    void toggle(){if(!ready)play(index);else{if(audio.isPlaying()){audio.pause();playbackEvent("pause",0);}else{audio.start();playbackEvent("play",0);}changed.run();}}
    void stop(){playbackEvent("stop",0);if(audio!=null){audio.release();audio=null;}ready=false;}
}

