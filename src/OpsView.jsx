import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  supabase,
  fetchReservations,
  createReservation,
  updateReservation,
  addPlayerToReservation,
  fetchPlayersForReservation,
  removePlayerFromReservation,
  fetchUserByPhone,
  createGuestUser,
  signWaiver,
  createRun,
  fetchObjectives,
  fetchPlayerScoringStats,
  updateReservationPlayer,
  finalizeVersusWar,
  createPayment,
  fetchRunsForReservations,
  activateStructureRun,
  setStructureEnvironment,
  deactivateStructure,
  updateStructurePlayers,
} from './supabase.js'
import { processPayment } from './payments.js'
import {
  calcCoopRunScore,
  calcVersusRunScore,
  calcWarOutcome,
  WAR_BONUS,
} from './scoreUtils.js'
import { MerchStaffSales } from './MerchPortal.jsx'
import { vizRenderName, audRenderName } from './envRender.jsx'
import { getTierInfo, TIER_COLORS, fmtMoney, fmtPhone, fmt12, getDayName, cleanPh, todayStr, hasValidWaiver, getSessionsForDate, laneCapacity, buildLanes, openPlayCapacity, getInitials } from './utils.js'
import { WaiverModal, TierImg, PlatoonTag } from './ui.jsx'
const fmtBookedAt=ts=>{if(!ts)return null;const d=new Date(ts);const mon=d.toLocaleDateString("en-US",{month:"short"});const day=d.getDate();const year=d.getFullYear();const v=day%100;const ord=day+(['th','st','nd','rd'][(v-20)%10]||['th','st','nd','rd'][v]||'th');const hr=d.getHours();const min=String(d.getMinutes()).padStart(2,'0');const ampm=hr>=12?'PM':'AM';const hr12=hr>12?hr-12:hr===0?12:hr;return`${mon} ${ord}, ${year} @ ${hr12}:${min}${ampm}`;};

// ── applyLaneOverrides (OpsView-only: not in utils.js) ───────────────────────
function applyLaneOverrides(lanes,overrides,resTypes){
  if(!Object.keys(overrides).length)return lanes;
  const result=lanes.map(l=>({...l,reservations:[...l.reservations],playerCount:l.playerCount}));
  for(const [resId,targetLaneNum] of Object.entries(overrides)){
    const src=result.find(l=>l.reservations.some(r=>r.id===resId));
    const tgt=result.find(l=>l.laneNum===Number(targetLaneNum));
    if(!src||!tgt||src.laneNum===tgt.laneNum)continue;
    const res=src.reservations.find(r=>r.id===resId);
    src.reservations=src.reservations.filter(r=>r.id!==resId);
    src.playerCount-=(res.playerCount||1);
    tgt.reservations.push(res);
    tgt.playerCount+=(res.playerCount||1);
    if(tgt.type===null){const rt=resTypes.find(x=>x.id===res.typeId);if(rt){tgt.type=rt.style;tgt.mode=rt.mode;}}
    if(src.reservations.length===0){src.type=null;src.mode=null;}
  }
  return result;
}

// ── Scoring Modal constants ────────────────────────────────────────────────────
const VISUAL_OPTIONS=[
  {ui:'Standard', code:'V', label:'Standard', desc:'6000K House Lighting'},
  {ui:'COSMIC',code:'C', label:'Cosmic',   desc:'UV Blacklighting (+20%)'},
  {ui:'STROBE',code:'S', label:'Strobe',   desc:'Flash Pulse (+40%)'},
  {ui:'DARK',  code:'B', label:'Dark',     desc:'Lights Off (+80%)'},
  {ui:'RAVE',  code:'R', label:'Rave',     desc:'Party Lighting (+20%)'},
];
const AUDIO_OPTIONS=[
  {ui:'OFF',    code:'O', cranked:false, label:'Off',     desc:'Silent'},
  {ui:'TUNES',  code:'T', cranked:false, label:'Tunes',   desc:'Background Music'},
  {ui:'CRANKED',code:'C', cranked:true,  label:'Cranked', desc:'Loud Music (+20%)'},
];
// Per-mode border + background for selected env buttons (matches envRender.jsx palette)
const VIZ_BTN={
  V:{selBorder:'rgba(220,227,239,.7)', selBg:'rgba(220,227,239,.1)'},
  C:{selBorder:'#a78bfa',             selBg:'rgba(167,139,250,.14)'},
  S:{selBorder:'rgba(255,255,255,.65)',selBg:'rgba(255,255,255,.07)'},
  B:{selBorder:'rgba(0,255,65,.55)',  selBg:'rgba(0,20,5,.45)'},
  R:{selBorder:'#c084fc',             selBg:'rgba(244,114,182,.08)'},
};
const AUD_BTN={
  O:{selBorder:'#94a3b8', selBg:'rgba(148,163,184,.1)'},
  T:{selBorder:'#38bdf8', selBg:'rgba(56,189,248,.12)'},
  C:{selBorder:'#f97316', selBg:'rgba(249,115,22,.14)'},
};
const DIFF_OPTIONS=[
  {value:'NONE',    label:'No Return Fire', desc:'Role players will not engage.'},
  {value:'HARMLESS',label:'Harmless',desc:'Light return fire with zero tactical skill.'},
  {value:'EASY',    label:'Easy',    desc:'Light return fire with basic tactical skill.'},
  {value:'MEDIUM',  label:'Medium',  desc:'Return fire with basic tactical skill.'},
  {value:'HARD',    label:'Hard',    desc:'Return fire with high tactical skill.'},
  {value:'EXPERT',  label:'Expert',  desc:'Everything you can handle!'},
];
const MAX_TENTHS=6000; // 10 minutes in tenths of a second
const fmtTenths=t=>{const min=Math.floor(t/600),sec=Math.floor((t%600)/10),tenth=t%10;return`${String(min).padStart(2,'0')}:${String(sec).padStart(2,'0')}.${tenth}`;};
const dfltLane=()=>({uiVisual:'Standard',visual:'V',uiAudio:'TUNES',audio:'T',cranked:false,targetsEliminated:false,objectiveComplete:false,objectiveId:null,difficulty:'NONE',winnerTeam:null});
// Assigns each reservation in a slot to a team (1 or 2), keeping each group together.
// Uses playerCount (booked seats) as the authoritative group size — stable even before all players are added.
// Each reservation goes to the team with fewer players; ties go to team 1.
function calcResVsTeams(reses){
  const sorted=[...reses].sort((a,b)=>(a.createdAt??a.id)<(b.createdAt??b.id)?-1:1);
  let t1=0,t2=0;const map={};
  for(const r of sorted){
    const n=r.playerCount||(r.players||[]).length||1;
    const team=t1<=t2?1:2;
    map[r.id]=team;
    if(team===1)t1+=n;else t2+=n;
  }
  return map;
}
// Returns a warning string if the new group can't fit on one team, or null.
// "big" = how many fit on the better team; rest go to the other.
function calcVsSlotWarn(date,startTime,newCount,reservations,resTypes){
  if(!newCount)return null;
  const slotReses=reservations.filter(r=>r.date===date&&r.startTime===startTime&&r.status!=='cancelled'&&resTypes.find(rt=>rt.id===r.typeId)?.mode==='versus');
  const teamMap=calcResVsTeams(slotReses);
  let t1=0,t2=0;
  slotReses.forEach(r=>{const n=r.playerCount||(r.players||[]).length||0;if(teamMap[r.id]===1)t1+=n;else t2+=n;});
  const r1=Math.max(0,6-t1),r2=Math.max(0,6-t2);
  if(newCount<=r1||newCount<=r2)return null; // fits on one team
  const big=Math.max(r1,r2),small=newCount-big;
  const bigT=r1>=r2?1:2;
  if(big<=0)return`This time slot is at capacity — no room for additional players.`;
  return`Heads up: your group of ${newCount} can't all be on the same team. ${big} will go to Team ${bigT} and ${small} to Team ${3-bigT}. Staff will arrange teams on arrival.`;
}

const fmtSecMS=s=>{if(s==null)return'—';const t=Math.round(s);return`${Math.floor(t/60)}:${String(t%60).padStart(2,'0')}`;};

function ScoringExitGuard({onStay,onLeave}){
  return(
    <div className="mo"><div className="mc">
      <div className="mt2">Leave Scoring?</div>
      <p style={{color:'var(--muted)',lineHeight:1.6}}>Any scores already written to the database will be kept. Unscored runs will be lost.</p>
      <div className="ma">
        <button className="btn btn-s" onClick={onStay}>Stay</button>
        <button className="btn btn-warn" onClick={onLeave}>Leave Anyway</button>
      </div>
    </div></div>
  );
}

function ScoringCommitModal({laneSummary,onCancel,onCommit}){
  return(
    <div className="mo"><div className="mc" style={{maxWidth:620,maxHeight:'85vh',overflowY:'auto',display:'flex',flexDirection:'column',gap:0}}>
      <div className="mt2" style={{flexShrink:0}}>Commit Scores?</div>
      <div style={{marginBottom:'1rem',display:'flex',flexDirection:'column',gap:'1rem'}}>
        {laneSummary.map(lane=>(
          <div key={lane.li} style={{border:'1px solid var(--bdr)',borderRadius:8,overflow:'hidden'}}>
            <div style={{background:'var(--bg2)',padding:'.45rem .85rem',display:'flex',alignItems:'center',gap:'.6rem',borderBottom:'1px solid var(--bdr)'}}>
              <span style={{fontWeight:700,fontSize:'.9rem'}}>Lane {lane.li+1}</span>
              {lane.typeName&&<span style={{color:'var(--muted)',fontSize:'.8rem'}}>{lane.typeName}</span>}
              <span style={{marginLeft:'auto',fontSize:'.72rem',textTransform:'uppercase',letterSpacing:'.06em',fontWeight:700,
                color:lane.mode==='versus'?'#4fc3f7':'var(--ok)',
                background:lane.mode==='versus'?'rgba(79,195,247,.12)':'rgba(76,175,80,.12)',
                padding:'.15rem .5rem',borderRadius:4}}>
                {lane.mode==='versus'?'VS':'CO-OP'}
              </span>
            </div>
            {lane.runs.map(run=>(
              <div key={run.runNum} style={{padding:'.65rem .85rem',borderBottom:'1px solid var(--bdr)'}}>
                <div style={{fontSize:'.72rem',color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:'.45rem',display:'flex',gap:'.5rem',alignItems:'center'}}>
                  <span>Run {run.runNum}</span><span>·</span><span>{run.struct}</span>
                  {run.elapsedSec!=null&&<><span>·</span><span>{fmtSecMS(run.elapsedSec)}</span></>}
                </div>
                {run.mode==='versus'?(()=>{
                  const blueT={color:'#4fc3f7',bg:'rgba(79,195,247,.08)',borderDim:'rgba(79,195,247,.25)',label:'Blue',role:run.blueRole,score:run.blueScore,players:run.bluePlayers,won:run.blueWon};
                  const redT ={color:'#ef9a9a',bg:'rgba(239,154,154,.08)',borderDim:'rgba(239,154,154,.25)',label:'Red', role:run.redRole, score:run.redScore, players:run.redPlayers, won:run.redWon};
                  const cols=run.hunterIsBlue?[blueT,redT]:[redT,blueT];
                  return(
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'.5rem'}}>
                      {cols.map(t=>(
                        <div key={t.label} style={{background:t.bg,border:`1px solid ${t.won?t.color:t.borderDim}`,borderRadius:6,padding:'.5rem .65rem'}}>
                          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'.3rem'}}>
                            <span style={{color:t.color,fontWeight:700,fontSize:'.85rem'}}>{t.label} · {t.role}</span>
                            <span style={{color:t.color,fontWeight:800,fontSize:'1rem'}}>{t.score!=null?Number(t.score).toFixed(1):'—'}</span>
                          </div>
                          <div style={{fontSize:'.75rem',color:'var(--muted)',lineHeight:1.5}}>
                            {t.players.map(p=>p.name?.split(' ')[0]||'?').join(', ')}
                          </div>
                          {t.won&&<div style={{marginTop:'.3rem',fontSize:'.75rem',color:t.color,fontWeight:700}}>✓ Won this run</div>}
                        </div>
                      ))}
                    </div>
                  );
                })():(
                  <div style={{display:'flex',alignItems:'center',gap:'1rem'}}>
                    <span style={{color:'var(--acc)',fontWeight:800,fontSize:'1.1rem'}}>{run.sc!=null?Number(run.sc).toFixed(1):'—'}</span>
                    <span style={{fontSize:'.78rem',color:'var(--muted)'}}>{run.players.map(p=>p.name?.split(' ')[0]||'?').join(', ')}</span>
                  </div>
                )}
              </div>
            ))}
            {lane.mode==='versus'&&(
              lane.laneWar?(
                <div style={{padding:'.5rem .85rem',background:lane.laneWar.winner===1?'rgba(79,195,247,.1)':'rgba(239,154,154,.1)',display:'flex',alignItems:'center',gap:'.75rem'}}>
                  <span style={{fontWeight:700,fontSize:'.85rem',color:lane.laneWar.winner===1?'#4fc3f7':'#ef9a9a'}}>
                    {lane.laneWar.winner===1?'Blue':'Red'} Team Wins War
                  </span>
                  <span style={{fontSize:'.78rem',color:'var(--muted)',flex:1}}>
                    {lane.laneWar.winType==='SWEEP'?'Clean Sweep':`Tiebreaker — ${fmtSecMS(lane.laneWar.timeDiff)} faster hunter run`}
                  </span>
                  <span style={{color:'var(--ok)',fontWeight:700,fontSize:'.82rem'}}>+{WAR_BONUS[lane.laneWar.winType]} pts</span>
                </div>
              ):(
                <div style={{padding:'.45rem .85rem',color:'var(--muted)',fontSize:'.78rem',textAlign:'center'}}>
                  No war winner — session ends as a tie
                </div>
              )
            )}
          </div>
        ))}
      </div>
      <p style={{color:'var(--muted)',fontSize:'.85rem',marginBottom:'1rem',flexShrink:0}}>This will mark all reservations in this slot as Completed and cannot be undone.</p>
      <div className="ma" style={{flexShrink:0}}>
        <button className="btn btn-s" onClick={onCancel}>Cancel</button>
        <button className="btn btn-p" onClick={onCommit}>Yes, Commit Scores</button>
      </div>
    </div></div>
  );
}

function ScoringTimePicker({timePicker,setTimePicker,setLaneFinish}){
  const {laneIdx,mins,secs,tenths}=timePicker;
  const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
  const at10=mins>=10;
  const tpSet=field=>v=>setTimePicker(p=>({...p,[field]:v}));
  const seg=(label,field,val,max,{onUp,onDown,upOff,downOff}={})=>{
    const btnStyle={width:64,height:56,fontSize:'1.6rem',lineHeight:1,display:'flex',alignItems:'center',justifyContent:'center',background:'var(--bg2)',border:'1px solid var(--bdr)',borderRadius:8,color:'var(--txt)',cursor:'pointer',userSelect:'none',flexShrink:0};
    const upClick=onUp||(()=>tpSet(field)(clamp(val+1,0,max)));
    const dnClick=onDown||(()=>tpSet(field)(clamp(val-1,0,max)));
    return <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:6}}>
      <button style={{...btnStyle,...(upOff?{opacity:.3,cursor:'default'}:{})}} onClick={upOff?undefined:upClick}>▲</button>
      <div style={{fontFamily:'var(--fd)',fontSize:'2.8rem',fontWeight:800,color:at10&&field!=='mins'?'var(--muted)':'var(--acc)',width:72,textAlign:'center',fontVariantNumeric:'tabular-nums',lineHeight:1.1}}>
        {field==='tenths'?val:String(val).padStart(2,'0')}
      </div>
      <button style={{...btnStyle,...(downOff?{opacity:.3,cursor:'default'}:{})}} onClick={downOff?undefined:dnClick}>▼</button>
      <span style={{fontSize:'.62rem',letterSpacing:'.12em',textTransform:'uppercase',color:'var(--muted)',marginTop:2}}>{label}</span>
    </div>;
  };
  return <div className="mo" style={{zIndex:3000}}>
    <div className="mc" style={{maxWidth:380,padding:'1.5rem 1.75rem'}} onClick={e=>e.stopPropagation()}>
      <div className="mt2" style={{marginBottom:'1.25rem'}}>Edit Time</div>
      <div style={{position:'relative',display:'flex',alignItems:'flex-start',justifyContent:'center',gap:'.25rem',marginBottom:'1.5rem'}}>
        {seg('MIN','mins',mins,10,{
          onUp:()=>setTimePicker(p=>p.mins>=9?{...p,mins:10,secs:0,tenths:0}:{...p,mins:p.mins+1}),
          upOff:mins>=10,downOff:mins<=0})}
        <span style={{fontSize:'2.8rem',fontWeight:700,color:'var(--muted)',alignSelf:'center',marginBottom:'1.4rem',lineHeight:1}}>:</span>
        {seg('SEC','secs',secs,59,{
          onUp:()=>setTimePicker(p=>{
            if(p.secs<59)return{...p,secs:p.secs+1};
            if(p.mins>=9)return{...p,mins:10,secs:0,tenths:0};
            return{...p,mins:p.mins+1,secs:0};
          }),
          onDown:()=>setTimePicker(p=>{
            if(p.secs>0)return{...p,secs:p.secs-1};
            if(p.mins<=0)return p;
            return{...p,mins:p.mins-1,secs:59};
          }),
          upOff:at10,
          downOff:at10||(mins===0&&secs===0),
        })}
        <span style={{fontSize:'2.8rem',fontWeight:700,color:'var(--muted)',alignSelf:'center',marginBottom:'1.4rem',lineHeight:1}}>.</span>
        {seg('1/10s','tenths',tenths,9,{upOff:at10,downOff:at10})}
      </div>
      <div style={{textAlign:'center',fontSize:'1rem',color:'var(--muted)',marginBottom:'1.25rem',fontVariantNumeric:'tabular-nums'}}>
        {String(mins).padStart(2,'0')}:{String(secs).padStart(2,'0')}.{tenths}
      </div>
      <div className="ma">
        <button className="btn btn-s" onClick={()=>setTimePicker(null)}>Cancel</button>
        <button className="btn btn-p" onClick={()=>{setLaneFinish(p=>({...p,[laneIdx]:Math.min(MAX_TENTHS,mins*600+secs*10+tenths)}));setTimePicker(null);}}>Set Time</button>
      </div>
    </div>
  </div>;
}

function ScoringModal({lanes,resTypes,versusTeams,users,currentUser,onClose,onCommit}){
  const [run,setRun]=useState(1);
  const [masterTenths,setMasterTenths]=useState(0);
  const [masterRunning,setMasterRunning]=useState(false);
  const masterRef=useRef(null);
  const [laneFinish,setLaneFinish]=useState({});
  const [structOrder,setStructOrder]=useState(['Alpha','Bravo']);
  // Map a lanes-array index → the correct structure name using the lane's physical laneNum
  // (laneNum=1→index 0, laneNum=2→index 1). Falls back to laneIdx+1 if laneNum absent.
  const laneStruct=(laneIdx,order)=>(order||structOrder)[((lanes[laneIdx]?.laneNum??laneIdx+1)-1)];
  const [settings,setSettings]=useState({1:{0:dfltLane(),1:dfltLane()},2:{0:dfltLane(),1:dfltLane()}});
  const [runTeams,setRunTeams]=useState(()=>{
    // Snapshot every player's initial team for run 1 at mount time so that
    // removing a player never shifts other players via the positional fallback.
    const snap={};
    lanes.forEach((lane,li)=>{
      const rt=resTypes.find(x=>x.id===(lane.reservations[0]?.typeId));
      if(rt?.mode!=='versus')return;
      const allPlayers=lane.reservations.flatMap(r=>r.players||[]);
      const laneSnap={};
      const laneResTeams=calcResVsTeams(lane.reservations);
      allPlayers.forEach(p=>{
        const ownerRes=lane.reservations.find(r=>(r.players||[]).some(pl=>pl.id===p.id));
        const vt=versusTeams?.[ownerRes?.id]?.[p.id];
        laneSnap[p.id]=vt!=null?vt:p.team!=null?p.team:(laneResTeams[ownerRes?.id]??1);
      });
      snap[li]=laneSnap;
    });
    return{1:snap,2:{}};
  });
  const [playerStats,setPlayerStats]=useState({});
  const [objectives,setObjectives]=useState([]);
  const [scored,setScored]=useState({});
  const [saving,setSaving]=useState(null);
  const [showCommit,setShowCommit]=useState(false);
  const [showExit,setShowExit]=useState(false);
  const [timePicker,setTimePicker]=useState(null); // {laneIdx,mins,secs,tenths}|null
  const openTimePicker=laneIdx=>{const ft=laneFinish[laneIdx]??0;setTimePicker({laneIdx,mins:Math.floor(ft/600),secs:Math.floor((ft%600)/10),tenths:ft%10});};
  // Refs so Realtime closure always sees current run/structOrder without re-subscribing
  const structOrderRef=useRef(structOrder);
  const runRef=useRef(run);
  useEffect(()=>{structOrderRef.current=structOrder;},[structOrder]);
  useEffect(()=>{runRef.current=run;},[run]);

  // Helper: activate both structures with current run context.
  // preservePicks=true: restore objectiveId+difficulty after activation (swap or versus run flip).
  // settingsMap: if provided, use these lane settings instead of reading from state (for run flip,
  //              where setSettings() hasn't committed yet when activateStructures is called).
  const activateStructures=(objs,runNum,order,preservePicks=false,settingsMap=null,statsMap=null)=>{
    const allObjs=objs||objectives;
    const effectiveStats=statsMap||playerStats;
    const effectiveOrder=order||structOrder;
    const occupiedPhysIdx=new Set();
    lanes.forEach((lane,laneIdx)=>{
      const allRes=lane.reservations;
      const physIdx=(lane.laneNum??laneIdx+1)-1;
      const structure=effectiveOrder[physIdx];
      occupiedPhysIdx.add(physIdx);
      if(!allRes.length){deactivateStructure(structure).catch(()=>{});return;}
      const rt=resTypes.find(x=>x.id===allRes[0].typeId);
      const mode=rt?.mode||'coop';
      const objsList=allObjs.filter(o=>o.mode==='all'||o.mode===mode).map(o=>({id:o.id,name:o.name,description:o.description??null}));
      const customerNames=allRes.map(r=>r.customerName).filter(Boolean);
      const s=(settingsMap??settings[runNum||run])[laneIdx];
      // Build per-player data for structure screen display
      const allPlayers=allRes.flatMap(r=>r.players||[]);
      const laneResTeams=calcResVsTeams(allRes);
      const playersList=allPlayers.map(p=>{
        const ownerRes=allRes.find(r=>(r.players||[]).some(pl=>pl.id===p.id));
        const vt=versusTeams?.[ownerRes?.id]?.[p.id];
        const team=vt!=null?vt:p.team!=null?p.team:(laneResTeams[ownerRes?.id]??1);
        const u=p.userId?(users||[]).find(x=>x.id===p.userId):null;
        const tier=getTierInfo(Number(effectiveStats[p.userId]?.total_runs||0)).current;
        return{id:p.id,name:p.name||'—',team:mode==='versus'?team:1,tierKey:tier.key,tierName:tier.name,tierColor:TIER_COLORS[tier.key]||'#888',platoonTag:u?.platoonTag??null,platoonBadgeColor:u?.platoonBadgeColor??null,leaderboardName:u?.leaderboardName??null};
      });
      const runActivate=activateStructureRun(structure,allRes[0].id,runNum||run,s?.visual||'V',s?.audio||'T',mode,customerNames,objsList,playersList);
      if(preservePicks){
        runActivate
          .then(()=>setStructureEnvironment(structure,s?.visual||'V',s?.audio||'T',s?.objectiveId??null,s?.difficulty??'NONE'))
          .catch(e=>console.error('activateStructureRun failed:',e));
      } else {
        runActivate.catch(e=>console.error('activateStructureRun failed:',e));
      }
    });
    // Deactivate any structure slots not covered by an active lane
    effectiveOrder.forEach((structure,i)=>{
      if(!occupiedPhysIdx.has(i))deactivateStructure(structure).catch(()=>{});
    });
  };

  // Fetch objectives + player stats on mount, then activate structure tablets
  useEffect(()=>{
    const uids=[...new Set(lanes.flatMap(l=>l.reservations.flatMap(r=>(r.players||[]).map(p=>p.userId).filter(Boolean))))];
    const statsP=uids.length?fetchPlayerScoringStats(uids):Promise.resolve({});
    Promise.all([fetchObjectives(),statsP]).then(([objs,stats])=>{
      setObjectives(objs);
      setPlayerStats(stats);
      activateStructures(objs,1,['Alpha','Bravo'],false,null,stats);
    }).catch(()=>{});
    // Deactivate both structures when modal unmounts normally
    return()=>{
      deactivateStructure('Alpha').catch(()=>{});
      deactivateStructure('Bravo').catch(()=>{});
    };
  },[]);// eslint-disable-line react-hooks/exhaustive-deps

  // Realtime — tablet changes push back to scoring modal via structures table
  useEffect(()=>{
    const ch=supabase.channel('scoring-structures')
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'structures'},({new:row})=>{
        const laneIdx=lanes.findIndex((l,i)=>structOrderRef.current[(l.laneNum??i+1)-1]===row.id);
        if(laneIdx===-1)return;
        const curRun=runRef.current;
        setSettings(prev=>{
          const cur=prev[curRun]?.[laneIdx]||dfltLane();
          const newVis=row.visual??cur.visual;
          const newAud=row.audio??cur.audio;
          return{...prev,[curRun]:{...prev[curRun],[laneIdx]:{
            ...cur,
            visual:   newVis,
            uiVisual: VISUAL_OPTIONS.find(v=>v.code===newVis)?.ui??cur.uiVisual,
            audio:    newAud,
            uiAudio:  AUDIO_OPTIONS.find(a=>a.code===newAud)?.ui??cur.uiAudio,
            cranked:  newAud==='C',
            ...(row.objective_id!==undefined?{objectiveId:row.objective_id}:{}),
            ...(row.difficulty   !==undefined?{difficulty:row.difficulty}:{}),
          }}};
        });
      })
      .subscribe();
    return()=>supabase.removeChannel(ch);
  },[]);// eslint-disable-line react-hooks/exhaustive-deps

  // Master clock interval
  useEffect(()=>{
    if(!masterRunning){clearInterval(masterRef.current);return;}
    masterRef.current=setInterval(()=>{
      setMasterTenths(prev=>{
        if(prev>=MAX_TENTHS){
          setMasterRunning(false);
          setLaneFinish(lf=>{const n={...lf};lanes.forEach((_,i)=>{if(n[i]==null)n[i]=MAX_TENTHS;});return n;});
          return MAX_TENTHS;
        }
        return prev+1;
      });
    },100);
    return()=>clearInterval(masterRef.current);
  },[masterRunning]);

  const tryClose=()=>setShowExit(true);

  const setSetting=(laneIdx,key,val)=>{
    setSettings(p=>({...p,[run]:{...p[run],[laneIdx]:{...p[run][laneIdx],[key]:val}}}));
    // Push customer-selectable env fields to structures table so tablets stay in sync
    if(['visual','audio','objectiveId','difficulty'].includes(key)){
      const cur=settings[run][laneIdx]||dfltLane();
      const nv=key==='visual'?val:cur.visual;
      const na=key==='audio'?val:cur.audio;
      const no=key==='objectiveId'?val:(cur.objectiveId??null);
      const nd=key==='difficulty'?val:(cur.difficulty??'NONE');
      setStructureEnvironment(laneStruct(laneIdx),nv,na,no,nd).catch(()=>{});
    }
  };

  const getTeam=(laneIdx,res,pid)=>{
    const rt=runTeams[run][laneIdx]||{};
    if(rt[pid]!=null)return rt[pid];
    const vt=versusTeams[res.id];
    if(vt&&vt[pid]!=null)return vt[pid];
    const pObj=(res.players||[]).find(p=>p.id===pid);
    if(pObj?.team!=null)return pObj.team;
    return calcResVsTeams(lanes[laneIdx].reservations)[res.id]??1;
  };
  const setPlayerTeam=(laneIdx,pid,team)=>{
    setRunTeams(p=>({...p,[run]:{...p[run],[laneIdx]:{...(p[run][laneIdx]||{}),[pid]:team}}}));
    // Push updated roster to structure tablet immediately (don't wait for state commit)
    const lane=lanes[laneIdx];const allRes=lane.reservations;if(!allRes.length)return;
    const rt=resTypes.find(x=>x.id===allRes[0].typeId);if(rt?.mode!=='versus')return;
    const overrideTeams={...(runTeams[run][laneIdx]||{}),[pid]:team};
    const laneResTeams=calcResVsTeams(allRes);
    const playersList=allRes.flatMap(r=>r.players||[]).map(p=>{
      const ownerRes=allRes.find(r=>(r.players||[]).some(pl=>pl.id===p.id));
      const t=overrideTeams[p.id]!=null?overrideTeams[p.id]:versusTeams?.[ownerRes?.id]?.[p.id]!=null?versusTeams[ownerRes.id][p.id]:p.team!=null?p.team:(laneResTeams[ownerRes?.id]??1);
      const u=p.userId?(users||[]).find(x=>x.id===p.userId):null;
      const tier=getTierInfo(Number(playerStats[p.userId]?.total_runs||0)).current;
      return{id:p.id,name:p.name||'—',team:t,tierKey:tier.key,tierName:tier.name,tierColor:TIER_COLORS[tier.key]||'#888',platoonTag:u?.platoonTag??null,platoonBadgeColor:u?.platoonBadgeColor??null,leaderboardName:u?.leaderboardName??null};
    });
    updateStructurePlayers(laneStruct(laneIdx),playersList).catch(()=>{});
  };


  const laneKey=(r,li,team)=>`${r}-${li}${team!=null?'-t'+team:''}`;
  const isLaneScored=(laneIdx,team)=>scored[laneKey(run,laneIdx,team)]!=null;
  const bothLanesScored=(runNum)=>{
    return lanes.every((_,li)=>{
      const rt=resTypes.find(x=>x.id===(lanes[li].reservations[0]?.typeId));
      if(rt?.mode==='versus')return scored[laneKey(runNum,li,1)]&&scored[laneKey(runNum,li,2)];
      return scored[laneKey(runNum,li,null)];
    });
  };
  const allRunsScored=bothLanesScored(1)&&bothLanesScored(2);

  const doScoreVersus=async(laneIdx)=>{
    const lane=lanes[laneIdx];const s=settings[run][laneIdx];
    if(!lane.reservations.length)return;
    const runNum=run;
    const env={visual:s.visual,audio:s.audio??null,cranked:s.cranked??false};
    // Score calc uses in-run slot convention (1=hunter,2=coyote) — unchanged
    const huntersScore=calcVersusRunScore({role:'hunter',winningTeam:s.winnerTeam,team:1,...env});
    const coyotesScore=calcVersusRunScore({role:'coyote',winningTeam:s.winnerTeam,team:2,...env});
    // Stable original team numbers: Blue(1) hunts run 1, Red(2) hunts run 2
    const hunterOrigTeam=runNum===2?2:1;
    const coyoteOrigTeam=runNum===2?1:2;
    // s.winnerTeam is in-run slot (1=hunter won, 2=coyote won); convert to stable original
    const winnerOrigTeam=s.winnerTeam===1?hunterOrigTeam:s.winnerTeam===2?coyoteOrigTeam:null;
    const elapsedSec=laneFinish[laneIdx]!=null?Math.round(laneFinish[laneIdx]/10):null;
    setSaving(laneIdx);
    try{
      // Persist each player's run-1 team to reservation_players.team
      const allLanePlayers=lane.reservations.flatMap(r=>r.players||[]);
      await Promise.all(allLanePlayers.map(player=>{
        const r1=runTeams[1]?.[laneIdx]?.[player.id];
        const resForPlayer=lane.reservations.find(r=>(r.players||[]).some(p=>p.id===player.id));
        const vt=versusTeams[resForPlayer?.id]?.[player.id];
        const fallback=calcResVsTeams(lane.reservations)[resForPlayer?.id]??1;
        return updateReservationPlayer(player.id,{team:r1??vt??fallback});
      }));
      // Create run records for EVERY reservation so each customer can see their scores
      let firstR1=null,firstR2=null;
      for(const res of lane.reservations){
        const base={reservationId:res.id,runNumber:runNum,structure:laneStruct(laneIdx),...env,elapsedSeconds:elapsedSec,objectiveId:s.objectiveId,winningTeam:winnerOrigTeam,scoredBy:currentUser?.id??null};
        const r1=await createRun({...base,team:hunterOrigTeam,role:'hunter',targetsEliminated:false,objectiveComplete:s.winnerTeam===1,score:huntersScore});
        const r2=await createRun({...base,team:coyoteOrigTeam,role:'coyote',targetsEliminated:false,objectiveComplete:s.winnerTeam!==2,score:coyotesScore});
        if(!firstR1){firstR1=r1;firstR2=r2;}
      }
      setScored(p=>({...p,[laneKey(runNum,laneIdx,hunterOrigTeam)]:firstR1,[laneKey(runNum,laneIdx,coyoteOrigTeam)]:firstR2}));
    }catch(e){alert("Score error: "+e.message);}
    setSaving(null);
  };

  const doScoreCoop=async(laneIdx)=>{
    const lane=lanes[laneIdx];const s=settings[run][laneIdx];
    const runNum=run;
    const score=calcCoopRunScore({visual:s.visual,audio:s.audio??null,cranked:s.cranked??false,targetsEliminated:s.targetsEliminated,objectiveComplete:s.objectiveComplete,liveOpDifficulty:s.difficulty??'MEDIUM'});
    const elapsedSec=laneFinish[laneIdx]!=null?Math.round(laneFinish[laneIdx]/10):null;
    setSaving(laneIdx);
    try{
      const runs=[];
      for(const res of lane.reservations){
        const r=await createRun({reservationId:res.id,runNumber:runNum,structure:laneStruct(laneIdx),visual:s.visual,cranked:s.cranked,audio:s.audio??null,targetsEliminated:s.targetsEliminated,objectiveComplete:s.objectiveComplete,elapsedSeconds:elapsedSec,score,objectiveId:s.objectiveId,liveOpDifficulty:s.difficulty??'MEDIUM',team:null,winningTeam:null,scoredBy:currentUser?.id??null});
        runs.push(r);
      }
      setScored(p=>({...p,[laneKey(runNum,laneIdx,null)]:runs[0]}));
    }catch(e){alert("Score error: "+e.message);}
    setSaving(null);
  };

  const doLogRun=()=>{
    // Copy run 1 settings to run 2 as defaults, swap structures and teams
    const newSettings2={};
    // Carry env controls + objective, but reset run winner (instructor must click fresh)
    lanes.forEach((_,i)=>{newSettings2[i]={...settings[1][i],winnerTeam:undefined};});
    setSettings(p=>({...p,2:newSettings2}));
    // Swap structures
    const newOrder=[structOrder[1],structOrder[0]];
    setStructOrder(()=>newOrder);
    // Activate tablets with run 2 context (swapped structures).
    // Pass newSettings2 directly (settings state hasn't committed yet) and preserve
    // picks so versus objective carries over to run 2.
    activateStructures(null,2,newOrder,true,newSettings2);
    // Swap hunters/coyotes for versus
    const newTeams2={};
    lanes.forEach((lane,li)=>{
      const rt=resTypes.find(x=>x.id===(lane.reservations[0]?.typeId));
      if(rt?.mode==='versus'){
        const batch={};
        lane.reservations.forEach(res=>{
          (res.players||[]).forEach(pl=>{const t=getTeam(li,res,pl.id);batch[pl.id]=t===1?2:1;});
        });
        newTeams2[li]=batch;
      }
    });
    setRunTeams(p=>({...p,2:newTeams2}));
    setMasterTenths(0);setMasterRunning(false);setLaneFinish({});
    setRun(2);
  };

  const doCommit=async()=>{
    const ids=[...new Set(lanes.flatMap(l=>l.reservations.map(r=>r.id)))];
    setShowCommit(false);
    // For VERSUS sessions, stamp the war outcome before marking complete
    const vsLaneIdx=lanes.findIndex((_,i)=>{const rt=resTypes.find(x=>x.id===(lanes[i].reservations[0]?.typeId));return rt?.mode==='versus';});
    if(vsLaneIdx>=0){
      // Read stable winning teams from scored records (winningTeam now = original group number)
      const r1Rec=scored[laneKey(1,vsLaneIdx,1)]||scored[laneKey(1,vsLaneIdx,2)];
      const r2Rec=scored[laneKey(2,vsLaneIdx,1)]||scored[laneKey(2,vsLaneIdx,2)];
      const run1Winner=r1Rec?.winningTeam??null;
      const run2Winner=r2Rec?.winningTeam??null;
      // Elapsed: Blue(team:1) hunts run 1, Red(team:2) hunts run 2
      const g1HunterElapsed=scored[laneKey(1,vsLaneIdx,1)]?.elapsedSeconds??null;
      const g2HunterElapsed=scored[laneKey(2,vsLaneIdx,2)]?.elapsedSeconds??null;
      const warResult=calcWarOutcome({run1WinnerTeam:run1Winner,run2WinnerTeam:run2Winner,group1HunterElapsed:g1HunterElapsed,group2HunterElapsed:g2HunterElapsed});
      if(warResult){
        for(const vsRes of lanes[vsLaneIdx].reservations){
          try{ await finalizeVersusWar(vsRes.id,warResult.warWinner,warResult.warWinType); }
          catch(e){ console.error('finalizeVersusWar failed:',e); }
        }
      }
    }
    await onCommit(ids);
  };

  // Helpers for commit summary
  const getScoredTeamScore=(runNum,laneIdx,team)=>{
    const rec=scored[laneKey(runNum,laneIdx,team)];
    return rec?.score??null;
  };
  const getRunWinner=(runNum,laneIdx)=>settings[runNum]?.[laneIdx]?.winnerTeam;
  const getSessionWinner=()=>{
    // Only for versus: use calcWarOutcome for consistent logic
    const vsLaneIdx=lanes.findIndex((_,i)=>{const rt=resTypes.find(x=>x.id===(lanes[i].reservations[0]?.typeId));return rt?.mode==='versus';});
    if(vsLaneIdx<0)return null;
    const r1Rec=scored[laneKey(1,vsLaneIdx,1)]||scored[laneKey(1,vsLaneIdx,2)];
    const r2Rec=scored[laneKey(2,vsLaneIdx,1)]||scored[laneKey(2,vsLaneIdx,2)];
    const result=calcWarOutcome({
      run1WinnerTeam:r1Rec?.winningTeam??null,
      run2WinnerTeam:r2Rec?.winningTeam??null,
      group1HunterElapsed:scored[laneKey(1,vsLaneIdx,1)]?.elapsedSeconds??null,
      group2HunterElapsed:scored[laneKey(2,vsLaneIdx,2)]?.elapsedSeconds??null,
    });
    return result?{winner:result.warWinner,winType:result.warWinType,timeDiff:result.timeDiff??null}:null;
  };

  // Render helpers
  const BLUE_COL='#4fc3f7',RED_COL='#ef9a9a',BLUE_BG='rgba(79,195,247,.15)',RED_BG='rgba(239,154,154,.15)';
  const teamCol=(t)=>t===1?BLUE_COL:RED_COL;const teamBg=(t)=>t===1?BLUE_BG:RED_BG;
  const teamAvg=(players,mode='all')=>{
    const scoreField=mode==='versus'?'versus_avg_score':'avg_score';
    const runsField=mode==='versus'?'versus_runs':'total_runs';
    const w=players.filter(p=>p.userId&&Number(playerStats[p.userId]?.[runsField])>0);
    if(!w.length)return null;
    return(w.reduce((s,p)=>s+Number(playerStats[p.userId]?.[scoreField]||0),0)/w.length).toFixed(1);
  };

  const _PillBtn=({options,value,onChange,disabled})=>(
    <div style={{display:'flex',flexWrap:'wrap',gap:'.35rem'}}>
      {options.map(o=>{const sel=value===o.value||value===o.ui;return(
        <button key={o.value||o.ui} type="button" disabled={disabled}
          onClick={()=>onChange(o)}
          style={{padding:'.45rem 1rem',borderRadius:20,fontSize:'.85rem',fontWeight:sel?700:500,
            border:`2px solid ${sel?'var(--acc)':'var(--bdr)'}`,background:sel?'var(--accD)':'var(--bg2)',
            color:sel?'var(--accB)':'var(--txt)',cursor:disabled?'default':'pointer',textTransform:'uppercase',letterSpacing:'.04em'}}>
          {o.label}
        </button>);
      })}
    </div>
  );

  const renderEnvControls=(laneIdx)=>{
    const s=settings[run][laneIdx];
    const selVis=VISUAL_OPTIONS.find(v=>v.ui===s.uiVisual)||VISUAL_OPTIONS[0];
    const selAud=AUDIO_OPTIONS.find(a=>a.ui===s.uiAudio)||AUDIO_OPTIONS[1];
    const lblSel={fontSize:'.8rem',fontWeight:700,textTransform:'uppercase',letterSpacing:'.04em'};
    const lblOff={fontSize:'.8rem',fontWeight:500,textTransform:'uppercase',letterSpacing:'.04em'};
    return(<>
      <div style={{marginBottom:'.5rem'}}>
        <div style={{fontSize:'.72rem',fontWeight:700,color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:'.35rem'}}>
          Visual <span style={{fontWeight:400,textTransform:'none',color:'var(--txt)',fontSize:'.78rem'}}>{selVis.desc}</span>
        </div>
        <div style={{display:'flex',flexWrap:'wrap',gap:'.3rem',justifyContent:'center'}}>
          {VISUAL_OPTIONS.map(v=>{
            const sel=s.uiVisual===v.ui;
            const c=VIZ_BTN[v.code]||{selBorder:'var(--acc)',selBg:'var(--accD)'};
            return(
              <button key={v.ui} type="button" onClick={()=>{setSetting(laneIdx,'uiVisual',v.ui);setSetting(laneIdx,'visual',v.code);}}
                style={{padding:'.35rem .8rem',borderRadius:16,cursor:'pointer',
                  border:`2px solid ${sel?c.selBorder:'var(--bdr)'}`,background:sel?c.selBg:'var(--bg2)',
                  opacity:sel?1:.55}}>
                {vizRenderName(v.code,v.label,sel?lblSel:lblOff)}
              </button>);
          })}
        </div>
      </div>
      <div>
        <div style={{fontSize:'.72rem',fontWeight:700,color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:'.35rem'}}>
          Audio <span style={{fontWeight:400,textTransform:'none',color:'var(--txt)',fontSize:'.78rem'}}>{selAud.desc}</span>
        </div>
        <div style={{display:'flex',gap:'.3rem',justifyContent:'center'}}>
          {AUDIO_OPTIONS.map(a=>{
            const sel=s.uiAudio===a.ui;
            const c=AUD_BTN[a.code]||{selBorder:'var(--acc)',selBg:'var(--accD)'};
            return(
              <button key={a.ui} type="button" onClick={()=>{setSetting(laneIdx,'uiAudio',a.ui);setSetting(laneIdx,'audio',a.code);setSetting(laneIdx,'cranked',a.cranked);}}
                style={{padding:'.35rem .8rem',borderRadius:16,cursor:'pointer',
                  border:`2px solid ${sel?c.selBorder:'var(--bdr)'}`,background:sel?c.selBg:'var(--bg2)',
                  opacity:sel?1:.55}}>
                {audRenderName(a.code,a.label,sel?lblSel:lblOff)}
              </button>);
          })}
        </div>
      </div>
    </>);
  };

  const renderObjSelect=(laneIdx)=>{
    const s=settings[run][laneIdx];
    const laneMode=lanes[laneIdx]?.mode||'coop';
    const visibleObjectives=objectives.filter(o=>o.mode==='all'||o.mode===laneMode);
    const selObj=visibleObjectives.find(o=>o.id===s.objectiveId);
    return(<div>
      <div style={{fontSize:'.72rem',fontWeight:700,color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:'.35rem'}}>
        Objective{selObj&&selObj.description?<span style={{fontWeight:400,textTransform:'none',color:'var(--txt)',fontSize:'.78rem'}}> · {selObj.description}</span>:''}
      </div>
      <div style={{display:'flex',flexWrap:'wrap',gap:'.3rem',justifyContent:'center'}}>
        {visibleObjectives.map(o=>{const sel=s.objectiveId===o.id;return(
          <button key={o.id} type="button" onClick={()=>setSetting(laneIdx,'objectiveId',o.id)}
            style={{padding:'.55rem .8rem',borderRadius:16,fontSize:'.8rem',fontWeight:sel?700:500,
              border:`2px solid ${sel?'var(--acc)':'var(--bdr)'}`,background:sel?'var(--accD)':'var(--bg2)',
              color:sel?'var(--accB)':'var(--txt)',cursor:'pointer',textTransform:'uppercase',letterSpacing:'.03em'}}>
            {o.name}
          </button>);})}
      </div>
    </div>);
  };

  const renderFinishPanel=(laneIdx)=>{
    const ft=laneFinish[laneIdx];
    const isScored=isLaneScored(laneIdx,null)||isLaneScored(laneIdx,1);
    return(<div style={{textAlign:'center',marginBottom:'.75rem'}}>
      {ft==null?(
        <button className="btn btn-warn" style={{fontSize:'1rem',padding:'.6rem 1.4rem',letterSpacing:'.04em'}}
          onClick={()=>setLaneFinish(p=>({...p,[laneIdx]:masterTenths}))}>
          FINISH
        </button>
      ):(
        <div>
          <div style={{fontSize:'1.1rem',fontWeight:800,color:'var(--acc)',fontVariantNumeric:'tabular-nums',letterSpacing:'.04em'}}>
            {fmtTenths(ft)}
          </div>
          <div style={{display:'flex',gap:'.4rem',justifyContent:'center',marginTop:'.3rem'}}>
            <button className="btn btn-s" style={{fontSize:'.75rem',padding:'.2rem .6rem'}} onClick={()=>openTimePicker(laneIdx)}>Edit</button>
            {!isScored&&<button className="btn btn-s" style={{fontSize:'.75rem',padding:'.2rem .6rem'}} onClick={()=>{setLaneFinish(p=>{const n={...p};delete n[laneIdx];return n;});}}>Clear</button>}
          </div>
        </div>
      )}
    </div>);
  };

  const renderVersusCard=(laneIdx,mirror=false)=>{
    const lane=lanes[laneIdx];const s=settings[run][laneIdx];
    const allRes=lane.reservations;
    if(!allRes.length)return<div style={{color:'var(--muted)',padding:'1rem',textAlign:'center',fontSize:'.9rem'}}>No reservation in this lane.</div>;
    const rt=resTypes.find(x=>x.id===allRes[0].typeId);
    // Aggregate all players across all reservations in this lane
    const allPlayers=allRes.flatMap(r=>r.players||[]);
    // Lane-scoped team getter: default splits by overall position across all players
    // Check ALL reservations in lane for versusTeams (not just allRes[0])
    const vtForPid=pid=>{for(const r of allRes){const v=versusTeams?.[r.id]?.[pid];if(v!==undefined)return v;}return undefined;};
    const getLaneTeam=pid=>{
      const ov=runTeams[run]?.[laneIdx]?.[pid];if(ov!==undefined)return ov;
      const vt=vtForPid(pid);if(vt!==undefined)return vt;
      const pObj=allPlayers.find(p=>p.id===pid);if(pObj?.team!=null)return pObj.team;
      const ownerRes=allRes.find(r=>(r.players||[]).some(p=>p.id===pid));
      return calcResVsTeams(allRes)[ownerRes?.id]??1;
    };
    // Row tint: Blue(1)/Red(2) — locked to run 1 identity, never changes in run 2.
    // In run 2, invert the run 2 assignment (doLogRun flipped T1↔T2) to recover run 1 color.
    // Falls back to versusTeams, then current role before run 1 is set.
    const getColorTeam=pid=>{
      if(run===2){
        const r2=runTeams[2]?.[laneIdx]?.[pid];
        if(r2!=null)return 3-r2; // invert: Blue was T1→T2, so 3-2=1=blue ✓
      }
      const r1=runTeams[1]?.[laneIdx]?.[pid];if(r1!=null)return r1;
      const vt=vtForPid(pid);if(vt!=null)return vt;
      return getLaneTeam(pid); // pre-assignment fallback: current role determines initial tint
    };
    // Run 1: Blue=T1=Hunters, Red=T2=Coyotes. Run 2 (after swap): Blue=T2=Coyotes, Red=T1=Hunters
    const blueTeamNum=run===1?1:2;const redTeamNum=run===1?2:1;
    const blueRole=run===1?'Hunters':'Coyotes';const redRole=run===1?'Coyotes':'Hunters';
    const hunterPlayers=allPlayers.filter(p=>getLaneTeam(p.id)===1);
    const coyotePlayers=allPlayers.filter(p=>getLaneTeam(p.id)===2);
    const bluePlayers=allPlayers.filter(p=>getLaneTeam(p.id)===blueTeamNum);
    const redPlayers=allPlayers.filter(p=>getLaneTeam(p.id)===redTeamNum);
    const blueAvg=teamAvg(bluePlayers);const redAvg=teamAvg(redPlayers);
    const bookerNames=[...new Set(allRes.map(r=>r.customerName).filter(Boolean))].join(' · ');
    const env={visual:s.visual,audio:s.audio??null,cranked:s.cranked??false};
    const huntersScore=s.winnerTeam!=null?calcVersusRunScore({role:'hunter',winningTeam:s.winnerTeam,team:1,...env}).toFixed(1):'—';
    const coyotesScore=s.winnerTeam!=null?calcVersusRunScore({role:'coyote',winningTeam:s.winnerTeam,team:2,...env}).toFixed(1):'—';
    const blueScore=run===1?huntersScore:coyotesScore;const redScore=run===1?coyotesScore:huntersScore;
    const isScoredVs=isLaneScored(laneIdx,1)&&isLaneScored(laneIdx,2);
    const isSavingThis=saving===laneIdx;
    const canScore=s.winnerTeam!=null&&s.objectiveId!=null&&laneFinish[laneIdx]!=null&&!isScoredVs;
    // Swap all players across entire lane
    const swapAll=()=>{
      const batch={};allPlayers.forEach(p=>{batch[p.id]=getLaneTeam(p.id)===1?2:1;});
      setRunTeams(prev=>({...prev,[run]:{...prev[run],[laneIdx]:{...(prev[run][laneIdx]||{}),...batch}}}));
    };

    const pRow=player=>{
      const st=playerStats[player.userId]||{};
      const t=getLaneTeam(player.id);
      const colorT=getColorTeam(player.id); // persistent Blue(1)/Red(2) for tinting
      const isHunter=t===1;
      const vr=Number(st.versus_runs)||0;
      const wl=Number(st.versus_wins)>0||Number(st.versus_losses)>0?`${st.versus_wins??0}-${st.versus_losses??0}`:'—';
      const avg=vr>0?Number(st.versus_avg_score||0).toFixed(1):'—';
      const obj=vr>0?Number(st.versus_obj_pct||0).toFixed(1)+'%':'—';
      const coyW=vr>0?Number(st.versus_coyote_win_pct||0).toFixed(1)+'%':'—';
      return(<div key={player.id} style={{display:'flex',alignItems:'center',gap:'.35rem',
          padding:'.3rem .4rem',borderRadius:4,marginBottom:'.15rem',
          background:colorT===1?'rgba(79,195,247,.06)':'rgba(239,154,154,.06)',
          border:`1px solid ${colorT===1?'rgba(79,195,247,.18)':'rgba(239,154,154,.18)'}`}}>
        <span style={{width:6,height:6,borderRadius:'50%',flexShrink:0,background:colorT===1?BLUE_COL:RED_COL}}/>
        <div style={{flex:1,display:'flex',alignItems:'center',gap:'.25rem',minWidth:0}}>
          {(()=>{const u=users?.find(x=>x.id===player.userId);const tier=getTierInfo(Number(playerStats[player.userId]?.total_runs||0)).current;return<><TierImg tierKey={tier.key} height={14}/><PlatoonTag tag={u?.platoonTag} color={u?.platoonBadgeColor||'var(--acc)'} style={{fontSize:'.72rem',fontWeight:500}}/></>;})()}
          <span style={{flex:1,minWidth:0,fontSize:'.88rem',color:'var(--txt)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{player.name||'—'}</span>
        </div>
        <span style={{fontSize:'.7rem',color:'var(--muted)',whiteSpace:'nowrap'}}>{vr>0?`${vr}r`:'new'}</span>
        <span style={{fontSize:'.7rem',color:'var(--muted)',whiteSpace:'nowrap',minWidth:26,textAlign:'right'}}>{avg}</span>
        <span style={{fontSize:'.7rem',color:'var(--muted)',whiteSpace:'nowrap',minWidth:28,textAlign:'right'}}>{obj}</span>
        <span style={{fontSize:'.7rem',color:'var(--muted)',whiteSpace:'nowrap',minWidth:28,textAlign:'right'}}>{coyW}</span>
        <span style={{fontSize:'.7rem',color:'var(--muted)',whiteSpace:'nowrap',minWidth:28,textAlign:'right',fontVariantNumeric:'tabular-nums'}}>{wl}</span>
        <button type="button"
          style={{minWidth:28,padding:'.2rem .4rem',borderRadius:4,fontSize:'.72rem',fontWeight:800,cursor:'pointer',flexShrink:0,marginLeft:'.35rem',
            border:`1px solid ${isHunter?'var(--acc)':'var(--warn)'}`,
            background:isHunter?'var(--accD)':'rgba(184,150,12,.15)',
            color:isHunter?'var(--accB)':'var(--warnL)'}}
          onClick={()=>setPlayerTeam(laneIdx,player.id,isHunter?2:1)}>
          {isHunter?'↓':'↑'}
        </button>
      </div>);
    };

    return(<div style={{display:'flex',flexDirection:'column',gap:'.75rem'}}>
      {/* Structure header */}
      <div style={{background:'var(--bg)',borderRadius:8,padding:'.6rem .85rem',textAlign:mirror?'right':'left'}}>
        <div style={{fontWeight:800,fontSize:'1.05rem',color:'var(--acc)',textTransform:'uppercase',letterSpacing:'.06em'}}>{laneStruct(laneIdx)}</div>
        <div style={{display:'flex',gap:'.4rem',marginTop:'.2rem',flexWrap:'wrap',alignItems:'center',flexDirection:mirror?'row-reverse':'row'}}>
          {rt&&<><span className={`badge b-${rt.mode}`}>{rt.mode}</span><span className={`badge b-${rt.style}`}>{rt.style}</span></>}
          <span style={{fontSize:'.78rem',color:'var(--muted)'}}>{bookerNames}</span>
        </div>
      </div>
      {/* Hunters / Coyotes sections */}
      {[[1,'var(--acc)','var(--accD)','var(--accB)','Hunters',hunterPlayers],[2,'var(--warn)','rgba(184,150,12,.15)','var(--warnL)','Coyotes',coyotePlayers]].map(([teamNum,bdr,bg,col,label,tPlayers])=>(
        <div key={teamNum} style={{background:'var(--bg2)',border:`1px solid ${bdr}`,borderRadius:8,padding:'.6rem .85rem'}}>
          <div style={{display:'flex',alignItems:'center',gap:'.5rem',marginBottom:'.5rem'}}>
            <span style={{fontWeight:800,fontSize:'.88rem',color:col,textTransform:'uppercase',letterSpacing:'.05em'}}>{label}</span>
            <span style={{flex:1}}/>
            <span style={{fontSize:'.72rem',color:'var(--muted)'}}>{tPlayers.length}p</span>
          </div>
          {tPlayers.length>0&&<div style={{fontSize:'.68rem',color:'var(--muted)',display:'flex',gap:'.35rem',paddingBottom:'.2rem',marginBottom:'.1rem',borderBottom:'1px solid rgba(255,255,255,.05)'}}>
            <span style={{width:6,flexShrink:0}}/>
            <span style={{flex:1}}>Player</span>
            <span>Runs</span>
            <span style={{minWidth:26,textAlign:'right'}}>Avg</span>
            <span style={{minWidth:28,textAlign:'right'}}>Obj%</span>
            <span style={{minWidth:28,textAlign:'right'}}>Coy W</span>
            <span style={{minWidth:28,textAlign:'right'}}>W-L</span>
            <span style={{minWidth:28,marginLeft:'.35rem'}}/>
          </div>}
          {tPlayers.length===0&&<div style={{fontSize:'.8rem',color:'var(--muted)',padding:'.2rem 0',textAlign:'center'}}>None assigned</div>}
          {tPlayers.map(p=>pRow(p))}
        </div>
      ))}
      {/* VS divider + Swap All */}
      <div style={{background:'var(--bg2)',border:'1px solid var(--bdr)',borderRadius:8,padding:'.5rem .85rem'}}>
        <div style={{display:'flex',alignItems:'center',gap:'.5rem'}}>
          <div style={{flex:1,textAlign:'center'}}>
            <div style={{fontSize:'.7rem',fontWeight:700,color:'var(--accB)',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:'.1rem'}}>Hunters</div>
            <div style={{fontSize:'.8rem',color:'var(--muted)'}}>{hunterPlayers.length}p{teamAvg(hunterPlayers,'versus')?` · avg ${teamAvg(hunterPlayers,'versus')}`:''}</div>
          </div>
          <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:'.3rem'}}>
            <img src="/vs.png" alt="VS" style={{width:44,height:44,filter:'drop-shadow(0 0 8px rgba(200,224,58,.6))',opacity:.9}}
              onError={e=>{e.target.style.display='none';e.target.nextSibling.style.display='block';}}/>
            <span style={{display:'none',fontWeight:900,fontSize:'1.4rem',color:'var(--acc)',letterSpacing:'.1em',fontStyle:'italic'}}>VS</span>
            <button type="button" style={{background:'none',border:'1px solid var(--bdr)',borderRadius:4,color:'var(--muted)',cursor:'pointer',fontSize:'.7rem',padding:'.15rem .45rem'}}
              onClick={swapAll}>⇅ Swap All</button>
          </div>
          <div style={{flex:1,textAlign:'center'}}>
            <div style={{fontSize:'.7rem',fontWeight:700,color:'var(--warnL)',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:'.1rem'}}>Coyotes</div>
            <div style={{fontSize:'.8rem',color:'var(--muted)'}}>{coyotePlayers.length}p{teamAvg(coyotePlayers,'versus')?` · avg ${teamAvg(coyotePlayers,'versus')}`:''}</div>
          </div>
        </div>
      </div>
      {/* Objective */}
      {renderObjSelect(laneIdx)}
      {/* Env Controls */}
      <div style={{background:'var(--bg2)',border:'1px solid var(--bdr)',borderRadius:8,padding:'.6rem .85rem',display:'flex',flexDirection:'column',gap:'.6rem'}}>
        {renderEnvControls(laneIdx)}
      </div>
      {/* Winner + Obj completed */}
      <div style={{background:'var(--bg2)',border:'1px solid var(--bdr)',borderRadius:8,padding:'.6rem .85rem',display:'flex',flexDirection:'column',gap:'.5rem'}}>
        <div>
          <div style={{fontSize:'.72rem',fontWeight:700,color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:'.35rem'}}>Run Winner</div>
          <div style={{display:'flex',gap:'.5rem'}}>
            {[1,2].map(t=>{
              const isBlue=t===blueTeamNum;const tCol=isBlue?BLUE_COL:RED_COL;const tBg=isBlue?BLUE_BG:RED_BG;
              const tRole=t===1?'Hunters':'Coyotes';const sel=s.winnerTeam===t;
              return(
                <button key={t} type="button" onClick={()=>setSetting(laneIdx,'winnerTeam',t)}
                  style={{flex:1,padding:'.5rem',borderRadius:8,fontWeight:sel?700:500,fontSize:'.85rem',
                    border:`2px solid ${sel?tCol:tCol+'66'}`,background:sel?tBg:tBg.replace('.15','.06'),
                    color:tCol,cursor:'pointer',textAlign:'center',lineHeight:1.3,
                    opacity:sel?1:.7}}>
                  <div style={{fontWeight:700}}>{isBlue?'Blue Team':'Red Team'}</div>
                  <div style={{fontSize:'.72rem',opacity:.8}}>{tRole}</div>
                </button>);
            })}
          </div>
        </div>
      </div>
      {/* Score row */}
      {!isScoredVs?(
        <div style={{display:'flex',alignItems:'center',gap:'.75rem',padding:'.5rem 0'}}>
          <div style={{textAlign:'center',flex:1}}>
            <div style={{fontSize:'.72rem',fontWeight:700,color:BLUE_COL,textTransform:'uppercase',letterSpacing:'.05em',marginBottom:'.1rem'}}>Blue Team</div>
            <div style={{fontSize:'.7rem',color:'var(--muted)',marginBottom:'.2rem'}}>{blueRole}</div>
            <div style={{fontSize:'1.5rem',fontWeight:800,color:BLUE_COL,fontVariantNumeric:'tabular-nums'}}>{blueScore}</div>
          </div>
          <button className="btn btn-p" disabled={!canScore||isSavingThis} style={{fontSize:'.9rem',padding:'.6rem 1.2rem',whiteSpace:'nowrap'}} onClick={()=>doScoreVersus(laneIdx)}>
            {isSavingThis?'Saving…':'SCORE RUN'}
          </button>
          <div style={{textAlign:'center',flex:1}}>
            <div style={{fontSize:'.72rem',fontWeight:700,color:RED_COL,textTransform:'uppercase',letterSpacing:'.05em',marginBottom:'.1rem'}}>Red Team</div>
            <div style={{fontSize:'.7rem',color:'var(--muted)',marginBottom:'.2rem'}}>{redRole}</div>
            <div style={{fontSize:'1.5rem',fontWeight:800,color:RED_COL,fontVariantNumeric:'tabular-nums'}}>{redScore}</div>
          </div>
        </div>
      ):(
        <div style={{display:'flex',gap:'.75rem',alignItems:'center',padding:'.5rem 0'}}>
          <div style={{textAlign:'center',flex:1}}>
            <div style={{fontSize:'.72rem',fontWeight:700,color:BLUE_COL,textTransform:'uppercase'}}>Blue Team</div>
            <div style={{fontSize:'.7rem',color:'var(--muted)',marginBottom:'.15rem'}}>{blueRole}</div>
            <div style={{fontSize:'1.5rem',fontWeight:800,color:BLUE_COL}}>{getScoredTeamScore(run,laneIdx,blueTeamNum)!=null?Number(getScoredTeamScore(run,laneIdx,blueTeamNum)).toFixed(1):'—'}</div>
          </div>
          <div style={{textAlign:'center',padding:'.4rem .75rem',background:'var(--accD)',borderRadius:6,color:'var(--accB)',fontWeight:700,fontSize:'.82rem'}}>✓ Scored</div>
          <div style={{textAlign:'center',flex:1}}>
            <div style={{fontSize:'.72rem',fontWeight:700,color:RED_COL,textTransform:'uppercase'}}>Red Team</div>
            <div style={{fontSize:'.7rem',color:'var(--muted)',marginBottom:'.15rem'}}>{redRole}</div>
            <div style={{fontSize:'1.5rem',fontWeight:800,color:RED_COL}}>{getScoredTeamScore(run,laneIdx,redTeamNum)!=null?Number(getScoredTeamScore(run,laneIdx,redTeamNum)).toFixed(1):'—'}</div>
          </div>
        </div>
      )}
    </div>);
  };

  const renderCoopCard=(laneIdx,mirror=false)=>{
    const lane=lanes[laneIdx];const s=settings[run][laneIdx];
    const rt=resTypes.find(x=>x.id===(lane.reservations[0]?.typeId));
    const bookerNames=[...new Set(lane.reservations.map(r=>r.customerName).filter(Boolean))].join(' · ');
    const allPlayers=lane.reservations.flatMap(r=>r.players||[]);
    const coopAvg=teamAvg(allPlayers);
    const score=calcCoopRunScore({visual:s.visual,audio:s.audio??null,cranked:s.cranked??false,targetsEliminated:s.targetsEliminated,objectiveComplete:s.objectiveComplete,liveOpDifficulty:s.difficulty??'MEDIUM'}).toFixed(1);
    const isSc=isLaneScored(laneIdx,null);const isSavingThis=saving===laneIdx;
    const canScore=s.objectiveId!=null&&laneFinish[laneIdx]!=null&&!isSc;
    const selDiff=DIFF_OPTIONS.find(d=>d.value===s.difficulty)||DIFF_OPTIONS[0];

    return(<div style={{display:'flex',flexDirection:'column',gap:'.75rem'}}>
      {/* Structure header */}
      <div style={{background:'var(--bg)',borderRadius:8,padding:'.6rem .85rem',textAlign:mirror?'right':'left'}}>
        <div style={{fontWeight:800,fontSize:'1.05rem',color:'var(--acc)',textTransform:'uppercase',letterSpacing:'.06em'}}>{laneStruct(laneIdx)}</div>
        <div style={{display:'flex',gap:'.4rem',marginTop:'.2rem',flexWrap:'wrap',alignItems:'center',flexDirection:mirror?'row-reverse':'row'}}>
          {rt&&<><span className={`badge b-${rt.mode}`}>{rt.mode}</span><span className={`badge b-${rt.style}`}>{rt.style}</span></>}
          <span style={{fontSize:'.78rem',color:'var(--muted)'}}>{bookerNames}</span>
        </div>
      </div>
      {/* Hunters (all players) */}
      <div style={{background:'var(--bg2)',border:'1px solid var(--bdr)',borderRadius:8,padding:'.6rem .85rem'}}>
        <div style={{display:'flex',alignItems:'center',gap:'.5rem',marginBottom:'.4rem'}}>
          <span style={{fontWeight:700,fontSize:'.82rem',color:'var(--acc)',textTransform:'uppercase',letterSpacing:'.05em'}}>Hunters</span>
          {coopAvg&&<span style={{fontSize:'.75rem',color:'var(--muted)'}}>team avg {coopAvg}</span>}
        </div>
        <div style={{fontSize:'.7rem',color:'var(--muted)',marginBottom:'.25rem',display:'flex',gap:'.5rem',paddingBottom:'.25rem',borderBottom:'1px solid rgba(255,255,255,.05)'}}>
          <span style={{flex:1}}>Player</span>
          <span style={{minWidth:28,textAlign:'right'}}>Coop</span>
          <span style={{minWidth:28,textAlign:'right'}}>Avg</span>
          <span style={{minWidth:30,textAlign:'right'}}>Tgt%</span>
          <span style={{minWidth:30,textAlign:'right'}}>Obj%</span>
          <span style={{minWidth:38,textAlign:'right'}}>Time</span>
        </div>
        {allPlayers.map(player=>{
          const st=playerStats[player.userId]||{};
          const cr=Number(st.coop_runs)||0;
          const avgS=cr>0?Number(st.coop_avg_score||0).toFixed(1):'—';
          const tgt=cr>0?Number(st.coop_targets_pct||0).toFixed(1)+'%':'—';
          const obj=cr>0?Number(st.coop_obj_pct||0).toFixed(1)+'%':'—';
          const secs=Number(st.coop_avg_seconds)||0;
          const timeS=cr>0&&secs>0?`${Math.floor(secs/60)}:${String(Math.round(secs%60)).padStart(2,'0')}`:'—';
          return(<div key={player.id} style={{display:'flex',alignItems:'center',gap:'.5rem',padding:'.3rem 0',borderBottom:'1px solid rgba(255,255,255,.05)'}}>
            <div style={{flex:1,display:'flex',alignItems:'center',gap:'.25rem',minWidth:0}}>
              {(()=>{const u=users?.find(x=>x.id===player.userId);const tier=getTierInfo(Number(playerStats[player.userId]?.total_runs||0)).current;return<><TierImg tierKey={tier.key} height={14}/><PlatoonTag tag={u?.platoonTag} color={u?.platoonBadgeColor||'var(--acc)'} style={{fontSize:'.75rem',fontWeight:500}}/></>;})()}
              <span style={{flex:1,fontSize:'.9rem',color:'var(--txt)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{player.name||'—'}</span>
            </div>
            <span style={{fontSize:'.72rem',color:'var(--muted)',whiteSpace:'nowrap',minWidth:28,textAlign:'right'}}>{cr>0?`${cr}r`:'new'}</span>
            <span style={{fontSize:'.72rem',color:'var(--muted)',minWidth:28,textAlign:'right'}}>{avgS}</span>
            <span style={{fontSize:'.72rem',color:'var(--muted)',minWidth:30,textAlign:'right'}}>{tgt}</span>
            <span style={{fontSize:'.72rem',color:'var(--muted)',minWidth:30,textAlign:'right'}}>{obj}</span>
            <span style={{fontSize:'.72rem',color:'var(--muted)',minWidth:38,textAlign:'right',fontVariantNumeric:'tabular-nums'}}>{timeS}</span>
          </div>);})}
      </div>
      {/* Live Op Difficulty */}
      <div style={{background:'var(--bg2)',border:'1px solid var(--bdr)',borderRadius:8,padding:'.6rem .85rem'}}>
        <div style={{fontSize:'.72rem',fontWeight:700,color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:'.3rem',textAlign:'center'}}>Live Op Difficulty</div>
        <div style={{textAlign:'center',marginBottom:'.25rem'}}>
          <span style={{fontWeight:800,fontSize:'1rem',color:'var(--acc)',textTransform:'uppercase',letterSpacing:'.05em'}}>{selDiff.label}</span>
        </div>
        <input type="range" min={0} max={DIFF_OPTIONS.length-1}
          value={DIFF_OPTIONS.findIndex(d=>d.value===s.difficulty)}
          onChange={e=>setSetting(laneIdx,'difficulty',DIFF_OPTIONS[+e.target.value].value)}
          style={{width:'100%',accentColor:'var(--acc)',cursor:'pointer',margin:'.1rem 0'}}/>
        <div style={{position:'relative',height:'1rem',marginBottom:'.35rem'}}>
          {DIFF_OPTIONS.map((d,i)=>{
            const pct=i/(DIFF_OPTIONS.length-1)*100;
            const xform=i===0?'none':i===DIFF_OPTIONS.length-1?'translateX(-100%)':'translateX(-50%)';
            return(<span key={d.value} style={{position:'absolute',left:`${pct}%`,transform:xform,fontSize:'.62rem',color:'var(--muted)',whiteSpace:'nowrap'}}>{d.label}</span>);
          })}
        </div>
        <div style={{fontSize:'.78rem',color:'var(--muted)',lineHeight:1.5,fontStyle:'italic',textAlign:'center'}}>{selDiff.desc}</div>
      </div>
      {/* Objective */}
      {renderObjSelect(laneIdx)}
      {/* Env controls */}
      <div style={{background:'var(--bg2)',border:'1px solid var(--bdr)',borderRadius:8,padding:'.6rem .85rem',display:'flex',flexDirection:'column',gap:'.6rem'}}>
        {renderEnvControls(laneIdx)}
      </div>
      {/* Outcome toggles */}
      <div style={{background:'var(--bg2)',border:'1px solid var(--bdr)',borderRadius:8,padding:'.6rem .85rem'}}>
        <div style={{display:'flex',gap:'.5rem'}}>
          <button type="button" onClick={()=>setSetting(laneIdx,'targetsEliminated',!s.targetsEliminated)}
            style={{flex:1,padding:'.5rem .4rem',borderRadius:8,fontSize:'.82rem',textAlign:'center',lineHeight:1.3,cursor:'pointer',
              border:`2px solid ${s.targetsEliminated?'var(--acc)':'var(--bdr)'}`,
              background:s.targetsEliminated?'var(--accD)':'var(--bg)',
              color:s.targetsEliminated?'var(--accB)':'var(--muted)',
              fontWeight:s.targetsEliminated?700:400}}>
            {s.targetsEliminated?'✓ ':''}Targets Elim
          </button>
          <button type="button" onClick={()=>setSetting(laneIdx,'objectiveComplete',!s.objectiveComplete)}
            style={{flex:1,padding:'.5rem .4rem',borderRadius:8,fontSize:'.82rem',textAlign:'center',lineHeight:1.3,cursor:'pointer',
              border:`2px solid ${s.objectiveComplete?'var(--acc)':'var(--bdr)'}`,
              background:s.objectiveComplete?'var(--accD)':'var(--bg)',
              color:s.objectiveComplete?'var(--accB)':'var(--muted)',
              fontWeight:s.objectiveComplete?700:400}}>
            {s.objectiveComplete?'✓ ':''}Obj Complete
          </button>
        </div>
      </div>
      {/* Score button */}
      {!isSc?(
        <div style={{textAlign:'center',padding:'.5rem 0'}}>
          <div style={{fontSize:'2rem',fontWeight:800,color:'var(--acc)',fontVariantNumeric:'tabular-nums',marginBottom:'.4rem'}}>{score}</div>
          <button className="btn btn-p" disabled={!canScore||isSavingThis} style={{fontSize:'1rem',padding:'.65rem 2rem'}} onClick={()=>doScoreCoop(laneIdx)}>
            {isSavingThis?'Saving…':'SCORE RUN'}
          </button>
        </div>
      ):(
        <div style={{textAlign:'center',padding:'.5rem 0'}}>
          <div style={{fontSize:'2rem',fontWeight:800,color:'var(--acc)',fontVariantNumeric:'tabular-nums'}}>{getScoredTeamScore(run,laneIdx,null)!=null?Number(getScoredTeamScore(run,laneIdx,null)).toFixed(1):'—'}</div>
          <div style={{fontSize:'.82rem',color:'var(--accB)',background:'var(--accD)',borderRadius:6,display:'inline-block',padding:'.3rem .75rem',marginTop:'.3rem',fontWeight:700}}>✓ Scored</div>
        </div>
      )}
    </div>);
  };

  const renderLaneCard=(laneIdx,mirror=false)=>{
    const lane=lanes[laneIdx];if(!lane)return null;
    if(lane.mode?.toLowerCase()==='versus')return renderVersusCard(laneIdx,mirror);
    return renderCoopCard(laneIdx,mirror);
  };

  // Commit summary — grouped by lane
  const buildLaneSummary=()=>lanes.map((lane,li)=>{
    const rt=resTypes.find(x=>x.id===(lane.reservations[0]?.typeId));
    const mode=rt?.mode||'coop';
    const allPlayers=lane.reservations.flatMap(r=>r.players||[]);
    const getLT=pid=>{
      const rt1=runTeams[1]?.[li];if(rt1?.[pid]!=null)return rt1[pid];
      for(const r of lane.reservations){const v=versusTeams?.[r.id]?.[pid];if(v!=null)return v;}
      const pObj=allPlayers.find(p=>p.id===pid);if(pObj?.team!=null)return pObj.team;
      return allPlayers.findIndex(p=>p.id===pid)<Math.ceil(allPlayers.length/2)?1:2;
    };
    const t1Pl=allPlayers.filter(p=>getLT(p.id)===1);
    const t2Pl=allPlayers.filter(p=>getLT(p.id)===2);
    const runs=[1,2].map(runNum=>{
      const sRec=scored[laneKey(runNum,li,1)]||scored[laneKey(runNum,li,2)]||scored[laneKey(runNum,li,null)];
      const sName=sRec?.structure||laneStruct(li);
      const elapsedSec=scored[laneKey(runNum,li,1)]?.elapsedSeconds??scored[laneKey(runNum,li,null)]?.elapsedSeconds??null;
      if(mode==='versus'){
        // Blue=team:1 always, Red=team:2 always (stable original teams)
        const blueScore=getScoredTeamScore(runNum,li,1);
        const redScore =getScoredTeamScore(runNum,li,2);
        const blueRec=scored[laneKey(runNum,li,1)],redRec=scored[laneKey(runNum,li,2)];
        const blueRole=blueRec?.role?(blueRec.role.charAt(0).toUpperCase()+blueRec.role.slice(1)+'s'):(runNum===1?'Hunters':'Coyotes');
        const redRole=redRec?.role?(redRec.role.charAt(0).toUpperCase()+redRec.role.slice(1)+'s'):(runNum===1?'Coyotes':'Hunters');
        const wt=blueRec?.winningTeam??redRec?.winningTeam??null;
        const blueWon=wt!=null&&wt===1,redWon=wt!=null&&wt===2;
        const bPl=t1Pl,rPl=t2Pl; // players never change — Blue=T1, Red=T2 always
        const hunterIsBlue=runNum===1; // Hunter on left; run 1→Blue left, run 2→Red left
        return{runNum,struct:sName,elapsedSec,mode:'versus',blueScore,redScore,blueRole,redRole,blueWon,redWon,bluePlayers:bPl,redPlayers:rPl,hunterIsBlue};
      }else{
        const sc=getScoredTeamScore(runNum,li,null);
        return{runNum,struct:sName,elapsedSec,mode:'coop',sc,players:allPlayers};
      }
    });
    // Per-lane war outcome
    const laneWar=(()=>{
      if(mode!=='versus')return null;
      const r1Blue=scored[laneKey(1,li,1)],r2Red=scored[laneKey(2,li,2)];
      const run1Win=r1Blue?.winningTeam??scored[laneKey(1,li,2)]?.winningTeam??null;
      const run2Win=r2Red?.winningTeam??scored[laneKey(2,li,1)]?.winningTeam??null;
      const result=calcWarOutcome({run1WinnerTeam:run1Win,run2WinnerTeam:run2Win,group1HunterElapsed:r1Blue?.elapsedSeconds??null,group2HunterElapsed:r2Red?.elapsedSeconds??null});
      return result?{winner:result.warWinner,winType:result.warWinType,timeDiff:result.timeDiff??null}:null;
    })();
    return{li,mode,typeName:rt?.name||'',runs,laneWar};
  });

  const reqFS=()=>{if(!document.fullscreenElement)document.documentElement.requestFullscreen().catch(()=>{});};
  return(
    <div onClick={reqFS} style={{position:'fixed',inset:0,background:'var(--bg)',zIndex:10000,display:'flex',flexDirection:'column',overflow:'hidden'}}>
      {showExit&&<ScoringExitGuard onStay={()=>setShowExit(false)} onLeave={onClose}/>}
      {/* Header bar */}
      <div style={{background:'var(--surf)',borderBottom:'2px solid var(--bdr)',padding:'.75rem 1.2rem',display:'grid',gridTemplateColumns:'1fr auto 1fr',alignItems:'center',gap:'1rem',flexShrink:0}}>
        {/* Left: title + run tabs */}
        <div style={{display:'flex',alignItems:'center',gap:'.75rem',flexWrap:'wrap'}}>
          <div style={{fontWeight:800,fontSize:'1.2rem',color:'var(--acc)',letterSpacing:'.06em',textTransform:'uppercase'}}>Scoring Table</div>
          <div style={{display:'flex',gap:'.4rem'}}>
            {[1,2].map(r=>(
              <span key={r}
                style={{padding:'.4rem 1rem',borderRadius:20,fontWeight:run===r?800:500,fontSize:'.88rem',
                  border:`2px solid ${run===r?'var(--acc)':'var(--bdr)'}`,background:run===r?'var(--accD)':'var(--bg2)',
                  color:run===r?'var(--accB)':'var(--muted)'}}>
                Run {r}
              </span>))}
          </div>
        </div>
        {/* Center: master clock */}
        <div style={{display:'flex',alignItems:'center',gap:'.6rem',justifyContent:'center'}}>
          <div style={{fontFamily:'monospace',fontSize:'1.6rem',fontWeight:800,color:masterRunning?'var(--ok)':'var(--txt)',letterSpacing:'.04em',fontVariantNumeric:'tabular-nums'}}>
            {fmtTenths(masterTenths)}
          </div>
          <button className={masterRunning||masterTenths>0?'btn btn-warn':'btn btn-p'} style={{fontSize:'.9rem',padding:'.45rem 1rem'}}
            onClick={()=>{
              if(masterRunning||masterTenths>0){
                if(masterRunning)setMasterRunning(false);
                else{setMasterTenths(0);setLaneFinish({});}
              }else setMasterRunning(true);
            }}>
            {masterRunning?'RESET':masterTenths>0?'RESET':'START'}
          </button>
        </div>
        {/* Right: close */}
        <div style={{display:'flex',justifyContent:'flex-end'}}>
          <button style={{background:'none',border:'1px solid var(--bdr)',borderRadius:6,color:'var(--muted)',cursor:'pointer',padding:'.4rem .75rem',fontSize:'1.1rem'}} onClick={tryClose}>✕</button>
        </div>
      </div>
      {/* Swap structures */}
      <div style={{padding:'.5rem 1.2rem',background:'var(--surf)',borderBottom:'1px solid var(--bdr)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
        <button className="btn btn-s" style={{fontSize:'.82rem',padding:'.35rem .9rem'}} onClick={()=>{const newOrder=[structOrder[1],structOrder[0]];setStructOrder(()=>newOrder);activateStructures(null,null,newOrder,true);}}>⇄ Swap Structures</button>
      </div>
      {/* Lane cards — Alpha always left, Bravo always right */}
      <div style={{flex:1,overflowY:'auto',padding:'1rem 1.2rem'}}>
        {(()=>{
          const aIdx=structOrder.indexOf('Alpha');
          const bIdx=structOrder.indexOf('Bravo');
          const displayOrder=[aIdx,bIdx].filter(i=>i>=0&&i<lanes.length);
          lanes.forEach((_,i)=>{if(!displayOrder.includes(i))displayOrder.push(i);});
          return(
            <div style={{display:'flex',gap:'1rem',alignItems:'flex-start'}}>
              {displayOrder.map((li,pos)=>(
                <div key={li} style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',gap:'.6rem'}}>
                  {renderFinishPanel(li)}
                  {renderLaneCard(li,pos===1)}
                </div>
              ))}
            </div>
          );
        })()}
      </div>
      {/* Bottom actions */}
      <div style={{background:'var(--surf)',borderTop:'2px solid var(--bdr)',padding:'.75rem 1.2rem',display:'flex',justifyContent:'center',gap:'1rem',flexShrink:0}}>
        {run===1&&bothLanesScored(1)&&!bothLanesScored(2)&&(
          <button className="btn btn-p" style={{fontSize:'1rem',padding:'.65rem 2rem'}} onClick={doLogRun}>Log Run 1 → Run 2</button>
        )}
        {allRunsScored&&(
          <button className="btn btn-p" style={{fontSize:'1rem',padding:'.65rem 2rem'}} onClick={()=>setShowCommit(true)}>Commit Scores</button>
        )}
      </div>
      {showCommit&&<ScoringCommitModal laneSummary={buildLaneSummary()} onCancel={()=>setShowCommit(false)} onCommit={doCommit}/>}
      {timePicker&&<ScoringTimePicker timePicker={timePicker} setTimePicker={setTimePicker} setLaneFinish={setLaneFinish}/>}
    </div>
  );
}

function LaneOverrideModal({time,rawLanes,laneOverrides,versusTeams,resTypes,reservations,allowCrossMode=false,onSave,onClose}){
  const [pending,setPending]=useState({...laneOverrides});
  const [pendingTeams,setPendingTeams]=useState({...versusTeams});
  const [pendingScoredRes,setPendingScoredRes]=useState(()=>{
    const init={};
    for(const lane of rawLanes){for(const res of lane.reservations){for(const pl of (res.players||[])){if(pl.scoredReservationId)init[pl.id]=pl.scoredReservationId;}}}
    return init;
  });
  const [modSaving,setModSaving]=useState(false);
  const [modeConfirm,setModeConfirm]=useState(null); // mixed-mode lanes awaiting confirmation
  const lanes=applyLaneOverrides(rawLanes,pending,resTypes);
  const activeLanes=lanes.filter(l=>l.type!==null);
  const allLanes=lanes;
  const allPlayers=rawLanes.flatMap(l=>l.reservations.flatMap(r=>r.players||[]));

  const doActualSave=async()=>{
    setModSaving(true);
    try{
      const updates=[];
      for(const pl of allPlayers){
        const next=pendingScoredRes[pl.id]??null;
        const prev=pl.scoredReservationId??null;
        if(next!==prev)updates.push(updateReservationPlayer(pl.id,{scoredReservationId:next}));
      }
      for(const [,playerTeams] of Object.entries(pendingTeams)){
        for(const [pid,team] of Object.entries(playerTeams)){
          const pl=allPlayers.find(p=>p.id===pid);
          if(pl&&team!==pl.team)updates.push(updateReservationPlayer(pid,{team}));
        }
      }
      await Promise.all(updates);
      onSave(pending,pendingTeams);
    }catch(e){alert('Error saving: '+e.message);}
    finally{setModSaving(false);}
  };

  const handleSave=async()=>{
    // Check for lanes with mixed coop/versus reservations
    const mixedLanes=lanes.filter(lane=>{
      if(!lane.reservations.length)return false;
      const modes=new Set(lane.reservations.map(r=>resTypes.find(rt=>rt.id===r.typeId)?.mode).filter(Boolean));
      return modes.size>1;
    });
    if(mixedLanes.length>0){setModeConfirm(mixedLanes);return;}
    await doActualSave();
  };

  const handleModeConfirm=async(selectedMode)=>{
    setModSaving(true);
    try{
      const resUpdates=[];
      for(const lane of modeConfirm){
        for(const res of lane.reservations){
          const rt=resTypes.find(x=>x.id===res.typeId);
          if(rt&&rt.mode!==selectedMode){
            const targetRt=resTypes.find(x=>x.mode===selectedMode&&x.style===rt.style);
            if(targetRt)resUpdates.push(updateReservation(res.id,{typeId:targetRt.id}));
          }
        }
      }
      await Promise.all(resUpdates);
      setModeConfirm(null);
      const playerUpdates=[];
      for(const pl of allPlayers){
        const next=pendingScoredRes[pl.id]??null;
        const prev=pl.scoredReservationId??null;
        if(next!==prev)playerUpdates.push(updateReservationPlayer(pl.id,{scoredReservationId:next}));
      }
      for(const [,playerTeams] of Object.entries(pendingTeams)){
        for(const [pid,team] of Object.entries(playerTeams)){
          const pl=allPlayers.find(p=>p.id===pid);
          if(pl&&team!==pl.team)playerUpdates.push(updateReservationPlayer(pid,{team}));
        }
      }
      await Promise.all(playerUpdates);
      onSave(pending,pendingTeams);
    }catch(e){alert('Error saving: '+e.message);setModSaving(false);}
  };

  const moveRes=(resId,toLaneNum)=>setPending(p=>({...p,[resId]:toLaneNum}));

  const getTeam=(resId,pid)=>{
    if(pendingTeams[resId]?.[pid]!==undefined)return pendingTeams[resId][pid];
    const res=reservations.find(r=>r.id===resId);
    if(res){const slotReses=reservations.filter(r=>r.date===res.date&&r.startTime===res.startTime&&r.status!=='cancelled');return calcResVsTeams(slotReses)[resId]??1;}
    return 1;
  };
  const toggleTeam=(resId,pid)=>{
    const cur=getTeam(resId,pid);
    setPendingTeams(p=>({...p,[resId]:{...(p[resId]||{}),[pid]:cur===1?2:1}}));
  };
  const setAllTeam=(resId,players,team)=>{
    const batch={};(players||[]).forEach(pl=>{batch[pl.id]=team;});
    setPendingTeams(p=>({...p,[resId]:{...(p[resId]||{}),...batch}}));
  };

  const fmt12=t=>{if(!t)return"";const[h,m]=t.split(":");const hr=+h;return`${hr>12?hr-12:hr===0?12:hr}:${m} ${hr>=12?"PM":"AM"}`;};

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.72)",zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:"1.5rem"}} onClick={onClose}>
      <div style={{background:"var(--surf)",border:"1px solid var(--bdr)",borderRadius:12,width:"100%",maxWidth:900,maxHeight:"90vh",display:"flex",flexDirection:"column",overflow:"hidden"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"1rem 1.25rem",borderBottom:"1px solid var(--bdr)",flexShrink:0}}>
          <div style={{fontWeight:700,fontSize:"1.05rem",color:"var(--txt)"}}>⇄ Arrange Lanes · {fmt12(time)}</div>
          <button style={{background:"none",border:"none",color:"var(--muted)",fontSize:"1.4rem",cursor:"pointer",lineHeight:1,padding:".2rem .5rem"}} onClick={onClose}>×</button>
        </div>
        <div style={{overflowY:"auto",padding:"1rem 1.25rem",flex:1}}>
          <div style={{display:"flex",gap:"1rem",alignItems:"flex-start"}}>
            {allLanes.map(lane=>{
              return(
                <div key={lane.laneNum} style={{flex:1,minWidth:0,background:"var(--bg)",border:"1px solid var(--bdr)",borderRadius:8,padding:".75rem"}}>
                  <div style={{fontWeight:700,fontSize:".75rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:".6rem",display:"flex",alignItems:"center",gap:".4rem"}}>
                    Lane {lane.laneNum}
                    {lane.mode&&<span className={`badge b-${lane.mode}`}>{lane.mode}</span>}
                    {lane.type&&<span className={`badge b-${lane.type}`}>{lane.type}</span>}
                  </div>
                  {lane.reservations.length===0&&<div style={{fontSize:".8rem",color:"var(--muted)",fontStyle:"italic",padding:".3rem 0"}}>Empty</div>}
                  {lane.reservations.map(res=>{
                    const rt=resTypes.find(x=>x.id===res.typeId);
                    const players=res.players||[];
                    const isVs=lane.mode==="versus";
                    const resMoveTargets=allowCrossMode
                      ?activeLanes.filter(l=>l.laneNum!==lane.laneNum).concat(allLanes.filter(l=>l.type===null&&l.laneNum!==lane.laneNum))
                      :activeLanes.filter(l=>l.laneNum!==lane.laneNum&&l.mode===rt?.mode).concat(allLanes.filter(l=>l.type===null&&l.laneNum!==lane.laneNum));
                    return(
                      <div key={res.id} style={{background:"var(--bg2)",border:"1px solid var(--bdr)",borderRadius:6,padding:".55rem .65rem",marginBottom:".5rem"}}>
                        <div style={{display:"flex",alignItems:"center",gap:".4rem",marginBottom:".35rem",flexWrap:"wrap"}}>
                          <span style={{fontWeight:700,fontSize:".88rem",color:"var(--txt)",flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{res.customerName}</span>
                          <span style={{fontSize:".75rem",color:"var(--muted)"}}>👥{res.playerCount}</span>
                          {resMoveTargets.map(tgt=>(
                            <button key={tgt.laneNum} className="btn btn-s" style={{fontSize:".7rem",padding:".18rem .5rem",whiteSpace:"nowrap"}} onClick={()=>moveRes(res.id,tgt.laneNum)}>{tgt.laneNum<lane.laneNum?'←':'→'} L{tgt.laneNum}</button>
                          ))}
                        </div>
                        {isVs&&players.length>0&&(()=>{
                          const t1=players.filter(p=>getTeam(res.id,p.id)===1);
                          const t2=players.filter(p=>getTeam(res.id,p.id)===2);
                          return(
                            <div style={{display:"flex",gap:".4rem"}}>
                              {[{num:1,label:"Team 1",list:t1},{num:2,label:"Team 2",list:t2}].map(({num,label,list})=>(
                                <div key={num} style={{flex:1,background:"var(--surf)",border:"1px solid var(--bdr)",borderRadius:5,padding:".35rem .45rem"}}>
                                  <div style={{display:"flex",alignItems:"center",gap:".3rem",marginBottom:".25rem"}}>
                                    <span style={{fontWeight:700,fontSize:".68rem",color:"var(--muted)",textTransform:"uppercase",flex:1}}>{label}</span>
                                    <button style={{fontSize:".65rem",padding:".1rem .35rem",border:"1px solid var(--bdr)",borderRadius:4,background:"none",color:"var(--muted)",cursor:"pointer"}} onClick={()=>setAllTeam(res.id,players,num)}>All</button>
                                  </div>
                                  {list.length===0&&<div style={{fontSize:".75rem",color:"var(--muted)"}}>—</div>}
                                  {list.map(pl=>(
                                    <div key={pl.id} style={{display:"flex",alignItems:"center",gap:".3rem",padding:".2rem 0"}}>
                                      <span style={{flex:1,fontSize:".8rem",color:"var(--txt)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{pl.name}</span>
                                      <button style={{fontSize:".65rem",padding:".1rem .35rem",border:`1px solid ${num===1?"var(--acc)":"var(--warn)"}`,borderRadius:4,background:"none",color:num===1?"var(--accB)":"var(--warnL)",cursor:"pointer"}} onClick={()=>toggleTeam(res.id,pl.id)}>{num===1?"↓T2":"↑T1"}</button>
                                    </div>
                                  ))}
                                </div>
                              ))}
                            </div>
                          );
                        })()}
                        {!isVs&&players.length>0&&(
                          <div style={{display:"flex",flexDirection:"column",gap:".2rem",marginTop:".3rem"}}>
                            {players.map(pl=>{
                              const override=pendingScoredRes[pl.id]??null;
                              const overrideLane=override?allLanes.find(l=>l.reservations.some(r=>r.id===override)):null;
                              const otherLanes=allLanes.filter(l=>l.laneNum!==lane.laneNum&&l.reservations.length>0);
                              return(
                                <div key={pl.id} style={{display:"flex",alignItems:"center",gap:".3rem",padding:".2rem .3rem",background:override?"var(--surf)":"transparent",borderRadius:4,border:override?"1px solid var(--warn)":"1px solid transparent"}}>
                                  <span style={{flex:1,fontSize:".8rem",color:"var(--txt)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{pl.name}</span>
                                  {override&&<span style={{fontSize:".65rem",color:"var(--warnL)",fontWeight:600,whiteSpace:"nowrap"}}>{(overrideLane?.laneNum??lane.laneNum+1)<lane.laneNum?'←':'→'}L{overrideLane?.laneNum??'?'}</span>}
                                  {otherLanes.map(ol=>(
                                    <button key={ol.laneNum} style={{fontSize:".65rem",padding:".1rem .35rem",border:"1px solid var(--bdr)",borderRadius:4,background:"none",color:"var(--muted)",cursor:"pointer",whiteSpace:"nowrap"}}
                                      onClick={()=>setPendingScoredRes(p=>({...p,[pl.id]:ol.reservations[0].id}))}>{ol.laneNum<lane.laneNum?'←':'→'}L{ol.laneNum}</button>
                                  ))}
                                  {override&&<button style={{fontSize:".65rem",padding:".1rem .35rem",border:"1px solid var(--bdr)",borderRadius:4,background:"none",color:"var(--danger)",cursor:"pointer"}}
                                    onClick={()=>setPendingScoredRes(p=>{const n={...p};delete n[pl.id];return n;})}>✕</button>}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
        <div style={{display:"flex",justifyContent:"flex-end",gap:".65rem",padding:".85rem 1.25rem",borderTop:"1px solid var(--bdr)",flexShrink:0}}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-p" disabled={modSaving} onClick={handleSave}>{modSaving?'Saving…':'Save Changes'}</button>
        </div>
      </div>
      {/* Mode confirmation overlay */}
      {modeConfirm&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.8)",zIndex:3100,display:"flex",alignItems:"center",justifyContent:"center",padding:"1.5rem"}}>
          <div style={{background:"var(--surf)",border:"1px solid var(--bdr)",borderRadius:12,maxWidth:420,width:"100%",padding:"1.5rem 1.75rem"}}>
            <div style={{fontWeight:700,fontSize:"1rem",color:"var(--txt)",marginBottom:".65rem"}}>🎮 Confirm Session Mode</div>
            <div style={{fontSize:".85rem",color:"var(--muted)",lineHeight:1.6,marginBottom:".5rem"}}>
              {modeConfirm.map(l=>`Lane ${l.laneNum}`).join(' and ')} {modeConfirm.length===1?'has':'have'} mixed Co-op and Versus reservations.
            </div>
            <div style={{fontSize:".85rem",color:"var(--txt)",lineHeight:1.6,marginBottom:"1.25rem"}}>
              Select the mode to run — any conflicting reservations will be updated to match (e.g. Co-op Open → Versus Open).
            </div>
            <div style={{display:"flex",gap:".65rem"}}>
              <button className="btn btn-s" style={{flex:1,fontSize:".88rem"}} disabled={modSaving} onClick={()=>handleModeConfirm('coop')}>🤝 Co-op</button>
              <button className="btn btn-s" style={{flex:1,fontSize:".88rem"}} disabled={modSaving} onClick={()=>handleModeConfirm('versus')}>⚔ Versus</button>
            </div>
            {!modSaving&&<button className="btn" style={{width:"100%",marginTop:".65rem",fontSize:".82rem"}} onClick={()=>setModeConfirm(null)}>← Back to Arrangement</button>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function OpsView({reservations,setReservations,resTypes,sessionTemplates,users,setUsers,activeWaiverDoc,currentUser,setPayments}){
  const [expandedSlot,setExpandedSlot]=useState(null);
  const [expandedRes,setExpandedRes]=useState({});
  const [signingFor,setSigningFor]=useState(null);
  const [signedName,setSignedName]=useState("");
  const [signedNow,setSignedNow]=useState(()=>new Set()); // userIds signed this OpsView session
  const [addingTo,setAddingTo]=useState(null);
  const [addingToTeam,setAddingToTeam]=useState(null);
  const [versusTeams,setVersusTeams]=useState(()=>{
    // Group versus reservations by (date|startTime) and compute per-reservation default
    // team via calcResVsTeams, exactly the same logic used by the ops-card and scoring
    // table fallbacks.  The old idx<6?1:2 heuristic put every player on team 1 because
    // idx resets to 0 for each reservation — causing all reservations to land on team 1.
    const vsSlotMap={};
    for(const res of reservations){
      if(res.status==='cancelled')continue;
      const rt=resTypes.find(x=>x.id===res.typeId);
      if(rt?.mode!=='versus')continue;
      const key=`${res.date}|${res.startTime}`;
      if(!vsSlotMap[key])vsSlotMap[key]=[];
      vsSlotMap[key].push(res);
    }
    const resDefaultTeam={};
    for(const group of Object.values(vsSlotMap)){
      const tm=calcResVsTeams(group);
      Object.entries(tm).forEach(([id,team])=>{resDefaultTeam[id]=team;});
    }
    const init={};
    for(const res of reservations){
      const players=res.players||[];
      const defaultTeam=resDefaultTeam[res.id]??1;
      players.forEach(player=>{
        if(!init[res.id])init[res.id]={};
        init[res.id][player.id]=player.team!=null?player.team:defaultTeam;
      });
    }
    return init;
  });
  const [laneOverrides,setLaneOverrides]=useState(()=>{try{const s=localStorage.getItem('s317_lanes_'+todayStr());return s?JSON.parse(s):{};}catch{return{};}});
  const [showLaneOverride,setShowLaneOverride]=useState(null);
  const [laneArrangeWarn,setLaneArrangeWarn]=useState(null);
  const [flipConfirm,setFlipConfirm]=useState(null); // {time,laneNum,targetMode,lane}
  const [flipBusy,setFlipBusy]=useState(false);
  const [addInput,setAddInput]=useState({phone:"",lookupStatus:"idle",foundUserId:null,name:""});
  const [wiStep,setWiStep]=useState("details");
  const [sendConfirm,setSendConfirm]=useState(null);
  const [statusBusy,setStatusBusy]=useState(null);
  const [clock,setClock]=useState(new Date());
  const [showWI,setShowWI]=useState(null);
  const [wi,setWi]=useState({phone:"",lookupStatus:"idle",foundUserId:null,customerName:"",typeId:"",playerCount:1,customTime:"",date:"",extraSlots:[],addSecondLane:false,splitA:0});
  const [wiSaving,setWiSaving]=useState(false);
  const [wiNewResIds,setWiNewResIds]=useState([]);
  const [wiCardLast4,setWiCardLast4]=useState('');
  const [wiCardExpiry,setWiCardExpiry]=useState('');
  const [wiCardHolder,setWiCardHolder]=useState('');
  const handleWiCardExpiry=e=>{const d=e.target.value.replace(/\D/g,'').slice(0,4);setWiCardExpiry(d.length>2?d.slice(0,2)+'/'+d.slice(2):d);};
  const [wiAddInput,setWiAddInput]=useState({phone:"",lookupStatus:"idle",foundUserId:null,name:""});
  const [toast,setToast]=useState(null);
  const [showMerch,setShowMerch]=useState(false);
  const [showHistory,setShowHistory]=useState(false);
  const [scoringSlot,setScoringSlot]=useState(null);
  const [completedRunsCache,setCompletedRunsCache]=useState({});
  const [viewDate,setViewDate]=useState(todayStr());
  useEffect(()=>{try{const s=localStorage.getItem('s317_lanes_'+viewDate);setLaneOverrides(s?JSON.parse(s):{});}catch{setLaneOverrides({});}},[viewDate]);
  const dateInputRef=useRef(null);
  const wiPhoneRef=useRef(null);
  const activeWorkRef=useRef(false);
  useEffect(()=>{const t=setInterval(()=>setClock(new Date()),30000);return()=>clearInterval(t);},[]);
  useEffect(()=>{const t=setInterval(async()=>{if(activeWorkRef.current)return;try{const fresh=await fetchReservations();setReservations(fresh);}catch(e){}},5*60*1000);return()=>clearInterval(t);},[]);
  const [isFullscreen,setIsFullscreen]=useState(()=>!!document.fullscreenElement);
  useEffect(()=>{const h=()=>setIsFullscreen(!!document.fullscreenElement);document.addEventListener('fullscreenchange',h);return()=>document.removeEventListener('fullscreenchange',h);},[]);
  useEffect(()=>()=>{if(document.fullscreenElement)document.exitFullscreen?.();},[]);
  const showMsg=msg=>{setToast(msg);setTimeout(()=>setToast(null),3000);};
  const today=todayStr();
  const getType=useCallback(id=>resTypes.find(t=>t.id===id),[resTypes]);
  const todayRes=useMemo(()=>reservations.filter(r=>r.date===viewDate&&r.status!=="cancelled"),[reservations,viewDate]);
  useEffect(()=>{
    if(!expandedSlot)return;
    if(completedRunsCache[expandedSlot]!==undefined)return;
    const slotRes=todayRes.filter(r=>r.startTime===expandedSlot);
    const allDone=slotRes.length>0&&slotRes.every(r=>r.status==='completed'||r.status==='no-show');
    if(!allDone)return;
    const ids=slotRes.filter(r=>r.status==='completed').map(r=>r.id);
    if(!ids.length){setCompletedRunsCache(prev=>({...prev,[expandedSlot]:[]}));return;}
    setCompletedRunsCache(prev=>({...prev,[expandedSlot]:null}));
    fetchRunsForReservations(ids).then(runs=>setCompletedRunsCache(prev=>({...prev,[expandedSlot]:runs}))).catch(()=>setCompletedRunsCache(prev=>({...prev,[expandedSlot]:[]})));
  },[expandedSlot,todayRes,completedRunsCache]);
  const todayTmpls=useMemo(()=>sessionTemplates.filter(t=>t.active&&t.dayOfWeek===getDayName(viewDate)),[sessionTemplates,viewDate]);
  const slotTimes=useMemo(()=>[...new Set([...todayTmpls.map(t=>t.startTime),...todayRes.map(r=>r.startTime)])].sort(),[todayTmpls,todayRes]);
  const slotIsHistory=useCallback(time=>{const[h,m]=time.split(':').map(Number);return clock.getHours()*60+clock.getMinutes()>=h*60+m+75;},[clock]);
  const slotIsHistoryForView=useCallback(time=>{if(viewDate<today)return true;if(viewDate>today)return false;return slotIsHistory(time);},[viewDate,today,slotIsHistory]);
  const activeSlots=useMemo(()=>slotTimes.filter(t=>!slotIsHistoryForView(t)),[slotTimes,slotIsHistoryForView]);
  const historySlots=useMemo(()=>[...slotTimes.filter(slotIsHistoryForView)].reverse(),[slotTimes,slotIsHistoryForView]);
  // ── Walk-in derived state (memoized so phone keystrokes don't retrigger) ──
  const wiDate=wi.date||viewDate;
  const wiTime=useMemo(()=>showWI==="custom"?wi.customTime:showWI,[showWI,wi.customTime]);
  const wiRt=useMemo(()=>resTypes.find(rt=>rt.id===wi.typeId),[resTypes,wi.typeId]);
  const wiIsPriv=wiRt?.style==="private";
  const wiIsOpen=wiRt?.style==="open";
  const wiAllLanes=useMemo(()=>wiTime?buildLanes(wiDate,wiTime,reservations,resTypes,sessionTemplates).lanes:[],[wiDate,wiTime,reservations,resTypes,sessionTemplates]);
  const wiDateTmpls=useMemo(()=>sessionTemplates.filter(t=>t.active&&t.dayOfWeek===getDayName(wiDate)),[sessionTemplates,wiDate]);
  const wiDateAllSlots=useMemo(()=>[...new Set([...wiDateTmpls.map(t=>t.startTime),...reservations.filter(r=>r.date===wiDate&&r.status!=="cancelled").map(r=>r.startTime)])].sort(),[wiDateTmpls,reservations,wiDate]);
  const wiAvailSlots=useMemo(()=>wiDate===today?wiDateAllSlots.filter(t=>!slotIsHistory(t)):wiDateAllSlots,[wiDate,today,wiDateAllSlots,slotIsHistory]);
  const wiExtraAvail=useMemo(()=>{
    if(!wiTime||!wi.typeId)return[];
    return wiAvailSlots.filter(st=>{
      if(st===wiTime)return false;
      const el=buildLanes(wiDate,st,reservations,resTypes,sessionTemplates).lanes;
      if(wiIsPriv)return el.filter(l=>l.type===null).length>0;
      if(wiIsOpen&&wiRt?.mode){const c=openPlayCapacity(wiRt.mode,el);return c.total>=wi.playerCount;}
      return false;
    });
  },[wiTime,wi.typeId,wiAvailSlots,wiDate,reservations,resTypes,sessionTemplates,wiIsPriv,wiIsOpen,wiRt,wi.playerCount]);
  const filteredWiResTypes=useMemo(()=>{
    const freeLanes=wiAllLanes.filter(l=>l.type===null).length;
    return resTypes.filter(rt=>{
      if(!rt.active||!rt.availableForBooking)return false;
      if(!wiTime)return true;
      if(rt.style==="private")return freeLanes>0;
      if(rt.style==="open"){const c=openPlayCapacity(rt.mode,wiAllLanes);return c.total>0;}
      return true;
    });
  },[resTypes,wiTime,wiAllLanes]);
  const wiSlotCapMap=useMemo(()=>{
    const m={};
    wiAvailSlots.forEach(st=>{const lns=buildLanes(wiDate,st,reservations,resTypes,sessionTemplates).lanes;m[st]=lns.length===0||lns.some(l=>l.type===null)||lns.some(l=>l.type==="open"&&l.playerCount<laneCapacity(l.mode));});
    return m;
  },[wiAvailSlots,wiDate,reservations,resTypes,sessionTemplates]);
  // Precompute lane layout once per slot — not on every button-click re-render
  const slotLaneData=useMemo(()=>{
    const data={};
    slotTimes.forEach(time=>{
      const{lanes:rawLanes}=buildLanes(viewDate,time,reservations,resTypes,sessionTemplates);
      data[time]={lanes:applyLaneOverrides(rawLanes,laneOverrides,resTypes),rawLanes};
    });
    return data;
  },[slotTimes,viewDate,reservations,resTypes,sessionTemplates,laneOverrides]);
  // O(1) user lookup instead of linear scan on every player row
  const userMap=useMemo(()=>new Map(users.map(u=>[u.id,u])),[users]);
  const playerWaiverOk=useCallback(player=>{if(!player.userId)return false;if(signedNow.has(player.userId))return true;return hasValidWaiver(userMap.get(player.userId),activeWaiverDoc);},[userMap,activeWaiverDoc,signedNow]);
  const sBadge=status=>{
    const map={confirmed:{bg:"rgba(58,125,255,.12)",color:"#60a5fa",bdr:"rgba(58,125,255,.25)"},ready:{bg:"rgba(212,236,70,.12)",color:"#d4ec46",bdr:"rgba(212,236,70,.3)"},arrived:{bg:"rgba(212,236,70,.12)",color:"#d4ec46",bdr:"rgba(212,236,70,.3)"},"no-show":{bg:"rgba(220,38,38,.12)",color:"#f87171",bdr:"rgba(220,38,38,.25)"},sent:{bg:"rgba(100,130,240,.18)",color:"#8096f0",bdr:"rgba(100,130,240,.35)"},completed:{bg:"rgba(21,128,61,.12)",color:"#4ade80",bdr:"rgba(21,128,61,.25)"}};
    const label={confirmed:"Confirmed",ready:"Arrived",arrived:"Arrived","no-show":"No Show",sent:"Sent",completed:"Completed"};
    const s=map[status]||map.confirmed;
    return <span style={{display:"inline-block",padding:".25rem .65rem",borderRadius:4,background:s.bg,color:s.color,border:`1px solid ${s.bdr}`,fontWeight:600,fontSize:".8rem",whiteSpace:"nowrap"}}>{label[status]||status}</span>;
  };
  const setResStatus=async(resId,status)=>{setStatusBusy(resId);try{await updateReservation(resId,{status});setReservations(p=>p.map(r=>r.id===resId?{...r,status}:r));}catch(e){showMsg("Error: "+e.message);}setStatusBusy(null);};
  const doFlipLane=async()=>{
    if(!flipConfirm)return;
    const{lane,targetMode}=flipConfirm;
    setFlipBusy(true);
    try{
      const updates=[];
      for(const res of lane.reservations){
        const rt=resTypes.find(x=>x.id===res.typeId);
        if(!rt||rt.mode===targetMode)continue;
        const targetRt=resTypes.find(x=>x.mode===targetMode&&x.style===rt.style&&x.active!==false);
        if(targetRt)updates.push(updateReservation(res.id,{typeId:targetRt.id}));
      }
      await Promise.all(updates);
      const fresh=await fetchReservations();
      setReservations(fresh);
      setFlipConfirm(null);
      showMsg(`Lane ${lane.laneNum} switched to ${targetMode}`);
    }catch(e){showMsg("Error: "+e.message);}
    finally{setFlipBusy(false);}
  };
  const doSendGroup=async time=>{const readyOnes=todayRes.filter(r=>r.startTime===time&&(r.status==="arrived"||r.status==="ready"));setSendConfirm(null);setStatusBusy(time);try{for(const r of readyOnes){await updateReservation(r.id,{status:"sent"});}setReservations(p=>p.map(r=>r.date===viewDate&&r.startTime===time&&(r.status==="arrived"||r.status==="ready")?{...r,status:"sent"}:r));showMsg("Group sent to training room!");}catch(e){showMsg("Error: "+e.message);}setStatusBusy(null);};
  const doSignWaiver=async()=>{const{player}=signingFor;if(!player.userId||!signedName.trim())return;const ts=new Date().toISOString();setUsers(p=>p.map(u=>u.id===player.userId?{...u,waivers:[...u.waivers,{signedAt:ts,signedName:signedName.trim(),waiverDocId:activeWaiverDoc?.id}],needsRewaiverDocId:null}:u));try{await signWaiver(player.userId,signedName.trim(),activeWaiverDoc?.id);}catch(e){}showMsg("Waiver signed for "+player.name);setSigningFor(null);setSignedName("");};
  const resetAddInput=()=>setAddInput({phone:"",lookupStatus:"idle",foundUserId:null,name:""});
  const doAddLookup=async(resId)=>{const clean=cleanPh(addInput.phone);if(clean.length<10)return;setAddInput(p=>({...p,lookupStatus:"searching"}));try{const found=await fetchUserByPhone(clean);if(found){if(resId!=null){const targetRes=reservations.find(r=>r.id===resId);const slotIds=targetRes?reservations.filter(r=>r.date===targetRes.date&&r.startTime===targetRes.startTime&&r.status!=="cancelled").flatMap(r=>(r.players||[]).map(p=>p.userId).filter(Boolean)):[];if(slotIds.includes(found.id)){setAddInput(p=>({...p,foundUserId:null,name:found.name,lookupStatus:"duplicate"}));return;}try{const pl=await addPlayerToReservation(resId,{name:found.name,userId:found.id});setReservations(prev=>prev.map(r=>r.id===resId?{...r,players:[...(r.players||[]),pl]}:r));if(addingToTeam!==null){setVersusTeams(prev=>({...prev,[resId]:{...(prev[resId]||{}),[pl.id]:addingToTeam}}));}resetAddInput();setAddingTo(null);setAddingToTeam(null);showMsg("Added: "+found.name);}catch(e){showMsg("Error: "+e.message);setAddInput(p=>({...p,foundUserId:found.id,name:found.name,lookupStatus:"found"}));}}else{setAddInput(p=>({...p,foundUserId:found.id,name:found.name,lookupStatus:"found"}));}}else{setAddInput(p=>({...p,foundUserId:null,lookupStatus:"notfound"}));}}catch(e){setAddInput(p=>({...p,lookupStatus:"notfound"}));}};
  const doAddPlayer=async resId=>{const userId=addInput.foundUserId||null;const name=userId?(users.find(u=>u.id===userId)?.name||addInput.name):addInput.name.trim();if(!name)return;if(userId){const targetRes=reservations.find(r=>r.id===resId);const slotIds=targetRes?reservations.filter(r=>r.date===targetRes.date&&r.startTime===targetRes.startTime&&r.status!=="cancelled").flatMap(r=>(r.players||[]).map(p=>p.userId).filter(Boolean)):[];if(slotIds.includes(userId)){showMsg(name+" is already in this time slot");return;}}try{let effectiveUserId=userId;if(!effectiveUserId){const phone=cleanPh(addInput.phone);if(phone.length!==10){showMsg("A phone number is required to add a new guest player.");return;}const newUser=await createGuestUser({name,phone,createdByUserId:currentUser?.id??null});effectiveUserId=newUser.id;setUsers(p=>[...p,newUser]);}const p=await addPlayerToReservation(resId,{name,userId:effectiveUserId});setReservations(prev=>prev.map(r=>r.id===resId?{...r,players:[...(r.players||[]),p]}:r));if(addingToTeam!==null){setVersusTeams(prev=>({...prev,[resId]:{...(prev[resId]||{}),[p.id]:addingToTeam}}));}resetAddInput();setAddingTo(null);setAddingToTeam(null);showMsg("Player added");}catch(e){showMsg("Error: "+e.message);}};
  const doRemovePlayer=async(resId,playerId)=>{
    // Snapshot remaining players' teams BEFORE updating reservations so positional
    // fallback stays based on pre-removal indices (removing a player would otherwise
    // shift others from idx≥6 down to idx<6 and flip their team).
    setVersusTeams(prev=>{
      const res=reservations.find(r=>r.id===resId);
      if(!res)return prev;
      const snap={...(prev[resId]||{})};
      (res.players||[]).forEach((p,idx)=>{
        if(p.id!==playerId&&snap[p.id]===undefined)snap[p.id]=idx<6?1:2;
      });
      delete snap[playerId];
      return{...prev,[resId]:snap};
    });
    try{await removePlayerFromReservation(playerId);setReservations(prev=>prev.map(r=>r.id===resId?{...r,players:(r.players||[]).filter(p=>p.id!==playerId)}:r));}catch(e){showMsg("Error: "+e.message);}
  };
  const doWiLookup=async()=>{const clean=cleanPh(wi.phone);if(clean.length<10)return;setWi(p=>({...p,lookupStatus:"searching"}));try{const found=await fetchUserByPhone(clean);if(found){setWi(p=>({...p,foundUserId:found.id,customerName:found.name,lookupStatus:"found"}));}else{setWi(p=>({...p,foundUserId:null,lookupStatus:"notfound"}));}}catch(e){setWi(p=>({...p,lookupStatus:"notfound"}));}};
  const doWiLookupPlayer=async()=>{const clean=cleanPh(wiAddInput.phone);if(clean.length<10)return;setWiAddInput(p=>({...p,lookupStatus:"searching"}));try{const found=await fetchUserByPhone(clean);if(found){setWiAddInput(p=>({...p,foundUserId:found.id,name:found.name,lookupStatus:"found"}));}else{setWiAddInput(p=>({...p,foundUserId:null,lookupStatus:"notfound"}));}}catch(e){setWiAddInput(p=>({...p,lookupStatus:"notfound"}));}};
  const doWiAddPlayer=async()=>{
    const userId=wiAddInput.foundUserId||null;
    const name=userId?(users.find(u=>u.id===userId)?.name||wiAddInput.name):wiAddInput.name.trim();
    if(!name)return;
    const phone=cleanPh(wiAddInput.phone);
    try{
      let effectiveUserId=userId;
      if(!effectiveUserId){
        if(phone.length!==10){showMsg("Phone required to add a new guest.");return;}
        const existByPhone=users.find(u=>cleanPh(u.phone||'')===phone);
        if(existByPhone){effectiveUserId=existByPhone.id;}
        else{const newUser=await createGuestUser({name,phone,createdByUserId:currentUser?.id??null});effectiveUserId=newUser.id;setUsers(p=>[...p,newUser]);}
      }
      // Add to all sessions in parallel; track individual failures
      const targets=wiNewResIds.filter(resId=>{
        const primary=reservations.find(r=>r.id===resId);
        if(!primary)return false;
        // Skip if player is already in ANY reservation at this date+time (cross-lane check)
        const allAtSlot=reservations.filter(r=>r.date===primary.date&&r.startTime===primary.startTime&&r.status!=='cancelled');
        return !allAtSlot.some(r=>r.players?.some(p=>p.userId===effectiveUserId));
      });
      const results=await Promise.allSettled(targets.map(async resId=>{
        const newPlayer=await addPlayerToReservation(resId,{name,userId:effectiveUserId});
        setReservations(prev=>prev.map(r=>r.id===resId?{...r,players:[...(r.players||[]),newPlayer]}:r));
        return resId;
      }));
      const failed=results.filter(r=>r.status==='rejected').length;
      setWiAddInput({phone:"",lookupStatus:"idle",foundUserId:null,name:""});
      setTimeout(()=>wiPhoneRef.current?.focus(),50);
      if(failed>0){
        showMsg(`Added to ${targets.length-failed} of ${targets.length} sessions — ${failed} failed`);
      }else{
        showMsg(wiNewResIds.length>1?`Added to all ${wiNewResIds.length} sessions`:"Player added");
      }
    }catch(e){showMsg("Error: "+e.message);}
  };
  const doWiRemovePlayer=async(userId)=>{
    const toRemove=wiNewResIds.flatMap(resId=>{const res=reservations.find(r=>r.id===resId);return(res?.players||[]).filter(p=>p.userId===userId).map(p=>({playerId:p.id,resId}));});
    try{
      await Promise.allSettled(toRemove.map(({playerId,resId})=>removePlayerFromReservation(playerId).then(async()=>{const freshPlayers=await fetchPlayersForReservation(resId);setReservations(prev=>prev.map(r=>r.id===resId?{...r,players:freshPlayers}:r));})));
    }catch(e){showMsg("Error: "+e.message);}
  };
  const doCreateWalkIn=async()=>{const time=showWI==="custom"?wi.customTime:showWI;const name=wi.foundUserId?(users.find(u=>u.id===wi.foundUserId)?.name||wi.customerName):wi.customerName.trim();if(!name||!wi.typeId||!time)return;const rt=getType(wi.typeId);const isPriv=rt?.style==="private";const isOpen=rt?.style==="open";const playerCount=isPriv?(rt.maxPlayers||laneCapacity(rt?.mode||"coop")):wi.playerCount;const doSplit=isOpen&&wi.splitA>0&&wi.splitA<playerCount;const bookDate=wi.date||viewDate;const allSlots=[{time,addSecondLane:wi.addSecondLane},...(wi.extraSlots||[])];const base={typeId:wi.typeId,date:bookDate,status:"confirmed",paid:true};setWiSaving(true);try{let userId=wi.foundUserId||null;if(!userId){const phone=cleanPh(wi.phone);const newUser=await createGuestUser({name,phone:phone.length===10?phone:null,createdByUserId:currentUser?.id??null});userId=newUser.id;setUsers(p=>[...p,newUser]);}const autoAddBooker=async(resId)=>{try{return await addPlayerToReservation(resId,{name,userId});}catch(e){return null;}};const newReses=[];const primaryIds=[];for(const {time:t,addSecondLane:sl} of allSlots){if(doSplit){const sB=playerCount-wi.splitA;const rA=await createReservation({...base,startTime:t,userId,customerName:name,playerCount:wi.splitA,amount:rt.price*wi.splitA});const rB=await createReservation({...base,startTime:t,userId,customerName:name,playerCount:sB,amount:rt.price*sB});const bp=await autoAddBooker(rA.id);newReses.push({...rA,players:bp?[bp]:[]},{...rB,players:[]});primaryIds.push(rA.id);}else{const lanePrice=isPriv?rt.price*(sl?2:1):rt.price*playerCount;const newRes=await createReservation({...base,startTime:t,userId,customerName:name,playerCount,amount:isPriv?rt.price:lanePrice});const bp=await autoAddBooker(newRes.id);newReses.push({...newRes,players:bp?[bp]:[]});primaryIds.push(newRes.id);if(isPriv&&sl){const _existAtT=reservations.filter(r=>r.date===bookDate&&r.startTime===t&&r.status!=='cancelled');const _newAtT=newReses.filter(r=>r.startTime===t);if(_existAtT.length+_newAtT.length<2){const newRes2=await createReservation({...base,startTime:t,userId,customerName:name,playerCount,amount:rt.price});newReses.push({...newRes2,players:[]});}}}}setReservations(p=>[...p,...newReses]);try{const totalAmt=newReses.reduce((s,r)=>s+(r.amount||0),0);const txn=await processPayment({amount:totalAmt,mode:'card_present',card:{last4:wiCardLast4,expiry:wiCardExpiry,holder:wiCardHolder}});if(!txn.ok)throw new Error('Terminal declined');const snapshot={customerName:name,sessionType:rt?.name??'—',mode:rt?.mode??'—',style:rt?.style??'—',date:bookDate,startTime:time,playerCount:isPriv?(rt?.maxPlayers||laneCapacity(rt?.mode||"coop")):wi.playerCount,amount:totalAmt,status:'confirmed',paid:true,refNum:primaryIds[0].replace(/-/g,'').slice(0,12).toUpperCase(),transactionAt:new Date().toISOString(),cardLast4:txn.last4,cardExpiry:txn.expiry,cardHolder:txn.holder||name};const pmt=await createPayment({userId,reservationId:primaryIds[0],customerName:name,amount:totalAmt,status:'paid',snapshot});if(setPayments)setPayments(p=>[pmt,...p]);}catch(pmtErr){console.warn("Walk-in payment record error:",pmtErr.message);}if(allSlots.length>1){setWiNewResIds(primaryIds);setWiStep("players");}else{setShowWI(null);setWiStep("details");setWi({phone:"",lookupStatus:"idle",foundUserId:null,customerName:"",typeId:"",playerCount:1,customTime:"",date:"",extraSlots:[],addSecondLane:false,splitA:0});}}catch(e){showMsg("Error: "+e.message);}setWiSaving(false);};
  const resetWI=()=>{setShowWI(null);setWiStep("details");setWiNewResIds([]);setWiCardLast4('');setWiCardExpiry('');setWiCardHolder('');setWiAddInput({phone:"",lookupStatus:"idle",foundUserId:null,name:""});setWi({phone:"",lookupStatus:"idle",foundUserId:null,customerName:"",typeId:"",playerCount:1,customTime:"",date:"",extraSlots:[],addSecondLane:false,splitA:0});};
  activeWorkRef.current=!!(showWI||signingFor||sendConfirm||addingTo||statusBusy||wiSaving);
  return(
    <div style={{paddingBottom:"2rem"}}>
      {toast&&<div style={{position:"fixed",top:"1rem",right:"1rem",background:"var(--surf)",border:"1px solid var(--acc2)",borderRadius:8,padding:".75rem 1.4rem",zIndex:9999,fontSize:".95rem",fontWeight:600,boxShadow:"0 4px 20px rgba(0,0,0,.4)"}}>{toast}</div>}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1.5rem",flexWrap:"wrap",gap:".75rem"}}>
        <div>
          <div style={{position:"relative",display:"inline-flex",alignItems:"center",gap:".6rem"}}>
            <div style={{fontSize:"1.45rem",fontWeight:700,color:viewDate!==today?"var(--acc)":"var(--txt)",cursor:"pointer",userSelect:"none"}}
              onClick={()=>dateInputRef.current&&(dateInputRef.current.showPicker?dateInputRef.current.showPicker():dateInputRef.current.click())}>
              {new Date(viewDate+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"})}
            </div>
            <input ref={dateInputRef} type="date" value={viewDate}
              onChange={e=>{if(e.target.value){setViewDate(e.target.value);setExpandedSlot(null);setShowHistory(false);}}}
              style={{position:"absolute",inset:0,opacity:0,pointerEvents:"none",width:"100%",height:"100%"}}/>
          </div>
          <div style={{fontSize:"1.05rem",color:"var(--muted)",marginTop:".15rem",display:"flex",alignItems:"center",gap:".75rem",flexWrap:"wrap"}}>
            <span>{clock.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}<span style={{marginLeft:".75rem",fontSize:".8rem"}}>{slotTimes.length} slot{slotTimes.length!==1?"s":""} · {todayRes.length} reservation{todayRes.length!==1?"s":""}</span></span>
            {viewDate!==today&&<button className="btn btn-s" style={{fontSize:".78rem",padding:".25rem .75rem"}} onClick={()=>{setViewDate(today);setExpandedSlot(null);setShowHistory(false);}}>↩ Back to Today</button>}
          </div>
        </div>
        <div style={{display:"flex",gap:".6rem"}}>
          <button className="btn btn-s" style={{fontSize:".95rem",padding:".6rem 1.2rem"}} onClick={()=>setShowMerch(true)}>Merchandise</button>
          {!isFullscreen&&<button className="btn btn-s" style={{fontSize:".95rem",padding:".6rem 1.2rem"}} onClick={()=>document.documentElement.requestFullscreen?.()}>⛶ Fullscreen</button>}
          <button className="btn btn-p" style={{fontSize:".95rem",padding:".6rem 1.2rem"}} onClick={()=>{setShowWI("custom");setWi({phone:"",lookupStatus:"idle",foundUserId:null,customerName:"",typeId:"",playerCount:1,customTime:"",date:"",extraSlots:[],addSecondLane:false,splitA:0});}}>+ Walk-In</button>
        </div>
      </div>
      {slotTimes.length===0&&<div style={{textAlign:"center",color:"var(--muted)",padding:"4rem 2rem",fontSize:"1rem",border:"1px dashed var(--bdr)",borderRadius:10}}>No sessions scheduled for {viewDate===today?"today":new Date(viewDate+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"})}.</div>}
      {activeSlots.length===0&&slotTimes.length>0&&<div style={{textAlign:"center",color:"var(--muted)",padding:"2rem",fontSize:".95rem",border:"1px dashed var(--bdr)",borderRadius:10}}>All sessions have ended. Check History below.</div>}
      {[...activeSlots,...(historySlots.length>0?['__hist__']:[]),...(showHistory?historySlots:[])].map(entry=>{
        if(entry==='__hist__')return(<div key="__hist__" style={{display:"flex",alignItems:"center",gap:".75rem",marginTop:".75rem",marginBottom:".5rem",cursor:"pointer",userSelect:"none"}} onClick={()=>setShowHistory(h=>!h)}><div style={{flex:1,height:1,background:"var(--bdr)"}}/><span style={{fontSize:".8rem",fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:".08em",whiteSpace:"nowrap",padding:"0 .6rem",display:"flex",alignItems:"center",gap:".4rem"}}><span style={{fontSize:".7rem"}}>{showHistory?"▲":"▼"}</span>History · {historySlots.length} slot{historySlots.length!==1?"s":""} ended</span><div style={{flex:1,height:1,background:"var(--bdr)"}}/></div>);
        const time=entry;const isHist=historySlots.includes(time);
        const slotResItems=todayRes.filter(r=>r.startTime===time);
        const tmpl=todayTmpls.find(t=>t.startTime===time);
        const {lanes=[],rawLanes=[]}=slotLaneData[time]||{};
        const activeLanes=lanes.filter(l=>l.type!==null);
        const laneReady=lane=>lane.reservations.length>0&&lane.reservations.every(r=>r.status==="arrived"||r.status==="ready"||r.status==="no-show");
        const allLanesReady=activeLanes.length>0?activeLanes.every(laneReady):slotResItems.length>0&&slotResItems.every(r=>r.status==="arrived"||r.status==="ready"||r.status==="no-show");
        const allSent=slotResItems.length>0&&slotResItems.every(r=>r.status==="sent"||r.status==="no-show");
        const allCompleted=slotResItems.length>0&&slotResItems.every(r=>r.status==="completed"||r.status==="no-show");
        const canSend=allLanesReady&&!allSent&&!allCompleted;
        const isOpen=expandedSlot===time;
        return(
          <div key={time} style={{background:"var(--surf)",border:"1px solid var(--bdr)",borderRadius:12,marginBottom:"1rem",overflow:"hidden",opacity:isHist?.65:1,filter:isHist?"saturate(.45)":"none"}}>
            {/* ── Collapsed slot header ── */}
            <div style={{display:"flex",alignItems:"stretch",cursor:"pointer",userSelect:"none",minHeight:78}} onClick={()=>setExpandedSlot(isOpen?null:time)}>
              <div style={{padding:".85rem 1.1rem",display:"flex",flexDirection:"column",justifyContent:"center",minWidth:100,flexShrink:0}}>
                <div style={{fontSize:"1.4rem",fontWeight:800,color:"var(--acc)",fontVariantNumeric:"tabular-nums",lineHeight:1.1}}>{fmt12(time)}</div>
                <div style={{fontSize:".7rem",color:"var(--muted)",marginTop:".25rem"}}>{tmpl?`${tmpl.maxSessions} lane${tmpl.maxSessions!==1?"s":""}`:""}{tmpl&&slotResItems.length>0?" · ":""}{slotResItems.length>0?`${slotResItems.length} booking${slotResItems.length!==1?"s":""}`:""}</div>
              </div>
              <div style={{flex:1,display:"flex",borderLeft:"1px solid var(--bdr)",overflow:"hidden"}}>
                {lanes.length===0&&slotResItems.length===0&&<div style={{padding:".85rem 1.1rem",color:"var(--muted)",fontSize:".9rem",display:"flex",alignItems:"center"}}>No bookings yet</div>}
                {lanes.length===0&&slotResItems.length>0&&slotResItems.map((res,ri)=>{
                  const rt=getType(res.typeId);const players=res.players||[];const wOkCount=players.filter(playerWaiverOk).length;
                  return <div key={res.id} style={{flex:1,padding:".65rem 1rem",borderRight:ri<slotResItems.length-1?"1px solid var(--bdr)":"none",minWidth:0}}>
                    <div style={{fontWeight:700,color:"var(--txt)",fontSize:".92rem",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{res.customerName}</div>
                    <div style={{display:"flex",gap:".3rem",marginTop:".2rem",alignItems:"center",flexWrap:"wrap"}}>
                      {rt&&<><span className={`badge b-${rt.mode}`} style={{fontSize:".65rem"}}>{rt.mode}</span><span className={`badge b-${rt.style}`} style={{fontSize:".65rem"}}>{rt.style}</span></>}
                      <span style={{fontSize:".75rem",color:"var(--muted)"}}>👥{res.playerCount}</span>
                      {players.length>0&&<span style={{fontSize:".72rem",color:wOkCount===players.length?"var(--ok)":wOkCount>0?"var(--warn)":"var(--danger)"}}>{wOkCount}/{players.length}w</span>}
                      {sBadge(res.status)}
                    </div>
                  </div>;
                })}
                {lanes.length>0&&lanes.map((lane,li)=>{
                  const players=lane.reservations.flatMap(r=>r.players||[]);const wOkCount=players.filter(playerWaiverOk).length;
                  const laneIsFull=lane.type==="private"||(lane.type==="open"&&lane.playerCount>=laneCapacity(lane.mode));
                  const lnReady=laneReady(lane);
                  const laneIsVs=lane.mode==='versus';
                  let lnT1=0,lnT2=0;
                  if(laneIsVs){const tm=calcResVsTeams(slotResItems);lane.reservations.forEach(r=>{(r.players||[]).forEach(p=>{const t=versusTeams[r.id]?.[p.id]??p.team??tm[r.id]??1;if(t===1)lnT1++;else lnT2++;});});}
                  const vsUnbalanced=laneIsVs&&Math.abs(lnT1-lnT2)>1;
                  return <div key={lane.laneNum} style={{flex:1,padding:".65rem 1rem",borderRight:li<lanes.length-1?"1px solid var(--bdr)":"none",minWidth:0,background:lnReady?"rgba(40,200,100,.06)":laneIsFull?"rgba(220,60,60,.1)":"transparent",...(vsUnbalanced?{outline:"3px solid #f59e0b",outlineOffset:"-3px"}:{})}}>
                    {vsUnbalanced&&<div style={{color:"#f59e0b",fontWeight:800,fontSize:".72rem",textTransform:"uppercase",letterSpacing:".07em",lineHeight:1.3,marginBottom:".3rem"}}>⚠ Unbalanced Match<br/><span style={{fontWeight:600,fontSize:".68rem"}}>T1: {lnT1} · T2: {lnT2}</span></div>}
                    <div style={{fontSize:".65rem",fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",marginBottom:".3rem",color:lnReady?"#2dc86e":"var(--muted)"}}>{laneIsFull&&!lnReady&&<><strong style={{color:"var(--acc)"}}>FULL!</strong>{" — "}</>}Lane {lane.laneNum} · {lane.mode} · {lane.type}{lnReady&&<strong style={{marginLeft:".35rem"}}> ✓ READY</strong>}</div>
                    {lane.reservations.map(res=>{
                      const rt=getType(res.typeId);const rPlayers=res.players||[];const rWok=rPlayers.filter(playerWaiverOk).length;
                      return <div key={res.id} style={{marginBottom:".25rem"}}>
                        <div style={{display:"flex",alignItems:"center",gap:".35rem",flexWrap:"wrap"}}>
                          <span style={{fontWeight:700,color:"var(--txt)",fontSize:".9rem",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:160}}>{res.customerName}</span>
                          <span style={{fontSize:".75rem",color:"var(--muted)",whiteSpace:"nowrap"}}>👥{res.playerCount}</span>
                          {rPlayers.length>0&&<span style={{fontSize:".7rem",color:rWok===rPlayers.length?"var(--ok)":rWok>0?"var(--warn)":"var(--danger)",whiteSpace:"nowrap"}}>{rWok}/{rPlayers.length}w</span>}
                          {sBadge(res.status)}
                        </div>
                      </div>;
                    })}
                    {lane.reservations.length===0&&<div style={{fontSize:".8rem",color:"var(--muted)"}}>Available</div>}
                  </div>;
                })}
              </div>
              <div style={{padding:".75rem 1rem",display:"flex",alignItems:"center",gap:".5rem",flexShrink:0}}>
                {canSend&&<button className="btn btn-p" style={{fontSize:".85rem",padding:".45rem 1rem",whiteSpace:"nowrap"}} onClick={e=>{e.stopPropagation();setSendConfirm(time);}}>Send {fmt12(time)}? →</button>}
                {allSent&&!allCompleted&&<span style={{display:"inline-block",padding:".3rem .8rem",borderRadius:4,background:"rgba(100,130,240,.18)",color:"#8096f0",border:"1px solid rgba(100,130,240,.35)",fontWeight:600,fontSize:".8rem"}}>SENT</span>}
                {allSent&&!allCompleted&&<button className="btn btn-p" style={{fontSize:".85rem",padding:".45rem 1rem",whiteSpace:"nowrap"}} onClick={e=>{e.stopPropagation();const scoringLanes=activeLanes.map(l=>({...l,reservations:l.reservations.filter(r=>r.status!=='no-show')})).filter(l=>l.reservations.length>0);setScoringSlot({time,lanes:scoringLanes});}}>🎯 Score</button>}
                {allCompleted&&<span style={{display:"inline-block",padding:".3rem .8rem",borderRadius:4,background:"rgba(21,128,61,.12)",color:"#4ade80",border:"1px solid rgba(21,128,61,.25)",fontWeight:600,fontSize:".8rem"}}>✓ COMPLETED</span>}
                <span style={{color:"var(--muted)",fontSize:"1.1rem"}}>{isOpen?"▲":"▼"}</span>
              </div>
            </div>
            {/* ── Expanded slot body ── */}
            {isOpen&&(()=>{
              const renderResCard=res=>{
                const rt=getType(res.typeId);const players=res.players||[];
                const wOkCount=players.filter(playerWaiverOk).length;const allWaiversOk=players.length>0&&wOkCount===players.length;const isBusy=statusBusy===res.id;
                const maxForRes=rt?.style==="private"?(rt.maxPlayers||laneCapacity(rt?.mode||"coop")):(res.playerCount||99);const isLocked=res.status==='completed'||res.status==='no-show'||res.status==='arrived'||res.status==='ready';const canAddMore=!isLocked&&players.length<maxForRes;
                return(
                  <div key={res.id} style={{background:"var(--bg2)",border:"1px solid var(--bdr)",borderRadius:8,marginBottom:".6rem",overflow:"hidden"}}>
                    {/* ── Card header: name + status badge ── */}
                    <div style={{display:"flex",alignItems:"flex-start",gap:".65rem",padding:".75rem 1rem .35rem"}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:"flex",alignItems:"baseline",gap:".5rem",flexWrap:"wrap"}}>
                          <span style={{fontWeight:700,fontSize:"1.05rem",color:"var(--txt)"}}>{res.customerName}</span>
                          {res.createdAt&&<span style={{fontSize:".72rem",color:"var(--muted)",whiteSpace:"nowrap"}}>({fmtBookedAt(res.createdAt)})</span>}
                        </div>
                        <div style={{display:"flex",gap:".35rem",marginTop:".2rem",alignItems:"center",flexWrap:"wrap"}}>
                          {rt&&<><span className={`badge b-${rt.mode}`}>{rt.mode}</span><span className={`badge b-${rt.style}`}>{rt.style}</span></>}
                          <span style={{fontSize:".8rem",color:"var(--muted)"}}>👥 {res.playerCount}</span>
                          <span style={{fontSize:".8rem",color:allWaiversOk?"var(--ok)":wOkCount>0?"var(--warn)":"var(--danger)"}}>{players.length>0?`${wOkCount}/${players.length} waivers`:"no players added"}</span>
                        </div>
                      </div>
                      {sBadge(res.status)}
                    </div>
                    {/* ── Action buttons — always visible, no expand needed ── */}
                    {res.status!=="sent"&&res.status!=="completed"&&(
                      <div style={{display:"flex",gap:".6rem",flexWrap:"wrap",padding:".55rem 1rem .8rem",alignItems:"center"}}>
                        {(res.status==="arrived"||res.status==="ready")
                          ?<span style={{color:"#d4ec46",fontWeight:700,fontSize:"1rem",letterSpacing:".03em"}}>✓ Arrived</span>
                          :res.status!=="no-show"&&<button className="btn" style={{background:allWaiversOk||players.length===0?"rgba(212,236,70,.12)":"var(--surf)",color:allWaiversOk||players.length===0?"#d4ec46":"var(--muted)",border:`1px solid ${allWaiversOk||players.length===0?"rgba(212,236,70,.3)":"var(--bdr)"}`}} disabled={isBusy||(players.length>0&&!allWaiversOk)} title={players.length>0&&!allWaiversOk?"All waivers must be signed before marking arrived":undefined} onClick={()=>setResStatus(res.id,"ready")}>{isBusy?"…":"✓ Mark Arrived"}</button>}
                        {(res.status==="arrived"||res.status==="ready")&&<button className="btn btn-s" disabled={isBusy} onClick={()=>setResStatus(res.id,"confirmed")}>← Undo</button>}
                        {res.status!=="no-show"&&res.status!=="arrived"&&res.status!=="ready"&&<button className="btn btn-d" disabled={isBusy} onClick={()=>setResStatus(res.id,"no-show")}>{isBusy?"…":"No Show"}</button>}
                        {res.status==="no-show"&&<><span style={{color:"#f87171",fontWeight:700,fontSize:"1rem",letterSpacing:".03em"}}>✗ No Show</span><button className="btn btn-s" disabled={isBusy} onClick={()=>setResStatus(res.id,"confirmed")}>← Undo</button></>}
                      </div>
                    )}
                    {/* ── Players — always visible ── */}
                    <div style={{borderTop:"1px solid var(--bdr)",padding:".65rem 1rem"}}>
                      {rt?.mode==="versus"?(()=>{
                        const getTeam=pid=>{if(versusTeams[res.id]?.[pid]!==undefined)return versusTeams[res.id][pid];const pObj=players.find(p=>p.id===pid);if(pObj?.team!=null)return pObj.team;const slotReses=reservations.filter(r=>r.date===res.date&&r.startTime===res.startTime&&r.status!=='cancelled'&&resTypes.find(rt=>rt.id===r.typeId)?.mode==='versus');return calcResVsTeams(slotReses)[res.id]??1;};
                        const t1=players.filter(p=>getTeam(p.id)===1);
                        const t2=players.filter(p=>getTeam(p.id)===2);
                        const switchT=pid=>{const newTeam=getTeam(pid)===1?2:1;setVersusTeams(prev=>({...prev,[res.id]:{...(prev[res.id]||{}),[pid]:newTeam}}));setReservations(prev=>prev.map(r=>r.id===res.id?{...r,players:(r.players||[]).map(p=>p.id===pid?{...p,team:newTeam}:p)}:r));updateReservationPlayer(pid,{team:newTeam}).catch(()=>{});};
                        const pRow=(player,teamNum)=>{const wOk=playerWaiverOk(player);return(<div key={player.id} style={{display:"flex",alignItems:"center",gap:".35rem",padding:".4rem 0",borderBottom:"1px solid var(--bdr)"}}><span style={{flex:1,fontSize:".88rem",color:"var(--txt)",minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{player.name||"—"}</span>{!isLocked&&<button style={{background:"none",border:"1px solid var(--bdr)",borderRadius:5,color:"var(--txt)",cursor:"pointer",fontSize:".82rem",padding:".35rem .6rem",flexShrink:0}} onClick={()=>switchT(player.id)}>{teamNum===1?"↓T2":"↑T1"}</button>}{!player.userId&&<span style={{fontSize:".65rem",color:"var(--muted)",background:"var(--surf)",border:"1px solid var(--bdr)",borderRadius:4,padding:"1px .3rem",flexShrink:0}}>guest</span>}{player.userId?(wOk?<span style={{color:"var(--ok)",fontSize:".78rem",fontWeight:600,whiteSpace:"nowrap",flexShrink:0}}>✓W</span>:<button className="btn btn-warn" style={{whiteSpace:"nowrap",flexShrink:0}} onClick={()=>{setSigningFor({player,resId:res.id});setSignedName(player.name||"");}}>Sign</button>):<span style={{fontSize:".68rem",color:"var(--muted)",flexShrink:0}}>—</span>}{!isLocked&&<button style={{background:"none",border:"none",color:"var(--danger)",cursor:"pointer",fontSize:"1.1rem",padding:".35rem .6rem",lineHeight:1,flexShrink:0,minWidth:40}} onClick={()=>doRemovePlayer(res.id,player.id)}>×</button>}</div>);};
                        const addPanel=teamNum=>{const isAddingThisTeam=!isLocked&&addingTo===res.id&&addingToTeam===teamNum;const tPlayers=teamNum===1?t1:t2;const teamFull=tPlayers.length>=6;if(isAddingThisTeam){return(<div style={{marginTop:".4rem",background:"var(--surf)",border:"1px solid var(--bdr)",borderRadius:6,padding:".5rem .65rem"}}><div style={{display:"flex",gap:".35rem",alignItems:"center",marginBottom:".3rem"}}><div className="phone-wrap" style={{flex:1}}><span className="phone-prefix">+1</span><input type="tel" maxLength={10} value={addInput.phone} onChange={e=>setAddInput({phone:cleanPh(e.target.value),lookupStatus:"idle",foundUserId:null,name:""})} onKeyDown={e=>e.key==="Enter"&&doAddLookup(res.id)} placeholder="Phone" autoFocus style={{fontSize:".85rem"}}/></div>{(addInput.lookupStatus==="idle"||addInput.lookupStatus==="searching")&&<button className="btn btn-s" disabled={cleanPh(addInput.phone).length<10||addInput.lookupStatus==="searching"} onClick={()=>doAddLookup(res.id)}>{addInput.lookupStatus==="searching"?"…":"→"}</button>}{addInput.lookupStatus!=="idle"&&addInput.lookupStatus!=="searching"&&<button className="btn btn-s" onClick={resetAddInput}>✕</button>}<button className="btn btn-s" onClick={()=>{setAddingTo(null);setAddingToTeam(null);resetAddInput();}}>×</button></div>{addInput.lookupStatus==="found"&&addInput.foundUserId&&(()=>{const u=users.find(x=>x.id===addInput.foundUserId);return<div style={{display:"flex",alignItems:"center",gap:".4rem",marginBottom:".3rem"}}><span style={{color:"#2dc86e",fontWeight:600,fontSize:".82rem"}}>✓ {u?.name||addInput.name}</span>{u?.authProvider&&<span style={{fontSize:".68rem",color:"var(--muted)"}}>({u.authProvider})</span>}</div>;})()}{addInput.lookupStatus==="duplicate"&&<div style={{background:"rgba(220,60,60,.1)",border:"1px solid rgba(220,60,60,.4)",borderRadius:5,padding:".35rem .55rem",marginBottom:".3rem",fontSize:".79rem",color:"var(--danger)",fontWeight:600}}>{addInput.name} is already assigned to this time slot.</div>}{(addInput.lookupStatus==="notfound"||addInput.lookupStatus==="named")&&<div style={{display:"flex",gap:".35rem",alignItems:"center"}}><input placeholder="Name" value={addInput.name} onChange={e=>setAddInput(p=>({...p,name:e.target.value,lookupStatus:e.target.value.trim()?"named":"notfound"}))} onKeyDown={e=>e.key==="Enter"&&addInput.name.trim()&&doAddPlayer(res.id)} autoFocus style={{flex:1,background:"var(--bg2)",border:"1px solid var(--bdr)",borderRadius:5,padding:".35rem .5rem",color:"var(--txt)",fontSize:".85rem"}}/><button className="btn btn-p" disabled={!addInput.name.trim()} onClick={()=>doAddPlayer(res.id)}>Add</button></div>}{addInput.lookupStatus==="notfound"&&<div style={{fontSize:".7rem",color:"var(--muted)",marginTop:".2rem"}}>No account — type name to add as guest.</div>}</div>);}if(!teamFull&&canAddMore){return<button className="btn btn-s" style={{width:"100%",marginTop:".5rem",fontSize:".9rem",padding:".6rem 0"}} onClick={()=>{setAddingTo(res.id);setAddingToTeam(teamNum);resetAddInput();}}>+ Add to Team {teamNum}</button>;}return null;};
                        return(<div><div style={{fontWeight:600,fontSize:".78rem",color:"var(--muted)",marginBottom:".5rem",textTransform:"uppercase",letterSpacing:".05em"}}>Players <span style={{textTransform:"none",fontWeight:400,color:players.length>=maxForRes?"var(--danger)":"var(--muted)"}}>{players.length}/{maxForRes}</span></div><div style={{display:"flex",flexDirection:"column",gap:".65rem"}}>{[1,2].map(tn=>{const tPlayers=tn===1?t1:t2;return(<div key={tn} style={{background:"var(--bg)",border:"1px solid var(--bdr)",borderRadius:6,padding:".5rem .6rem"}}><div style={{fontWeight:700,fontSize:".73rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:".04em",marginBottom:".35rem"}}>Team {tn} <span style={{fontWeight:400}}>({tPlayers.length}/6)</span></div>{tPlayers.length===0&&<div style={{fontSize:".78rem",color:"var(--muted)",padding:".2rem 0"}}>—</div>}{tPlayers.map(p=>pRow(p,tn))}{addPanel(tn)}</div>);})}</div></div>);
                      })():(
                        <>
                        <div style={{fontWeight:600,fontSize:".78rem",color:"var(--muted)",marginBottom:".5rem",textTransform:"uppercase",letterSpacing:".05em"}}>Players <span style={{textTransform:"none",fontWeight:400,color:players.length>=maxForRes?"var(--danger)":"var(--muted)"}}>{players.length}/{maxForRes}</span></div>
                        {players.length===0&&<div style={{fontSize:".85rem",color:"var(--muted)",marginBottom:".5rem"}}>No players added yet.</div>}
                        {players.map(player=>{
                          const wOk=playerWaiverOk(player);
                          return(
                            <div key={player.id} style={{display:"flex",alignItems:"center",gap:".5rem",padding:".65rem 0",borderBottom:"1px solid var(--bdr)"}}>
                              <span style={{flex:1,fontSize:".95rem",color:"var(--txt)"}}>{player.name||"—"}</span>
                              {!player.userId&&<span style={{fontSize:".7rem",color:"var(--muted)",background:"var(--surf)",border:"1px solid var(--bdr)",borderRadius:4,padding:"1px .4rem"}}>guest</span>}
                              {player.userId?(wOk?(<span style={{color:"var(--ok)",fontSize:".85rem",fontWeight:600,whiteSpace:"nowrap"}}>✓ Waiver</span>):(<button className="btn btn-warn" style={{whiteSpace:"nowrap"}} onClick={()=>{setSigningFor({player,resId:res.id});setSignedName(player.name||"");}}>Sign Waiver</button>)):(<span style={{fontSize:".75rem",color:"var(--muted)"}}>no account</span>)}
                              {!isLocked&&<button style={{background:"none",border:"none",color:"var(--danger)",cursor:"pointer",fontSize:"1.2rem",padding:".35rem .6rem",lineHeight:1,flexShrink:0,minWidth:44}} onClick={()=>doRemovePlayer(res.id,player.id)}>×</button>}
                            </div>
                          );
                        })}
                        {!isLocked&&(addingTo===res.id?(
                          <div style={{marginTop:".6rem",background:"var(--surf)",border:"1px solid var(--bdr)",borderRadius:6,padding:".6rem .75rem"}}>
                            <div style={{display:"flex",gap:".4rem",alignItems:"center",marginBottom:".35rem"}}>
                              <div className="phone-wrap" style={{flex:1}}><span className="phone-prefix">+1</span><input type="tel" maxLength={10} value={addInput.phone} onChange={e=>setAddInput({phone:cleanPh(e.target.value),lookupStatus:"idle",foundUserId:null,name:""})} onKeyDown={e=>e.key==="Enter"&&doAddLookup(res.id)} placeholder="Phone" autoFocus style={{fontSize:".9rem"}}/></div>
                              {(addInput.lookupStatus==="idle"||addInput.lookupStatus==="searching")&&<button className="btn btn-s" style={{padding:'.45rem .6rem',fontSize:'.78rem',flexShrink:0}} disabled={cleanPh(addInput.phone).length<10||addInput.lookupStatus==="searching"} onClick={()=>doAddLookup(res.id)}>{addInput.lookupStatus==="searching"?"…":"→"}</button>}
                              {addInput.lookupStatus!=="idle"&&addInput.lookupStatus!=="searching"&&<button className="btn btn-s" style={{padding:'.45rem .6rem',fontSize:'.78rem',flexShrink:0}} onClick={resetAddInput}>✕</button>}
                              <button className="btn btn-s" style={{padding:'.45rem .6rem',fontSize:'.78rem',flexShrink:0}} onClick={()=>{setAddingTo(null);resetAddInput();}}>✕</button>
                            </div>
                            {addInput.lookupStatus==="found"&&addInput.foundUserId&&(()=>{const u=users.find(x=>x.id===addInput.foundUserId);return<div style={{display:"flex",alignItems:"center",gap:".5rem",marginBottom:".35rem"}}><span style={{color:"#2dc86e",fontWeight:600,fontSize:".85rem"}}>✓ {u?.name||addInput.name}</span>{u?.authProvider&&<span style={{fontSize:".7rem",color:"var(--muted)"}}>({u.authProvider})</span>}</div>;})()}
                            {addInput.lookupStatus==="duplicate"&&<div style={{background:"rgba(220,60,60,.1)",border:"1px solid rgba(220,60,60,.4)",borderRadius:5,padding:".4rem .65rem",marginBottom:".35rem",fontSize:".82rem",color:"var(--danger)",fontWeight:600}}>{addInput.name} is already assigned to this time slot.</div>}
                            {(addInput.lookupStatus==="notfound"||addInput.lookupStatus==="named")&&<div style={{display:"flex",gap:".4rem",alignItems:"center"}}><input placeholder="Player name" value={addInput.name} onChange={e=>setAddInput(p=>({...p,name:e.target.value,lookupStatus:e.target.value.trim()?"named":"notfound"}))} onKeyDown={e=>e.key==="Enter"&&addInput.name.trim()&&doAddPlayer(res.id)} autoFocus style={{flex:1,background:"var(--bg2)",border:"1px solid var(--bdr)",borderRadius:5,padding:".4rem .6rem",color:"var(--txt)",fontSize:".9rem"}}/><button className="btn btn-p" disabled={!addInput.name.trim()} onClick={()=>doAddPlayer(res.id)}>Add</button></div>}
                            {addInput.lookupStatus==="notfound"&&<div style={{fontSize:".72rem",color:"var(--muted)",marginTop:".25rem"}}>No account found — type a name to add as a guest.</div>}
                          </div>
                        ):(
                          canAddMore?<button className="btn btn-s" style={{marginTop:".5rem",width:"100%",fontSize:".9rem",padding:".6rem 0"}} onClick={()=>{setAddingTo(res.id);resetAddInput();}}>+ Add Player</button>:(res.status==='arrived'||res.status==='ready')?<div style={{fontSize:".8rem",color:"var(--warnL)",marginTop:".5rem",fontStyle:"italic"}}>← Undo arrived to add players</div>:<div style={{fontSize:".8rem",color:"var(--muted)",marginTop:".5rem",fontStyle:"italic"}}>Player limit reached ({maxForRes}/{maxForRes})</div>
                        ))}
                        </>
                      )}
                    </div>
                  </div>
                );
              };
              const hasMatchingModes=activeLanes.some(l=>activeLanes.some(l2=>l2.laneNum!==l.laneNum&&l2.mode===l.mode));
              return(
                <div style={{borderTop:"1px solid var(--bdr)",padding:"1rem 1.2rem"}}>
                  {allCompleted&&(()=>{
                    const runs=completedRunsCache[time];
                    if(runs==null)return<div style={{textAlign:"center",color:"var(--muted)",fontSize:".82rem",padding:".2rem 0 .8rem"}}>Loading scores…</div>;
                    if(!runs.length)return null;
                    return<div style={{marginBottom:".9rem",display:"flex",gap:".75rem",flexWrap:"wrap"}}>
                      {activeLanes.map(lane=>{
                        const laneRuns=lane.reservations.flatMap(res=>runs.filter(r=>r.reservationId===res.id));
                        if(!laneRuns.length)return null;
                        const mode=lane.mode;
                        return<div key={lane.laneNum} style={{flex:1,minWidth:180,background:"var(--bg2)",border:"1px solid rgba(74,222,128,.25)",borderRadius:8,padding:".65rem .85rem"}}>
                          <div style={{fontSize:".72rem",fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:".6rem"}}>Lane {lane.laneNum} · {mode} · Scores</div>
                          {(()=>{
                            const run1Rows=laneRuns.filter(r=>r.runNumber===1);
                            const run2Rows=laneRuns.filter(r=>r.runNumber===2);
                            const warResult=mode==="versus"?calcWarOutcome({
                              run1WinnerTeam:run1Rows[0]?.winningTeam??null,
                              run2WinnerTeam:run2Rows[0]?.winningTeam??null,
                              group1HunterElapsed:run1Rows.find(r=>r.team===1)?.elapsedSeconds??null,
                              group2HunterElapsed:run2Rows.find(r=>r.team===2)?.elapsedSeconds??null,
                            }):null;
                            return<>
                              {[1,2].map(runNum=>{
                                const recs=laneRuns.filter(r=>r.runNumber===runNum);
                                if(!recs.length)return null;
                                const elapsed=recs.find(r=>r.elapsedSeconds>0)?.elapsedSeconds??null;
                                if(mode==="versus"){
                                  const blue=recs.find(r=>r.team===1);
                                  const red=recs.find(r=>r.team===2);
                                  const winner=blue?.winningTeam??red?.winningTeam??null;
                                  return<div key={runNum} style={{marginBottom:".5rem"}}>
                                    <div style={{fontSize:".68rem",color:"var(--muted)",fontWeight:600,marginBottom:".2rem",display:"flex",gap:".35rem",alignItems:"center"}}>
                                      <span>Run {runNum}</span>
                                      {elapsed>0&&<span style={{fontWeight:400}}>· ⏱ {fmtSecMS(elapsed)}</span>}
                                    </div>
                                    <div style={{display:"flex",gap:".4rem",alignItems:"center"}}>
                                      <div style={{flex:1,textAlign:"center",background:"rgba(59,130,246,.08)",border:`1px solid ${winner===1?"#3b82f6":"rgba(59,130,246,.2)"}`,borderRadius:5,padding:".3rem .5rem"}}>
                                        <div style={{fontSize:".62rem",color:"#60a5fa",fontWeight:700,textTransform:"uppercase",marginBottom:".1rem"}}>Blue{winner===1?" ✓":""}</div>
                                        <div style={{fontFamily:"var(--fd)",fontSize:"1.1rem",fontWeight:800,color:winner===1?"#3b82f6":"var(--txt)"}}>{blue?.score!=null?Number(blue.score).toFixed(1):"—"}</div>
                                      </div>
                                      <div style={{fontSize:".75rem",color:"var(--muted)",fontWeight:700,flexShrink:0}}>vs</div>
                                      <div style={{flex:1,textAlign:"center",background:"rgba(239,68,68,.08)",border:`1px solid ${winner===2?"#ef4444":"rgba(239,68,68,.2)"}`,borderRadius:5,padding:".3rem .5rem"}}>
                                        <div style={{fontSize:".62rem",color:"#f87171",fontWeight:700,textTransform:"uppercase",marginBottom:".1rem"}}>Red{winner===2?" ✓":""}</div>
                                        <div style={{fontFamily:"var(--fd)",fontSize:"1.1rem",fontWeight:800,color:winner===2?"#ef4444":"var(--txt)"}}>{red?.score!=null?Number(red.score).toFixed(1):"—"}</div>
                                      </div>
                                    </div>
                                  </div>;
                                }else{
                                  const rec=recs[0];
                                  return<div key={runNum} style={{marginBottom:".4rem",padding:".35rem .5rem",background:"rgba(212,236,70,.06)",border:"1px solid rgba(212,236,70,.15)",borderRadius:5}}>
                                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                                      <div style={{fontSize:".72rem",color:"var(--muted)",fontWeight:600}}>Run {runNum}</div>
                                      <div style={{fontFamily:"var(--fd)",fontSize:"1.1rem",fontWeight:800,color:"var(--acc)"}}>{rec?.score!=null?Number(rec.score).toFixed(1):"—"}</div>
                                    </div>
                                    <div style={{display:"flex",gap:".5rem",marginTop:".15rem"}}>
                                      {elapsed>0&&<span style={{fontSize:".62rem",color:"var(--muted)"}}>⏱ {fmtSecMS(elapsed)}</span>}
                                      <span style={{fontSize:".62rem",fontWeight:600,color:rec?.targetsEliminated?"#4ade80":"#f87171"}}>T: {rec?.targetsEliminated?"✓":"✗"}</span>
                                      <span style={{fontSize:".62rem",fontWeight:600,color:rec?.objectiveComplete?"#4ade80":"#f87171"}}>O: {rec?.objectiveComplete?"✓":"✗"}</span>
                                    </div>
                                  </div>;
                                }
                              })}
                              {warResult&&<div style={{marginTop:".35rem",padding:".3rem .5rem",background:warResult.warWinner===1?"rgba(59,130,246,.1)":"rgba(239,68,68,.1)",border:`1px solid ${warResult.warWinner===1?"rgba(59,130,246,.35)":"rgba(239,68,68,.35)"}`,borderRadius:5,textAlign:"center"}}>
                                <span style={{fontSize:".7rem",fontWeight:700,color:warResult.warWinner===1?"#60a5fa":"#f87171",textTransform:"uppercase",letterSpacing:".05em"}}>
                                  {warResult.warWinner===1?"Blue":"Red"} Wins · {warResult.warWinType==="SWEEP"?"Sweep":"Tiebreaker"}{warResult.timeDiff>0?` (${fmtSecMS(warResult.timeDiff)} faster)`:""}
                                </span>
                              </div>}
                            </>;
                          })()}
                        </div>;
                      })}
                    </div>;
                  })()}
                  {activeLanes.length>=1&&!allCompleted&&(activeLanes.length>1||lanes.some(l=>l.type===null))&&<div style={{display:"flex",justifyContent:"center",marginBottom:".75rem"}}><button className="btn btn-s" style={{fontSize:".82rem",padding:".35rem .85rem"}} onClick={()=>{const allSameMode=activeLanes.every(l=>l.mode===activeLanes[0]?.mode);if(!allSameMode){setLaneArrangeWarn({time,rawLanes});}else{setShowLaneOverride({time,rawLanes,allowCrossMode:false});}}}>⇄ Arrange Lanes</button></div>}
                  {activeLanes.length>0?(
                    <div style={{display:"flex",gap:"1rem",alignItems:"flex-start"}}>
                    {activeLanes.map(lane=>(
                      <div key={lane.laneNum} style={{flex:1,minWidth:0}}>
                        <div style={{display:"flex",alignItems:"center",gap:".5rem",marginBottom:".6rem",paddingBottom:".45rem",borderBottom:`2px solid ${laneReady(lane)?"rgba(40,200,100,.4)":"var(--bdr)"}`}}>
                          <span style={{fontWeight:700,fontSize:".8rem",color:"var(--txt)"}}>Lane {lane.laneNum}</span>
                          <span className={`badge b-${lane.mode}`}>{lane.mode}</span>
                          <span className={`badge b-${lane.type}`}>{lane.type}</span>
                          {laneReady(lane)&&<span style={{fontSize:".75rem",fontWeight:700,color:"#2dc86e",background:"rgba(40,200,100,.12)",border:"1px solid rgba(40,200,100,.35)",borderRadius:4,padding:".15rem .5rem"}}>✓ Lane Ready</span>}
                          <span style={{fontSize:".78rem",color:"var(--muted)",marginLeft:"auto"}}>👥 {lane.playerCount}p booked</span>
                          {!allCompleted&&lane.reservations.length>0&&(
                            flipConfirm?.laneNum===lane.laneNum&&flipConfirm?.time===time
                              ?<><span style={{fontSize:".7rem",color:"var(--warn)",whiteSpace:"nowrap"}}>Switch to {lane.mode==='versus'?'co-op':'versus'}?</span><button className="btn btn-p btn-s" style={{fontSize:".68rem",padding:".15rem .4rem"}} disabled={flipBusy} onClick={doFlipLane}>{flipBusy?'…':'Yes'}</button><button className="btn btn-s" style={{fontSize:".68rem",padding:".15rem .4rem"}} onClick={()=>setFlipConfirm(null)}>No</button></>
                              :<button className="btn btn-s" style={{fontSize:".68rem",padding:".15rem .45rem",whiteSpace:"nowrap"}} title={`Switch lane to ${lane.mode==='versus'?'co-op':'versus'}`} onClick={()=>setFlipConfirm({time,laneNum:lane.laneNum,targetMode:lane.mode==='versus'?'coop':'versus',lane})}>⇄ {lane.mode==='versus'?'Co-op':'Versus'}</button>
                          )}
                        </div>
                        {lane.reservations.length===0&&<div style={{fontSize:".85rem",color:"var(--muted)",padding:".5rem 0"}}>No bookings in this lane.</div>}
                        {lane.reservations.map(renderResCard)}
                      </div>
                    ))}
                    </div>
                  ):(
                    <>
                      {slotResItems.length===0&&<div style={{color:"var(--muted)",textAlign:"center",padding:".75rem 0",fontSize:".9rem"}}>No reservations for this slot yet.</div>}
                      {slotResItems.map(renderResCard)}
                    </>
                  )}
                  {(lanes.filter(l=>l.type===null).length>0||lanes.some(l=>l.type==="open"&&l.playerCount<laneCapacity(l.mode)))&&<button className="btn btn-s" style={{width:"100%",marginTop:".25rem",fontSize:".9rem"}} onClick={()=>{setShowWI(time);setWi({phone:"",lookupStatus:"idle",foundUserId:null,customerName:"",typeId:"",playerCount:1,customTime:"",date:"",extraSlots:[],addSecondLane:false,splitA:0});}}>+ Walk-In this Slot</button>}
                </div>
              );
            })()}
          </div>
        );
      })}
      {showWI&&(()=>{
        const wiName=wi.foundUserId?(users.find(u=>u.id===wi.foundUserId)?.name||wi.customerName):wi.customerName.trim();
        const wiFreeLanes=wiAllLanes.filter(l=>l.type===null).length;
        const offerSecondLane=wiIsPriv&&wiFreeLanes>=2;
        const wiExtraSlots=wi.extraSlots||[];
        const wiExtraTimes=wiExtraSlots.map(s=>s.time);
        // Capacity check for current type+playerCount
        const wiCap=wiIsOpen&&wiRt?.mode&&wiTime?openPlayCapacity(wiRt.mode,wiAllLanes):null;
        const wiCapStatus=!wiCap?"ok":wi.playerCount>wiCap.total?"full":wi.playerCount>wiCap.maxSingle?"split":"ok";
        const splitB=wi.splitA>0?wi.playerCount-wi.splitA:0;
        const splitValid=wiCapStatus==="split"&&wi.splitA>0&&wi.splitA<wi.playerCount&&wi.splitA<=(wiCap?.blocks[0]||0)&&splitB<=(wiCap?.blocks[1]||0);
        const slotCount=1+(wiExtraTimes.length||0);
        const wiAmt=wiRt?(wiIsPriv?wiRt.price*((wi.addSecondLane?2:1)+wiExtraSlots.reduce((s,es)=>s+(es.addSecondLane?2:1),0)):wiRt.price*wi.playerCount*slotCount):0;
        const wiOpenMax=wiIsOpen&&wiRt?Math.max(1,wiCap?Math.min(wiCap.maxSingle,laneCapacity(wiRt.mode)):laneCapacity(wiRt.mode)):20;
        const wiPrivateRt=wiIsOpen&&wiRt?resTypes.find(rt=>rt.mode===wiRt.mode&&rt.style==="private"&&rt.active):null;
        const wiOpenPerSession=wiIsOpen&&wiRt?wiRt.price*wi.playerCount:0;
        const wiShowPrivateUpsell=wiIsOpen&&wiPrivateRt&&wi.playerCount>0&&wiOpenPerSession>=wiPrivateRt.price;
        const canProceed=wi.typeId&&wiTime&&(wi.lookupStatus==="found"||(wi.lookupStatus==="named"&&wi.customerName.trim()))&&wiCapStatus!=="full"&&(wiCapStatus!=="split"||splitValid);
        return(
          <div className="mo"><div className="mc">
            {wiStep==="details"&&<>
              <div className="mt2">Walk-In{wiTime?` — ${wiDate!==today?new Date(wiDate+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})+" ":""}${fmt12(wiTime)}`:""}</div>
              <div className="f">
                <label>Phone Number</label>
                <div style={{display:"flex",gap:".5rem",alignItems:"center"}}>
                  <div className="phone-wrap" style={{flex:1}}><span className="phone-prefix">+1</span><input type="tel" maxLength={10} value={wi.phone} onChange={e=>setWi(p=>({...p,phone:cleanPh(e.target.value),lookupStatus:"idle",foundUserId:null,customerName:""}))} onKeyDown={e=>e.key==="Enter"&&doWiLookup()} placeholder="Area code + number" autoFocus/></div>
                  {(wi.lookupStatus==="idle"||wi.lookupStatus==="searching")&&<button className="btn btn-s" disabled={cleanPh(wi.phone).length<10||wi.lookupStatus==="searching"} onClick={doWiLookup}>{wi.lookupStatus==="searching"?"…":"Search →"}</button>}
                  {wi.lookupStatus!=="idle"&&wi.lookupStatus!=="searching"&&<button className="btn btn-s" onClick={()=>setWi(p=>({...p,phone:"",lookupStatus:"idle",foundUserId:null,customerName:""}))}>✕ Clear</button>}
                </div>
              </div>
              {wi.lookupStatus==="found"&&wi.foundUserId&&(()=>{const u=users.find(x=>x.id===wi.foundUserId);const displayName=u?.name||wi.customerName||"";return<div style={{display:"flex",alignItems:"center",gap:".5rem",background:"rgba(40,200,100,.1)",border:"1px solid rgba(40,200,100,.3)",borderRadius:6,padding:".6rem .85rem",marginBottom:".5rem"}}><span style={{background:"var(--acc2)",color:"var(--bg2)",borderRadius:"50%",width:28,height:28,display:"inline-flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:".75rem",flexShrink:0}}>{getInitials(displayName)}</span><div><div style={{fontWeight:700,color:"var(--txt)",fontSize:".95rem"}}>{displayName}</div><div style={{fontSize:".75rem",color:"var(--muted)"}}>{u?.phone?fmtPhone(u.phone):""}{u?.authProvider?` · ${u.authProvider}`:""}</div></div><span style={{marginLeft:"auto",color:"#2dc86e",fontWeight:600,fontSize:".85rem"}}>✓ Found</span></div>;})()}
              {(wi.lookupStatus==="notfound"||wi.lookupStatus==="named")&&<div style={{marginBottom:".5rem"}}>{wi.lookupStatus==="notfound"&&<div style={{fontSize:".8rem",color:"var(--muted)",marginBottom:".4rem"}}>No account found — enter a name to continue as a guest.</div>}<div className="f" style={{marginBottom:wi.lookupStatus==="named"?".35rem":0}}><label>Customer Name{wi.lookupStatus==="notfound"&&<span style={{color:"var(--danger)"}}> *</span>}</label><input value={wi.customerName} onChange={e=>setWi(p=>({...p,customerName:e.target.value,lookupStatus:e.target.value.trim()?"named":"notfound"}))} placeholder="First Last" autoFocus/></div>{wi.lookupStatus==="named"&&<div style={{fontSize:".75rem",color:"var(--muted)"}}>Guest walk-in — no existing account.</div>}</div>}
              {showWI==="custom"&&<div style={{marginBottom:".75rem"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:".35rem"}}>
                  <span style={{fontWeight:600,fontSize:".85rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:".04em"}}>Date &amp; Time</span>
                  <input type="date" value={wiDate} min={today} onChange={e=>setWi(p=>({...p,date:e.target.value,customTime:"",extraSlots:[],splitA:0}))} style={{fontSize:".82rem",padding:".25rem .5rem",background:"var(--bg2)",border:"1px solid var(--bdr)",borderRadius:5,color:"var(--txt)"}}/>
                </div>
                {wiAvailSlots.length===0&&<div style={{fontSize:".85rem",color:"var(--muted)",padding:".65rem",background:"var(--bg2)",border:"1px dashed var(--bdr)",borderRadius:6,textAlign:"center"}}>No slots available for this date.</div>}
                {wiAvailSlots.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:".4rem"}}>{wiAvailSlots.map(st=>{const sel=wi.customTime===st;const hasCapacity=wiSlotCapMap[st]??true;return<button key={st} type="button" disabled={!hasCapacity} onClick={()=>hasCapacity&&setWi(p=>({...p,customTime:st,extraSlots:[],splitA:0}))} style={{padding:".4rem .9rem",borderRadius:20,fontSize:".9rem",fontWeight:sel?700:500,border:`2px solid ${sel?"var(--acc)":"var(--bdr)"}`,background:sel?"var(--accD)":"var(--bg2)",color:sel?"var(--accB)":!hasCapacity?"var(--muted)":"var(--txt)",cursor:hasCapacity?"pointer":"not-allowed",opacity:!hasCapacity&&!sel?.5:1}}>{fmt12(st)}{!hasCapacity?" ✕":""}</button>;})}</div>}
              </div>}
              <div className="f"><label>Type</label><div style={{display:"flex",flexWrap:"wrap",gap:".4rem"}}>{filteredWiResTypes.map(rt=>{const sel=wi.typeId===rt.id;return(<button key={rt.id} type="button" onClick={()=>setWi(p=>({...p,typeId:rt.id,splitA:0,extraSlots:[],playerCount:1}))} style={{padding:".55rem 1.2rem",borderRadius:20,fontSize:".9rem",fontWeight:sel?700:500,border:`2px solid ${sel?"var(--acc)":"var(--bdr)"}`,background:sel?"var(--accD)":"var(--bg2)",color:sel?"var(--accB)":"var(--txt)",cursor:"pointer",textTransform:"uppercase",letterSpacing:".04em"}}>{rt.name}</button>);})} {filteredWiResTypes.length===0&&<div style={{fontSize:".85rem",color:"var(--muted)",padding:".4rem 0",fontStyle:"italic"}}>{wiTime?"No types available for this slot.":"Select a time first."}</div>}</div></div>
              {offerSecondLane&&<div style={{background:"rgba(40,200,100,.08)",border:"1px solid rgba(40,200,100,.3)",borderRadius:8,padding:".65rem .9rem",marginBottom:".5rem",display:"flex",alignItems:"center",gap:".75rem",cursor:"pointer"}} onClick={()=>setWi(p=>({...p,addSecondLane:!p.addSecondLane}))}><input type="checkbox" checked={wi.addSecondLane} readOnly style={{width:18,height:18,cursor:"pointer",accentColor:"var(--acc)"}}/><div style={{flex:1}}><div style={{fontWeight:700,color:"#2dc86e",fontSize:".9rem"}}>{wi.addSecondLane?"Both lanes reserved":"Reserve both lanes"}</div><div style={{fontSize:".8rem",color:"var(--muted)"}}>{wi.addSecondLane?"Uncheck to book single lane only.":"Check to book both lanes — "+( wiRt?.mode==="versus"?"up to 24":"up to 12")+" players total."}</div></div><span style={{fontWeight:700,color:"var(--accB)",whiteSpace:"nowrap"}}>+{fmtMoney(wiRt?.price||0)}</span></div>}
              {!wiIsPriv&&<div className="f"><label>Player Count</label><div style={{display:"flex",alignItems:"center",gap:"1rem"}}><span style={{fontSize:"2.2rem",fontWeight:800,color:wi.typeId?"var(--txt)":"var(--muted)",minWidth:48,textAlign:"center",lineHeight:1,flexShrink:0}}>{wi.playerCount}</span><div style={{flex:1,display:"flex",flexDirection:"column",gap:".25rem"}}><input type="range" min={1} max={wiOpenMax} value={Math.min(wi.playerCount,wiOpenMax)} disabled={!wi.typeId} onChange={e=>setWi(p=>({...p,playerCount:+e.target.value,splitA:0,extraSlots:[]}))} style={{width:"100%",accentColor:"var(--acc)",height:6,cursor:wi.typeId?"pointer":"not-allowed",opacity:wi.typeId?1:.35}}/><div style={{display:"flex",justifyContent:"space-between",fontSize:".72rem",color:"var(--muted)"}}><span>1</span>{wi.typeId&&wiTime&&wiIsOpen&&wiRt&&<span style={{color:wiOpenMax<3?"var(--warn)":"var(--muted)",fontWeight:600}}>{wiOpenMax} max</span>}</div></div></div>{!wi.typeId&&<div style={{fontSize:".78rem",color:"var(--muted)",marginTop:".3rem"}}>Select a type first.</div>}</div>}
              {wiShowPrivateUpsell&&<div style={{background:"rgba(58,125,255,.08)",border:"1px solid rgba(58,125,255,.3)",borderRadius:7,padding:".75rem 1rem",marginBottom:".5rem"}}><div style={{fontWeight:700,color:"#60a5fa",fontSize:".9rem",marginBottom:".25rem"}}>💡 Private Play May Be a Better Deal</div><div style={{fontSize:".82rem",color:"var(--muted)",marginBottom:".55rem"}}>{wi.playerCount} players at open play ({fmtMoney(wiOpenPerSession)}/session) meets or exceeds a private {wiRt?.mode} lane ({fmtMoney(wiPrivateRt.price)}/session) — your group gets the whole lane.</div><button type="button" className="btn btn-p" style={{fontSize:".82rem",padding:".35rem .85rem"}} onClick={()=>setWi(p=>({...p,typeId:wiPrivateRt.id,splitA:0,extraSlots:[],playerCount:1}))}>Switch to {wiPrivateRt.name} →</button></div>}
              {wiIsPriv&&<div style={{fontSize:".82rem",color:"var(--muted)",marginBottom:".5rem",padding:".45rem .6rem",background:"var(--bg2)",border:"1px solid var(--bdr)",borderRadius:5}}>Private: up to <strong style={{color:"var(--txt)"}}>{wiRt?.maxPlayers||laneCapacity(wiRt?.mode||"coop")}</strong> players{wi.addSecondLane?` per lane (${(wiRt?.maxPlayers||laneCapacity(wiRt?.mode||"coop"))*2} total across both)`:""}</div>}
              {wiCapStatus==="full"&&<div style={{background:"rgba(184,50,50,.1)",border:"1px solid rgba(184,50,50,.4)",borderRadius:7,padding:".7rem 1rem",marginBottom:".5rem"}}><div style={{fontWeight:700,color:"var(--danger)",fontSize:".9rem",marginBottom:".2rem"}}>No room for {wi.playerCount} players</div><div style={{fontSize:".82rem",color:"var(--muted)"}}>All {wiRt?.mode} lanes are full at this time. Please choose a different time slot.</div></div>}
              {wiCapStatus==="split"&&(()=>{const b0=wiCap.blocks[0]||0;const b1=wiCap.blocks[1]||0;const maxA=Math.min(b0,wi.playerCount-1);return(<div style={{background:"rgba(184,150,12,.08)",border:"1px solid var(--warn)",borderRadius:7,padding:".75rem 1rem",marginBottom:".5rem"}}><div style={{fontWeight:700,color:"var(--warnL)",fontSize:".9rem",marginBottom:".35rem"}}>⚠ Group of {wi.playerCount} can't fit in one {wiRt?.mode} lane</div><div style={{fontSize:".82rem",color:"var(--muted)",marginBottom:".65rem"}}>Split across 2 lanes, or choose a different time.</div><div style={{display:"flex",alignItems:"center",gap:".6rem",flexWrap:"wrap",marginBottom:".45rem"}}><span style={{fontSize:".85rem",color:"var(--txt)",fontWeight:600}}>Lane A</span><span style={{fontSize:".75rem",color:"var(--muted)"}}>({b0} spot{b0!==1?"s":""} avail.)</span><div style={{display:"flex",alignItems:"center",gap:".4rem"}}><button type="button" className="btn btn-s" style={{width:40,height:40,fontSize:"1.3rem",padding:0,lineHeight:1}} disabled={wi.splitA<=1} onClick={()=>setWi(p=>({...p,splitA:Math.max(1,p.splitA-1)}))}>−</button><span style={{minWidth:36,textAlign:"center",fontSize:"1.15rem",fontWeight:700,color:"var(--txt)"}}>{wi.splitA||"—"}</span><button type="button" className="btn btn-s" style={{width:40,height:40,fontSize:"1.3rem",padding:0,lineHeight:1}} disabled={wi.splitA>=maxA} onClick={()=>setWi(p=>({...p,splitA:Math.min(maxA,p.splitA+1)}))}>+</button></div><span style={{fontSize:".85rem",color:"var(--muted)"}}>players</span></div><div style={{display:"flex",alignItems:"center",gap:".6rem",flexWrap:"wrap"}}><span style={{fontSize:".85rem",color:"var(--txt)",fontWeight:600}}>Lane B</span><span style={{fontSize:".75rem",color:"var(--muted)"}}>({b1} spot{b1!==1?"s":""} avail.)</span><span style={{minWidth:56,textAlign:"center",background:"var(--surf)",border:"1px solid var(--bdr)",borderRadius:5,padding:".3rem .4rem",color:wi.splitA>0&&splitB>b1?"var(--danger)":"var(--txt)",fontSize:".95rem",display:"inline-block"}}>{wi.splitA>0?splitB:"—"}</span><span style={{fontSize:".85rem",color:"var(--muted)"}}>players</span>{wi.splitA>0&&splitB>b1&&<span style={{fontSize:".75rem",color:"var(--danger)"}}>exceeds lane B capacity</span>}</div></div>);})()}
              {wiRt&&wiTime&&wiExtraAvail.length>0&&<div style={{marginBottom:".5rem"}}>
                <div style={{fontWeight:600,fontSize:".82rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:".04em",marginBottom:".35rem"}}>Add More Sessions</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:".35rem"}}>{wiExtraAvail.map(st=>{const sel=wiExtraTimes.includes(st);return<button key={st} type="button" onClick={()=>setWi(p=>({...p,extraSlots:sel?p.extraSlots.filter(x=>x.time!==st):[...p.extraSlots,{time:st,addSecondLane:false}]}))} style={{padding:".35rem .75rem",borderRadius:20,fontSize:".85rem",fontWeight:sel?700:500,border:`2px solid ${sel?"var(--acc)":"var(--bdr)"}`,background:sel?"var(--accD)":"var(--bg2)",color:sel?"var(--accB)":"var(--txt)",cursor:"pointer"}}>{fmt12(st)}</button>;})}</div>
                {wiIsPriv&&wiExtraSlots.length>0&&wiExtraSlots.map(es=>{const esLanes=buildLanes(wiDate,es.time,reservations,resTypes,sessionTemplates).lanes;const esFree=esLanes.filter(l=>l.type===null).length;if(esFree<2)return null;return(<div key={es.time} style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:es.addSecondLane?"rgba(40,200,100,.08)":"var(--bg2)",border:`1px solid ${es.addSecondLane?"rgba(40,200,100,.3)":"var(--bdr)"}`,borderRadius:7,padding:".5rem .75rem",marginTop:".4rem",cursor:"pointer"}} onClick={()=>setWi(p=>({...p,extraSlots:p.extraSlots.map(x=>x.time===es.time?{...x,addSecondLane:!x.addSecondLane}:x)}))}><div style={{display:"flex",alignItems:"center",gap:".5rem"}}><input type="checkbox" checked={es.addSecondLane} readOnly style={{width:16,height:16,accentColor:"var(--acc)",cursor:"pointer"}}/><span style={{fontSize:".85rem",color:"var(--txt)",fontWeight:600}}>{fmt12(es.time)}</span><span style={{fontSize:".8rem",color:es.addSecondLane?"#2dc86e":"var(--muted)"}}>— {es.addSecondLane?"both lanes reserved":"check to reserve both lanes"}</span></div><span style={{fontSize:".8rem",color:es.addSecondLane?"#2dc86e":"var(--muted)",fontWeight:600,whiteSpace:"nowrap"}}>+{fmtMoney(wiRt?.price||0)}</span></div>);}) }
                {wiExtraTimes.length>0&&<div style={{fontSize:".78rem",color:"var(--muted)",marginTop:".3rem"}}>{wiExtraTimes.length} additional session{wiExtraTimes.length!==1?"s":""} selected</div>}
              </div>}
              {wiRt&&wiCapStatus!=="full"&&<div style={{background:"var(--accD)",border:"1px solid var(--acc2)",borderRadius:5,padding:".7rem",marginBottom:".5rem",display:"flex",justifyContent:"space-between"}}><span style={{color:"var(--muted)"}}>{wiRt.name}{!wiIsPriv?` · ${wi.playerCount}p`:""}{wiCapStatus==="split"&&splitValid?" · split 2 lanes":""}{wi.addSecondLane?" · 2 lanes":""}{slotCount>1?` · ${slotCount} sessions`:""}</span><strong style={{color:"var(--accB)"}}>{fmtMoney(wiAmt)}</strong></div>}
              <div className="ma"><button className="btn btn-s" onClick={resetWI}>Cancel</button><button className="btn btn-p" disabled={!canProceed} onClick={()=>setWiStep("payment")}>Continue to Payment →</button></div>
            </>}
            {wiStep==="payment"&&<>
              <div className="mt2">Collect Payment</div>
              <div style={{background:"var(--bg2)",border:"1px solid var(--bdr)",borderRadius:8,padding:"1rem 1.2rem",marginBottom:"1rem"}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:".4rem"}}><span style={{color:"var(--muted)"}}>Customer</span><strong style={{color:"var(--txt)"}}>{wiName}</strong></div>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:".4rem"}}><span style={{color:"var(--muted)"}}>Type</span><span style={{color:"var(--txt)"}}>{wiRt?.name}</span></div>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:".4rem"}}><span style={{color:"var(--muted)"}}>Players</span><span style={{color:"var(--txt)"}}>{wiIsPriv?(wiRt?.maxPlayers||laneCapacity(wiRt?.mode||"coop")):wi.playerCount}{wiCapStatus==="split"&&splitValid?` (${wi.splitA}+${splitB} split)`:""}</span></div>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:".4rem"}}><span style={{color:"var(--muted)"}}>Session{slotCount>1?"s":""}</span><span style={{color:"var(--txt)",textAlign:"right"}}>{[wiTime,...wiExtraTimes].map(t=>fmt12(t)).join(", ")}{wiDate!==today?" · "+new Date(wiDate+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"}):""}</span></div>
                <div style={{borderTop:"1px solid var(--bdr)",marginTop:".6rem",paddingTop:".6rem",display:"flex",justifyContent:"space-between",alignItems:"baseline"}}><span style={{fontWeight:600,color:"var(--txt)"}}>Total Due</span><span style={{fontSize:"1.6rem",fontWeight:800,color:"var(--accB)"}}>{fmtMoney(wiAmt)}</span></div>
              </div>
              {(()=>{const warn=wiRt?.mode==='versus'&&wiIsOpen?calcVsSlotWarn(wiDate,wiTime,wi.playerCount,reservations,resTypes):null;return warn?<div style={{background:"rgba(79,195,247,.08)",border:"1px solid rgba(79,195,247,.3)",borderRadius:6,padding:".65rem 1rem",fontSize:".85rem",color:"var(--acc2)",marginBottom:".75rem"}}>⚠ {warn}</div>:null;})()}
              <div style={{background:"rgba(184,150,12,.08)",border:"1px solid var(--warn)",borderRadius:6,padding:".75rem 1rem",fontSize:".9rem",color:"var(--warnL)",marginBottom:"1rem",textAlign:"center"}}>💳 Present card terminal to customer for <strong>{fmtMoney(wiAmt)}</strong></div>
              <div style={{background:"var(--surf)",border:"1px solid var(--bdr)",borderRadius:6,padding:".65rem .85rem",marginBottom:"1rem"}}>
                <div style={{fontSize:".68rem",color:"var(--muted)",fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",marginBottom:".5rem"}}>Card Details (after terminal approval)</div>
                <div style={{display:"flex",gap:".5rem",marginBottom:".4rem"}}>
                  <div style={{flex:1}}><label style={{fontSize:".72rem",color:"var(--muted)",display:"block",marginBottom:".2rem"}}>Last 4 Digits</label><input type="text" maxLength={4} placeholder="1234" value={wiCardLast4} onChange={e=>setWiCardLast4(e.target.value.replace(/\D/g,''))} style={{background:"var(--bg2)",border:"1px solid var(--bdr)",borderRadius:4,padding:".35rem .5rem",color:"var(--txt)",fontSize:".88rem",width:"100%"}}/></div>
                  <div style={{flex:1}}><label style={{fontSize:".72rem",color:"var(--muted)",display:"block",marginBottom:".2rem"}}>Expiry (MM/YY)</label><input type="text" maxLength={5} placeholder="MM/YY" value={wiCardExpiry} onChange={handleWiCardExpiry} style={{background:"var(--bg2)",border:"1px solid var(--bdr)",borderRadius:4,padding:".35rem .5rem",color:"var(--txt)",fontSize:".88rem",width:"100%"}}/></div>
                </div>
                <div><label style={{fontSize:".72rem",color:"var(--muted)",display:"block",marginBottom:".2rem"}}>Name on Card</label><input type="text" placeholder={wiName||"Cardholder name"} value={wiCardHolder} onChange={e=>setWiCardHolder(e.target.value)} style={{background:"var(--bg2)",border:"1px solid var(--bdr)",borderRadius:4,padding:".35rem .5rem",color:"var(--txt)",fontSize:".88rem",width:"100%"}}/></div>
              </div>
              <div className="ma"><button className="btn btn-s" onClick={()=>setWiStep("details")}>← Back</button><button className="btn btn-p" disabled={wiSaving} onClick={doCreateWalkIn}>{wiSaving?"Processing…":"Payment Collected — Complete Walk-In"}</button></div>
            </>}
            {wiStep==="players"&&(()=>{
              const primaryRes=reservations.find(r=>r.id===wiNewResIds[0]);
              const currentPlayers=primaryRes?.players||[];
              const wiMaxPlayers=wiIsPriv?(wiRt?.maxPlayers||laneCapacity(wiRt?.mode||"coop")):(wi.playerCount||null);
              const atCapacity=wiMaxPlayers!==null&&currentPlayers.length>=wiMaxPlayers;
              return<>
                <div className="mt2">Add Players</div>
                {wiNewResIds.length>1&&<div style={{fontSize:".82rem",color:"var(--muted)",marginBottom:".75rem",textAlign:"center",background:"rgba(79,195,247,.07)",border:"1px solid rgba(79,195,247,.2)",borderRadius:5,padding:".4rem .75rem"}}>Players added here will be added to all {wiNewResIds.length} sessions</div>}
                {atCapacity
                  ?<div style={{background:"rgba(45,200,110,.08)",border:"1px solid rgba(45,200,110,.3)",borderRadius:6,padding:".7rem 1rem",marginBottom:"1rem",textAlign:"center",fontSize:".9rem",color:"var(--okB)"}}>✓ Session is full ({wiMaxPlayers} / {wiMaxPlayers} players)</div>
                  :<div style={{background:"var(--surf)",border:"1px solid var(--bdr)",borderRadius:6,padding:".6rem .75rem",marginBottom:"1rem"}}>
                    <div style={{display:"flex",gap:".4rem",alignItems:"center",marginBottom:".35rem"}}>
                      <div className="phone-wrap" style={{flex:1}}><span className="phone-prefix">+1</span><input ref={wiPhoneRef} type="tel" maxLength={10} value={wiAddInput.phone} onChange={e=>setWiAddInput({phone:cleanPh(e.target.value),lookupStatus:"idle",foundUserId:null,name:""})} onKeyDown={e=>e.key==="Enter"&&doWiLookupPlayer()} placeholder="Phone" autoFocus style={{fontSize:".9rem"}}/></div>
                      {(wiAddInput.lookupStatus==="idle"||wiAddInput.lookupStatus==="searching")&&<button className="btn btn-s" disabled={cleanPh(wiAddInput.phone).length<10||wiAddInput.lookupStatus==="searching"} onClick={doWiLookupPlayer}>{wiAddInput.lookupStatus==="searching"?"…":"Search →"}</button>}
                      {wiAddInput.lookupStatus!=="idle"&&wiAddInput.lookupStatus!=="searching"&&<button className="btn btn-s" onClick={()=>setWiAddInput({phone:"",lookupStatus:"idle",foundUserId:null,name:""})}>✕</button>}
                    </div>
                    {wiAddInput.lookupStatus==="found"&&wiAddInput.foundUserId&&<div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:".5rem",marginBottom:".35rem"}}><span style={{fontSize:".85rem",color:"var(--muted)"}}>Found: <strong style={{color:"var(--txt)"}}>{wiAddInput.name}</strong></span><button className="btn btn-p" style={{padding:".3rem .8rem",fontSize:".85rem"}} autoFocus onClick={doWiAddPlayer}>+ Add to Session</button></div>}
                    {(wiAddInput.lookupStatus==="notfound"||wiAddInput.lookupStatus==="named")&&<div style={{display:"flex",gap:".4rem",alignItems:"center"}}><input placeholder="Player name" value={wiAddInput.name} onChange={e=>setWiAddInput(p=>({...p,name:e.target.value,lookupStatus:e.target.value.trim()?"named":"notfound"}))} onKeyDown={e=>e.key==="Enter"&&wiAddInput.name.trim()&&doWiAddPlayer()} autoFocus style={{flex:1,background:"var(--bg2)",border:"1px solid var(--bdr)",borderRadius:5,padding:".4rem .6rem",color:"var(--txt)",fontSize:".9rem"}}/><button className="btn btn-p" disabled={!wiAddInput.name.trim()} onClick={doWiAddPlayer}>Add</button></div>}
                    {wiAddInput.lookupStatus==="notfound"&&<div style={{fontSize:".72rem",color:"var(--muted)",marginTop:".25rem"}}>No account found — type a name to add as a guest.</div>}
                  </div>}
                {currentPlayers.length>0&&<div style={{background:"var(--bg2)",border:"1px solid var(--bdr)",borderRadius:6,padding:".4rem .75rem",marginBottom:".75rem"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:".25rem"}}><span style={{fontSize:".72rem",color:"var(--muted)",fontWeight:600,textTransform:"uppercase",letterSpacing:".06em"}}>Players</span>{wiMaxPlayers&&<span style={{fontSize:".72rem",color:atCapacity?"var(--okB)":"var(--muted)"}}>{currentPlayers.length} / {wiMaxPlayers}</span>}</div>
                  {currentPlayers.map(p=><div key={p.id} style={{display:"flex",alignItems:"center",gap:".5rem",padding:".3rem 0",borderBottom:"1px solid var(--bdr)"}}>
                    <span style={{color:"#2dc86e",fontSize:".8rem"}}>✓</span>
                    <span style={{fontSize:".9rem",color:"var(--txt)",flex:1}}>{p.name}</span>
                    <button onClick={()=>doWiRemovePlayer(p.userId)} style={{background:"none",border:"none",color:"var(--muted)",cursor:"pointer",fontSize:".9rem",padding:".1rem .3rem",lineHeight:1}} title="Remove player">✕</button>
                  </div>)}
                </div>}
                <div className="ma"><button className="btn btn-p" onClick={resetWI}>Done — Go to Ops</button></div>
              </>;
            })()}
          </div></div>
        );
      })()}
      {signingFor&&<WaiverModal
        playerName={signingFor.player.name}
        waiverDoc={activeWaiverDoc}
        onClose={()=>setSigningFor(null)}
        onSign={async(name)=>{const{player}=signingFor;if(!player.userId)return;try{await signWaiver(player.userId,name,activeWaiverDoc?.id);const ts=new Date().toISOString();setSignedNow(prev=>{const next=new Set(prev);next.add(player.userId);return next;});setUsers(p=>p.map(u=>u.id===player.userId?{...u,waivers:[...u.waivers,{signedAt:ts,signedName:name,waiverDocId:activeWaiverDoc?.id}],needsRewaiverDocId:null}:u));showMsg("Waiver signed for "+player.name);setSigningFor(null);}catch(e){alert("Waiver save failed: "+e.message);}}}
      />}
      {sendConfirm&&(
        <div className="mo"><div className="mc">
          <div className="mt2">Send Group?</div>
          <p style={{color:"var(--muted)",marginBottom:"1.2rem",lineHeight:1.6}}>Send all <strong style={{color:"var(--txt)"}}>Ready</strong> parties at <strong style={{color:"var(--acc)"}}>{fmt12(sendConfirm)}</strong> to the safety &amp; training room?<br/>No-shows will remain marked as No Show.</p>
          <div className="ma"><button className="btn btn-s" onClick={()=>setSendConfirm(null)}>No, Go Back</button><button className="btn btn-p" disabled={statusBusy===sendConfirm} onClick={()=>doSendGroup(sendConfirm)}>{statusBusy===sendConfirm?"Sending…":"Yes, Send Group"}</button></div>
        </div></div>
      )}
      {showMerch&&(
        <div className="mo" onClick={()=>setShowMerch(false)}>
          <div className="mc" style={{maxWidth:'min(95vw,940px)',width:'940px',padding:'1.5rem'}} onClick={e=>e.stopPropagation()}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1rem'}}>
              <span className="mt2" style={{margin:0}}>Walk-In Merch Sale</span>
              <button className="btn btn-s btn-sm" onClick={()=>setShowMerch(false)}>✕ Close</button>
            </div>
            <MerchStaffSales currentUser={currentUser} users={users} setUsers={setUsers} setPayments={setPayments} onAlert={showMsg} onClose={()=>setShowMerch(false)}/>
          </div>
        </div>
      )}
      {laneArrangeWarn&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.72)",zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:"1.5rem"}} onClick={()=>setLaneArrangeWarn(null)}>
          <div style={{background:"var(--surf)",border:"1px solid var(--warn)",borderRadius:12,maxWidth:420,width:"100%",padding:"1.5rem 1.75rem"}} onClick={e=>e.stopPropagation()}>
            <div style={{fontWeight:700,fontSize:"1.05rem",color:"var(--warnL)",marginBottom:".75rem"}}>⚠ Lane Mode Mismatch</div>
            <div style={{fontSize:".88rem",color:"var(--txt)",lineHeight:1.6,marginBottom:"1.25rem"}}>
              These lanes have different session types (Co-op and Versus). You can still rearrange groups across lanes — you'll be asked to confirm the final session mode before saving.
            </div>
            <div style={{display:"flex",gap:".65rem",justifyContent:"flex-end"}}>
              <button className="btn" onClick={()=>setLaneArrangeWarn(null)}>← Back</button>
              <button className="btn btn-warn" onClick={()=>{setShowLaneOverride({time:laneArrangeWarn.time,rawLanes:laneArrangeWarn.rawLanes,allowCrossMode:true});setLaneArrangeWarn(null);}}>Proceed →</button>
            </div>
          </div>
        </div>
      )}
      {showLaneOverride&&<LaneOverrideModal
        time={showLaneOverride.time}
        rawLanes={showLaneOverride.rawLanes}
        laneOverrides={laneOverrides}
        versusTeams={versusTeams}
        resTypes={resTypes}
        reservations={reservations}
        allowCrossMode={showLaneOverride.allowCrossMode??false}
        onClose={()=>setShowLaneOverride(null)}
        onSave={async(newOverrides,newTeams)=>{setLaneOverrides(newOverrides);setVersusTeams(newTeams);try{localStorage.setItem('s317_lanes_'+viewDate,JSON.stringify(newOverrides));}catch{}setShowLaneOverride(null);try{const fresh=await fetchReservations();setReservations(fresh);}catch(e){}}}
      />}
      {scoringSlot&&<ScoringModal
        lanes={scoringSlot.lanes}
        resTypes={resTypes}
        versusTeams={versusTeams}
        users={users}
        currentUser={currentUser}
        onClose={async()=>{
          setScoringSlot(null);
          try{const fresh=await fetchReservations();setReservations(fresh);}catch(e){}
        }}
        onCommit={async ids=>{
          try{for(const id of ids)await updateReservation(id,{status:'completed'});}catch(e){showMsg("Error completing: "+e.message);return;}
          setReservations(p=>p.map(r=>ids.includes(r.id)?{...r,status:'completed'}:r));
          setScoringSlot(null);
          showMsg("Session scored and completed!");
          try{const fresh=await fetchReservations();setReservations(fresh);}catch(e){}
        }}
      />}
    </div>
  );
}
