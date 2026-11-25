const cardStorage=new LocalStorage();
// The desktop clips the rectangular form. The 2×2 design radius is 18vp.
const coverInset:number=12;
const coverRadius:number=18-coverInset;
@Entry(cardStorage)
@Component
struct PlayerCard {
  @LocalStorageProp('title') title:string='澄音播放器';
  @LocalStorageProp('artist') artist:string='';
  @LocalStorageProp('playing') playing:boolean=false;
  @LocalStorageProp('liked') liked:boolean=false;
  @LocalStorageProp('favoriteKey') favoriteKey:string='';
  @LocalStorageProp('imageName') imageName:string='';
  @LocalStorageProp('formId') formId:string='';

  control(action:string):void{
    postCardAction(this,{action:'call',abilityName:'EntryAbility',
      params:{method:'playerControl',formId:this.formId,control:action,favoriteKey:this.favoriteKey}});
  }
  open():void{postCardAction(this,{action:'router',abilityName:'EntryAbility',params:{targetPage:'nowPlaying'}});}
  build(){
    Column(){
      Row(){
        Image(this.imageName?'memory://'+this.imageName:$r('app.media.lume'))
          .height('100%').aspectRatio(1).objectFit(ImageFit.Cover).borderRadius(coverRadius).clip(true)
          .accessibilityText('打开澄音').onClick(()=>this.open())
        Blank()
        Image(this.liked?$r('app.media.widget_heart_on'):$r('app.media.widget_heart'))
          .width(36).height(32).padding({left:9,bottom:7}).objectFit(ImageFit.Contain)
          .accessibilityText(this.liked?'取消收藏':'收藏').onClick(()=>{if(this.favoriteKey)this.control('favorite');})
      }.width('100%').layoutWeight(1).alignItems(VerticalAlign.Top)
      Text(this.title).width('100%').fontColor('#FFFCF8').fontSize(15).fontWeight(FontWeight.Bold)
        .maxLines(1).textOverflow({overflow:TextOverflow.Ellipsis}).margin({top:3}).onClick(()=>this.open())
      Text(this.artist).width('100%').fontColor('#BCB4AD').fontSize(12)
        .maxLines(1).textOverflow({overflow:TextOverflow.Ellipsis}).onClick(()=>this.open())
      Row(){
        Image($r('app.media.widget_previous')).layoutWeight(1).height(37).padding(7)
          .objectFit(ImageFit.Contain).accessibilityText('上一首').onClick(()=>this.control('previous'))
        Stack(){
          Image(this.playing?$r('app.media.widget_pause'):$r('app.media.widget_play')).width(29).height(29).padding(7)
            .backgroundColor('#FFFCF8').borderRadius(15)
        }.layoutWeight(1).height(37).accessibilityText(this.playing?'暂停':'播放').onClick(()=>this.control('toggle'))
        Image($r('app.media.widget_next')).layoutWeight(1).height(37).padding(7)
          .objectFit(ImageFit.Contain).accessibilityText('下一首').onClick(()=>this.control('next'))
      }.height(37).width('100%')
    }.width('100%').height('100%').padding({left:coverInset,right:12,top:coverInset,bottom:6})
      .linearGradient({angle:180,colors:[['#54473F',0],['#372E29',0.5],['#191613',1]]})
      .onClick(()=>this.open())
  }
}
