import { systemPlayback } from '../engine/SystemPlayback';
import { rpc } from '@kit.IPCKit';
import { AbilityConstant, ConfigurationConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { window } from '@kit.ArkUI';

const DOMAIN = 0x0000;

interface CardCommand {control?:string;favoriteKey?:string}
interface CardRoute {targetPage?:string}
class ControlReply implements rpc.Parcelable {
  marshalling(parcel:rpc.MessageSequence):boolean{parcel.writeInt(1);return true;}
  unmarshalling(parcel:rpc.MessageSequence):boolean{parcel.readInt();return true;}
}

export default class EntryAbility extends UIAbility {
  private acceptRoute(want:Want):void {
    const params=want.parameters?.params;
    let player=false;
    if(typeof params==='string'){
      try{player=(JSON.parse(params) as CardRoute)?.targetPage==='nowPlaying';}catch{}
    }
    AppStorage.setOrCreate('widgetPlayerPending',player);
  }
  onNewWant(want:Want, launchParam:AbilityConstant.LaunchParam):void {
    this.acceptRoute(want);
  }
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.acceptRoute(want);
    systemPlayback.attach(this.context);
    this.callee.on('playerControl',(parcel:rpc.MessageSequence)=>{
      const data=JSON.parse(parcel.readString()) as CardCommand;
      if(data.control==='favorite')systemPlayback.toggleCardFavorite(data.favoriteKey??'');
      else systemPlayback.command(data.control??'');
      return new ControlReply();
    });
    this.context.getApplicationContext().setColorMode(ConfigurationConstant.ColorMode.COLOR_MODE_NOT_SET);
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onCreate');
  }

  async onDestroy(): Promise<void> {
    this.callee.off('playerControl');
    await systemPlayback.close();
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onDestroy');
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    // Main window is created, set main page for this ability
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onWindowStageCreate');

    // Establish the edge-to-edge surface before the first page is drawn.
    // The page, rather than the window, keeps controls clear of system areas.
    const main = windowStage.getMainWindowSync();
    try { main.setWindowBackgroundColor('#10121E'); } catch {}
    main.setWindowLayoutFullScreen(true)
      .then(() => main.setWindowSystemBarEnable(['status', 'navigation']))
      .then(() => main.setWindowSystemBarProperties({
      statusBarColor: '#00000000', statusBarContentColor: '#F1FFFA',
      navigationBarColor: '#00000000', navigationBarContentColor: '#F1FFFA'
    })).catch(() => {}).then(() => windowStage.loadContent('pages/Index', (err) => {
      if (err.code) {
        hilog.error(DOMAIN, 'testTag', 'Failed to load the content. Cause: %{public}s', JSON.stringify(err));
        return;
      }
      hilog.info(DOMAIN, 'testTag', 'Succeeded in loading the content.');
    }));
  }

  onWindowStageDestroy(): void {
    // Main window is destroyed, release UI related resources
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onWindowStageDestroy');
  }

  onForeground(): void {
    AppStorage.setOrCreate('lumeForeground',true);
    // Ability has brought to foreground
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onForeground');
  }

  onBackground(): void {
    AppStorage.setOrCreate('lumeForeground',false);
    // Ability has back to background
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onBackground');
  }
}
