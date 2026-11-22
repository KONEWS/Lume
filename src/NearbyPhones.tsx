import { useEffect, useState } from 'react';
import type { Device, GuestRoom } from './types';

interface Phone { id:string; name:string; platform:string; address:string; roomPort?:number }

export function NearbyPhones({connected,refreshKey=0,onJoined,guestRoom}:{connected:Device[];refreshKey?:number;onJoined?:()=>void;guestRoom?:GuestRoom|null}) {
  const [phones, setPhones] = useState<Phone[]>([]);
  const [message, setMessage] = useState('正在搜索同一 Wi-Fi 下的手机…');
  const [sent, setSent] = useState<{id:string; until:number} | null>(null);
  const [inviteError, setInviteError] = useState('');
  const [joining,setJoining]=useState('');

  useEffect(() => {
    const abort = new AbortController();
    let timer:ReturnType<typeof setTimeout>;
    let first = true;
    async function scan() {
      try {
        const response = await fetch('/api/nearby', {signal:abort.signal, cache:'no-store'});
        if (!response.ok) throw new Error('搜索暂不可用，请检查局域网连接。');
        const found:Phone[] = await response.json();
        if (abort.signal.aborted) return;
        setPhones(found);
        setMessage(found.length ? '' : first ? '正在搜索同一 Wi-Fi 下的手机…' : '正在搜索。请在同一 Wi-Fi 下打开手机澄音。');
      } catch (error) {
        if (abort.signal.aborted) return;
        setPhones([]);
        setMessage((error as Error).message);
      }
      first = false;
      timer = setTimeout(scan, 1800);
    }
    void scan();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [refreshKey]);

  async function invite(phone:Phone) {
    setSent({id:phone.id, until:Date.now()+8000});
    setInviteError('');
    try {
      const response=await fetch('/api/nearby/invite',{method:'POST', headers:{'Content-Type':'application/json'},body:JSON.stringify({id:phone.id})});
      if(!response.ok) throw new Error((await response.json()).error);
    } catch(error){
      setSent(null);setInviteError((error as Error).message || '发送失败，请重新邀请');
    }
  }
  async function join(phone:Phone) {
    if(joining)return;
    setJoining(phone.id);setInviteError('');
    try {await window.lumeDesktop!.joinRoom(phone.id);onJoined?.();}
    catch(error){setInviteError((error as Error).message||'空间连接失败，请重试');}
    finally{setJoining('');}
  }
  return <section className="nearby-phones" aria-label="附近的手机">
    <h3>附近的设备与空间</h3>
    <p role="status">{message || '邀请手机加入，或选择其他设备创建的空间。'}</p>
    {phones.map(phone=>{
      const waiting=sent?.id===phone.id && sent.until>Date.now();
      return <div className="nearby-row" key={phone.id}>
        <div><strong>{phone.name}</strong><small>{phone.platform} · {phone.address}</small></div>
        {phone.roomPort ? (window.lumeDesktop
          ? <button className="button button-secondary" disabled={!!joining||guestRoom?.url==='http://'+phone.address+':'+phone.roomPort&&guestRoom.status==='joined'} onClick={()=>void join(phone)}>{joining===phone.id?'等待手机确认…':guestRoom?.url==='http://'+phone.address+':'+phone.roomPort&&guestRoom.status==='joined'?'已加入':'加入空间'}</button>
          : <a href={'http://'+phone.address+':'+phone.roomPort} target="_blank" rel="noreferrer">加入空间</a>)
          : <button className="button button-secondary" disabled={waiting||guestRoom?.status==='joined'} onClick={()=>void invite(phone)}>{guestRoom?.status==='joined'?'由手机房主邀请':waiting?'已邀请':'邀请加入'}</button>}
      </div>;
    })}
    {inviteError && <p role="alert">{inviteError}</p>}
    {connected.map(device=><div className="nearby-row" key={device.id}><strong>{device.name}</strong><span>已连接</span></div>)}
  </section>;
}
