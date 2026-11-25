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
import java.util.HashMap;
import java.util.HashSet;
import java.util.Set;
import java.util.Map;

final class ReceiverScreen implements RoomReceiver.Listener {
    private static final String ORIGIN = "https://lume.invalid/";
    private final java.util.concurrent.ExecutorService detailReads=java.util.concurrent.Executors.newSingleThreadExecutor();
    private final java.util.concurrent.ExecutorService roomCoverReads=java.util.concurrent.Executors.newFixedThreadPool(2);
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
        if("roomCover".equals(request.optString("kind"))){
            Runnable read=room.catalogCover(request.optString("id"),request.optString("revision"),request.optString("visible"),data->
                app.runOnUiThread(()->{if(!closed)view.evaluateJavascript("window.lumeReadResult("+token+","+JSONObject.quote(data)+")",null);}));
            roomCoverReads.execute(read);return;
        }
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
    static final int TRANSFER_FILE_REQUEST = 85;
    private int pickToken;
    private android.net.Uri selectedTransfer;
    private String selectedName="", selectionId="";
    private void personalReply(int token,JSONObject result){
        if(!closed)view.evaluateJavascript("window.lumePersonalReply("+token+","+result+")",null);
    }
    void pickedTransfer(int code,android.content.Intent result){
        JSONObject response=new JSONObject();
        try{
            android.net.Uri uri=result==null?null:result.getData();
            if(code==Activity.RESULT_OK&&uri!=null){
                String name=null;
                try(android.database.Cursor c=app.getContentResolver().query(uri,new String[]{android.provider.OpenableColumns.DISPLAY_NAME},null,null,null)){
                    if(c!=null&&c.moveToFirst())name=c.getString(0);
                }
                if(name==null)name=uri.getLastPathSegment();
                selectedTransfer=uri;selectedName=name;selectionId=java.util.UUID.randomUUID().toString();
                response.put("name",name).put("selection",selectionId);
            }
        }catch(Exception e){try{response.put("error","无法读取所选文件");}catch(JSONException ignored){}}
        personalReply(pickToken,response);
    }
    private void offerDocument(int token,android.net.Uri uri,String name,String title,String peer){
        new Thread(()->{
            JSONObject reply=new JSONObject();java.io.File temp=null;
            try(android.os.ParcelFileDescriptor fd=app.getContentResolver().openFileDescriptor(uri,"r")){
                if(fd==null)throw new java.io.IOException("歌曲无法读取");
                String path="/proc/self/fd/"+fd.getFd();
                try{android.system.Os.lseek(fd.getFileDescriptor(),0,android.system.OsConstants.SEEK_CUR);}
                catch(android.system.ErrnoException notSeekable){
                    temp=java.io.File.createTempFile("lume-transfer-",".part",app.getCacheDir());
                    try(java.io.InputStream in=new android.os.ParcelFileDescriptor.AutoCloseInputStream(android.os.ParcelFileDescriptor.dup(fd.getFileDescriptor()));java.io.OutputStream out=new java.io.FileOutputStream(temp)){
                        byte[] block=new byte[256*1024];int n;long bytes=0;
                        while((n=in.read(block))!=-1){bytes+=n;if(bytes>500L*1024*1024)throw new java.io.IOException("歌曲超过单首上限 500 MiB");out.write(block,0,n);}
                    }
                    path=temp.getPath();
                }
                String ext=name.substring(name.lastIndexOf('.')+1).toLowerCase(java.util.Locale.ROOT);
                reply=MobileHost.call(new JSONObject().put("type","personal").put("op","offer").put("peer",peer).put("path",path).put("ext",ext).put("title",title));
            }catch(Exception e){try{reply.put("error",e.getMessage()==null?"歌曲无法读取":e.getMessage());}catch(JSONException ignored){}}
            finally{if(temp!=null)temp.delete();}
            final JSONObject value=reply;app.runOnUiThread(()->personalReply(token,value));
        },"lume-send-document").start();
    }
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
    private final PlaybackEngine playback;
    private SongActions songActions;
    void songActivityResult(int request,int result,android.content.Intent data){if(songActions!=null)songActions.activityResult(request,result,data);}
    private RoomReceiver room;
    private final WebView view;
    private final FrameLayout frame;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Map<String,String> hosts = new LinkedHashMap<>();
    private boolean ready, closed, canBack;
    boolean widgetPlayerPending;
    void widgetPlayerRequest(boolean requested){
        widgetPlayerPending=requested;
        if(!requested){view.setVisibility(View.VISIBLE);return;}
        if(!ready){view.setVisibility(View.INVISIBLE);return;}
        widgetPlayerPending=false;
        view.evaluateJavascript("window.lumeOpenWidgetPlayer()",ignored->{if(!closed)view.setVisibility(View.VISIBLE);});
    }
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
        if (!closed) {
            String availability=host.active?"hosting":creating||joining?"connecting":snapshot!=null?"joined":"available";
            JSONObject invite=host.call(new JSONObject().put("type","nearby").put("platform","Android").put("model",MobileHost.MODEL).put("availability",availability));
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
        playback = PlaybackEngine.get(app);
        host = playback.host;
        prefs = app.getSharedPreferences("appearance", 0);
        saved = prefs.getString("host", "");
        local = playback.local;
        frame = new FrameLayout(app);
        view = new WebView(app);
        frame.addView(view);
        int base = app.getColor(R.color.launch_surface);
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

    void start() {
        room = playback.room;
        playback.screen = this;
        catalog = playback.catalog;
        snapshot = playback.snapshot;
        theme = snapshot == null ? null : snapshot.optJSONObject("skin");
        app.setContentView(frame);
        frame.requestApplyInsets();
        view.loadUrl(ORIGIN + "player/index.html");
        localChanged();
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
        detailReads.shutdownNow();roomCoverReads.shutdownNow();hostWork.shutdownNow();playback.detach(this);
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

    private boolean preparingInvite;
    private void acceptInvite(JSONObject action)throws JSONException {
        if(preparingInvite||creating||joining)return;
        JSONObject offer=MobileHost.call(action.put("type","inviteFeedback").put("status","accept"));
        if(!offer.has("url") || offer.optBoolean("switchHost")!=host.active){status="邀请已失效，请让房主重新邀请";publish();return;}
        if(!host.active){handle(offer.put("type","join"));return;}
        final int generation=scan;
        preparingInvite=true;
        hostWork.execute(()->{
            RoomReceiver.PreparedInvite prepared=null;
            try{prepared=RoomReceiver.prepareInvite(offer);}catch(Exception ignored){}
            final RoomReceiver.PreparedInvite readyInvite=prepared;
            app.runOnUiThread(()->{
                preparingInvite=false;
                if(closed||!host.active||generation!=scan)return;
                if(readyInvite==null){status="未能连接受邀空间，已保留当前空间";publish();return;}
                room.disconnect();host.stop();reset("");stopSearch();joining=true;
                saved=offer.optString("url");prefs.edit().putString("host",saved).apply();
                room.connect(saved,"","","",readyInvite);publish();
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
            case "personal": personal(action);return;
            case "catalogThumbnail": case "trackDetails": if(host.active)MobileHost.call(action); return;
            case "favoriteSet": playback.setFavorite(action.optString("key"),action.optBoolean("enabled"));return;
            case "ready":
                playback.importFavorites(action.optJSONArray("favoriteKeys"));playerSession(false, false);
                ready=true;sendFavorites();previous=new JSONObject();publishInsets();frame.requestApplyInsets();publish();
                if(widgetPlayerPending)widgetPlayerRequest(true);
                return;
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
            case "inviteFeedback":MobileHost.call(action);return;
            case "acceptRoomInvite":acceptInvite(action);return;
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
            case "pauseImport":case "stopScan":local.stopScan();return;
            case "songNext":case "songShare":case "songHide":case "songDelete":case "songRestore":
                int token=action.optInt("token");
                if(songActions==null)songActions=new SongActions(app,local,(t,ok,message)->{
                    if(!closed)view.evaluateJavascript("window.lumeSongActionResult("+t+","+ok+","+JSONObject.quote(message)+")",null);
                });
                if(joined){view.evaluateJavascript("window.lumeSongActionResult("+token+",false,'请先离开播放空间')",null);return;}
                songActions.run(type,id,token);return;
            case "detailRead":readDetail(action);return;
            case "pickScanBlock": if((!joined||host.active)&&!local.scanning)local.pickFolder(app,action,true);return;
            case "scan": if ((!joined||host.active)&&!local.scanning)local.pickFolder(app,action,false);return;
            case "rescan": if ((!joined||host.active)&&!local.scanning)local.rescan(app,action);return;
            case "import": if ((!joined||host.active)&&!local.scanning) local.pick(app); return;
            case "toggle": case "next": case "previous": playback.command(type); return;
            case "seek":
                double seconds = Math.max(0, action.optDouble("seconds", 0));
                if (!joined) { local.seek(seconds); return; }
                action.put("position", seconds); break;
            case "select":
                if (!joined) {
                    Map<String,Integer> indexes=new LinkedHashMap<>();
                    for(int i=0;i<local.songs.size();i++)indexes.put(localId(i),i);
                    Integer selected=indexes.get(id);if(selected==null)return;
                    playback.prepareService();
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
                playback.prepareService();action.put("trackId", host.active?hostSongId(id):id); type = "play"; break;
            default: return;
        }
        room.action(action.put("type", type));
    }

    private void personal(JSONObject action)throws JSONException {
        int token=action.optInt("token");
        String op=action.optString("op");
        JSONObject result=new JSONObject();
        try{
            if(op.equals("pickFile")){
                pickToken=token;
                android.content.Intent pick=new android.content.Intent(android.content.Intent.ACTION_OPEN_DOCUMENT);
                pick.addCategory(android.content.Intent.CATEGORY_OPENABLE);pick.setType("*/*");
                pick.putExtra(android.content.Intent.EXTRA_MIME_TYPES,new String[]{"audio/*","video/mp4","video/webm","application/ogg","application/octet-stream"});
                app.startActivityForResult(pick,TRANSFER_FILE_REQUEST);return;
            }else if(op.equals("offerFile")){
                if(selectedTransfer==null||!selectionId.equals(action.optString("id")))throw new IllegalStateException("请重新选择歌曲");
                int dot=selectedName.lastIndexOf('.');
                offerDocument(token,selectedTransfer,selectedName,dot>0?selectedName.substring(0,dot):selectedName,action.getString("peer"));return;
            }else if(op.equals("offer")){
                LibraryPlayer.Song song=detailSongs.get(action.optString("id"));
                if(song==null||song.hidden)throw new IllegalStateException("请选择本机歌曲");
                String filename=song.facts.optString("fileName",song.title);
                offerDocument(token,android.net.Uri.parse(song.uri),filename,song.title,action.getString("peer"));return;
            }else if(java.util.Arrays.asList("status","rename","checkName","trust","approvePair","rejectPair","forget","accept","decline","find").contains(op)){
                result=MobileHost.call(action);
                if(op.equals("rename")&&!result.has("error")){MobileHost.MODEL=result.getString("name");publish();}
            }
            JSONArray files=result.optJSONArray("files");
            if(files!=null&&!local.scanning)for(int i=0;i<files.length();i++){
                JSONObject item=files.getJSONObject(i);
                java.io.File file=new java.io.File(new java.io.File(app.getFilesDir(),"received"),item.getString("file"));
                local.receivePersonal(file,item.getString("title"),item.getString("ext"));
                MobileHost.call(new JSONObject().put("type","personal").put("op","imported").put("key",item.getString("key")));
            }
            if(op.equals("library"))result.put("songs",localCatalog);
        }catch(Exception e){result.put("error",e.getMessage()==null?"设备操作失败":e.getMessage());}
        view.evaluateJavascript("window.lumePersonalReply("+token+","+result+")",null);
    }
    private String localId(int i) { return local.songs.get(i).uri; }
    private String hostSongId(String id) {
        for(LibraryPlayer.Song song:local.songs)if(song.uri.equals(id))
            return java.util.UUID.nameUUIDFromBytes(id.getBytes(java.nio.charset.StandardCharsets.UTF_8)).toString();
        return id;
    }
    void localChanged() {
        localOrder=new JSONArray();for(int index:local.order)if(index>=0&&index<local.songs.size()&&!local.songs.get(index).hidden)localOrder.put(localId(index));
        if (localCatalog.length() != local.songs.size()||catalogRevision!=local.revision) {
            catalogRevision=local.revision;
            if(host.active)try{host.catalog("update",local.songs);}catch(Exception ex){status="更新空间曲库失败";}
            localCatalog = new JSONArray();detailSongs.clear();
            for (int i = 0; i < local.songs.size(); i++) try {
                LibraryPlayer.Song song=local.songs.get(i);
                detailSongs.put(localId(i),song);
                String hostId=java.util.UUID.nameUUIDFromBytes(song.uri.getBytes(java.nio.charset.StandardCharsets.UTF_8)).toString();
                detailSongs.put(hostId,song);
                localCatalog.put(song.coverRecord().put("hostId",hostId).put("originalUri",song.uri));
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
        final Map<String,String> byRoom=new HashMap<>();final Set<String> liveIds=new HashSet<>();
        discovery=Discovery.search(saved, (name,url,roomId,live) -> app.runOnUiThread(() -> {
            if (closed || run != scan) return;
            if(!roomId.isEmpty()){
                String old=byRoom.get(roomId);
                if(old!=null&&!old.equals(url)){
                    if(!live||liveIds.contains(roomId))return;
                    hosts.remove(old);found.remove(old);
                }
                byRoom.put(roomId,url);if(live)liveIds.add(roomId);
            }
            found.put(url,name);if(name.equals(hosts.get(url)))return;
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
        playback.clearRoom();local.reloadCounts();joining=false; snapshot = null; theme = null; catalog = new JSONArray(); status = message; channel = ""; publish();
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
    void sendFavorites(){
        if(ready&&!closed)view.evaluateJavascript("window.lumeFavoriteState&&window.lumeFavoriteState("+playback.favoriteKeys()+")",null);
    }
    boolean switchingPlayback() { return joining || creating; }
    private void publish() {
        if(closed)return;
        playback.sync();
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
                .put("hosting",host.active).put("joined", joined).put("host", host.active?"本机空间":saved).put("hostAddress",joined?snapshot.optString("hostAddress"):"").put("savedHost", saved).put("hosts", spaces)
                .put("status", status).put("channel", channel).put("skin", theme == null ? JSONObject.NULL : theme)
                .put("completion",joined?snapshot.optJSONObject("completion"):MobileHost.call(new JSONObject().put("type","historyEvent")))
                .put("playRecords",MobileHost.call(new JSONObject().put("type","historyRecords").put("current",joined?snapshot.optString("currentSession"):"").put("playing",joined&&snapshot.optBoolean("roomPlaying")).put("rows",joined?snapshot.optJSONArray("playRecords"):null)).optJSONArray("records"))
                .put("roomDetails",joined?snapshot.optJSONObject("roomDetails"):JSONObject.NULL)
                .put("localSong",joined?snapshot.optJSONObject("localSong"):JSONObject.NULL).put("localTrackId",joined?snapshot.optString("localTrackId"):"")
                .put("counts",local.counts).put("scanTotalKnown",local.scan.scanTotalKnown).put("scanTotal",local.scan.scanTotal).put("scanFound",local.scan.scanFound).put("scanDone",local.scan.scanDone)
                .put("scanHistory",local.scanHistory).put("scanStatus",local.scanStatus).put("scanning",local.scanning).put("scanPaused",false)
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
                data.put("coverLibrary",localCatalog).put("coverRequests",info.optJSONArray("coverRequests")).put("coverRevision",info.optString("coverRevision"));
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
