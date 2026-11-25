// The same WebView palette is used by Android and HarmonyOS. The manual
// light/dark choice and room skin remain stored separately from this switch.
window.lumeCoverTheme=(()=>{
  const preference='lume-phone-cover-theme';
  let on=false,trackKey=null,coverHue=null,coverSource=null;
  try{on=JSON.parse(localStorage.getItem(preference))===true;}catch{}

  function hueFrom(image){
    try{
      const canvas=document.createElement('canvas');canvas.width=canvas.height=32;
      const context=canvas.getContext('2d',{willReadFrequently:true});
      context.drawImage(image,0,0,32,32);
      const pixels=context.getImageData(0,0,32,32).data;
      const weights=new Float64Array(24);
      for(let i=0;i<pixels.length;i+=4){
        const [r,g,b,a]=pixels.slice(i,i+4);
        if(a<160)continue;
        const max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min;
        if(delta<22||max<35||min>225)continue;
        let hue=max===r?((g-b)/delta)%6:max===g?(b-r)/delta+2:(r-g)/delta+4;
        hue=(hue*60+360)%360;
        const saturation=delta/(255-Math.abs(max+min-255));
        weights[Math.floor(hue/15)%24]+=Math.max(.1,saturation)*Math.sqrt(delta)*(a/255);
      }
      let winner=0;
      for(let i=1;i<weights.length;i++)if(weights[i]>weights[winner])winner=i;
      return weights[winner]>0?winner*15+7.5:215;
    }catch{return null;}
  }
  function hex(h,s,l){
    const a=s*Math.min(l,1-l),f=n=>{
      const k=(n+h/30)%12;
      return Math.round(255*(l-a*Math.max(-1,Math.min(k-3,9-k,1)))).toString(16).padStart(2,'0');
    };
    return '#'+f(0)+f(8)+f(4);
  }
  function palette(){
    if(!on||coverHue===null)return null;
    const dark=document.documentElement.dataset.phoneTheme==='dark',h=coverHue;
    return dark?{
      background:hex(h,.30,.12),surface:hex(h,.28,.19),ink:hex(h,.30,.94),accent:hex(h,.72,.76)
    }:{
      background:hex(h,.34,.91),surface:hex(h,.32,.97),ink:hex(h,.38,.17),accent:hex(h,.68,.27)
    };
  }
  function track(key){
    if(trackKey===key)return;
    trackKey=key;coverSource=null;
    // Keep the previous cover's palette while the next artwork is read and
    // decoded. A missing or invalid cover must not flash the default skin.
    if(key===null){coverHue=null;if(on)applySkin();}
  }
  function show(image,key){
    if(!key||key!==trackKey)return;
    if(!image)return;
    if(coverSource===image.src)return;
    const nextHue=hueFrom(image);
    if(nextHue===null)return;
    coverSource=image.src;
    if(coverHue===nextHue)return;
    coverHue=nextHue;
    if(on){
      if(document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches)
        document.startViewTransition(()=>applySkin());
      else applySkin();
    }
  }
  function setEnabled(enabled){
    on=!!enabled;
    try{localStorage.setItem(preference,JSON.stringify(on));}catch{}
    applySkin();
  }
  return {enabled:()=>on,setEnabled,track,show,palette};
})();
