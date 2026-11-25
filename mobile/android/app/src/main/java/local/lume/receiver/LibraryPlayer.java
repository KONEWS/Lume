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
        static boolean isLegacyAsset(String uri){
            return "asset".equals(uri)||"demo".equals(uri)||"demo-moon".equals(uri)||"demo-forest".equals(uri);
        }
        static String filenameTitle(String name){return name.replaceFirst("(?i)\\.(mp3|flac|wav|wave|m4a|aac|ogg|opus|wma|aiff|ape|alac)$","");}
        JSONObject metadata() throws JSONException {
            return new JSONObject(facts.toString()).put("title",title).put("artist",artist).put("album",album).put("folder",folder).put("hidden",hidden);
        }
        JSONObject coverRecord() throws JSONException {
            return metadata().put("id",uri).put("scanStamp",scanStamp)
                .put("thumbSource",uri+"|"+coverUri+"|"+scanStamp+"|"+facts.optLong("modifiedAt"))
                .put("hasSideLyrics",!lyricUri.isEmpty()).put("hasSideCover",!coverUri.isEmpty());
        }
    }
    private final ExecutorService imports=Executors.newSingleThreadExecutor();
    boolean scanning, closed;
    static final class ScanRun {
        final android.os.CancellationSignal cancel=new android.os.CancellationSignal();
        java.util.concurrent.Future<?> worker;
        volatile int scanDone,scanFound,scanTotal;
        volatile boolean scanTotalKnown;
        int scanRead,scanUnchanged,shortFiles,excludedFolders,excludedFormats;
        JSONObject shortCache, directories;
        final Set<String> seen=new HashSet<>(), completeRoots=new HashSet<>(), missing=new HashSet<>();
        final Map<String,String> folders=new HashMap<>();
    }
    ScanRun scan=new ScanRun();
    void stopScan(){
        if(!scanning)return;
        ScanRun stopped=scan;
        scan=new ScanRun();scanning=false;scanStatus="已终止扫描";
        if(stopped.worker!=null)stopped.worker.cancel(true);
        stopped.cancel.cancel();
        changed.run();
    }
    String scanStatus="";
    JSONArray scanHistory=new JSONArray();
    private Set<String> blockedFolders=Collections.emptySet();
    private boolean skipShort;
    private ScanFilter scanFilter=new ScanFilter(Collections.emptyList());
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

    private JSONObject scanShortCache=new JSONObject(), scanDirectories=new JSONObject();
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
    private void persistSongs(){persistSongs(false);}
    private void persistSongs(boolean durable){
        JSONArray list=new JSONArray();
        try{for(Song s:songs)list.put(s.metadata().put("metadataVersion",s.metadataVersion).put("taggedTitle",s.taggedTitle).put("facts",s.facts).put("uri",s.uri).put("lyricUri",s.lyricUri).put("coverUri",s.coverUri).put("scanStamp",s.scanStamp));}catch(JSONException ignored){}
        android.content.SharedPreferences.Editor edit=app.getSharedPreferences("library",0).edit().putString("songs",list.toString()).putString("scanShortCache",scanShortCache.toString()).putString("directoryIndex",scanDirectories.toString());
        if(durable){if(!edit.commit())throw new IllegalStateException("本机曲库保存失败");}
        else edit.apply();
    }
    private void refreshLegacyMetadata(List<Song> candidates){
        if(candidates.isEmpty())return;
        imports.execute(()->{
            Map<Song,Song> tags=new HashMap<>();
            for(Song song:candidates){
                if(Thread.currentThread().isInterrupted())return;
                tags.put(song,readSong(Uri.parse(song.uri),song.title,song.folder,-1,false));
            }
            main.post(()->{
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
    private final android.content.Context app;
    private final android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable changed;
    MediaPlayer audio;int index=0;boolean ready, shuffle;String playMode="sequence";
    String error="";
    LibraryPlayer(android.content.Context app,Runnable changed){
        this.app=app;this.source=new PhoneSource(app);this.changed=changed;
        playMode=app.getSharedPreferences("library",0).getString("playMode",app.getSharedPreferences("library",0).getBoolean("shuffle",false)?"shuffle":"sequence");shuffle=playMode.equals("shuffle");
        List<Song> legacyTitles=new ArrayList<>();
        try{scanDirectories=new JSONObject(app.getSharedPreferences("library",0).getString("directoryIndex","{}"));}catch(JSONException ignored){}
        try{scanShortCache=new JSONObject(app.getSharedPreferences("library",0).getString("scanShortCache","{}"));}catch(JSONException ignored){}
        try{JSONArray list=new JSONArray(app.getSharedPreferences("library",0).getString("songs","[]"));
            for(int i=0;i<list.length();i++){JSONObject s=list.getJSONObject(i);Song song=new Song(s.getString("title"),s.getString("uri"));
                song.taggedTitle=s.optBoolean("taggedTitle");song.hidden=s.optBoolean("hidden");song.metadataVersion=s.optInt("metadataVersion");
                if(!s.has("taggedTitle")&&!Song.filenameTitle(song.title).equals(song.title)){
                    song.taggedTitle=null;
                }
                if(Song.isLegacyAsset(song.uri))continue;
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
        try{counts=MobileHost.call(new JSONObject().put("type","openHistory").put("name",MobileHost.SYSTEM_MODEL).put("path",new File(app.getFilesDir(),"plays.json").getPath()));MobileHost.MODEL=MobileHost.call(new JSONObject().put("type","deviceIdentity")).optString("originDeviceName",MobileHost.SYSTEM_MODEL);}catch(Exception ignored){}
        source.publish(songs);
    }
    void pick(Activity activity){Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT);i.setType("audio/*");i.addCategory(Intent.CATEGORY_OPENABLE);i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,true);activity.startActivityForResult(i,81);}
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
    void pickFolder(Activity activity,JSONObject options,boolean blockOnly){
        if(!blockOnly){scanOptions(options);unavailableRoots=0;}
        activity.startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION),blockOnly?83:82);
    }
    private void rememberRoot(Uri uri){
        Set<String> roots=new HashSet<>(app.getSharedPreferences("library",0).getStringSet("scanRoots",Collections.emptySet()));
        roots.add(uri.toString());
        app.getSharedPreferences("library",0).edit().putStringSet("scanRoots",roots).apply();
    }
    void rescan(Activity activity,JSONObject options){
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
        if(roots.isEmpty()){scanStatus="请先选择音乐文件夹，之后可点击开始扫描复扫。";changed.run();pickFolder(activity,options,false);return;}
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
        return song.metadataVersion<1||song.taggedTitle==null||song.facts.optInt("factsVersion")<3||!song.facts.has("sortMetadata");
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
        if(ScanFilter.skipsAudio(filterDuration,durationMs,song.album))return null;
        return song;
    }
    private void scanTree(ScanRun run,Uri tree,boolean lastRoot,List<Song> found,Set<String> known,int[] skipped,Map<String,String[]> companions,Set<String> history,Map<String,Song> refreshed,Map<String,Song> indexed,Set<String> processed){
        List<String[]> candidates=new ArrayList<>();
        Map<String,String> sidecars=new HashMap<>(), sideStamps=new HashMap<>();
        String root=DocumentsContract.getTreeDocumentId(tree);
        ArrayDeque<String[]> dirs=new ArrayDeque<>();
        dirs.add(new String[]{root,root.substring(Math.max(root.lastIndexOf('/'),root.lastIndexOf(':'))+1)});
        boolean fullTree=true;
        Set<String> visited=new HashSet<>();
        Set<String> completeDirs=new HashSet<>();
        String[] cols={Document.COLUMN_DOCUMENT_ID,Document.COLUMN_DISPLAY_NAME,Document.COLUMN_MIME_TYPE,Document.COLUMN_SIZE,Document.COLUMN_LAST_MODIFIED};
        while(!dirs.isEmpty()&&!run.cancel.isCanceled()){
            String[] dir=dirs.remove();if(!visited.add(dir[0]))continue;
            String directory=folderKey(tree,dir[0]);
            if(blocked(directory)){run.excludedFolders++;fullTree=false;continue;}
            Uri children=DocumentsContract.buildChildDocumentsUriUsingTree(tree,dir[0]);
            try(Cursor c=app.getContentResolver().query(children,cols,null,null,null,run.cancel)){
                if(c==null){skipped[0]++;fullTree=false;continue;}
                List<String> fingerprint=new ArrayList<>();
                Set<String> members=new HashSet<>();
                int first=candidates.size();
                boolean reusable=true,complete=true;
                history.add(directory);
                while(c.moveToNext()){
                    if(run.cancel.isCanceled())return;
                    String id=c.getString(0),name=c.getString(1),mime=c.getString(2);
                    if(id==null||name==null){complete=false;continue;}
                    String docKey=tree.getAuthority()+"/"+id;
                    members.add(docKey);run.seen.add(docKey);
                    if(Document.MIME_TYPE_DIR.equals(mime)){dirs.add(new String[]{id,dir[1]+"/"+name});continue;}
                    if(name.matches("(?i).+\\.(lrc|png|jpe?g|webp)")){
                        String side=DocumentsContract.buildDocumentUriUsingTree(tree,id).toString();
                        sidecars.put(dir[0]+"/"+name.toLowerCase(Locale.ROOT),side);
                        String stamp=scanStamp(name,c.isNull(3)?-1:c.getLong(3),c.getLong(4));
                        sideStamps.put(side,stamp);if(stamp.isEmpty())reusable=false;
                        fingerprint.add(new JSONArray(Arrays.asList(id,name,stamp)).toString());
                        continue;
                    }
                    if(!(mime!=null&&mime.startsWith("audio/"))&&!name.matches("(?i).+\\.(mp3|m4a|aac|flac|ogg|opus|wav|aif|aiff|wma|alac)"))continue;
                    if(scanFilter.blocksName(name)){run.excludedFormats++;continue;}
                    Uri file=DocumentsContract.buildDocumentUriUsingTree(tree,id);
                    String audioStamp=scanStamp(name,c.isNull(3)?-1:c.getLong(3),c.getLong(4));
                    Song existing=indexed.get(docKey);
                    if(audioStamp.isEmpty() || (existing==null?!(skipShort&&!audioStamp.isEmpty()&&audioStamp.equals(run.shortCache.optString(docKey))):
                            !audioStamp.equals(existing.scanStamp)||needsMetadataRefresh(existing)))reusable=false;
                    if(existing!=null&&!dir[1].equals(existing.folder))run.folders.put(docKey,dir[1]);
                    fingerprint.add(new JSONArray(Arrays.asList(id,name,audioStamp)).toString());
                    candidates.add(new String[]{file.toString(),name,dir[1],dir[0]+"/"+stem(name),Long.toString(c.isNull(3)?-1:c.getLong(3)),Long.toString(c.isNull(4)?0:c.getLong(4))});run.scanFound++;
                }
                if(!complete||c.getExtras().getBoolean(DocumentsContract.EXTRA_LOADING,false)||c.getExtras().containsKey(DocumentsContract.EXTRA_ERROR)){
                    fullTree=false;skipped[0]++;continue;
                }
                completeDirs.add(dir[0]);
                JSONObject old=run.directories.optJSONObject(directory);
                Collections.sort(fingerprint);
                java.security.MessageDigest digest=java.security.MessageDigest.getInstance("SHA-256");
                String hash=android.util.Base64.encodeToString(digest.digest(new JSONArray(fingerprint).toString().getBytes(java.nio.charset.StandardCharsets.UTF_8)),android.util.Base64.NO_WRAP);
                JSONArray previous=old==null?null:old.optJSONArray("members");
                if(previous!=null)for(int j=0;j<previous.length();j++){
                    String k=previous.optString(j);if(!members.contains(k))run.missing.add(k);
                }
                if(reusable && old!=null && hash.equals(old.optString("stamp"))){
                    int unchanged=candidates.size()-first;
                    candidates.subList(first,candidates.size()).clear();run.scanUnchanged+=unchanged;run.scanDone+=unchanged;
                }
                run.directories.put(directory,new JSONObject().put("members",new JSONArray(members)).put("stamp",hash));
            }catch(Exception e){skipped[0]++;fullTree=false;}
        }
        if(fullTree)run.completeRoots.add(tree.getAuthority()+"/"+root);
        if(lastRoot){run.scanTotal=run.scanFound;run.scanTotalKnown=true;}
        for(String[] entry:candidates){
            if(run.cancel.isCanceled())return;
            Uri uri=Uri.parse(entry[0]);
            try{
                String id=key(uri),stem=entry[3],dir=stem.substring(0,stem.lastIndexOf('/')+1);
                if(!processed.add(id))continue;
                String lyrics=sidecars.get(stem+".lrc"),cover=null;
                for(String base:new String[]{stem,dir+"cover",dir+"folder",dir+"front"}){
                    for(String ext:new String[]{".jpg",".jpeg",".png",".webp"})if((cover=sidecars.get(base+ext))!=null)break;
                    if(cover!=null)break;
                }
                Song saved=indexed.get(id);
                String coverStamp=sideStamps.get(cover),lyricStamp=sideStamps.get(lyrics);
                if(completeDirs.contains(dir.substring(0,dir.length()-1)) && (saved==null||
                    !Objects.equals(saved.coverUri,cover==null?"":cover)||!Objects.equals(saved.lyricUri,lyrics==null?"":lyrics)||
                    !Objects.equals(saved.facts.optString("coverStamp",""),coverStamp==null?"":coverStamp)||
                    !Objects.equals(saved.facts.optString("lyricStamp",""),lyricStamp==null?"":lyricStamp)))
                    companions.put(id,new String[]{lyrics,cover,coverStamp,lyricStamp});
                long size=Long.parseLong(entry[4]);
                String stamp=scanStamp(entry[1],size,Long.parseLong(entry[5]));
                boolean sideNeedsFacts=saved!=null&&!saved.lyricUri.isEmpty()&&lyrics==null&&!saved.facts.has("embeddedHasLyrics");
                if(saved!=null&&!stamp.isEmpty()&&stamp.equals(saved.scanStamp)&&!needsMetadataRefresh(saved)&&!sideNeedsFacts){run.scanUnchanged++;continue;}
                if(saved==null&&skipShort&&!stamp.isEmpty()&&stamp.equals(run.shortCache.optString(id))){run.shortFiles++;run.scanUnchanged++;continue;}
                run.scanRead++;
                Song measured=readSong(uri,entry[1],entry[2],size,saved==null&&skipShort);
                if(run.cancel.isCanceled())return;
                if(measured==null){run.shortFiles++;if(!stamp.isEmpty())run.shortCache.put(id,stamp);continue;}
                run.shortCache.remove(id);measured.scanStamp=stamp;
                if(saved==null&&known.add(id))found.add(measured);else refreshed.put(id,measured);
            }catch(Exception e){skipped[0]++;}finally{run.scanDone++;}
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
        final ScanRun run=new ScanRun();
        try{run.directories=new JSONObject(scanDirectories.toString());}catch(JSONException e){run.directories=new JSONObject();}
        try{run.shortCache=new JSONObject(scanShortCache.toString());}catch(JSONException e){run.shortCache=new JSONObject();}
        scan=run;scanning=true;scanStatus=tree?"正在扫描文件夹…":"正在导入…";changed.run();
        Set<String> known=new HashSet<>();
        Map<String,Song> indexed=new HashMap<>();Set<String> processed=new HashSet<>();
        for(Song song:songs){String id=key(Uri.parse(song.uri));known.add(id);indexed.put(id,song);}
        run.worker=imports.submit(()->{
            Set<String> history=new LinkedHashSet<>();
            Map<String,String[]> companions=new HashMap<>();
            Map<String,Song> refreshed=new HashMap<>();
            List<Song> found=new ArrayList<>();int[] skipped={0};
            if(!tree){run.scanTotal=uris.size();run.scanTotalKnown=true;}
            int rootIndex=0;
            for(Uri uri:uris)try{
                rootIndex++;
                if(run.cancel.isCanceled())return;
                if(!reusePermission)app.getContentResolver().takePersistableUriPermission(uri,permissionFlags&(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION));
                if(tree&&!reusePermission)rememberRoot(uri);
                if(tree){scanTree(run,uri,rootIndex==uris.size(),found,known,skipped,companions,history,refreshed,indexed,processed);continue;}
                boolean fresh=known.add(key(uri));
                String name=uri.getLastPathSegment();
                try(Cursor c=app.getContentResolver().query(uri,new String[]{OpenableColumns.DISPLAY_NAME},null,null,null,run.cancel)){if(c!=null&&c.moveToFirst())name=c.getString(0);}
                Song measured=readSong(uri,name,parent(uri.toString()),-1,false);
                if(fresh)found.add(measured);else refreshed.put(key(uri),measured);
            }catch(RuntimeException e){skipped[0]++;}finally{if(!tree)run.scanDone++;}
            main.post(()->{
                if(closed||scan!=run||run.cancel.isCanceled())return;
                int removed=0;
                if(tree){
                    for(int i=songs.size()-1;i>=0;i--){
                        Song song=songs.get(i);Uri uri=Uri.parse(song.uri);String id=key(uri);
                        if(!indexed.containsKey(id)||!DocumentsContract.isTreeUri(uri)||run.seen.contains(id))continue;
                        String rootKey=uri.getAuthority()+"/"+DocumentsContract.getTreeDocumentId(uri);
                        if(run.completeRoots.contains(rootKey)||run.missing.contains(id)){removeEntry(song);removed++;run.shortCache.remove(id);}
                    }
                    scanDirectories=run.directories;
                }
                scanShortCache=run.shortCache;
                if(tree)scanHistory=new JSONArray(history);
                for(Song song:found)try{song.facts.put("addedAt",System.currentTimeMillis());}catch(JSONException ignored){}
                songs.addAll(found);
                for(Song s:songs){
                    Song measured=refreshed.get(key(Uri.parse(s.uri)));if(measured!=null)mergeMetadata(s,measured);
                    String folder=run.folders.get(key(Uri.parse(s.uri)));if(folder!=null)s.folder=folder;
                    String[] sides=companions.get(key(Uri.parse(s.uri)));
                    if(sides==null)continue;
                    try{s.facts.put("coverStamp",sides[2]);s.facts.put("lyricStamp",sides[3]);}catch(JSONException ignored){}
                    s.lyricUri=sides[0]==null?"":sides[0];s.coverUri=sides[1]==null?"":sides[1];
                    updateLyricsStatus(s);
                }
                if(removed>0||!found.isEmpty()||!refreshed.isEmpty()||!companions.isEmpty()||!run.folders.isEmpty()){
                    revision++;persistSongs();source.publish(songs);
                }else if(tree)app.getSharedPreferences("library",0).edit().putString("directoryIndex",scanDirectories.toString()).putString("scanShortCache",scanShortCache.toString()).apply();
                scanning=false;
                scanStatus="完成，新增 "+found.size()+" 首"+(run.shortFiles>0?"，跳过短音频 "+run.shortFiles+" 首":"")+(run.excludedFormats>0?"，跳过屏蔽格式 "+run.excludedFormats+" 首":"")+(run.excludedFolders>0?"，跳过屏蔽目录 "+run.excludedFolders+" 个":"")+(skipped[0]>0?"，无法读取 "+skipped[0]+" 项":"");
                if(removed>0)scanStatus+="，移除失效条目 "+removed+" 首";
                if(tree)scanStatus+="；枚举 "+run.scanFound+" 首，读取 "+run.scanRead+" 首，未变化 "+run.scanUnchanged+" 首";
                if(unavailableRoots>0)scanStatus+="；"+unavailableRoots+" 个目录授权已失效，请重新选择文件夹";
                changed.run();
            });
        });
    }
    void close(){closed=true;scan.cancel.cancel();imports.shutdownNow();stop();}
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
    void receivePersonal(File file,String title,String ext){
        String uri=Uri.fromFile(file).toString();
        for(Song song:songs)if(song.uri.equals(uri))return;
        Song song=readSong(Uri.fromFile(file),title+"."+ext,"局域网接收",file.length(),false);
        if(song==null)throw new IllegalStateException("无法读取接收的歌曲");
        if(!song.taggedTitle)song.title=title;
        songs.add(song);
        try{persistSongs(true);}catch(RuntimeException error){songs.remove(song);throw error;}
        revision++;source.publish(songs);changed.run();
    }
    void refreshLibrary(){revision++;persistSongs();source.publish(songs);changed.run();}
    void hideSong(Song song){song.hidden=true;playNext.remove(song.uri);order.remove((Integer)songs.indexOf(song));if(songs.indexOf(song)==index){stop();for(int i=0;i<songs.size();i++)if(!songs.get(i).hidden){index=i;break;}}refreshLibrary();}
    void restoreSongs(){for(Song song:songs)song.hidden=false;refreshLibrary();}
    void removeSong(Song song){removeEntry(song);refreshLibrary();}
    private void removeEntry(Song song){
        int removed=songs.indexOf(song);if(removed<0)return;
        if(index==removed)stop();songs.remove(removed);playNext.remove(song.uri);
        for(int i=order.size()-1;i>=0;i--){int n=order.get(i);if(n==removed)order.remove(i);else if(n>removed)order.set(i,n-1);}
        if(index>removed)index--;index=Math.max(0,Math.min(index,songs.size()-1));
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
        statisticsSeeking=false;p.setOnSeekCompleteListener(v->{if(p==audio){statisticsSeeking=false;playbackEvent("seeked",0);changed.run();}});
        try{p.setWakeMode(app,android.os.PowerManager.PARTIAL_WAKE_LOCK);p.setDataSource(app,Uri.parse(s.uri));
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

