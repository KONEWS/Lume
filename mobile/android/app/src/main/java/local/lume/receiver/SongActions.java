package local.lume.receiver;

import android.app.*;
import android.content.*;
import android.net.Uri;
import android.os.Build;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import org.json.*;

/** Scoped operations on the selected library entry; no filesystem path guessing. */
final class SongActions {
    static final int DELETE_REQUEST=85, WRITE_REQUEST=86;
    interface Result {void send(int token,boolean ok,String message);}
    private final Activity app;private final LibraryPlayer library;private final Result result;
    private LibraryPlayer.Song pending;private int pendingToken;private boolean retryDelete;
    SongActions(Activity app,LibraryPlayer library,Result result){this.app=app;this.library=library;this.result=result;}
    void run(String type,String id,int token){
        if(pending!=null){result.send(token,false,"请先完成系统确认");return;}
        if(library.scanning){result.send(token,false,"请等待导入完成后再操作");return;}
        LibraryPlayer.Song song=null;for(LibraryPlayer.Song s:library.songs)if(s.uri.equals(id)){song=s;break;}
        if(type.equals("songRestore")){library.restoreSongs();result.send(token,true,"已恢复隐藏歌曲");return;}
        if(song==null||song.hidden){result.send(token,false,"歌曲已不存在，请重新打开菜单");return;}
        try{
            if(type.equals("songNext")){library.queueNext(song);result.send(token,true,"已设为下一首播放");}
            else if(type.equals("songHide")){library.hideSong(song);result.send(token,true,"已隐藏，可在媒体库中恢复");}
            else if(type.equals("songShare")){
                Uri uri=Uri.parse(song.uri);
                try(android.os.ParcelFileDescriptor file=app.getContentResolver().openFileDescriptor(uri,"r")){if(file==null)throw new Exception();}
                String mime=app.getContentResolver().getType(uri);
                Intent share=new Intent(Intent.ACTION_SEND).setType(mime==null?"audio/*":mime).putExtra(Intent.EXTRA_STREAM,uri).putExtra(Intent.EXTRA_TITLE,song.title).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                share.setClipData(ClipData.newUri(app.getContentResolver(),song.title,uri));
                app.startActivity(Intent.createChooser(share,"分享歌曲"));result.send(token,true,"已打开系统分享面板");
            }else if(type.equals("songDelete")){pending=song;pendingToken=token;delete(false);}
        }catch(Exception e){if(pending!=null)finish(false,"删除失败：文件不可用或没有删除权限，歌曲已保留");else result.send(token,false,"无法打开音频文件或系统分享面板");}
    }
    private void delete(boolean authorized) throws Exception {
        Uri uri=Uri.parse(pending.uri),media=null;
        if(Build.VERSION.SDK_INT>=29)try{media=MediaStore.getMediaUri(app,uri);}catch(Exception ignored){}
        if("media".equals(uri.getAuthority())&&!DocumentsContract.isDocumentUri(app,uri))media=uri;
        if(Build.VERSION.SDK_INT>=30&&media!=null&&!authorized){retryDelete=false;app.startIntentSenderForResult(MediaStore.createDeleteRequest(app.getContentResolver(),java.util.Collections.singletonList(media)).getIntentSender(),DELETE_REQUEST,null,0,0,0);return;}
        try{
            boolean deleted=DocumentsContract.isDocumentUri(app,uri)?DocumentsContract.deleteDocument(app.getContentResolver(),uri):app.getContentResolver().delete(uri,null,null)>0;
            if(!deleted)throw new Exception("not deleted");finish(true,"歌曲文件已永久删除");
        }catch(SecurityException e){
            if(Build.VERSION.SDK_INT>=29&&e instanceof RecoverableSecurityException&&!authorized){retryDelete=true;app.startIntentSenderForResult(((RecoverableSecurityException)e).getUserAction().getActionIntent().getIntentSender(),DELETE_REQUEST,null,0,0,0);return;}
            if(!authorized&&DocumentsContract.isDocumentUri(app,uri)){
                Intent pick=new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("audio/*").addCategory(Intent.CATEGORY_OPENABLE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                pick.putExtra(DocumentsContract.EXTRA_INITIAL_URI,uri);app.startActivityForResult(pick,WRITE_REQUEST);return;
            }throw e;
        }
    }
    void activityResult(int request,int code,Intent data){
        if(pending==null)return;
        if(code!=Activity.RESULT_OK){finish(false,"已取消删除，歌曲已保留");return;}
        try{
            if(request==WRITE_REQUEST){
                Uri chosen=data==null?null:data.getData(),original=Uri.parse(pending.uri);
                if(chosen==null||!java.util.Objects.equals(chosen.getAuthority(),original.getAuthority())||!DocumentsContract.getDocumentId(chosen).equals(DocumentsContract.getDocumentId(original))){finish(false,"选择的不是原歌曲，已取消删除");return;}
                // Use the newly granted URI without changing the stored song identity.
                if(!DocumentsContract.deleteDocument(app.getContentResolver(),chosen))throw new Exception();finish(true,"歌曲文件已永久删除");
            }else if(retryDelete)delete(true);else finish(true,"歌曲文件已永久删除");
        }catch(Exception e){finish(false,"删除失败：没有删除权限，歌曲已保留");}
    }
    private void finish(boolean ok,String message){LibraryPlayer.Song song=pending;int token=pendingToken;pending=null;if(ok)library.removeSong(song);result.send(token,ok,message);}
}
