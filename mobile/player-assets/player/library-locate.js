/* Locate within the displayed source by ID, without issuing playback commands. */
let libraryLocate;
function initLibraryLocate(){
  const list=$('library-list'),scroll=$('scroll'),button=$('locate-current');
  let highlighted=null,highlightId='',highlightSource='',timer=0,frame=0;
  function clear(){
    clearTimeout(timer);
    highlighted?.classList.remove('located-current');
    highlighted=null;
  }
  function notice(message){
    $('notice').textContent=message;$('notice').hidden=false;
    clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('notice').hidden=true,4000);
  }
  function refresh(){
    if(highlighted&&(!highlighted.isConnected||highlightId!==state.id||highlightSource!==sourceKey()))clear();
  }
  button.onclick=()=>{
    cancelAnimationFrame(frame);clear();
    if(!state.id){notice('尚未选择曲目');return;}
    const song=active();
    if(!song){notice(state.joined?'当前曲目不在此空间曲库中':'当前曲目不在本机曲库中');return;}
    if(song.hidden){notice('当前曲目已隐藏，请先在曲库管理中恢复');return;}
    const id=song.id,source=sourceKey(),changed=[];
    const query=$('query'),q=query.value.trim().toLocaleLowerCase();
    if(!matchesLibraryQuery(song,q)){
      query.value='';changed.push('搜索');
    }
    if(onlyLiked&&!liked.has(favKey(id))){onlyLiked=false;changed.push('收藏筛选');}
    query.blur();library();
    // Let the refreshed list lay out before measuring; never retain an old row
    // across a rescan, source change, or a next-track update.
    frame=requestAnimationFrame(()=>{
      frame=0;
      if(tab!=='library'||state.id!==id||sourceKey()!==source)return;
      const index=list.songItems?.findIndex(s=>s.id===id&&!s.hidden)??-1;
      const row=index<0?null:list.children[index];
      if(!row)return;
      const bounds=scroll.getBoundingClientRect(),rect=row.getBoundingClientRect();
      // Center above the floating control, including in a short landscape view.
      // A direct jump remains predictable even thousands of rows away.
      const visibleHeight=Math.min(scroll.clientHeight,button.getBoundingClientRect().top-bounds.top-8);
      scroll.scrollTo({top:scroll.scrollTop+rect.top-bounds.top-(visibleHeight-rect.height)/2,behavior:'instant'});
      highlighted=row;highlightId=id;highlightSource=source;
      row.classList.add('located-current');
      timer=setTimeout(clear,2800);
      notice((changed.length?'已清除'+changed.join('和')+'，':'')+'已定位：'+song.title);
    });
  };
  libraryLocate={refresh};
}
