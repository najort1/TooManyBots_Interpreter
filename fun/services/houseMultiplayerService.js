export function createHouseMultiplayerService(options = {}) {
  const sessions = new Map();
  const rooms = new Map();
  const bounds = options.bounds || { minX: 0, maxX: 100, minY: 0, maxY: 100 };
  const collision = options.collision || (() => false);
  const maxChatLength = options.maxChatLength || 500;
  const now = options.now || Date.now;
  const maxSpeed = Number(options.maxSpeed) || Infinity;
  const rateState = new Map();
  function allowed(sessionId, kind, config) {
    if (!config) return true; const key=sessionId+'|'+kind, time=now(), old=rateState.get(key);
    if (!old || time-old.start >= config.windowMs) { rateState.set(key,{start:time,count:1}); return true; }
    old.count++; return old.count <= config.max;
  }
  const keyOf = (a) => String(a.scopeKey) + '|' + String(a.scene);
  const room = (key) => { if (!rooms.has(key)) rooms.set(key, { history: [] }); return rooms.get(key); };
  function join(input) {
    if (!input?.sessionId || !input.userId || !input.scopeKey || !input.scene) return { ok:false,error:'invalid-session' };
    const old=sessions.get(input.sessionId);
    if (old && (old.userId!==input.userId || old.scopeKey!==input.scopeKey || old.scene!==input.scene)) return {ok:false,error:'session-owner-conflict'};
    sessions.set(input.sessionId, old || { ...input, position: input.position || {x:0,y:0}, seq:0, movedAt:now() }); room(keyOf(input)); return {ok:true};
  }
  function leave(id) { if (!sessions.has(id)) return {ok:false,error:'session-not-found'}; sessions.delete(id); return {ok:true}; }
  function snapshot(query) { const key=keyOf(query); return { participants:[...sessions.values()].filter(s=>keyOf(s)===key).map(s=>({sessionId:s.sessionId,userId:s.userId,nickname:s.nickname,position:{...s.position}})), history:[...(rooms.get(key)?.history||[])] }; }
  function move(input) { const s=sessions.get(input.sessionId); if(!s)return {ok:false,error:'session-not-found'}; const x=Number(input.x),y=Number(input.y),seq=Number(input.seq); if(!Number.isFinite(x)||!Number.isFinite(y))return {ok:false,error:'invalid-position'}; if(seq<=s.seq)return {ok:false,error:'stale-sequence'}; if(x<bounds.minX||x>bounds.maxX||y<bounds.minY||y>bounds.maxY)return {ok:false,error:'position-out-of-bounds'}; if(collision({x,y},s))return {ok:false,error:'collision-blocked'}; const elapsed=Math.max(1,now()-s.movedAt)/1000, distance=Math.hypot(x-s.position.x,y-s.position.y); if(distance/elapsed>maxSpeed)return {ok:false,error:'movement-speed-limit'}; s.position={x,y};s.seq=seq;s.movedAt=now();return {ok:true,position:s.position}; }
  function chat(input) { const s=sessions.get(input.sessionId);if(!s)return {ok:false,error:'session-unauthorized'};if(!allowed(s.sessionId,'chat',options.chatRateLimit))return {ok:false,error:'chat-rate-limit'};const text=String(input.text||'').trim();if(!text||text.length>maxChatLength)return {ok:false,error:'invalid-text-length'};const r=room(keyOf(s));const message={id:crypto.randomUUID(),senderId:s.userId,text,createdAt:Date.now()};r.history.push(message);if(r.history.length>20)r.history.shift();return {ok:true,message}; }
  function signal(input) { const from=sessions.get(input.sessionId),to=sessions.get(input.targetSessionId);if(!from)return {ok:false,error:'session-not-found'};if(!allowed(from.sessionId,'signal',options.signalRateLimit))return {ok:false,error:'signal-rate-limit'};if(!to)return {ok:false,error:'peer-not-found'};if(keyOf(from)!==keyOf(to))return {ok:false,error:'peer-forbidden-room'};const size=Buffer.byteLength(JSON.stringify(input.signal||null));if(size>65536)return {ok:false,error:'signal-limit'};return {ok:true,fromSessionId:from.sessionId,targetSessionId:to.sessionId,signal:input.signal}; }
  return {join,leave,snapshot,move,chat,signal};
}
