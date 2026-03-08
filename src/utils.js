// ── Shared constants ──────────────────────────────────────────────
export const DAYS_OF_WEEK = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
export const ACCESS_LEVELS = { customer:{label:"Customer"}, staff:{label:"Staff"}, manager:{label:"Manager"}, admin:{label:"Admin"} };
export const PAGE_SIZE = 25;

// ── Formatters ────────────────────────────────────────────────────
export const fmt       = d  => new Date(d+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
export const fmtMoney  = n  => `$${Number(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
export const fmtPhone  = p  => p ? `(${p.slice(0,3)}) ${p.slice(3,6)}-${p.slice(6)}` : "";
export const fmt12     = t  => { if(!t)return""; const[h,m]=t.split(":"); const hr=+h; return`${hr>12?hr-12:hr===0?12:hr}:${m} ${hr>=12?"PM":"AM"}`; };
export const fmtTS     = ts => new Date(ts).toLocaleString("en-US",{month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"});
export const getDayName= d  => new Date(d+"T12:00:00").toLocaleDateString("en-US",{weekday:"long"});
export const cleanPh   = p  => (p||"").replace(/\D/g,"");
export const getInitials= n  => { if(!n)return"??"; const p=n.trim().split(/\s+/); return p.length>=2?p[0][0].toUpperCase()+p[p.length-1][0].toUpperCase():n.slice(0,2).toUpperCase(); };
export const todayStr  = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
export const addDaysStr= (d,n) => { const dt=new Date(d+'T00:00:00'); dt.setDate(dt.getDate()+n); return dt.toISOString().slice(0,10); };

export const sortTemplates = arr => [...arr].sort((a,b)=>{
  const di=DAYS_OF_WEEK.indexOf(a.dayOfWeek)-DAYS_OF_WEEK.indexOf(b.dayOfWeek);
  return di!==0?di:a.startTime.localeCompare(b.startTime);
});

// ── Waiver helpers ────────────────────────────────────────────────
export function hasValidWaiver(user, activeWaiverDoc) {
  if(!user||!user.waivers||!user.waivers.length) return false;
  if(activeWaiverDoc && user.needsRewaiverDocId === activeWaiverDoc.id) return false;
  const latest = user.waivers.reduce((a,b)=>a.signedAt>b.signedAt?a:b);
  if(activeWaiverDoc && latest.waiverDocId !== activeWaiverDoc.id) return false;
  return Date.now() - new Date(latest.signedAt).getTime() < 365*864e5;
}
export const latestWaiverDate  = user => user?.waivers?.length ? user.waivers.reduce((a,b)=>a.signedAt>b.signedAt?a:b).signedAt : null;
export const latestWaiverEntry = user => user?.waivers?.length ? user.waivers.reduce((a,b)=>a.signedAt>b.signedAt?a:b) : null;

// ── Tier rank ─────────────────────────────────────────────────────
export const TIER_THRESHOLDS=[
  {key:'recruit',  name:'Recruit',  min:0},
  {key:'initiate', name:'Initiate', min:4},
  {key:'operator', name:'Operator', min:10},
  {key:'striker',  name:'Striker',  min:18},
  {key:'vanguard', name:'Vanguard', min:28},
  {key:'sentinel', name:'Sentinel', min:40},
  {key:'enforcer', name:'Enforcer', min:56},
  {key:'apex',     name:'Apex',     min:71},
  {key:'elite',    name:'Elite',    min:86},
  {key:'legend',   name:'Legend',   min:100},
];
export const TIER_COLORS={recruit:'#e8e8e8',initiate:'#8b95c9',operator:'#4db6ac',striker:'#85b07a',vanguard:'#5a9a6a',sentinel:'#6b9dcf',enforcer:'#c94a5a',apex:'#cd7f32',elite:'#b8bfc7',legend:'#f5c842'};
export const TIER_SVGS=(()=>{
  const SP='M0,-1 .23,-.32 .95,-.31 .36,.12 .59,.81 0,.38 -.59,.81 -.36,.12 -.95,-.31 -.23,-.32Z';
  const star=(cx,cy,sz)=>`<path d="${SP}" fill="currentColor" transform="translate(${cx},${cy}) scale(${sz})"/>`;
  const cf=(py,ey,hw)=>{const ht=ey-py,len=Math.hypot(10,ht),nx=ht/len*hw,ny=10/len*hw,iy=ey+ny,ipy=iy-ht*(10-nx)/10,f=v=>+v.toFixed(1);return`<polygon points="0,${ey} 10,${py} 20,${ey} ${f(20-nx)},${f(iy)} 10,${f(ipy)} ${f(nx)},${f(iy)}" fill="currentColor"/>`;};
  const s=(w,h,vw,vh,c)=>`<svg width="${w*2}" height="${h*2}" viewBox="0 0 ${vw} ${vh}" xmlns="http://www.w3.org/2000/svg">${c}</svg>`;
  return{
    recruit: s(14,12,20,17,cf(2,14,3.5)),
    initiate:s(14,17,20,24,cf(2,9,3.5)+cf(13,20,3.5)),
    operator:s(14,18,20,26,cf(2,8,3.0)+cf(10.5,16.5,3.0)+star(10,22,3.2)),
    striker: s(10,20,12,24,'<rect x="3" y="1" width="6" height="22" fill="currentColor"/>'),
    vanguard:s(16,20,20,24,'<rect x="1" y="1" width="6" height="22" fill="currentColor"/><rect x="13" y="1" width="6" height="22" fill="currentColor"/>'),
    sentinel:s(16,20,20,24,'<path d="M10,2 L18,5 L18,12 Q18,21 10,23 Q2,21 2,12 L2,5 Z" stroke="currentColor" stroke-width="2.8" fill="none" stroke-linejoin="miter"/>'),
    enforcer:s(22,14,28,18,'<path d="M14,9 C11,6 6,5 0,7 C3,10 9,10 14,10Z" fill="currentColor"/><path d="M14,9 C17,6 22,5 28,7 C25,10 19,10 14,10Z" fill="currentColor"/><ellipse cx="14" cy="12" rx="2.5" ry="3.5" fill="currentColor"/>'),
    apex:    s(16,16,20,20,star(10,10,8.5)),
    elite:   s(22,14,28,18,star(7,9,5.5)+star(21,9,5.5)),
    legend:  s(28,22,56,44,'<path d="M 0,40 L 0,28 L 12,16 L 22,30 L 28,10 L 34,30 L 44,16 L 56,28 L 56,40 Z" fill="currentColor"/>'+star(12,12,5)+star(28,6,6)+star(44,12,5)),
  };
})();
export function getTierInfo(runs){
  const n=runs??0;
  let idx=0;
  for(let i=TIER_THRESHOLDS.length-1;i>=0;i--){if(n>=TIER_THRESHOLDS[i].min){idx=i;break;}}
  const current=TIER_THRESHOLDS[idx];
  const next=TIER_THRESHOLDS[idx+1]??null;
  const runsToNext=next?next.min-n:0;
  const sessionsToNext=next?Math.ceil(runsToNext/2):0;
  return{current,next,runsToNext,sessionsToNext};
}
export function getTierSvg1x(key){
  return TIER_SVGS[key].replace(/ width="(\d+)"/,(m,v)=>` width="${v/2}"`).replace(/ height="(\d+)"/,(m,v)=>` height="${v/2}"`);
}

// ── Session / lane helpers ────────────────────────────────────────
export function getSessionsForDate(date,templates) { return templates.filter(t=>t.active&&t.dayOfWeek===getDayName(date)); }

export function buildLanes(date,startTime,reservations,resTypes,templates) {
  const tmpl = getSessionsForDate(date,templates).find(t=>t.startTime===startTime);
  if(!tmpl) return {tmpl:null,lanes:[]};
  const numLanes = tmpl.maxSessions;
  const slotRes = reservations.filter(r=>r.date===date&&r.startTime===startTime&&r.status!=="cancelled");
  const lanes = Array.from({length:numLanes},(_,i)=>({laneNum:i+1,type:null,mode:null,reservations:[],playerCount:0}));
  const privRes = slotRes.filter(r=>resTypes.find(x=>x.id===r.typeId)?.style==="private");
  const openRes = slotRes.filter(r=>resTypes.find(x=>x.id===r.typeId)?.style==="open");
  let laneIdx=0;
  for(const r of privRes){
    if(laneIdx<numLanes){lanes[laneIdx].type="private";lanes[laneIdx].mode=resTypes.find(x=>x.id===r.typeId)?.mode;lanes[laneIdx].reservations.push(r);lanes[laneIdx].playerCount+=(r.playerCount||1);laneIdx++;}
  }
  for(const r of openRes){
    const mode=resTypes.find(x=>x.id===r.typeId)?.mode||"unknown";
    const cap=laneCapacity(mode);const cnt=r.playerCount||1;
    let targetLane=lanes.find(l=>l.type==="open"&&l.mode===mode&&l.playerCount+cnt<=cap);
    if(!targetLane) targetLane=lanes.find(l=>l.type===null);
    if(!targetLane) targetLane=lanes.find(l=>l.type==="open"&&l.mode===mode);
    if(!targetLane) continue;
    targetLane.type="open";targetLane.mode=mode;targetLane.reservations.push(r);targetLane.playerCount+=cnt;
  }
  return {tmpl,lanes};
}

export function laneCapacity(mode){return mode==="versus"?12:6;}

export function openPlayCapacity(mode,allLanes){
  const cap=laneCapacity(mode);
  const modeLanes=allLanes.filter(l=>l.type==="open"&&l.mode===mode);
  const freeLanes=allLanes.filter(l=>l.type===null);
  const blocks=[
    ...modeLanes.map(l=>Math.max(0,cap-l.playerCount)),
    ...freeLanes.map(()=>cap)
  ].filter(b=>b>0).sort((a,b)=>b-a);
  return{maxSingle:blocks[0]||0,total:blocks.reduce((s,b)=>s+b,0),blocks};
}

export function getSlotStatus(date,startTime,typeId,reservations,resTypes,templates) {
  const {tmpl,lanes} = buildLanes(date,startTime,reservations,resTypes,templates);
  if(!tmpl) return {available:false,reason:"No session",lanes:[]};
  const now=new Date();
  const todayISO=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  if(date===todayISO&&new Date(`${date}T${startTime}:00`)-now<15*60*1000){
    return {available:false,reason:"Check-in closed",lanes};
  }
  const desired = resTypes.find(rt=>rt.id===typeId);
  if(!desired) return {available:false,reason:"Unknown type",lanes};
  if(desired.style==="private"){
    const freeLane = lanes.find(l=>l.type===null);
    return freeLane
      ? {available:true,laneNum:freeLane.laneNum,slotsLeft:lanes.filter(l=>l.type===null).length,lanes}
      : {available:false,reason:"Sold out!",lanes};
  }
  const cap = laneCapacity(desired.mode);
  let bestLane = lanes.find(l=>l.type==="open"&&l.mode===desired.mode&&l.playerCount<cap);
  if(!bestLane) bestLane = lanes.find(l=>l.type===null);
  if(!bestLane) return {available:false,reason:"Sold out!",lanes};
  const spotsInLane = bestLane.type===null ? cap : cap - bestLane.playerCount;
  const freeLanes = lanes.filter(l=>l.type===null).length;
  const compatLanes = lanes.filter(l=>l.type==="open"&&l.mode===desired.mode&&l.playerCount<cap).length;
  return {available:true,laneNum:bestLane.laneNum,spotsLeft:spotsInLane,slotsLeft:freeLanes+compatLanes,lanes};
}

export function dateHasAvailability(date,typeId,reservations,resTypes,templates) {
  return getSessionsForDate(date,templates).some(t=>getSlotStatus(date,t.startTime,typeId,reservations,resTypes,templates).available);
}

export function get60Dates(templates) {
  const out=[]; const today=new Date(); today.setHours(0,0,0,0);
  for(let i=0;i<=60;i++){const d=new Date(today);d.setDate(today.getDate()+i);const day=d.toLocaleDateString("en-US",{weekday:"long"});if(templates.some(t=>t.active&&t.dayOfWeek===day))out.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`);}
  return out;
}
