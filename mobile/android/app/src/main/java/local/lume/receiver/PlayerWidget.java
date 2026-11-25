package local.lume.receiver;

import android.app.*;
import android.appwidget.*;
import android.content.*;
import android.widget.RemoteViews;

public final class PlayerWidget extends AppWidgetProvider {
    static final String OPEN_PLAYER="local.lume.receiver.WIDGET_OPEN_PLAYER";
    static PendingIntent open(Context c){
        Intent i=new Intent(c,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(c,0,i,PendingIntent.FLAG_IMMUTABLE);
    }
    static PendingIntent action(Context c,String name){
        Intent i=new Intent(c,PlaybackService.class).setAction(name);
        return PendingIntent.getForegroundService(c,0,i,PendingIntent.FLAG_IMMUTABLE);
    }
    private static final String FAVORITE="local.lume.receiver.WIDGET_FAVORITE";
    private static PendingIntent favoriteIntent(Context c,String key){
        Intent intent=new Intent(c,PlayerWidget.class).setAction(FAVORITE)
            .setData(android.net.Uri.fromParts("lume-favorite",key,null));
        return PendingIntent.getBroadcast(c,0,intent,PendingIntent.FLAG_IMMUTABLE);
    }
    @Override public void onReceive(Context c,Intent intent){
        if(!FAVORITE.equals(intent.getAction())){super.onReceive(c,intent);return;}
        PlaybackEngine engine=PlaybackEngine.get(c);engine.sync();
        String key=intent.getData()==null?"":intent.getData().getSchemeSpecificPart();
        if(!engine.favoriteKey.isEmpty()&&engine.favoriteKey.equals(key))
            engine.setFavorite(key,!engine.favorite());
    }
    @Override public void onUpdate(Context c,AppWidgetManager m,int[] ids){
        PlaybackEngine engine=PlaybackEngine.get(c);engine.sync();render(c,engine);
    }
    static void render(Context c,PlaybackEngine engine){
        AppWidgetManager m=AppWidgetManager.getInstance(c);
        int[] ids=m.getAppWidgetIds(new ComponentName(c,PlayerWidget.class));
        if(ids.length==0)return;
        RemoteViews v=new RemoteViews(c.getPackageName(),R.layout.player_widget);
        v.setTextViewText(R.id.widget_title,engine.title.isEmpty()?"澄音播放器":engine.title);
        v.setTextViewText(R.id.widget_artist,engine.artist.isEmpty()&&!engine.id.isEmpty()?"未知艺人":engine.artist);
        if(engine.cover!=null){
            int size=Math.min(engine.cover.getWidth(),engine.cover.getHeight());
            v.setImageViewBitmap(R.id.widget_cover,android.graphics.Bitmap.createBitmap(engine.cover,
                (engine.cover.getWidth()-size)/2,(engine.cover.getHeight()-size)/2,size,size));
        }else v.setImageViewResource(R.id.widget_cover,R.drawable.lume);
        v.setImageViewResource(R.id.widget_favorite,engine.favorite()?R.drawable.widget_heart_on:R.drawable.widget_heart);
        v.setContentDescription(R.id.widget_favorite,engine.favorite()?"取消收藏":"收藏");
        v.setOnClickPendingIntent(R.id.widget_favorite,favoriteIntent(c,engine.favoriteKey));
        v.setImageViewResource(R.id.widget_toggle,engine.playing?R.drawable.widget_pause:R.drawable.widget_play);
        v.setContentDescription(R.id.widget_toggle_target,engine.playing?"暂停":"播放");
        Intent player=new Intent(c,MainActivity.class).setAction(OPEN_PLAYER)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
        v.setOnClickPendingIntent(R.id.widget_panel,PendingIntent.getActivity(c,0,player,PendingIntent.FLAG_IMMUTABLE));
        v.setOnClickPendingIntent(R.id.widget_toggle_target,action(c,"toggle"));
        v.setOnClickPendingIntent(R.id.widget_previous,action(c,"previous"));
        v.setOnClickPendingIntent(R.id.widget_next,action(c,"next"));
        m.updateAppWidget(ids,v);
    }
}
