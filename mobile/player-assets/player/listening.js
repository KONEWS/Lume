// Shared by the desktop and both mobile players. Dates are local calendar dates.
globalThis.lumeListening = (() => {
  const key=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
  function days(records=[],legacy={}){
    const result={};for(const [date,value] of Object.entries(legacy))result[date]={...value};
    for(const record of records){
      if(record.completed&&Number.isFinite(record.startedAt)){const date=key(new Date(record.startedAt));(result[date]??={starts:0,ms:0}).starts++;}
      for(const [date,ms] of Object.entries(record.days||{}))if(Number.isFinite(ms)&&ms>=0)(result[date]??={starts:0,ms:0}).ms+=ms;
    }
    return result;
  }
  function period(days,kind,offset=0,now=new Date()){
    const start=new Date(now);start.setHours(0,0,0,0);
    if(kind==='week')start.setDate(start.getDate()-(start.getDay()+6)%7+offset*7);
    else if(kind==='month'){start.setDate(1);start.setMonth(start.getMonth()+offset);}
    else {start.setMonth(0,1);start.setFullYear(start.getFullYear()+offset);}
    const end=new Date(start);
    if(kind==='week')end.setDate(end.getDate()+7);else if(kind==='month')end.setMonth(end.getMonth()+1);else end.setFullYear(end.getFullYear()+1);
    const first=key(start),limit=key(end),today=key(now);let starts=0,ms=0;
    for(const [date,value] of Object.entries(days||{}))if(date>=first&&date<limit&&date<=today){starts+=Number.isFinite(value.starts)?Math.max(0,value.starts):0;ms+=Number.isFinite(value.ms)?Math.max(0,value.ms):0;}
    const last=new Date(end);last.setDate(last.getDate()-1);
    return {start,end,starts,ms,label:kind==='year'?start.getFullYear()+' 年':kind==='month'?start.getFullYear()+' 年 '+(start.getMonth()+1)+' 月':first+' — '+key(last)};
  }
  return {key,days,period};
})();
