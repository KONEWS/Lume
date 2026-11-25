package local.lume.receiver;
import android.app.Activity;
import android.os.Bundle;
import android.content.Intent;

public class MainActivity extends Activity {
    private ReceiverScreen screen;
    @Override protected void onResume(){super.onResume();if(screen!=null)screen.foreground(true);}
    @Override protected void onPause(){if(screen!=null)screen.foreground(false);super.onPause();}
    @Override public void onWindowFocusChanged(boolean focused){super.onWindowFocusChanged(focused);if(focused&&screen!=null)screen.windowConfigurationChanged();}
    @Override public void onCreate(Bundle state){
        super.onCreate(state);
        screen=new ReceiverScreen(this);
        boolean pending=state!=null?state.getBoolean("widgetPlayerPending"):
            (getIntent().getFlags()&Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY)==0 && isWidgetPlayer(getIntent());
        screen.widgetPlayerRequest(pending);
        screen.start();
    }
    private boolean isWidgetPlayer(Intent intent){return PlayerWidget.OPEN_PLAYER.equals(intent.getAction());}
    @Override protected void onNewIntent(Intent intent){
        super.onNewIntent(intent);
        setIntent(intent);
        screen.widgetPlayerRequest(isWidgetPlayer(intent));
    }
    @Override protected void onSaveInstanceState(Bundle state){
        super.onSaveInstanceState(state);
        state.putBoolean("widgetPlayerPending",screen.widgetPlayerPending);
    }
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request==SongActions.DELETE_REQUEST||request==SongActions.WRITE_REQUEST)screen.songActivityResult(request,result,data);else if(request==ReceiverScreen.TRANSFER_FILE_REQUEST)screen.pickedTransfer(result,data);else if(request==ReceiverScreen.STYLE_FILE_REQUEST)screen.pickedStyleFiles(result,data);else if(request==83&&result==RESULT_OK&&data!=null&&data.getData()!=null)screen.selectedBlock(data.getData());else if((request==81||request==82)&&result==RESULT_OK&&data!=null)screen.local.imported(data,request==82);}
    @Override public void onBackPressed(){if(!screen.back())super.onBackPressed();}
    @Override public void onConfigurationChanged(android.content.res.Configuration config){super.onConfigurationChanged(config);if(screen!=null)screen.windowConfigurationChanged();}
    @Override protected void onDestroy(){screen.end();super.onDestroy();}
}

