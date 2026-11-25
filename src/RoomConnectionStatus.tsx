import {useEffect,useState} from 'react';
import type {GuestRoom} from './types';
import './appearance/room-connection.css';

export function RoomConnectionStatus({connection,leave,persistent=false}:{connection?:GuestRoom|null;leave:()=>void;persistent?:boolean}) {
  const [hidden,setHidden]=useState(false);
  const statusKey=connection?.status,url=connection?.url;
  useEffect(()=>{
    setHidden(false);
    if(persistent||statusKey!=='joined')return;
    const timer=window.setTimeout(()=>setHidden(true),4000);
    return ()=>window.clearTimeout(timer);
  },[statusKey,url,persistent]);
  if(!connection||(!persistent&&hidden&&connection.status==='joined'))return null;
  let host=connection.hostAddress||'';
  if(!host)try{host=new URL(connection.url).hostname;}catch{}
  if(!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)||host.startsWith('127.'))host='暂无';
  const status={joining:'正在连接',waiting:'等待手机房主确认',joined:'已加入 · 手机房主',disconnected:'连接中断，正在重连',error:'加入失败'}[connection.status];
  return <section className="room-connection-status" role="status" data-status={connection.status}>
    <div><strong>{status} · {connection.name}</strong><p>{connection.error||
      (connection.status==='joined'?'主机地址　'+host:connection.status==='waiting'?'请在手机上允许这台电脑加入。':connection.url)}</p></div>
    <button type="button" onClick={leave}>{['joining','waiting'].includes(connection.status)?'取消加入':connection.status==='error'?'关闭':'离开空间'}</button>
  </section>;
}
