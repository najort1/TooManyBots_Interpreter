import test from 'node:test';
import assert from 'node:assert/strict';
import { startFunDashboardServer } from '../fun/dashboard/server.js';

const scopeKey='group@g.us';
const owner={scopeKey,userJid:'owner@s.whatsapp.net'};
const actor={scopeKey,userJid:'actor@s.whatsapp.net'};
const neighbor={scopeKey,userJid:'neighbor@s.whatsapp.net'};

async function fixture() {
  const noop={};
  const services={
    repository:{}, houseRepository:{},
    houseService:noop, avatarService:noop, visitService:noop, giftService:noop, robberyService:noop,
    soundSystemService: {
      getState: ({scopeKey}) => ({ok:true,scopeKey,current:null,queue:[],serverNow:1,revision:0,searchEnabled:false}),
      enqueue: async ({scopeKey,userJid,url}) => ({ok:true,scopeKey,userJid,url}),
      search: async () => ({ok:false,reason:'youtube-search-not-configured'}),
      reportDuration: () => ({ok:true}),
      advance: () => ({ok:true}),
    },
    houseLinkService:{resolve: async token => token==='house' ? owner : token==='actor' ? actor : token==='neighbor' ? neighbor : null},
  };
  const server=await startFunDashboardServer({port:0,getConfig:()=>({dashboardHost:'127.0.0.1',dashboardAllowedOrigins:['https://allowed.test']}),funModule:{_services:services}});
  const address=server.address(); const base='http://127.0.0.1:'+address.port+'/api/fun/houses/house';
  return {server,base,close:()=>new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()))};
}
const post=(base,path,body,headers={})=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json','x-house-token':'actor',...headers},body});

test('realtime HTTP: Origin exato, JSON inválido e body >128KiB são controlados',async()=>{
  const f=await fixture(); try {
    let res=await post(f.base,'/session',JSON.stringify({scene:'street'}),{origin:'https://evil.test'}); assert.equal(res.status,403); assert.equal((await res.json()).error,'origin-not-allowed');
    res=await post(f.base,'/session','{"scene":'); assert.equal(res.status,400); assert.equal((await res.json()).error,'invalid-json');
    res=await post(f.base,'/session',JSON.stringify({scene:'street',padding:'x'.repeat(132000)})); assert.equal(res.status,413); assert.equal((await res.json()).error,'body-too-large');
    res=await post(f.base,'/session',JSON.stringify({scene:'street'}),{origin:'https://allowed.test'}); assert.equal(res.status,201); assert.equal(res.headers.get('access-control-allow-origin'),'https://allowed.test');
  } finally { await f.close(); }
});

test('realtime HTTP: auth, ticket single-use e leave autenticado',async()=>{
  const f=await fixture(); try {
    let res=await fetch(f.base+'/session',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}); assert.equal(res.status,401);
    res=await post(f.base,'/session',JSON.stringify({scene:'street'})); assert.equal(res.status,201); const session=await res.json(); assert.ok(session.sessionId&&session.streamTicket); assert.equal(session.nextClientSeq,1);
    const stream=await fetch(f.base+'/realtime/stream?ticket='+encodeURIComponent(session.streamTicket)); assert.equal(stream.status,200); await stream.body.cancel();
    const replay=await fetch(f.base+'/realtime/stream?ticket='+encodeURIComponent(session.streamTicket)); assert.equal(replay.status,401);
    const replayBody=JSON.stringify(await replay.json()); assert.doesNotMatch(replayBody,new RegExp(session.streamTicket.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
    res=await fetch(f.base+'/realtime/move',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:session.sessionId,streamTicket:session.streamTicket,x:1,y:1,clientSeq:1})}); assert.equal(res.status,401);
    assert.doesNotMatch(JSON.stringify(await res.json()),new RegExp(session.streamTicket.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
    res=await fetch(f.base+'/realtime/leave',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:session.sessionId})}); assert.equal(res.status,401);
    res=await post(f.base,'/realtime/leave',JSON.stringify({sessionId:session.sessionId})); assert.ok([200,403].includes(res.status));
  } finally { await f.close(); }
});

test('realtime HTTP: snapshot autenticado devolve o bairro compartilhado',async()=>{
  const f=await fixture(); try {
    let res=await post(f.base,'/session',JSON.stringify({scene:'street'}));
    assert.equal(res.status,201); const alice=await res.json();
    res=await fetch(f.base+'/session',{method:'POST',headers:{'content-type':'application/json','x-house-token':'neighbor'},body:JSON.stringify({scene:'street'})});
    assert.equal(res.status,201); const bruno=await res.json();
    res=await post(f.base,'/realtime/snapshot',JSON.stringify({sessionId:alice.sessionId}));
    assert.equal(res.status,200); const snapshot=await res.json();
    assert.equal(snapshot.selfId,alice.self.id);
    assert.ok(snapshot.participants.some(participant=>participant.id===bruno.self.id));
    res=await post(f.base,'/realtime/snapshot',JSON.stringify({sessionId:bruno.sessionId}),{'x-house-token':'actor'});
    assert.equal(res.status,403);
  } finally { await f.close(); }
});

test('realtime HTTP: polling entrega sinais WebRTC pendentes no Quick Tunnel',async()=>{
  const f=await fixture(); try {
    let res=await post(f.base,'/session',JSON.stringify({scene:'street'}));
    assert.equal(res.status,201); const alice=await res.json();
    res=await fetch(f.base+'/session',{method:'POST',headers:{'content-type':'application/json','x-house-token':'neighbor'},body:JSON.stringify({scene:'street'})});
    assert.equal(res.status,201); const bruno=await res.json();
    res=await post(f.base,'/realtime/signal',JSON.stringify({sessionId:alice.sessionId,toParticipantId:bruno.self.id,kind:'ready',payload:null}));
    assert.equal(res.status,200);
    res=await fetch(f.base+'/realtime/poll',{method:'POST',headers:{'content-type':'application/json','x-house-token':'neighbor'},body:JSON.stringify({sessionId:bruno.sessionId,afterSignalSeq:0})});
    assert.equal(res.status,200); const poll=await res.json();
    assert.equal(poll.snapshot.selfId,bruno.self.id);
    assert.equal(poll.signals.length,1);
    assert.equal(poll.signals[0].kind,'ready');
    res=await fetch(f.base+'/realtime/poll',{method:'POST',headers:{'content-type':'application/json','x-house-token':'neighbor'},body:JSON.stringify({sessionId:bruno.sessionId,afterSignalSeq:poll.nextSignalSeq})});
    assert.equal((await res.json()).signals.length,0);
  } finally { await f.close(); }
});

test('realtime HTTP: movimento da casa aceita a escala normalizada do cliente 3D',async()=>{
  const f=await fixture(); try {
    let res=await post(f.base,'/session',JSON.stringify({scene:'house'}));
    assert.equal(res.status,201); const session=await res.json();
    res=await post(f.base,'/realtime/move',JSON.stringify({sessionId:session.sessionId,x:50,y:50,moving:true,clientSeq:session.nextClientSeq}));
    assert.equal(res.status,200);
  } finally { await f.close(); }
});

test('paredão HTTP: estado é público pelo link e fila exige token do mesmo bairro',async()=>{
  const f=await fixture(); try {
    let res=await fetch(f.base+'/sound-system');
    assert.equal(res.status,200);
    assert.equal((await res.json()).scopeKey,scopeKey);
    res=await fetch(f.base+'/sound-system/queue',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:'https://youtu.be/dQw4w9WgXcQ'})});
    assert.equal(res.status,401);
    res=await post(f.base,'/sound-system/queue',JSON.stringify({url:'https://youtu.be/dQw4w9WgXcQ'}));
    assert.equal(res.status,200);
    const body=await res.json();
    assert.equal(body.userJid,actor.userJid);
  } finally { await f.close(); }
});
