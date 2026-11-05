export const RULES=Object.freeze({approved:true,version:'proposal-1-approved-2026-11-05',minPlayers:4,maxPlayers:10,defaultRounds:5,minRounds:3,maxRounds:10,readingMs:35000,discussionMs:120000,votingMs:30000,hostTransferMs:60000,weightCap:5,changes:3,aiTimeoutMs:8000});
const fail=(message,code='INVALID_ACTION')=>{const e=new Error(message);e.code=code;e.status=409;throw e;};
export function randomInt(max) {
  if (!Number.isSafeInteger(max)||max<1||max>0x100000000) throw new Error('Invalid random range');
  const bound=Math.floor(0x100000000/max)*max,buf=new Uint32Array(1);
  do{globalThis.crypto.getRandomValues(buf);}while(buf[0]>=bound);
  return buf[0]%max;
}
export function weightedPick(players,weights,random=randomInt) {
  const total=players.reduce((s,p)=>s+weights[p.id],0);
  let ticket=random(total);
  for(const p of players){ticket-=weights[p.id];if(ticket<0)return p.id;}
  throw new Error('Invalid weighted draw');
}
export function assignRoles(players,history,random=randomInt) {
  const h=structuredClone(history||{});
  for(const p of players)h[p.id]??={trickster:1,confused:1};
  const trickster=weightedPick(players,Object.fromEntries(players.map(p=>[p.id,h[p.id].trickster])),random);
  const confused=weightedPick(players.filter(p=>p.id!==trickster),Object.fromEntries(players.map(p=>[p.id,h[p.id].confused])),random);
  const roles=Object.fromEntries(players.map(p=>[p.id,p.id===trickster?'trickster':p.id===confused?'confused':'keeper']));
  for(const p of players){h[p.id].trickster=p.id===trickster?1:Math.min(RULES.weightCap,h[p.id].trickster+1);h[p.id].confused=p.id===confused?1:Math.min(RULES.weightCap,h[p.id].confused+1);}
  return {roles,history:h};
}
export function createRoom({id,code,players,mode='online',rounds=5,now=Date.now()}) {
  if(!Number.isInteger(rounds)||rounds<RULES.minRounds||rounds>RULES.maxRounds)fail('عدد الجولات من 3 إلى 10.');
  return {id,code,mode,players:players.map(p=>({...p,score:0,connected:true,joinedAt:p.joinedAt??now})),hostId:players[0]?.id,hostDisconnectedAt:null,hostEpoch:1,status:'lobby',phase:'lobby',settings:{rounds},roundNumber:0,history:{},usedStoryIds:[],round:null,results:[],revision:1,createdAt:now};
}
export function requireHost(room,playerId){if(room.hostId!==playerId)fail('هذا الإجراء للمضيف فقط.','HOST_REQUIRED');}
export function touch(room){room.revision++;}
export function setConnected(room,playerId,connected,now=Date.now()) {
  const p=room.players.find(p=>p.id===playerId);if(!p||p.connected===connected)return false;
  p.connected=connected;
  if(playerId===room.hostId){room.hostDisconnectedAt=connected?null:now;}
  touch(room);return true;
}
export function transferHost(room,now=Date.now()) {
  const host=room.players.find(p=>p.id===room.hostId);
  if(host?.connected){room.hostDisconnectedAt=null;return false;}
  if(room.hostDisconnectedAt===null||now-room.hostDisconnectedAt<RULES.hostTransferMs)return false;
  const next=room.players.filter(p=>p.connected).sort((a,b)=>a.joinedAt-b.joinedAt||a.id.localeCompare(b.id))[0];
  if(!next)return false;
  room.hostId=next.id;room.hostEpoch++;room.hostDisconnectedAt=null;touch(room);return true;
}
export function beginRound(room,content,now=Date.now(),random=randomInt) {
  if(!RULES.approved)fail('القواعد غير معتمدة.');
  if(!['lobby','reveal'].includes(room.phase))fail('هناك جولة جارية.');
  if(room.players.length<RULES.minPlayers||room.players.length>RULES.maxPlayers)fail('المطلوب 4–10 لاعبين.');
  if(room.roundNumber>=room.settings.rounds)fail('انتهت المباراة.');
  if(!room.players.some(p=>p.connected))fail('لا يوجد لاعب متصل.');
  if(!content?.original?.id||!content?.variant?.text)fail('محتوى الجولة غير مكتمل.');
  if(room.usedStoryIds.includes(content.original.id))fail('استُخدم هذا الأصل في المباراة.');
  const draw=assignRoles(room.players,room.history,random);
  room.history=draw.history;room.roundNumber++;room.usedStoryIds.push(content.original.id);
  room.status='playing';room.phase=room.mode==='single'?'handoff-read':'reading';
  room.round={id:`${room.id}:${room.roundNumber}`,content:structuredClone(content),roles:draw.roles,votes:{},voteRevisions:{},settled:false,startedAt:now,deadline:room.mode==='single'?null:now+RULES.readingMs,turnIndex:0};touch(room);
}
export function confirmHandoff(room,playerId,now=Date.now()) {
  if(room.mode!=='single'||!['handoff-read','handoff-vote'].includes(room.phase))fail('لا توجد شاشة تسليم نشطة.');
  if(room.players[room.round.turnIndex]?.id!==playerId)fail('هذا ليس دور اللاعب.');
  room.phase=room.phase==='handoff-read'?'reading':'voting';
  room.round.deadline=now+(room.phase==='reading'?RULES.readingMs:RULES.votingMs);touch(room);
}
export function castVote(room,playerId,targetId,now=Date.now(),revision=1) {
  if(room.phase!=='voting'||now>=room.round.deadline)fail('التصويت مغلق.','VOTING_CLOSED');
  if(!room.players.some(p=>p.id===playerId))fail('اللاعب غير موجود.');
  if(room.mode==='single'&&room.players[room.round.turnIndex]?.id!==playerId)fail('ليس دورك.');
  if(targetId!==null&&(!room.players.some(p=>p.id===targetId)||targetId===playerId))fail('اختيار غير صالح.');
  if(!Number.isSafeInteger(revision)||revision<1)fail('رقم التصويت غير صالح.');
  if(revision<=(room.round.voteRevisions[playerId]||0))return false;
  room.round.votes[playerId]=targetId;room.round.voteRevisions[playerId]=revision;touch(room);return true;
}
export function settleRound(room,now=Date.now()) {
  const round=room.round;if(!round||round.settled)return false;
  if(room.phase!=='voting')fail('لم تبدأ مرحلة التصويت.');
  if(now<round.deadline)fail('التصويت لم يُغلق بعد.');
  if(room.mode==='single'&&round.turnIndex!==room.players.length-1)fail('لم يمر التصويت على كل اللاعبين.');
  const tally=Object.fromEntries(room.players.map(p=>[p.id,0]));
  for(const target of Object.values(round.votes))if(target&&Object.hasOwn(tally,target))tally[target]++;
  const highest=Math.max(...Object.values(tally)),top=Object.keys(tally).filter(id=>tally[id]===highest);
  const accused=highest>0&&top.length===1?top[0]:null;
  const trickster=Object.keys(round.roles).find(id=>round.roles[id]==='trickster');
  const caught=accused===trickster;
  const awards=room.players.map(p=>{
    const role=round.roles[p.id],vote=round.votes[p.id]??null;
    const points=role==='trickster'?(caught?0:3):(vote===trickster?2:0);
    const reason=role==='trickster'?(caught?'كُشف المحوّس بأعلى تصويت منفرد.':'نجا المحوّس؛ لم يحصل على أعلى تصويت منفرد.'):(vote===trickster?'صوتك النهائي حدّد المحوّس.':vote===null?'امتنعت أو انتهت المهلة دون اختيار.':'صوتك النهائي لم يحدّد المحوّس.');
    p.score+=points;return {playerId:p.id,role,vote,points,reason,total:p.score};
  });
  round.settled=true;round.deadline=null;round.result={roundId:round.id,roundNumber:room.roundNumber,accused,caught,tally,awards,closedAt:now};
  room.results.push(structuredClone(round.result));room.phase='reveal';touch(room);return true;
}
export function advance(room,now=Date.now()) {
  let changed=transferHost(room,now);
  if(!room.round||!room.round.deadline||now<room.round.deadline)return changed;
  while(room.round.deadline&&now>=room.round.deadline){
    const boundary=room.round.deadline;
    if(room.phase==='reading') {
      if(room.mode==='single'&&room.round.turnIndex<room.players.length-1){room.round.turnIndex++;room.phase='handoff-read';room.round.deadline=null;}
      else{room.phase='discussion';room.round.deadline=boundary+RULES.discussionMs;}
    } else if(room.phase==='discussion') {
      room.round.turnIndex=0;room.phase=room.mode==='single'?'handoff-vote':'voting';room.round.deadline=room.mode==='single'?null:boundary+RULES.votingMs;
    } else if(room.phase==='voting') {
      if(room.mode==='single'&&room.round.turnIndex<room.players.length-1){room.round.turnIndex++;room.phase='handoff-vote';room.round.deadline=null;}
      else settleRound(room,boundary);
    }else break;
    touch(room);changed=true;
  }
  return changed;
}
export function finishMatch(room,playerId) {
  requireHost(room,playerId);
  if(room.phase!=='reveal'||room.roundNumber!==room.settings.rounds)fail('لم تنته الجولات.');
  room.status='finished';room.phase='finished';touch(room);
}
export function publicView(room,playerId,now=Date.now()) {
  const p=room.players.find(p=>p.id===playerId);if(!p)fail('الجلسة غير صالحة.','INVALID_SESSION');
  const r=room.round,revealed=room.phase==='reveal'||room.phase==='finished';
  const me={id:p.id,name:p.name,score:p.score,isHost:room.hostId===p.id};
  if(r&&room.phase==='reading'&&(room.mode!=='single'||room.players[r.turnIndex]?.id===p.id)){
    const role=r.roles[p.id];
    me.story=role==='confused'?r.content.variant.text:r.content.original.original_text;
    if(role==='trickster'){me.role='trickster';me.alternate=r.content.variant.text;me.changes=r.content.variant.changes;}
  }
  if(r&&room.phase==='voting'&&(room.mode!=='single'||room.players[r.turnIndex]?.id===p.id)) {me.vote=r.votes[p.id]??null;me.voteRevision=r.voteRevisions[p.id]||0;}
  return {id:room.id,code:room.code,mode:room.mode,status:room.status,phase:room.phase,settings:room.settings,roundNumber:room.roundNumber,revision:room.revision,serverNow:now,deadline:r?.deadline??null,players:room.players.map(({id,name,score,connected})=>({id,name,score,connected})),hostId:room.hostId,hostEpoch:room.hostEpoch,hostDisconnectedAt:room.hostDisconnectedAt,me,nextPlayer:room.mode==='single'&&r?{id:room.players[r.turnIndex].id,name:room.players[r.turnIndex].name}:null,reveal:revealed&&r?{result:r.result,original:r.content.original.original_text,alternate:r.content.variant.text,changes:r.content.variant.changes,source:r.content.source,humanReviewed:r.content.humanReviewed}:null,results:revealed?room.results:[],winners:room.phase==='finished'?room.players.filter(p=>p.score===Math.max(...room.players.map(p=>p.score))).map(p=>p.id):[]};
}
