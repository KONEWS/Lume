package local.lume.receiver;
import java.util.*;

public class AndroidScanHarness {
    boolean scanning,closed,paused;
    String scanStatus="";
    JSONArray scanHistory=new JSONArray();
    Set<String> blockedFolders=Collections.emptySet();
    boolean skipShort;
    ScanFilter scanFilter=new ScanFilter(Collections.emptyList());
    int shortFiles,excludedFolders,excludedFormats,unavailableRoots,scanDone,scanFound,scanTotal,revision,scanRead,scanUnchanged;
    JSONObject scanShortCache=new JSONObject();
    final ArrayList<Song> songs=new ArrayList<>();
    final FakeApp app;
    final Runnable changed=()->{};
    final DirectExecutor imports=new DirectExecutor();
    final FakeSource source=new FakeSource();
    boolean canImport(){return true;}
    AndroidScanHarness(FakeApp app){
        this.app=app;
        scanShortCache=new JSONObject(app.prefs.getString("scanShortCache","{}"));
        JSONArray saved=new JSONArray(app.prefs.getString("songs","[]"));
        for(int i=0;i<saved.length();i++){
            JSONObject item=saved.getJSONObject(i);Song song=new Song(item.getString("title"),item.getString("uri"));
            song.album=item.optString("album");song.artist=item.optString("artist");song.folder=item.optString("folder");
            song.facts=item.optJSONObject("facts");song.metadataVersion=1;song.scanStamp=item.optString("scanStamp");song.lyricUri=item.optString("lyricUri");song.coverUri=item.optString("coverUri");song.hidden=item.optBoolean("hidden");songs.add(song);
        }
    }
    JSONObject facts(Uri uri,String name,long size){
        Node node=app.resolver.nodes.get(uri.doc);
        return new JSONObject().put("album",node.commonAlbum).put("bytes",size).put("factsVersion",2).put("hasLyrics",false);
    }
    // PRODUCTION_SCANNER_METHODS

    static void check(boolean ok,String message){if(!ok)throw new AssertionError(message);}
    static JSONObject options(String blocked){return new JSONObject().put("skipShort",true).put("blocked",new JSONArray(Arrays.asList(blocked))).put("blockedFormats",new JSONArray(Arrays.asList(" .MP3 ","AMR")));}
    public static void main(String[] args){
        FakeApp app=new FakeApp();String root="primary:Music";Uri tree=Uri.tree(root);
        app.resolver.dir(root);app.resolver.dir(root+"/Album");app.resolver.dir(root+"/Recordings");app.resolver.dir(root+"/blocked");app.resolver.dir(root+"/blockedSibling");
        app.resolver.audio(root+"/Album/intro.flac",13000,"Real Album","");
        app.resolver.audio(root+"/Album/common.flac",13000,"<unknown>","Common parser album");
        app.resolver.audio(root+"/Album/untagged.flac",13000,"","");
        app.resolver.audio(root+"/Album/excluded.Mp3",13000,"Real Album","");
        app.resolver.audio(root+"/Recordings/memo.WAV",13000,"","");
        app.resolver.audio(root+"/exact.FLAC",60000,"","");
        app.resolver.audio(root+"/short.wav",59999,"","");
        app.resolver.audio(root+"/unknown.aac",0,"","");
        app.resolver.audio(root+"/other.AMR",13000,"Album","");
        app.resolver.audio(root+"/blocked/hidden.flac",120000,"","");
        app.resolver.audio(root+"/blockedSibling/visible.flac",120000,"","");
        JSONObject rules=options(folderKey(tree,root+"/blocked"));
        AndroidScanHarness library=new AndroidScanHarness(app);
        library.rescan(rules);check(app.picks==1&&app.lastRequest==82,"first start asks for a folder");
        library.imported(new Intent().setData(tree).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),true);
        check(library.songs.size()==5,"tagged intros and exact 60s retained; short recordings, formats and blocked folder excluded: "+library.scanStatus);
        check(library.scanStatus.contains("跳过短音频 3 首"),"short count");
        check(library.scanStatus.contains("跳过屏蔽格式 2 首"),"format count including MIME-discovered AMR");
        check(!app.resolver.opened.contains(root+"/Album/excluded.Mp3"),"format blocked before tag read");
        check(!app.resolver.listed.contains(root+"/blocked"),"blocked folder not traversed");
        check(app.prefs.getStringSet("scanRoots",Collections.emptySet()).contains(tree.toString()),"root persisted");
        check(library.scanRead==8,"first scan reads five imported and three rejected short files");
        System.out.println("EVIDENCE Android first: enumerated="+library.scanFound+", audioRead="+library.scanRead);
        app.resolver.opened.clear();app.resolver.listed.clear();
        library=new AndroidScanHarness(app);library.rescan(rules);
        check(library.scanRead==0&&app.resolver.opened.isEmpty()&&!app.resolver.listed.isEmpty(),"unchanged restart enumerates but reads no audio including rejected short files");
        System.out.println("EVIDENCE Android unchanged: enumerated="+library.scanFound+", audioRead="+library.scanRead+", opened="+app.resolver.opened.size());
        app.resolver.audio(root+"/Album/new.flac",120000,"Album","");
        library=new AndroidScanHarness(app);library.rescan(rules);
        check(library.songs.size()==6&&library.scanStatus.contains("新增 1 首"),"restart then new file appears");
        check(library.scanRead==1&&app.resolver.opened.equals(Collections.singleton(root+"/Album/new.flac")),"only new file is read");
        System.out.println("EVIDENCE Android added: enumerated="+library.scanFound+", audioRead="+library.scanRead);
        Song stable=library.songs.stream().filter(s->s.uri.endsWith("/exact.FLAC")).findFirst().get();stable.hidden=true;library.persistSongs();
        app.resolver.nodes.get(root+"/exact.FLAC").modified++;
        app.resolver.opened.clear();library=new AndroidScanHarness(app);library.rescan(rules);
        check(library.scanRead==1&&app.resolver.opened.equals(Collections.singleton(root+"/exact.FLAC")),"same-size modified file is re-read alone");
        stable=library.songs.stream().filter(s->s.uri.endsWith("/exact.FLAC")).findFirst().get();check(stable.hidden,"hidden flag survives refresh");
        System.out.println("EVIDENCE Android modified: enumerated="+library.scanFound+", audioRead="+library.scanRead);
        app.resolver.nodes.put(root+"/exact.lrc",new Node(root+"/exact.lrc","text/plain",0,"",""));
        library.rescan(rules);check(library.scanRead==0&&!stable.lyricUri.isEmpty()&&stable.facts.optBoolean("hasLyrics"),"external lyrics added without audio read");
        app.resolver.nodes.get(root+"/exact.lrc").modified++;library.rescan(rules);check(library.scanRead==0,"external lyrics edits use live URI without audio re-read");
        app.resolver.nodes.remove(root+"/exact.lrc");library.rescan(rules);check(library.scanRead==0&&stable.lyricUri.isEmpty()&&!stable.facts.optBoolean("hasLyrics"),"removed lyrics restore embedded status without audio read");
        stable.facts.remove("embeddedHasLyrics");updateLyricsStatus(stable);
        check(!stable.facts.has("hasLyrics"),"unknown embedded lyrics stay unknown without a sidecar");
        stable.facts.put("factsVersion",1);library.persistSongs();library=new AndroidScanHarness(app);library.rescan(rules);
        check(library.scanRead==1,"old statistics are repaired even if fingerprint matches");
        library=new AndroidScanHarness(app);library.rescan(rules);
        check(library.songs.size()==6&&library.scanStatus.contains("新增 0 首"),"repeat scan deduplicates");
        check(app.picks==1,"rescan reuses authorization without picker");
        app.resolver.nodes.remove(root+"/Album/new.flac");library.rescan(rules);
        check(library.songs.size()==6&&library.scanRead==0,"missing sources retain library records without re-reading survivors");
        app.resolver.nodes.get(root+"/exact.FLAC").modified=0;library.rescan(rules);check(library.scanRead==1,"missing provider timestamp falls back to safe read");
        app.resolver.nodes.get(root+"/exact.FLAC").modified=102;
        JSONObject allowShort=new JSONObject().put("skipShort",false).put("blocked",rules.optJSONArray("blocked")).put("blockedFormats",rules.optJSONArray("blockedFormats"));
        library.rescan(allowShort);check(library.songs.size()==9,"changing short rule reconsiders cached rejections");
        app.resolver.granted.clear();library.rescan(rules);
        check(library.scanStatus.contains("授权已失效")&&!library.scanning,"revoked authorization handled");
        library.pickFolder(rules,false);library.imported(new Intent().setData(tree).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),true);
        check(library.songs.size()==9&&app.picks==2,"reselect restores permission without duplicates or deleting previously imported short files");
        System.out.println("PASS Android production scanner: first selection, persisted roots, restart, added file, repeated scan, revoked/reselected authorization, 13s album exception, 60s boundary, folder/format priority");
    }

    static class DirectExecutor{void execute(Runnable task){task.run();}}
    static class FakeSource{void publish(List<Song> songs){}}
    static class FakeApp{
        final FakePrefs prefs=new FakePrefs();final Resolver resolver=new Resolver();int picks,lastRequest;
        Resolver getContentResolver(){return resolver;}FakePrefs getSharedPreferences(String name,int mode){return prefs;}
        void runOnUiThread(Runnable task){task.run();}void startActivityForResult(Intent intent,int request){picks++;lastRequest=request;}
    }
    static class FakePrefs{
        final Map<String,Object> values=new HashMap<>();
        @SuppressWarnings("unchecked") Set<String> getStringSet(String key,Set<String> fallback){return (Set<String>)values.getOrDefault(key,fallback);}
        String getString(String key,String fallback){return (String)values.getOrDefault(key,fallback);}
        FakePrefs edit(){return this;}FakePrefs putStringSet(String key,Set<String> value){values.put(key,new HashSet<>(value));return this;}
        FakePrefs putString(String key,String value){values.put(key,value);return this;}void apply(){}
    }
    static class Uri{
        final String root,doc;final boolean list;
        Uri(String root,String doc,boolean list){this.root=root;this.doc=doc;this.list=list;}
        static Uri tree(String root){return new Uri(root,null,false);}
        static Uri parse(String text){String[] parts=text.substring("content://docs/tree/".length()).split("#",-1);return new Uri(parts[0],parts.length>1?parts[1]:null,false);}
        String getAuthority(){return "docs";}String getLastPathSegment(){return doc==null?root:doc;}
        public String toString(){return "content://docs/tree/"+root+(doc==null?"":"#"+doc);}
    }
    static class DocumentsContract{
        static String getTreeDocumentId(Uri uri){return uri.root;}static String getDocumentId(Uri uri){return uri.doc==null?uri.root:uri.doc;}
        static boolean isTreeUri(Uri uri){return uri.root!=null;}static boolean isDocumentUri(FakeApp app,Uri uri){return uri.doc!=null;}
        static Uri buildChildDocumentsUriUsingTree(Uri uri,String doc){return new Uri(uri.root,doc,true);}
        static Uri buildDocumentUriUsingTree(Uri uri,String doc){return new Uri(uri.root,doc,false);}
    }
    static class Document{
        static final String MIME_TYPE_DIR="directory",COLUMN_DOCUMENT_ID="id",COLUMN_DISPLAY_NAME="name",COLUMN_MIME_TYPE="mime",COLUMN_SIZE="size",COLUMN_LAST_MODIFIED="modified";
    }
    static class OpenableColumns{static final String DISPLAY_NAME="name";}
    static class Intent{
        static final String ACTION_OPEN_DOCUMENT_TREE="tree";static final int FLAG_GRANT_READ_URI_PERMISSION=1,FLAG_GRANT_WRITE_URI_PERMISSION=2,FLAG_GRANT_PERSISTABLE_URI_PERMISSION=4;
        Uri uri;int flags;Intent(){}Intent(String action){}Intent setData(Uri uri){this.uri=uri;return this;}Intent addFlags(int flags){this.flags|=flags;return this;}
        int getFlags(){return flags;}Uri getData(){return uri;}ClipData getClipData(){return null;}
    }
    static class ClipData{int getItemCount(){return 0;}ClipData getItemAt(int i){return this;}Uri getUri(){return null;}}
    static class UriPermission{final Uri uri;UriPermission(Uri uri){this.uri=uri;}boolean isReadPermission(){return true;}Uri getUri(){return uri;}}
    static class Node{
        final String id,mime,album,commonAlbum;final long ms;
        long size=100,modified=100;
        Node(String id,String mime,long ms,String album,String common){this.id=id;this.mime=mime;this.ms=ms;this.album=album;this.commonAlbum=common;}
        String name(){return id.substring(id.lastIndexOf('/')+1);}
    }
    static class Resolver{
        final Map<String,Node> nodes=new LinkedHashMap<>();final Set<String> granted=new HashSet<>(),opened=new HashSet<>(),listed=new HashSet<>();
        void dir(String id){nodes.put(id,new Node(id,Document.MIME_TYPE_DIR,0,"",""));}
        void audio(String id,long ms,String album,String common){nodes.put(id,new Node(id,"audio/test",ms,album,common));}
        List<UriPermission> getPersistedUriPermissions(){List<UriPermission> result=new ArrayList<>();for(String uri:granted)result.add(new UriPermission(Uri.parse(uri)));return result;}
        void takePersistableUriPermission(Uri uri,int flags){granted.add(uri.toString());}
        Cursor query(Uri uri,String[] cols,String selection,String[] args,String sort){
            List<Node> result=new ArrayList<>();
            if(uri.list){listed.add(uri.doc);for(Node node:nodes.values())if(node.id.startsWith(uri.doc+"/")&&!node.id.substring(uri.doc.length()+1).contains("/"))result.add(node);}
            else if(nodes.containsKey(uri.doc))result.add(nodes.get(uri.doc));return new Cursor(result,cols);
        }
    }
    static class Cursor implements AutoCloseable{
        final List<Node> nodes;final String[] cols;int at=-1;Cursor(List<Node> nodes,String[] cols){this.nodes=nodes;this.cols=cols;}
        boolean moveToNext(){return ++at<nodes.size();}boolean moveToFirst(){at=0;return !nodes.isEmpty();}
        String getString(int i){Node n=nodes.get(at);return cols[i].equals("id")?n.id:cols[i].equals("name")?n.name():n.mime;}
        boolean isNull(int i){return false;}long getLong(int i){return cols[i].equals("modified")?nodes.get(at).modified:nodes.get(at).size;}public void close(){}
    }
    static class MediaMetadataRetriever{
        static final int METADATA_KEY_DURATION=1,METADATA_KEY_TITLE=2,METADATA_KEY_ARTIST=3,METADATA_KEY_ALBUM=4,METADATA_KEY_ALBUMARTIST=5;
        static final int METADATA_KEY_YEAR=6,METADATA_KEY_CD_TRACK_NUMBER=7,METADATA_KEY_DISC_NUMBER=8;
        Node node;
        void setDataSource(FakeApp app,Uri uri){node=app.resolver.nodes.get(uri.doc);app.resolver.opened.add(uri.doc);}
        String extractMetadata(int key){return key==METADATA_KEY_DURATION?String.valueOf(node.ms):key==METADATA_KEY_ALBUM?node.album:"";}void release(){}
    }
    // In-memory serialization lets production persistence code run without Android's org.json runtime.
    static final Map<String,Object> encoded=new HashMap<>();
    static String encode(Object value){String key="fixture-"+encoded.size();encoded.put(key,value);return key;}
    static class JSONException extends RuntimeException{}
    static class JSONObject{
        final Map<String,Object> map=new LinkedHashMap<>();JSONObject(){}JSONObject(String text){if(encoded.get(text) instanceof JSONObject)map.putAll(((JSONObject)encoded.get(text)).map);}
        JSONObject put(String key,Object value){map.put(key,value);return this;}Object get(String key){return map.get(key);}String getString(String key){return optString(key);}
        String optString(String key){return optString(key,"");}String optString(String key,String fallback){Object v=map.get(key);return v==null?fallback:v.toString();}
        boolean optBoolean(String key,boolean fallback){return map.get(key) instanceof Boolean?(Boolean)map.get(key):fallback;}
        boolean optBoolean(String key){return optBoolean(key,false);}int optInt(String key){return map.get(key) instanceof Number?((Number)map.get(key)).intValue():0;}
        Object remove(String key){return map.remove(key);}
        JSONObject optJSONObject(String key){return (JSONObject)map.get(key);}JSONArray optJSONArray(String key){return (JSONArray)map.get(key);}
        boolean has(String key){return map.containsKey(key);}Iterator<String> keys(){return map.keySet().iterator();}public String toString(){return encode(this);}
    }
    static class JSONArray{
        final List<Object> list=new ArrayList<>();JSONArray(){}JSONArray(Collection<?> value){list.addAll(value);}JSONArray(String text){if(encoded.get(text) instanceof JSONArray)list.addAll(((JSONArray)encoded.get(text)).list);}
        JSONArray put(Object value){list.add(value);return this;}int length(){return list.size();}String optString(int i){return String.valueOf(list.get(i));}JSONObject getJSONObject(int i){return (JSONObject)list.get(i);}public String toString(){return encode(this);}
    }
}
