package local.lume.receiver;

import android.app.Activity;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.*;
import android.widget.FrameLayout;
import org.json.*;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;

final class ReceiverScreen implements RoomReceiver.Listener {
    private static final String ORIGIN = "https://lume.invalid/";
    private final java.util.concurrent.ExecutorService detailReads=java.util.concurrent.Executors.newSingleThreadExecutor();
    private final java.util.concurrent.ExecutorService hostWork=java.util.concurrent.Executors.newSingleThreadExecutor();
    private final Map<String,LibraryPlayer.Song> detailSongs=new java.util.HashMap<>();
    private String listThumbnail(LibraryPlayer.Song song,int maxSide) {
        byte[] picture;
        try(android.os.ParcelFileDescriptor file=app.getContentResolver().openFileDescriptor(android.net.Uri.parse(song.uri),"r")){
            android.media.MediaMetadataRetriever reader=new android.media.MediaMetadataRetriever();
            try{reader.setDataSource(file.getFileDescriptor());picture=reader.getEmbeddedPicture();}
            finally{reader.release();}
            if(picture==null)return "";
            android.graphics.BitmapFactory.Options options=new android.graphics.BitmapFactory.Options();
            options.inJustDecodeBounds=true;
            android.graphics.BitmapFactory.decodeByteArray(picture,0,picture.length,options);
            options.inJustDecodeBounds=false;
            int longest=Math.max(options.outWidth,options.outHeight);
            options.inSampleSize=1;
            while(longest/options.inSampleSize>maxSide)options.inSampleSize*=2;
            android.graphics.Bitmap bitmap=android.graphics.BitmapFactory.decodeByteArray(picture,0,picture.length,options);
            if(bitmap==null)return "";
            try{
                java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream();
                bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG,82,out);
                return android.util.Base64.encodeToString(out.toByteArray(),android.util.Base64.NO_WRAP);
            }finally{bitmap.recycle();}
        }catch(Exception ignored){return "";}
    }
    private void readDetail(JSONObject request){
        int token=request.optInt("token"),length=request.optInt("length");
        long offset=request.optLong("offset",-1);
        LibraryPlayer.Song song=detailSongs.get(request.optString("id"));
        String kind=request.optString("kind");
        String uri=song==null?"":kind.equals("audio")?song.uri:kind.equals("lyrics")?song.lyricUri:kind.equals("cover")?song.coverUri:"";
        detailReads.execute(()->{
            String result="";
            if(song!=null && (kind.equals("thumbnail")||kind.equals("artwork")))result=listThumbnail(song,kind.equals("artwork")?640:192);
            if(!uri.isEmpty()&&length>0&&length<=512*1024&&offset>=0)try(android.os.ParcelFileDescriptor fd=app.getContentResolver().openFileDescriptor(android.net.Uri.parse(uri),"r");
                java.io.FileInputStream stream=new java.io.FileInputStream(fd.getFileDescriptor())){
                java.nio.ByteBuffer bytes=java.nio.ByteBuffer.allocate(length);
                java.nio.channels.FileChannel file=stream.getChannel();
                while(bytes.hasRemaining()&&file.read(bytes,offset+bytes.position())>0){}
                result=android.util.Base64.encodeToString(bytes.array(),0,bytes.position(),android.util.Base64.NO_WRAP);
            }catch(Exception ignored){}
            final String data=result;
            app.runOnUiThread(()->{if(!closed)view.evaluateJavascript("window.lumeReadResult("+token+","+JSONObject.quote(data)+")",null);});
        });
    }
    static final int STYLE_FILE_REQUEST = 84;
    private ValueCallback<android.net.Uri[]> styleFiles;
    void pickedStyleFiles(int result, android.content.Intent data) {
        if (styleFiles == null) return;
        ValueCallback<android.net.Uri[]> pending = styleFiles;
        styleFiles = null;
        android.net.Uri[] selected = null;
        if (result == Activity.RESULT_OK && data != null) {
            android.content.ClipData clips = data.getClipData();
            if (clips != null) {
                selected = new android.net.Uri[clips.getItemCount()];
                for (int i = 0; i < selected.length; i++) selected[i] = clips.getItemAt(i).getUri();
            } else if (data.getData() != null) selected = new android.net.Uri[] { data.getData() };
        }
        pending.onReceiveValue(selected);
    }
    private final Activity app;
    private final MobileHost host;
    private final SharedPreferences prefs;
    final LibraryPlayer local;
    private SongActions songActions;
    void songActivityResult(int request,int result,android.content.Intent data){if(songActions!=null)songActions.activityResult(request,result,data);}
    private RoomReceiver room;
    private final WebView view;
    private final FrameLayout frame;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Map<String,String> hosts = new LinkedHashMap<>();
    private boolean ready, closed, canBack;
    private int safeTop, safeLeft, safeRight, safeBottom;
    private int scan, catalogRevision=-1;
    private Discovery.Session discovery;
    private boolean searching;
    private boolean foreground;
    void foreground(boolean value){foreground=value;syncKeepAwake();if(value)windowConfigurationChanged();}
    private void syncKeepAwake(){
        boolean playing=snapshot!=null?snapshot.optBoolean("roomPlaying"):local.ready&&local.audio.isPlaying();
        boolean enabled=foreground&&!closed&&prefs.getBoolean("landscapeAwake",false)&&playing
            &&app.getResources().getConfiguration().orientation==android.content.res.Configuration.ORIENTATION_LANDSCAPE;
        if(enabled)app.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else app.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
    private boolean joining, listening, creating;
    private String hostError="";
    private String pendingHostSong="";
    private void checkNearby() throws JSONException {
        boolean available = !closed && !joining && !creating && snapshot == null && !host.active;
        if (available) {
            JSONObject invite=host.call(new JSONObject().put("type","nearby").put("platform","Android").put("model",MobileHost.MODEL));
            listening=true;
            if(invite.has("url")) view.evaluateJavascript("window.lumeInvite("+invite+")",null);
        } else if(listening){
            host.call(new JSONObject().put("type","nearbyStop"));listening=false;
        }
    }
    private String saved, status = "", channel = "";
    private JSONObject snapshot, theme, previous = new JSONObject();
    private JSONArray localOrder=new JSONArray();
    private JSONArray catalog = new JSONArray(), localCatalog = new JSONArray(), spaces = new JSONArray();
    private final Runnable tick = new Runnable() {
        public void run() { publish(); handler.postDelayed(this, 350); }
    };

    ReceiverScreen(Activity app) {
        this.app = app;
        host = new MobileHost(app);
        prefs = app.getSharedPreferences("appearance", 0);
        saved = prefs.getString("host", "");
        local = new LibraryPlayer(app, this::localChanged);
        frame = new FrameLayout(app);
        view = new WebView(app);
        frame.addView(view);
        int base = Color.rgb(16, 18, 30);
        frame.setBackgroundColor(base);
        view.setBackgroundColor(base);
        // The page paints behind both bars; content receives their safe insets.
        WindowManager.LayoutParams attributes = app.getWindow().getAttributes();
        attributes.layoutInDisplayCutoutMode = Build.VERSION.SDK_INT >= 30 ?
            WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS :
            WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        app.getWindow().setAttributes(attributes);
        app.getWindow().setStatusBarColor(Color.TRANSPARENT);
        app.getWindow().setNavigationBarColor(Color.TRANSPARENT);
        app.getWindow().setNavigationBarDividerColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 29) {
            app.getWindow().setStatusBarContrastEnforced(false);
            app.getWindow().setNavigationBarContrastEnforced(false);
        }
        if (Build.VERSION.SDK_INT >= 30) app.getWindow().setDecorFitsSystemWindows(false);
        else app.getWindow().getDecorView().setSystemUiVisibility(edgeLayoutFlags());
        app.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        app.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        frame.setOnApplyWindowInsetsListener((v, insets) -> applyInsets(insets));
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        view.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView web, ValueCallback<android.net.Uri[]> callback, FileChooserParams params) {
                pickedStyleFiles(Activity.RESULT_CANCELED, null);
                styleFiles = callback;
                android.content.Intent pick = new android.content.Intent(android.content.Intent.ACTION_OPEN_DOCUMENT);
                pick.addCategory(android.content.Intent.CATEGORY_OPENABLE).setType("*/*");
                pick.putExtra(android.content.Intent.EXTRA_LOCAL_ONLY, true);
                pick.putExtra(android.content.Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                java.util.ArrayList<String> types = new java.util.ArrayList<>();
                for (String type : params.getAcceptTypes()) if (type.contains("/")) types.add(type);
                if (!types.isEmpty()) pick.putExtra(android.content.Intent.EXTRA_MIME_TYPES, types.toArray(new String[0]));
                try { app.startActivityForResult(pick, STYLE_FILE_REQUEST); }
                catch (android.content.ActivityNotFoundException missing) { pickedStyleFiles(Activity.RESULT_CANCELED, null); }
                return true;
            }
        });
        view.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) { return true; }
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
                String url = req.getUrl().toString();
                if (url.startsWith(ORIGIN + "player/")) {
                    String path = req.getUrl().getPath().substring(1);
                    if (!path.contains("..")) try {
                        String type = path.endsWith(".css") ? "text/css" : path.endsWith(".js") ? "application/javascript" :
                            path.endsWith(".svg") ? "image/svg+xml" : "text/html";
                        return new WebResourceResponse(type, "UTF-8", app.getAssets().open(path));
                    } catch (IOException ignored) { }
                }
                return new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream(new byte[0]));
            }
        });
        view.addJavascriptInterface(new Bridge(), "LumeNative");
    }

    void start(RoomReceiver room) {
        this.room = room;
        localChanged();
        app.setContentView(frame);
        frame.requestApplyInsets();
        view.loadUrl(ORIGIN + "player/index.html");
        search();
        handler.post(tick);
    }

    void end() {
        pickedStyleFiles(Activity.RESULT_CANCELED, null);
        closed = true;
        syncKeepAwake();
        stopSearch();
        try {checkNearby();} catch(JSONException ignored){}
        handler.removeCallbacksAndMessages(null);
        detailReads.shutdownNow();hostWork.shutdownNow();local.close(); room.disconnect(); host.stop();
        view.removeJavascriptInterface("LumeNative"); view.destroy();
    }

    void selectedBlock(android.net.Uri uri){
        String key=LibraryPlayer.folderKey(uri,android.provider.DocumentsContract.getTreeDocumentId(uri));
        if(ready&&!closed)view.evaluateJavascript("window.lumeScanRules.block("+JSONObject.quote(key)+",true)",null);
    }
    private int gestureStartVolume;
    private boolean playerSessionActive, playerSessionLyrics, playerFullscreen, darkNavigationIcons;
    private boolean landscapeWindow() {
        return app.getResources().getConfiguration().orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE;
    }
    private boolean wantsPlayerFullscreen() {
        return playerSessionActive && (playerSessionLyrics || landscapeWindow());
    }
    void windowConfigurationChanged() {
        playerFullscreen(wantsPlayerFullscreen());
    }
    private void playerSession(boolean enabled, boolean lyrics) {
        playerSessionActive = enabled;
        playerSessionLyrics = lyrics;
        if (wantsPlayerFullscreen() != playerFullscreen) windowConfigurationChanged();
    }
    private static int edgeLayoutFlags() {
        return View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
            View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
    }
    private WindowInsets applyInsets(WindowInsets insets) {
        int left, top, right, bottom, keyboard = 0;
        if (Build.VERSION.SDK_INT >= 30) {
            // Transient bars overlay the landscape session; never resize the page
            // (or Chromium's captured Folia transition) when the user reveals them.
            android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.displayCutout() |
                (playerFullscreen ? 0 : WindowInsets.Type.systemBars()));
            left = bars.left; top = bars.top; right = bars.right; bottom = bars.bottom;
            if (insets.isVisible(WindowInsets.Type.ime())) keyboard = insets.getInsets(WindowInsets.Type.ime()).bottom;
        } else {
            left = insets.getSystemWindowInsetLeft(); top = insets.getSystemWindowInsetTop();
            right = insets.getSystemWindowInsetRight(); bottom = insets.getSystemWindowInsetBottom();
            if (bottom > insets.getStableInsetBottom()) keyboard = bottom;
            if (playerFullscreen) { left = top = right = bottom = 0; }
            android.view.DisplayCutout cutout = insets.getDisplayCutout();
            if (cutout != null) {
                left = Math.max(left, cutout.getSafeInsetLeft()); top = Math.max(top, cutout.getSafeInsetTop());
                right = Math.max(right, cutout.getSafeInsetRight()); bottom = Math.max(bottom, cutout.getSafeInsetBottom());
            }
        }
        // Landscape player controls can use the camera-hole side of the screen.
        if (playerFullscreen && landscapeWindow()) left = right = 0;
        // Only the keyboard resizes the native surface. System bars and cutouts
        // are content-safe margins in the page, never separate background strips.
        frame.setPadding(0, 0, 0, keyboard);
        safeTop = top; safeLeft = left; safeRight = right; safeBottom = keyboard > 0 ? 0 : bottom;
        publishInsets();
        return Build.VERSION.SDK_INT >= 30 ? WindowInsets.CONSUMED :
            insets.consumeSystemWindowInsets().consumeStableInsets().consumeDisplayCutout();
    }
    private void publishInsets() {
        if (!ready || closed) return;
        float density = app.getResources().getDisplayMetrics().density;
        view.evaluateJavascript("window.lumeInsets&&window.lumeInsets({top:" + safeTop / density + ",left:" + safeLeft / density +
            ",right:" + safeRight / density + ",bottom:" + safeBottom / density + "})", null);
    }
    private void navigationAppearance(boolean dark) {
        darkNavigationIcons = dark;
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = app.getWindow().getInsetsController();
            int mask = WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS |
                WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS;
            if (controller != null) controller.setSystemBarsAppearance(dark ? mask : 0, mask);
        } else {
            View decor = app.getWindow().getDecorView();
            int mask = View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            int flags = decor.getSystemUiVisibility() & ~mask;
            decor.setSystemUiVisibility(flags | (dark ? mask : 0));
        }
    }
    private void playerFullscreen(boolean enabled) {
        playerFullscreen = enabled;
        View decor = app.getWindow().getDecorView();
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = app.getWindow().getInsetsController();
            if (controller != null) {
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                if (enabled) controller.hide(WindowInsets.Type.systemBars());
                else controller.show(WindowInsets.Type.systemBars());
            }
        } else {
            decor.setSystemUiVisibility(edgeLayoutFlags() | (enabled ?
                View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY : 0) |
                (darkNavigationIcons ? View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR : 0));
        }
        frame.requestApplyInsets();
    }
    boolean back() {
        if (!canBack) return false;
        view.evaluateJavascript("window.lumeBack()", null);
        return true;
    }

    private final class Bridge {
        @JavascriptInterface public void dispatch(String message) {
            app.runOnUiThread(() -> {
                if (closed) return;
                try { handle(new JSONObject(message)); } catch (JSONException ignored) { }
            });
        }
    }

    private void createHost() {
        if(snapshot!=null || host.active || creating)return;
        stopSearch();
        creating=true;hostError="";status="正在创建空间";local.stop();publish();
        java.util.List<LibraryPlayer.Song> songs=new java.util.ArrayList<>(local.songs);
        hostWork.execute(()->{
            JSONObject result=null;
            try{result=host.catalog("start",songs);if(!host.active)host.stop();}catch(Exception ignored){host.stop();}
            final JSONObject info=result;
            app.runOnUiThread(()->{
                if(closed)return;
                creating=false;
                if(host.active && info!=null){
                    scan++;status="空间已创建，正在连接";
                    room.connect("http://127.0.0.1:"+info.optInt("port"),info.optString("pin"));
                }else{
                    pendingHostSong="";hostError="创建空间失败，请稍后重试";status=hostError;
                }
                publish();
            });
        });
    }

    private void handle(JSONObject action) throws JSONException {
        String type = action.optString("type"), id = action.optString("id");
        boolean joined = snapshot != null;
        // The host's receiver joins asynchronously. A tap in this interval belongs
        // to the room; never start an unrelated local player behind an empty room.
        if(!joined && (creating || host.active)){
            if(type.equals("select")){
                pendingHostSong=hostSongId(id);status="正在连接播放空间，连接后播放所选歌曲";publish();return;
            }
            if(type.equals("toggle") || type.equals("next") || type.equals("previous") || type.equals("seek")){
                status="正在连接播放空间，请稍候";publish();return;
            }
        }
        switch (type) {
            case "mediaVolumeStart":
            case "mediaVolumeDrag": {
                android.media.AudioManager manager=app.getSystemService(android.media.AudioManager.class);
                int stream=android.media.AudioManager.STREAM_MUSIC;
                int current=manager.getStreamVolume(stream);
                if(type.equals("mediaVolumeStart")){gestureStartVolume=current;return;}
                int min=manager.getStreamMinVolume(stream), max=manager.getStreamMaxVolume(stream);
                int level=(int)Math.round(gestureStartVolume+action.optDouble("delta",0)*(max-min));
                level=Math.max(min,Math.min(max,level));
                if(current!=level)manager.setStreamVolume(stream,level,android.media.AudioManager.FLAG_SHOW_UI);
                return;
            }
            case "trackDetails": if(host.active)MobileHost.call(action); return;
            case "ready": playerSession(false, false); ready = true; previous = new JSONObject(); publishInsets(); frame.requestApplyInsets(); publish(); return;
            case "playerSession": playerSession(action.optBoolean("enabled"), action.optBoolean("lyrics")); return;
            case "landscapeAwake": prefs.edit().putBoolean("landscapeAwake",action.optBoolean("enabled")).apply();syncKeepAwake();publish();return;
            case "systemBarAppearance": navigationAppearance(action.optBoolean("dark")); return;
            case "playMode":
                if(!joined){local.setPlayMode(action.optString("mode"));return;}
                break;
            case "shuffle":
                if(!(action.opt("value") instanceof Boolean))return;
                if(!joined){local.setShuffle(action.optBoolean("value"));return;}
                if(!(snapshot.opt("shuffle") instanceof Boolean))return;
                break;
            case "backState": canBack = action.optBoolean("enabled"); return;
            case "createHost": createHost();return;
            case "decide":
                if(joined)room.action(new JSONObject().put("type",action.optBoolean("enabled")?"join-allow":"join-deny").put("value",id));
                return;
            case "output":
                if(joined)room.action(action);
                return;
            case "search": search(); return;
            case "searchPhones":
                if(host.active){host.searchPhones();publish();}return;
            case "invitePhone":
                if(host.active){host.call(action);publish();}return;
            case "join":
                if(creating||joining||joined||host.active)return;
                hostError="";pendingHostSong="";
                stopSearch();joining=true; saved = action.optString("url"); String pin = action.optString("pin");
                local.stop(); prefs.edit().putString("host", saved).apply();
                String inviteToken=action.optString("inviteToken");
                status = !inviteToken.isEmpty()?"正在接受邀请":pin.isEmpty() ? "等待主机允许加入" : "正在配对"; publish();
                room.connect(saved, pin,inviteToken,action.optString("deviceId")); return;
            case "leave": hostError="";pendingHostSong="";room.disconnect(); if(host.active)host.stop(); reset("已离开空间"); return;
            case "pauseImport":local.pauseImport(action.optBoolean("enabled"));return;
            case "songNext":case "songShare":case "songHide":case "songDelete":case "songRestore":
                int token=action.optInt("token");
                if(songActions==null)songActions=new SongActions(app,local,(t,ok,message)->{
                    if(!closed)view.evaluateJavascript("window.lumeSongActionResult("+t+","+ok+","+JSONObject.quote(message)+")",null);
                });
                if(joined){view.evaluateJavascript("window.lumeSongActionResult("+token+",false,'请先离开播放空间')",null);return;}
                songActions.run(type,id,token);return;
            case "detailRead":readDetail(action);return;
            case "pickScanBlock": if((!joined||host.active)&&!local.scanning)local.pickFolder(action,true);return;
            case "scan": if ((!joined||host.active)&&!local.scanning)local.pickFolder(action,false);return;
            case "rescan": if ((!joined||host.active)&&!local.scanning)local.rescan(action);return;
            case "import": if ((!joined||host.active)&&!local.scanning) local.pick(); return;
            case "toggle":
                if (joined) type = snapshot.optBoolean("roomPlaying") ? "pause" : "play";
                else { local.toggle(); return; } break;
            case "next": case "previous":
                if (!joined) { local.step(type.equals("next") ? 1 : -1); return; } break;
            case "seek":
                double seconds = Math.max(0, action.optDouble("seconds", 0));
                if (!joined) { local.seek(seconds); return; }
                action.put("position", seconds); break;
            case "select":
                if (!joined) {
                    Map<String,Integer> indexes=new LinkedHashMap<>();
                    for(int i=0;i<local.songs.size();i++)indexes.put(localId(i),i);
                    Integer selected=indexes.get(id);if(selected==null)return;
                    local.order.clear();local.playNext.clear();
                    JSONArray order=action.optJSONArray("order");
                    if(order!=null){
                        java.util.Set<Integer> seen=new java.util.HashSet<>();
                        for(int i=0;i<order.length();i++){
                            Integer index=indexes.get(order.optString(i));if(index!=null&&seen.add(index))local.order.add(index);
                        }
                        if(!seen.contains(selected))local.order.clear();
                    }
                    localOrder=new JSONArray();for(int index:local.order)localOrder.put(localId(index));
                    local.play(selected);
                    return;
                }
                action.put("trackId", host.active?hostSongId(id):id); type = "play"; break;
            default: return;
        }
        room.action(action.put("type", type));
    }

    private String localId(int i) { return local.songs.get(i).uri; }
    private String hostSongId(String id) {
        for(LibraryPlayer.Song song:local.songs)if(song.uri.equals(id))
            return java.util.UUID.nameUUIDFromBytes(id.getBytes(java.nio.charset.StandardCharsets.UTF_8)).toString();
        return id;
    }
    private void localChanged() {
        localOrder=new JSONArray();for(int index:local.order)if(index>=0&&index<local.songs.size()&&!local.songs.get(index).hidden)localOrder.put(localId(index));
        if (localCatalog.length() != local.songs.size()||catalogRevision!=local.revision) {
            catalogRevision=local.revision;
            if(host.active)try{host.catalog("update",local.songs);}catch(Exception ex){status="更新空间曲库失败";}
            localCatalog = new JSONArray();detailSongs.clear();
            for (int i = 0; i < local.songs.size(); i++) try {
                LibraryPlayer.Song song=local.songs.get(i);
                detailSongs.put(localId(i),song);
                detailSongs.put(java.util.UUID.nameUUIDFromBytes(song.uri.getBytes(java.nio.charset.StandardCharsets.UTF_8)).toString(),song);
                localCatalog.put(song.metadata().put("id",localId(i)).put("thumbSource",song.uri+"|"+song.coverUri).put("hasSideLyrics",!song.lyricUri.isEmpty()).put("hasSideCover",!song.coverUri.isEmpty()));
            } catch (JSONException ignored) { }
        }
        publish();
    }

    private void stopSearch() {
        ++scan;searching=false;
        if(discovery!=null){discovery.stop();discovery=null;}
    }
    private void search() {
        if(closed||snapshot!=null||host.active||creating||joining)return;
        stopSearch();
        final int run = ++scan;
        hosts.clear();spaces=new JSONArray();searching=true;
        final Map<String,String> found=new LinkedHashMap<>(); status = "正在搜索附近空间 · 30 秒后停止"; publish();
        discovery=Discovery.search(saved, (name,url) -> app.runOnUiThread(() -> {
            if (closed || run != scan) return;
            found.put(url,name);if(hosts.containsKey(url))return;
            hosts.put(url, name);
            spaces = new JSONArray();
            for (Map.Entry<String,String> h : hosts.entrySet()) try {
                spaces.put(new JSONObject().put("name", h.getValue()).put("url", h.getKey()));
            } catch (JSONException ignored) { }
            publish();
        }), () -> app.runOnUiThread(() -> {
            if (!closed && run == scan) {
                searching=false;discovery=null;
                hosts.clear();hosts.putAll(found);spaces=new JSONArray();
                for(Map.Entry<String,String> h:hosts.entrySet())try{spaces.put(new JSONObject().put("name",h.getValue()).put("url",h.getKey()));}catch(JSONException ignored){}
                status = hosts.isEmpty() ? "未发现空间，请确认两台设备已连接同一 Wi-Fi。" : "";
                publish();
            }
        }));
    }

    private void reset(String message) {
        local.reloadCounts();joining=false; snapshot = null; theme = null; catalog = new JSONArray(); status = message; channel = ""; publish();
    }
    public void skin(JSONObject next) { if (!String.valueOf(next).equals(String.valueOf(theme))) theme = next; }
    public void show(String value,String title,String route) {
        if (value.startsWith("连接失败")) {
            if(host.active){
                host.stop();creating=false;pendingHostSong="";
                hostError="本机空间连接失败，请重新创建";reset(hostError);
            }else reset(value);
            return;
        }
        status = value; channel = route; publish();
    }
    public void snapshot(JSONObject data) {
        joining=false; snapshot = data;
        room.saveRoute(data.optString("channel","right"),data.optInt("delayMs"));
        if (data.optJSONArray("catalog") != null) catalog = data.optJSONArray("catalog");
        if(host.active && !pendingHostSong.isEmpty()){
            String selected=pendingHostSong;pendingHostSong="";
            try{room.action(new JSONObject().put("type","play").put("trackId",selected));}catch(JSONException ignored){}
        }
    }
    private void publish() {
        local.samplePlayback();
        syncKeepAwake();
        if (!ready || closed) return;
        boolean joined = snapshot != null;
        try {
            checkNearby();
            JSONObject data = new JSONObject().put("platform","Android").put("model",MobileHost.MODEL)
                .put("searching",searching)
                .put("landscapeAwake",prefs.getBoolean("landscapeAwake",false))
                .put("creating",creating).put("hostError",hostError)
                .put("hosting",host.active).put("joined", joined).put("host", host.active?"本机空间":saved).put("savedHost", saved).put("hosts", spaces)
                .put("status", status).put("channel", channel).put("skin", theme == null ? JSONObject.NULL : theme)
                .put("completion",joined?snapshot.optJSONObject("completion"):MobileHost.call(new JSONObject().put("type","historyEvent")))
                .put("playRecords",joined?snapshot.optJSONArray("playRecords"):MobileHost.call(new JSONObject().put("type","historyRecords")).optJSONArray("records"))
                .put("roomDetails",joined?snapshot.optJSONObject("roomDetails"):JSONObject.NULL)
                .put("localSong",joined?snapshot.optJSONObject("localSong"):JSONObject.NULL).put("localTrackId",joined?snapshot.optString("localTrackId"):"")
                .put("counts",local.counts).put("scanTotal",local.scanTotal).put("scanFound",local.scanFound).put("scanDone",local.scanDone)
                .put("scanHistory",local.scanHistory).put("scanStatus",local.scanStatus).put("scanning",local.scanning).put("scanPaused",local.paused)
                .put("order",joined?JSONObject.NULL:localOrder).put("songs", joined ? catalog : localCatalog)
                .put("id", joined ? snapshot.optString("trackId") : local.songs.isEmpty() || local.songs.get(local.index).hidden ? "" : localId(local.index))
                .put("title", joined ? snapshot.optString("roomTrack") : local.songs.isEmpty() || local.songs.get(local.index).hidden ? "" : local.songs.get(local.index).title)
                .put("playing", joined ? snapshot.optBoolean("roomPlaying") : local.ready && local.audio.isPlaying())
                .put("playMode",joined?snapshot.optString("playMode",snapshot.optBoolean("shuffle")?"shuffle":"sequence"):local.playMode)
                .put("shuffle", joined ? snapshot.optBoolean("shuffle") : local.shuffle)
                .put("shuffleAvailable", !joined || snapshot.opt("shuffle") instanceof Boolean)
                .put("pos", joined ? room.playbackPosition() : local.ready ? local.audio.getCurrentPosition()/1000.0 : 0)
                .put("duration", joined ? snapshot.optDouble("duration", 0) : local.ready ? local.audio.getDuration()/1000.0 : 0)
                .put("error", joined ? snapshot.optString("roomError") : local.error);
            data.put("outputs",joined?snapshot.optJSONArray("outputs"):new JSONArray())
                .put("selfId",joined?snapshot.optString("selfId"):"")
                .put("pending",joined?snapshot.optJSONArray("pending"):new JSONArray());
            if(host.active){
                JSONObject info=host.status();
                data.put("hostPin",info.optString("pin")).put("address",info.optString("address"));
                data.put("nearbyPhones",info.optJSONArray("nearbyPhones")).put("phoneSearching",info.optBoolean("phoneSearching")).put("inviteStatus",info.optString("inviteStatus"));
            }
            JSONObject delta = new JSONObject();
            for (java.util.Iterator<String> it = data.keys(); it.hasNext();) {
                String key = it.next(); Object value = data.get(key);
                if (previous.opt(key)!=value && (!previous.has(key) || !value.toString().equals(String.valueOf(previous.opt(key))))) delta.put(key, value);
            }
            previous = data;
            if (delta.length() != 0) view.evaluateJavascript("window.lumeUpdate("+delta.toString()+")", null);
        } catch (JSONException ignored) { }
    }
}
