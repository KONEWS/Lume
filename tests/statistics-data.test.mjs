import test from 'node:test';
import assert from 'node:assert/strict';
import '../mobile/player-assets/player/listening.js';
import '../mobile/player-assets/player/statistics-data.js';
const A=globalThis.lumeStats,at=s=>+new Date(s),now=at('2027-01-02T12:00:00');
const records=[
 {session:'old',id:'a',title:'A',artist:'Alpha',album:'First',startedAt:at('2026-11-01T22:00:00'),listenedMs:60000,completed:false,days:{'2026-11-01':60000},hours:{'2026-11-01T22':60000}},
 {session:'cross',id:'a',title:'A',artist:'Alpha',album:'First',startedAt:at('2026-12-31T23:59:59'),lastHeardAt:at('2027-01-01T00:00:01'),listenedMs:2000,completed:true,days:{'2026-12-31':1000,'2027-01-01':1000},hours:{'2026-12-31T23':1000,'2027-01-01T00':1000}},
 {session:'next',id:'b',title:'B',artist:'Beta',startedAt:at('2027-01-01T00:01:00'),listenedMs:20000,completed:false,days:{'2027-01-01':20000},hours:{'2027-01-01T00':20000}},
 {session:'day2',id:'b',title:'B',artist:'Beta',startedAt:at('2027-01-02T10:00:00'),listenedMs:30000,completed:true,days:{'2027-01-02':30000},hours:{'2027-01-02T10':30000}}
];
test('five-page analytics: all/today/week/month/year/day/custom and cross-midnight attribution',()=>{
 const all=A.normalize([...records,records[0]]);assert.equal(all.length,4);
 for(const kind of ['month','year']){const rows=A.scope(all,A.range(kind,now));assert.deepEqual(A.summary(rows),{ms:51000,count:1,records:2,tracks:2,artists:2});assert.equal(A.trend(rows,A.range(kind,now),now).reduce((n,r)=>n+r.ms,0),51000);}
 assert.equal(A.summary(A.scope(all,A.range('week',now))).count,2);
 assert.equal(A.summary(A.scope(all,A.range('today',now))).ms,30000);
 assert.equal(A.summary(A.scope(all,A.range('day',now,'2026-12-31'))).count,1);
 assert.equal(A.summary(A.scope(all,A.range('custom',now,'','2026-12-31','2027-01-01'))).ms,22000);
 assert.equal(A.scope(all,A.range('custom',now,'','2027-01-02','2027-01-01')).length,0);
 const bounds=A.range('all',now),rows=A.scope(all,bounds);assert.equal(A.summary(rows).ms,112000);assert.equal(A.summary(A.scope(all,bounds,{onlyComplete:true})).ms,32000);assert.equal(A.summary(A.scope(all,bounds,{query:'alpha'})).records,2);
});
test('rankings, sessions, discoveries, day streaks, hourly distribution and goals reflect actual records',()=>{
 const all=A.normalize(records),rows=A.scope(all,A.range('all',now));const a=A.activity(rows);assert.equal(a.days,4);assert.equal(a.longest,3);assert.equal(a.sessions.length,3);
 assert.equal(A.rank(rows,'artists','ms')[0].title,'Alpha');assert.equal(A.rank(rows,'albums').length,1);assert.equal(A.rank(rows,'tracks','title')[0].title,'B');
 assert.equal(A.discovery(all,rows).rediscovered,1);assert.equal(A.discovery(all,rows).repeatRate,.5);
 assert.equal(A.hours(rows).reduce((n,v)=>n+v,0),112000);
 const goals=A.milestones(all,now);assert.equal(goals.length,13);assert.equal(goals.find(g=>g[0]==='后来完整听完的歌曲')[1],2);assert.equal(goals.find(g=>g[0]==='深夜聆听时间')[1],82000);
 const blank=A.scope([],A.range('all',now));assert.equal(A.summary(blank).ms,0);assert.equal(A.activity(blank).averageSession,0);assert.equal(A.milestones([],now).every(g=>g[1]===0),true);
});
