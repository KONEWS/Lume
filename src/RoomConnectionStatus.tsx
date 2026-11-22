import type {GuestRoom} from './types';
import './appearance/room-connection.css';

export function RoomConnectionStatus({connection,leave}:{connection?:GuestRoom|null;leave:()=>void}) {
  if(!connection)return null;
  const status={joining:'正在连接',waiting:'等待手机房主确认',joined:'已加入 · 手机房主',disconnected:'连接中断，正在重连',error:'加入失败'}[connection.status];
  return <section className="room-connection-status" role="status" data-status={connection.status}>
    <div><strong>{status} · {connection.name}</strong><p>{connection.error||
      (connection.status==='joined'?'当前播放器直接控制手机空间，关闭页面不会断开连接。':connection.status==='waiting'?'请在手机上允许这台电脑加入。':connection.url)}</p></div>
    <button type="button" onClick={leave}>{['joining','waiting'].includes(connection.status)?'取消加入':connection.status==='error'?'关闭':'离开空间'}</button>
  </section>;
}
