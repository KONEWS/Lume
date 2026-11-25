package local.lume.receiver;

import android.app.*;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.session.*;
import android.os.*;

public final class PlaybackService extends Service {
    static PlaybackService current;
    private PlaybackEngine engine;
    private MediaSession session;
    private AudioManager audio;
    private AudioFocusRequest focus;
    private boolean focused;
    private final Handler main=new Handler(Looper.getMainLooper());
    private final Runnable retire=()->stopSelf();
    private static final int ID=93;
    @Override public void onCreate(){
        super.onCreate();
        engine=PlaybackEngine.get(this);
        NotificationChannel channel=new NotificationChannel("playback","音乐播放",NotificationManager.IMPORTANCE_LOW);
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
        audio=getSystemService(AudioManager.class);
        focus=new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
            .setOnAudioFocusChangeListener(change->{
                if(change==AudioManager.AUDIOFOCUS_LOSS||change==AudioManager.AUDIOFOCUS_LOSS_TRANSIENT)
                    engine.command("pause");
            },main).build();
        session=new MediaSession(this,"澄音播放");
        session.setSessionActivity(PlayerWidget.open(this));
        session.setCallback(new MediaSession.Callback(){
            public void onPlay(){engine.command("play");}
            public void onPause(){engine.command("pause");}
            public void onSkipToPrevious(){engine.command("previous");}
            public void onSkipToNext(){engine.command("next");}
            public void onStop(){engine.command("pause");stopSelf();}
        });
        current=this;engine.serviceRequested=true;
    }
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        startForeground(ID,notification());
        engine.sync();
        if(intent!=null && intent.getAction()!=null)engine.command(intent.getAction());
        refresh(true);
        return START_NOT_STICKY;
    }
    private Notification notification(){
        Notification.Builder b=new Notification.Builder(this,"playback")
            .setSmallIcon(R.drawable.widget_play).setContentTitle(engine.title.isEmpty()?"澄音播放器":engine.title)
            .setContentText(engine.artist).setContentIntent(PlayerWidget.open(this)).setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_TRANSPORT).setVisibility(Notification.VISIBILITY_PUBLIC)
            .setShowWhen(false).setOngoing(engine.playing)
            .addAction(R.drawable.widget_previous,"上一首",PlayerWidget.action(this,"previous"))
            .addAction(engine.playing?R.drawable.widget_pause:R.drawable.widget_play,engine.playing?"暂停":"播放",PlayerWidget.action(this,"toggle"))
            .addAction(R.drawable.widget_next,"下一首",PlayerWidget.action(this,"next"))
            .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0,1,2));
        if(engine.cover!=null)b.setLargeIcon(engine.cover);
        return b.build();
    }
    void refresh(boolean changed){
        if(engine.playing&&!focused)focused=audio.requestAudioFocus(focus)==AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        if(!engine.playing&&focused){audio.abandonAudioFocusRequest(focus);focused=false;}
        session.setActive(!engine.id.isEmpty());
        if(changed){
            MediaMetadata.Builder metadata=new MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_MEDIA_ID,engine.id)
                .putString(MediaMetadata.METADATA_KEY_TITLE,engine.title).putString(MediaMetadata.METADATA_KEY_ARTIST,engine.artist)
                .putLong(MediaMetadata.METADATA_KEY_DURATION,engine.duration);
            if(engine.cover!=null)metadata.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART,engine.cover);
            session.setMetadata(metadata.build());
            getSystemService(NotificationManager.class).notify(ID,notification());
        }
        long actions=PlaybackState.ACTION_PLAY|PlaybackState.ACTION_PAUSE|PlaybackState.ACTION_PLAY_PAUSE|
            PlaybackState.ACTION_SKIP_TO_PREVIOUS|PlaybackState.ACTION_SKIP_TO_NEXT|PlaybackState.ACTION_STOP;
        session.setPlaybackState(new PlaybackState.Builder().setActions(actions).setState(engine.playing?PlaybackState.STATE_PLAYING:
            PlaybackState.STATE_PAUSED,engine.position,engine.playing?1f:0f,engine.sampledAt).build());
        main.removeCallbacks(retire);
        if(!engine.playing)main.postDelayed(retire,engine.id.isEmpty()?3000:300000);
    }
    @Override public void onDestroy(){
        main.removeCallbacks(retire);current=null;engine.serviceRequested=false;
        if(focused)audio.abandonAudioFocusRequest(focus);
        session.release();stopForeground(STOP_FOREGROUND_REMOVE);super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent){return null;}
}
