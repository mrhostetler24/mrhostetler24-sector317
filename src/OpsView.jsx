import { useState, useEffect, useRef } from 'react'
import {
  fetchReservations,
  createReservation,
  updateReservation,
  addPlayerToReservation,
  removePlayerFromReservation,
  fetchUserByPhone,
  createGuestUser,
  signWaiver,
} from './supabase.js'

// ── Shared utilities (mirrored from App.jsx) ─────────────────────────────────
const fmtMoney = n => `$${Number(n).toFixed(2)}`
const fmtPhone = p => p ? `(${p.slice(0,3)}) ${p.slice(3,6)}-${p.slice(6)}` : ""
const fmt12 = t => { if(!t)return""; const[h,m]=t.split(":"); const hr=+h; return`${hr>12?hr-12:hr===0?12:hr}:${m} ${hr>=12?"PM":"AM"}`; }
const getDayName = d => new Date(d+"T12:00:00").toLocaleDateString("en-US",{weekday:"long"})
const cleanPh = p => (p||"").replace(/\D/g,"")
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function hasValidWaiver(user, activeWaiverDoc) {
  if(!user||!user.waivers||!user.waivers.length) return false;
  if(activeWaiverDoc && user.needsRewaiverDocId === activeWaiverDoc.id) return false;
  const latest = user.waivers.reduce((a,b)=>a.signedAt>b.signedAt?a:b);
  if(activeWaiverDoc && latest.waiverDocId !== activeWaiverDoc.id) return false;
  return Date.now() - new Date(latest.signedAt).getTime() < 365*864e5;
}
function getSessionsForDate(date,templates) { return templates.filter(t=>t.active&&t.dayOfWeek===getDayName(date)); }
function laneCapacity(mode){return mode==="versus"?12:6;}
function buildLanes(date,startTime,reservations,resTypes,templates) {
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

// ── WaiverModal ──────────────────────────────────────────────────────────────
function WaiverModal({playerName,waiverDoc,onClose,onSign}){
  const [scrolled,setScrolled]=useState(false);
  const [name,setName]=useState("");
  const [agreed,setAgreed]=useState(false);
  const [isMinor,setIsMinor]=useState(false);
  const [guardianExpanded,setGuardianExpanded]=useState(false);
  const [guardianAgreed,setGuardianAgreed]=useState(false);
  const ref=useRef(null);
  const onScroll=()=>{const el=ref.current;if(el&&el.scrollTop+el.clientHeight>=el.scrollHeight-8)setScrolled(true);};
  const doc=waiverDoc||{name:"Liability Waiver",body:"Content unavailable."};
  const canSign=scrolled&&name.trim()&&agreed&&(!isMinor||guardianAgreed);
  return(
    <div className="mo"><div className="mc" style={{maxWidth:600}}>
      <div className="mt2">Waiver — {playerName}</div>
      <div className={`scroll-hint${scrolled?" done":""}`}>{scrolled?"✓ Read complete":"↓ Scroll entire waiver before signing"}</div>
      <div className="wvr-scroll" ref={ref} onScroll={onScroll}><span className="wvr-title">{doc.name}</span>{doc.body}</div>
      {!scrolled&&<div style={{fontSize:".73rem",color:"var(--dangerL)",textAlign:"center",marginBottom:".75rem"}}>Scroll to bottom to enable signing.</div>}
      <div className="f"><label>Full Legal Name Of Participant/Guardion If Minor </label><input value={name} onChange={e=>setName(e.target.value)} placeholder="Type your full legal name" disabled={!scrolled}/></div>
      <label style={{display:"flex",gap:".65rem",alignItems:"flex-start",fontSize:".82rem",color:scrolled?"var(--txt)":"var(--muted)",cursor:scrolled?"pointer":"not-allowed",opacity:scrolled?1:.6,marginBottom:".85rem"}}>
        <input type="checkbox" checked={agreed} onChange={e=>scrolled&&setAgreed(e.target.checked)} style={{width:"auto",marginTop:"3px",flexShrink:0}} disabled={!scrolled}/>
        <span>I HAVE READ AND AGREE TO THIS RELEASE AND WAIVER AND INTEND MY TYPED NAME TO SERVE AS MY LEGAL SIGNATURE.</span>
      </label>
      <div style={{border:"1px solid var(--bdr)",borderRadius:5,marginBottom:".85rem",overflow:"hidden"}}>
        <button type="button"
          style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",padding:".6rem .9rem",background:"var(--surf2)",border:"none",cursor:scrolled?"pointer":"not-allowed",color:scrolled?"var(--txt)":"var(--muted)",fontSize:".8rem",fontWeight:600,textTransform:"uppercase",letterSpacing:".06em"}}
          disabled={!scrolled}
          onClick={()=>{if(!scrolled)return;setGuardianExpanded(e=>!e);if(guardianExpanded){setIsMinor(false);setGuardianAgreed(false);}else{setIsMinor(true);}}}>
          <span>⚠ Participant is a Minor (Under 18)</span>
          <span style={{fontSize:".9rem"}}>{guardianExpanded?"▲":"▼"}</span>
        </button>
        {guardianExpanded&&(
          <div style={{padding:".85rem .9rem",borderTop:"1px solid var(--warn)",background:"rgba(184,150,12,.04)"}}>
            <div style={{fontSize:".74rem",color:"var(--warnL)",marginBottom:".65rem",fontWeight:700}}>PARENT/GUARDIAN CERTIFICATION REQUIRED</div>
            <label style={{display:"flex",gap:".65rem",alignItems:"flex-start",fontSize:".8rem",color:"var(--txt)",cursor:"pointer",lineHeight:1.5}}>
              <input type="checkbox" checked={guardianAgreed} onChange={e=>setGuardianAgreed(e.target.checked)} style={{width:"auto",marginTop:"3px",flexShrink:0}}/>
              <span>I certify that I am the legal parent or court-appointed guardian of the minor participant, that I have legal authority to sign this agreement on their behalf, and that I agree to all terms of this Release of Liability, including the waiver of claims and indemnification provisions, on behalf of the minor. I intend my typed name to serve as my legal electronic signature.</span>
            </label>
          </div>
        )}
      </div>
      <div className="ma">
        <button className="btn btn-s" onClick={onClose}>Cancel</button>
        <button className="btn btn-p" disabled={!canSign} onClick={()=>onSign(name.trim(),isMinor)}>Sign Waiver</button>
      </div>
    </div></div>
  );
}

export default function OpsView({reservations,setReservations,resTypes,sessionTemplates,users,setUsers,activeWaiverDoc}){
  const [expandedSlot,setExpandedSlot]=useState(null);
  const [expandedRes,setExpandedRes]=useState({});
  const [signingFor,setSigningFor]=useState(null);
  const [signedName,setSignedName]=useState("");
  const [addingTo,setAddingTo]=useState(null);
  const [addingToTeam,setAddingToTeam]=useState(null);
  const [versusTeams,setVersusTeams]=useState({});
  const [addInput,setAddInput]=useState({phone:"",lookupStatus:"idle",foundUserId:null,name:""});
  const [wiStep,setWiStep]=useState("details");
  const [sendConfirm,setSendConfirm]=useState(null);
  const [statusBusy,setStatusBusy]=useState(null);
  const [clock,setClock]=useState(new Date());
  const [showWI,setShowWI]=useState(null);
  const [wi,setWi]=useState({phone:"",lookupStatus:"idle",foundUserId:null,customerName:"",typeId:"",playerCount:1,customTime:"",date:"",extraSlots:[],addSecondLane:false,splitA:0});
  const [wiSaving,setWiSaving]=useState(false);
  const [toast,setToast]=useState(null);
  const [showMerch,setShowMerch]=useState(false);
  const [showHistory,setShowHistory]=useState(false);
  const activeWorkRef=useRef(false);
  useEffect(()=>{const t=setInterval(()=>setClock(new Date()),30000);return()=>clearInterval(t);},[]);
  useEffect(()=>{const t=setInterval(async()=>{if(activeWorkRef.current)return;try{const fresh=await fetchReservations();setReservations(fresh);}catch(e){}},5*60*1000);return()=>clearInterval(t);},[]);
  const showMsg=msg=>{setToast(msg);setTimeout(()=>setToast(null),3000);};
  const today=todayStr();
  const getType=id=>resTypes.find(t=>t.id===id);
  const todayRes=reservations.filter(r=>r.date===today&&r.status!=="cancelled");
  const todayTmpls=sessionTemplates.filter(t=>t.active&&t.dayOfWeek===getDayName(today));
  const slotTimes=[...new Set([...todayTmpls.map(t=>t.startTime),...todayRes.map(r=>r.startTime)])].sort();
  const slotIsHistory=time=>{const[h,m]=time.split(':').map(Number);return clock.getHours()*60+clock.getMinutes()>=h*60+m+75;};
  const activeSlots=slotTimes.filter(t=>!slotIsHistory(t));
  const historySlots=[...slotTimes.filter(slotIsHistory)].reverse();
  const playerWaiverOk=player=>{if(!player.userId)return false;return hasValidWaiver(users.find(u=>u.id===player.userId),activeWaiverDoc);};
  const sBadge=status=>{
    const map={confirmed:{bg:"rgba(90,138,58,.15)",color:"var(--okB)",bdr:"rgba(90,138,58,.3)"},ready:{bg:"rgba(40,200,100,.18)",color:"#2dc86e",bdr:"rgba(40,200,100,.4)"},arrived:{bg:"rgba(40,200,100,.18)",color:"#2dc86e",bdr:"rgba(40,200,100,.4)"},"no-show":{bg:"rgba(184,150,12,.12)",color:"var(--warnL)",bdr:"rgba(184,150,12,.25)"},sent:{bg:"rgba(100,130,240,.18)",color:"#8096f0",bdr:"rgba(100,130,240,.35)"},completed:{bg:"var(--accD)",color:"var(--accB)",bdr:"rgba(138,154,53,.25)"}};
    const label={confirmed:"Confirmed",ready:"Arrived",arrived:"Arrived","no-show":"No Show",sent:"Sent",completed:"Completed"};
    const s=map[status]||map.confirmed;
    return <span style={{display:"inline-block",padding:".25rem .65rem",borderRadius:4,background:s.bg,color:s.color,border:`1px solid ${s.bdr}`,fontWeight:600,fontSize:".8rem",whiteSpace:"nowrap"}}>{label[status]||status}</span>;
  };
  const setResStatus=async(resId,status)=>{setStatusBusy(resId);try{await updateReservation(resId,{status});setReservations(p=>p.map(r=>r.id===resId?{...r,status}:r));}catch(e){showMsg("Error: "+e.message);}setStatusBusy(null);};
  const doSendGroup=async time=>{const readyOnes=todayRes.filter(r=>r.startTime===time&&(r.status==="arrived"||r.status==="ready"));setSendConfirm(null);setStatusBusy(time);try{for(const r of readyOnes){await updateReservation(r.id,{status:"sent"});}setReservations(p=>p.map(r=>r.date===today&&r.startTime===time&&(r.status==="arrived"||r.status==="ready")?{...r,status:"sent"}:r));showMsg("Group sent to training room!");}catch(e){showMsg("Error: "+e.message);}setStatusBusy(null);};
  const doSignWaiver=async()=>{const{player}=signingFor;if(!player.userId||!signedName.trim())return;const ts=new Date().toISOString();setUsers(p=>p.map(u=>u.id===player.userId?{...u,waivers:[...u.waivers,{signedAt:ts,signedName:signedName.trim(),waiverDocId:activeWaiverDoc?.id}],needsRewaiverDocId:null}:u));try{await signWaiver(player.userId,signedName.trim(),activeWaiverDoc?.id);}catch(e){}showMsg("Waiver signed for "+player.name);setSigningFor(null);setSignedName("");};
  const resetAddInput=()=>setAddInput({phone:"",lookupStatus:"idle",foundUserId:null,name:""});
  const doAddLookup=async(resId)=>{const clean=cleanPh(addInput.phone);if(clean.length<10)return;setAddInput(p=>({...p,lookupStatus:"searching"}));try{const found=await fetchUserByPhone(clean);if(found){if(resId!=null){const targetRes=reservations.find(r=>r.id===resId);const slotIds=targetRes?reservations.filter(r=>r.date===targetRes.date&&r.startTime===targetRes.startTime&&r.status!=="cancelled").flatMap(r=>(r.players||[]).map(p=>p.userId).filter(Boolean)):[];if(slotIds.includes(found.id)){setAddInput(p=>({...p,foundUserId:null,name:found.name,lookupStatus:"duplicate"}));return;}try{const pl=await addPlayerToReservation(resId,{name:found.name,userId:found.id});setReservations(prev=>prev.map(r=>r.id===resId?{...r,players:[...(r.players||[]),pl]}:r));if(addingToTeam!==null){setVersusTeams(prev=>({...prev,[resId]:{...(prev[resId]||{}),[pl.id]:addingToTeam}}));}resetAddInput();setAddingTo(null);setAddingToTeam(null);showMsg("Added: "+found.name);}catch(e){showMsg("Error: "+e.message);setAddInput(p=>({...p,foundUserId:found.id,name:found.name,lookupStatus:"found"}));}}else{setAddInput(p=>({...p,foundUserId:found.id,name:found.name,lookupStatus:"found"}));}}else{setAddInput(p=>({...p,foundUserId:null,lookupStatus:"notfound"}));}}catch(e){setAddInput(p=>({...p,lookupStatus:"notfound"}));}};
  const doAddPlayer=async resId=>{const userId=addInput.foundUserId||null;const name=userId?(users.find(u=>u.id===userId)?.name||addInput.name):addInput.name.trim();if(!name)return;if(userId){const targetRes=reservations.find(r=>r.id===resId);const slotIds=targetRes?reservations.filter(r=>r.date===targetRes.date&&r.startTime===targetRes.startTime&&r.status!=="cancelled").flatMap(r=>(r.players||[]).map(p=>p.userId).filter(Boolean)):[];if(slotIds.includes(userId)){showMsg(name+" is already in this time slot");return;}}try{let effectiveUserId=userId;if(!effectiveUserId){const phone=cleanPh(addInput.phone);if(phone.length!==10){showMsg("A phone number is required to add a new guest player.");return;}const newUser=await createGuestUser({name,phone,createdByUserId:currentUser?.id??null});effectiveUserId=newUser.id;setUsers(p=>[...p,newUser]);}const p=await addPlayerToReservation(resId,{name,userId:effectiveUserId});setReservations(prev=>prev.map(r=>r.id===resId?{...r,players:[...(r.players||[]),p]}:r));if(addingToTeam!==null){setVersusTeams(prev=>({...prev,[resId]:{...(prev[resId]||{}),[p.id]:addingToTeam}}));}resetAddInput();setAddingTo(null);setAddingToTeam(null);showMsg("Player added");}catch(e){showMsg("Error: "+e.message);}};
  const doRemovePlayer=async(resId,playerId)=>{try{await removePlayerFromReservation(playerId);setReservations(prev=>prev.map(r=>r.id===resId?{...r,players:(r.players||[]).filter(p=>p.id!==playerId)}:r));}catch(e){showMsg("Error: "+e.message);}};
  const doWiLookup=async()=>{const clean=cleanPh(wi.phone);if(clean.length<10)return;setWi(p=>({...p,lookupStatus:"searching"}));try{const found=await fetchUserByPhone(clean);if(found){setWi(p=>({...p,foundUserId:found.id,customerName:found.name,lookupStatus:"found"}));}else{setWi(p=>({...p,foundUserId:null,lookupStatus:"notfound"}));}}catch(e){setWi(p=>({...p,lookupStatus:"notfound"}));}};
  const doCreateWalkIn=async()=>{const time=showWI==="custom"?wi.customTime:showWI;const name=wi.foundUserId?(users.find(u=>u.id===wi.foundUserId)?.name||wi.customerName):wi.customerName.trim();if(!name||!wi.typeId||!time)return;const rt=getType(wi.typeId);const isPriv=rt?.style==="private";const isOpen=rt?.style==="open";const playerCount=isPriv?(rt.maxPlayers||laneCapacity(rt?.mode||"coop")):wi.playerCount;const doSplit=isOpen&&wi.splitA>0&&wi.splitA<playerCount;const bookDate=wi.date||today;const allSlots=[{time,addSecondLane:wi.addSecondLane},...(wi.extraSlots||[])];const base={typeId:wi.typeId,date:bookDate,status:"confirmed",paid:true};setWiSaving(true);try{let userId=wi.foundUserId||null;if(!userId){const phone=cleanPh(wi.phone);const newUser=await createGuestUser({name,phone:phone.length===10?phone:null,createdByUserId:currentUser?.id??null});userId=newUser.id;setUsers(p=>[...p,newUser]);}const autoAddBooker=async(resId)=>{try{return await addPlayerToReservation(resId,{name,userId});}catch(e){return null;}};const newReses=[];for(const {time:t,addSecondLane:sl} of allSlots){if(doSplit){const sB=playerCount-wi.splitA;const rA=await createReservation({...base,startTime:t,userId,customerName:name,playerCount:wi.splitA,amount:rt.price*wi.splitA});const rB=await createReservation({...base,startTime:t,userId,customerName:name,playerCount:sB,amount:rt.price*sB});const bp=await autoAddBooker(rA.id);newReses.push({...rA,players:bp?[bp]:[]},{...rB,players:[]});}else{const lanePrice=isPriv?rt.price*(sl?2:1):rt.price*playerCount;const newRes=await createReservation({...base,startTime:t,userId,customerName:name,playerCount,amount:isPriv?rt.price:lanePrice});const bp=await autoAddBooker(newRes.id);newReses.push({...newRes,players:bp?[bp]:[]});if(isPriv&&sl){const newRes2=await createReservation({...base,startTime:t,userId,customerName:name,playerCount,amount:rt.price});newReses.push({...newRes2,players:[]});}}}setReservations(p=>[...p,...newReses]);const extraMsg=wi.extraSlots?.length?` · ${allSlots.length} sessions`:"";if(doSplit)showMsg(`Walk-in created — split ${wi.splitA}+${playerCount-wi.splitA} across 2 lanes${extraMsg}`);else showMsg("Walk-in created"+(isPriv&&wi.addSecondLane?" — 2 lanes":"")+extraMsg);resetWI();}catch(e){showMsg("Error: "+e.message);}setWiSaving(false);};
  const resetWI=()=>{setShowWI(null);setWiStep("details");setWi({phone:"",lookupStatus:"idle",foundUserId:null,customerName:"",typeId:"",playerCount:1,customTime:"",date:"",extraSlots:[],addSecondLane:false,splitA:0});};
  activeWorkRef.current=!!(showWI||signingFor||sendConfirm||addingTo||statusBusy||wiSaving);
  return(
    <div style={{paddingBottom:"2rem"}}>
      {toast&&<div style={{position:"fixed",top:"1rem",right:"1rem",background:"var(--surf)",border:"1px solid var(--acc2)",borderRadius:8,padding:".75rem 1.4rem",zIndex:9999,fontSize:".95rem",fontWeight:600,boxShadow:"0 4px 20px rgba(0,0,0,.4)"}}>{toast}</div>}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1.5rem",flexWrap:"wrap",gap:".75rem"}}>
        <div>
          <div style={{fontSize:"1.45rem",fontWeight:700,color:"var(--txt)"}}>{new Date(today+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"})}</div>
          <div style={{fontSize:"1.05rem",color:"var(--muted)",marginTop:".15rem"}}>{clock.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}<span style={{marginLeft:".75rem",fontSize:".8rem"}}>{slotTimes.length} slot{slotTimes.length!==1?"s":""} · {todayRes.length} reservation{todayRes.length!==1?"s":""}</span></div>
        </div>
        <div style={{display:"flex",gap:".6rem"}}>
          <button className="btn btn-s" style={{fontSize:".95rem",padding:".6rem 1.2rem"}} onClick={()=>setShowMerch(true)}>🛍 Merchandise</button>
          <button className="btn btn-p" style={{fontSize:".95rem",padding:".6rem 1.2rem"}} onClick={()=>{setShowWI("custom");setWi({phone:"",lookupStatus:"idle",foundUserId:null,customerName:"",typeId:"",playerCount:1,customTime:"",date:"",extraSlots:[],addSecondLane:false,splitA:0});}}>+ Walk-In</button>
        </div>
      </div>
      {slotTimes.length===0&&<div style={{textAlign:"center",color:"var(--muted)",padding:"4rem 2rem",fontSize:"1rem",border:"1px dashed var(--bdr)",borderRadius:10}}>No sessions scheduled for today.</div>}
      {activeSlots.length===0&&slotTimes.length>0&&<div style={{textAlign:"center",color:"var(--muted)",padding:"2rem",fontSize:".95rem",border:"1px dashed var(--bdr)",borderRadius:10}}>All sessions have ended. Check History below.</div>}
      {[...activeSlots,...(historySlots.length>0?['__hist__']:[]),...(showHistory?historySlots:[])].map(entry=>{
        if(entry==='__hist__')return(<div key="__hist__" style={{display:"flex",alignItems:"center",gap:".75rem",marginTop:".75rem",marginBottom:".5rem",cursor:"pointer",userSelect:"none"}} onClick={()=>setShowHistory(h=>!h)}><div style={{flex:1,height:1,background:"var(--bdr)"}}/><span style={{fontSize:".8rem",fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:".08em",whiteSpace:"nowrap",padding:"0 .6rem",display:"flex",alignItems:"center",gap:".4rem"}}><span style={{fontSize:".7rem"}}>{showHistory?"▲":"▼"}</span>History · {historySlots.length} slot{historySlots.length!==1?"s":""} ended</span><div style={{flex:1,height:1,background:"var(--bdr)"}}/></div>);
        const time=entry;const isHist=historySlots.includes(time);
        const slotResItems=todayRes.filter(r=>r.startTime===time);
        const tmpl=todayTmpls.find(t=>t.startTime===time);
        const {lanes}=buildLanes(today,time,reservations,resTypes,sessionTemplates);
        const activeLanes=lanes.filter(l=>l.type!==null);
        const laneReady=lane=>lane.reservations.length>0&&lane.reservations.every(r=>r.status==="arrived"||r.status==="ready"||r.status==="no-show");
        const allLanesReady=activeLanes.length>0?activeLanes.every(laneReady):slotResItems.length>0&&slotResItems.every(r=>r.status==="arrived"||r.status==="ready"||r.status==="no-show");
        const allSent=slotResItems.length>0&&slotResItems.every(r=>r.status==="sent"||r.status==="no-show");
        const canSend=allLanesReady&&!allSent;
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
                  return <div key={lane.laneNum} style={{flex:1,padding:".65rem 1rem",borderRight:li<lanes.length-1?"1px solid var(--bdr)":"none",minWidth:0,background:lnReady?"rgba(40,200,100,.06)":laneIsFull?"rgba(220,60,60,.1)":"transparent"}}>
                    <div style={{fontSize:".65rem",color:lnReady?"#2dc86e":"var(--muted)",fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",marginBottom:".3rem"}}>{laneIsFull&&!lnReady&&<><strong style={{color:"var(--acc)"}}>FULL!</strong>{" — "}</>}Lane {lane.laneNum} · {lane.mode} · {lane.type}{lnReady&&<strong style={{marginLeft:".35rem"}}> ✓ READY</strong>}</div>
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
                {allSent&&<span style={{display:"inline-block",padding:".3rem .8rem",borderRadius:4,background:"rgba(100,130,240,.18)",color:"#8096f0",border:"1px solid rgba(100,130,240,.35)",fontWeight:600,fontSize:".8rem"}}>SENT</span>}
                <span style={{color:"var(--muted)",fontSize:"1.1rem"}}>{isOpen?"▲":"▼"}</span>
              </div>
            </div>
            {/* ── Expanded slot body ── */}
            {isOpen&&(()=>{
              const renderResCard=res=>{
                const rt=getType(res.typeId);const players=res.players||[];
                const wOkCount=players.filter(playerWaiverOk).length;const allWaiversOk=players.length>0&&wOkCount===players.length;const isBusy=statusBusy===res.id;
                const maxForRes=rt?.style==="private"?(rt.maxPlayers||laneCapacity(rt?.mode||"coop")):(res.playerCount||99);const canAddMore=players.length<maxForRes;
                return(
                  <div key={res.id} style={{background:"var(--bg2)",border:"1px solid var(--bdr)",borderRadius:8,marginBottom:".6rem",overflow:"hidden"}}>
                    {/* ── Card header: name + status badge ── */}
                    <div style={{display:"flex",alignItems:"flex-start",gap:".65rem",padding:".75rem 1rem .35rem"}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontWeight:700,fontSize:"1.05rem",color:"var(--txt)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{res.customerName}</div>
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
                          ?<span style={{color:"#2dc86e",fontWeight:700,fontSize:"1rem",letterSpacing:".03em"}}>✓ Arrived</span>
                          :res.status!=="no-show"&&<button className="btn" style={{background:allWaiversOk||players.length===0?"rgba(40,200,100,.2)":"var(--surf)",color:allWaiversOk||players.length===0?"#2dc86e":"var(--muted)",border:`1px solid ${allWaiversOk||players.length===0?"rgba(40,200,100,.4)":"var(--bdr)"}`}} disabled={isBusy||(players.length>0&&!allWaiversOk)} title={players.length>0&&!allWaiversOk?"All waivers must be signed before marking arrived":undefined} onClick={()=>setResStatus(res.id,"arrived")}>{isBusy?"…":"✓ Mark Arrived"}</button>}
                        {(res.status==="arrived"||res.status==="ready")&&<button className="btn btn-s" disabled={isBusy} onClick={()=>setResStatus(res.id,"confirmed")}>← Undo</button>}
                        {res.status!=="no-show"&&res.status!=="arrived"&&res.status!=="ready"&&<button className="btn btn-warn" disabled={isBusy} onClick={()=>setResStatus(res.id,"no-show")}>{isBusy?"…":"No Show"}</button>}
                        {res.status==="no-show"&&<button className="btn btn-s" disabled={isBusy} onClick={()=>setResStatus(res.id,"confirmed")}>← Undo</button>}
                      </div>
                    )}
                    {/* ── Players — always visible ── */}
                    <div style={{borderTop:"1px solid var(--bdr)",padding:".65rem 1rem"}}>
                      {rt?.mode==="versus"?(()=>{
                        const isPrivVs=rt?.style==="private";
                        const getTeam=pid=>{if(versusTeams[res.id]?.[pid]!==undefined)return versusTeams[res.id][pid];const idx=players.findIndex(p=>p.id===pid);return idx<6?1:2;};
                        const t1=players.filter(p=>getTeam(p.id)===1);
                        const t2=players.filter(p=>getTeam(p.id)===2);
                        const switchT=pid=>setVersusTeams(prev=>({...prev,[res.id]:{...(prev[res.id]||{}),[pid]:getTeam(pid)===1?2:1}}));
                        const pRow=(player,teamNum)=>{const wOk=playerWaiverOk(player);return(<div key={player.id} style={{display:"flex",alignItems:"center",gap:".35rem",padding:".4rem 0",borderBottom:"1px solid var(--bdr)"}}><span style={{flex:1,fontSize:".88rem",color:"var(--txt)",minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{player.name||"—"}</span>{isPrivVs&&<button style={{background:"none",border:"1px solid var(--bdr)",borderRadius:5,color:"var(--txt)",cursor:"pointer",fontSize:".82rem",padding:".35rem .6rem",flexShrink:0}} onClick={()=>switchT(player.id)}>{teamNum===1?"→T2":"←T1"}</button>}{!player.userId&&<span style={{fontSize:".65rem",color:"var(--muted)",background:"var(--surf)",border:"1px solid var(--bdr)",borderRadius:4,padding:"1px .3rem",flexShrink:0}}>guest</span>}{player.userId?(wOk?<span style={{color:"var(--ok)",fontSize:".78rem",fontWeight:600,whiteSpace:"nowrap",flexShrink:0}}>✓W</span>:<button className="btn btn-warn" style={{whiteSpace:"nowrap",flexShrink:0}} onClick={()=>{setSigningFor({player,resId:res.id});setSignedName(player.name||"");}}>Sign</button>):<span style={{fontSize:".68rem",color:"var(--muted)",flexShrink:0}}>—</span>}<button style={{background:"none",border:"none",color:"var(--danger)",cursor:"pointer",fontSize:"1.1rem",padding:".35rem .6rem",lineHeight:1,flexShrink:0,minWidth:40}} onClick={()=>doRemovePlayer(res.id,player.id)}>×</button></div>);};
                        const addPanel=teamNum=>{const isAddingThisTeam=addingTo===res.id&&addingToTeam===teamNum;const tPlayers=teamNum===1?t1:t2;const teamFull=tPlayers.length>=6;if(isAddingThisTeam){return(<div style={{marginTop:".4rem",background:"var(--surf)",border:"1px solid var(--bdr)",borderRadius:6,padding:".5rem .65rem"}}><div style={{display:"flex",gap:".35rem",alignItems:"center",marginBottom:".3rem"}}><div className="phone-wrap" style={{flex:1}}><span className="phone-prefix">+1</span><input type="tel" maxLength={10} value={addInput.phone} onChange={e=>setAddInput({phone:cleanPh(e.target.value),lookupStatus:"idle",foundUserId:null,name:""})} onKeyDown={e=>e.key==="Enter"&&doAddLookup(res.id)} placeholder="Phone" autoFocus style={{fontSize:".85rem"}}/></div>{(addInput.lookupStatus==="idle"||addInput.lookupStatus==="searching")&&<button className="btn btn-s" disabled={cleanPh(addInput.phone).length<10||addInput.lookupStatus==="searching"} onClick={()=>doAddLookup(res.id)}>{addInput.lookupStatus==="searching"?"…":"→"}</button>}{addInput.lookupStatus!=="idle"&&addInput.lookupStatus!=="searching"&&<button className="btn btn-s" onClick={resetAddInput}>✕</button>}<button className="btn btn-s" onClick={()=>{setAddingTo(null);setAddingToTeam(null);resetAddInput();}}>×</button></div>{addInput.lookupStatus==="found"&&addInput.foundUserId&&(()=>{const u=users.find(x=>x.id===addInput.foundUserId);return<div style={{display:"flex",alignItems:"center",gap:".4rem",marginBottom:".3rem"}}><span style={{color:"#2dc86e",fontWeight:600,fontSize:".82rem"}}>✓ {u?.name||addInput.name}</span>{u?.authProvider&&<span style={{fontSize:".68rem",color:"var(--muted)"}}>({u.authProvider})</span>}</div>;})()}{addInput.lookupStatus==="duplicate"&&<div style={{background:"rgba(220,60,60,.1)",border:"1px solid rgba(220,60,60,.4)",borderRadius:5,padding:".35rem .55rem",marginBottom:".3rem",fontSize:".79rem",color:"var(--danger)",fontWeight:600}}>{addInput.name} is already assigned to this time slot.</div>}{(addInput.lookupStatus==="notfound"||addInput.lookupStatus==="named")&&<div style={{display:"flex",gap:".35rem",alignItems:"center"}}><input placeholder="Name" value={addInput.name} onChange={e=>setAddInput(p=>({...p,name:e.target.value,lookupStatus:e.target.value.trim()?"named":"notfound"}))} onKeyDown={e=>e.key==="Enter"&&addInput.name.trim()&&doAddPlayer(res.id)} autoFocus style={{flex:1,background:"var(--bg2)",border:"1px solid var(--bdr)",borderRadius:5,padding:".35rem .5rem",color:"var(--txt)",fontSize:".85rem"}}/><button className="btn btn-p" disabled={!addInput.name.trim()} onClick={()=>doAddPlayer(res.id)}>Add</button></div>}{addInput.lookupStatus==="notfound"&&<div style={{fontSize:".7rem",color:"var(--muted)",marginTop:".2rem"}}>No account — type name to add as guest.</div>}</div>);}if(!teamFull&&canAddMore){return<button className="btn btn-s" style={{width:"100%",marginTop:".5rem",fontSize:".9rem",padding:".6rem 0"}} onClick={()=>{setAddingTo(res.id);setAddingToTeam(teamNum);resetAddInput();}}>+ Add to Team {teamNum}</button>;}return null;};
                        return(<div><div style={{fontWeight:600,fontSize:".78rem",color:"var(--muted)",marginBottom:".5rem",textTransform:"uppercase",letterSpacing:".05em"}}>Players <span style={{textTransform:"none",fontWeight:400,color:players.length>=maxForRes?"var(--danger)":"var(--muted)"}}>{players.length}/{maxForRes}</span></div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:".65rem"}}>{[1,2].map(tn=>{const tPlayers=tn===1?t1:t2;return(<div key={tn} style={{background:"var(--bg)",border:"1px solid var(--bdr)",borderRadius:6,padding:".5rem .6rem"}}><div style={{fontWeight:700,fontSize:".73rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:".04em",marginBottom:".35rem"}}>Team {tn} <span style={{fontWeight:400}}>({tPlayers.length}/6)</span></div>{tPlayers.length===0&&<div style={{fontSize:".78rem",color:"var(--muted)",padding:".2rem 0"}}>—</div>}{tPlayers.map(p=>pRow(p,tn))}{addPanel(tn)}</div>);})}</div></div>);
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
                              <button style={{background:"none",border:"none",color:"var(--danger)",cursor:"pointer",fontSize:"1.2rem",padding:".35rem .6rem",lineHeight:1,flexShrink:0,minWidth:44}} onClick={()=>doRemovePlayer(res.id,player.id)}>×</button>
                            </div>
                          );
                        })}
                        {addingTo===res.id?(
                          <div style={{marginTop:".6rem",background:"var(--surf)",border:"1px solid var(--bdr)",borderRadius:6,padding:".6rem .75rem"}}>
                            <div style={{display:"flex",gap:".4rem",alignItems:"center",marginBottom:".35rem"}}>
                              <div className="phone-wrap" style={{flex:1}}><span className="phone-prefix">+1</span><input type="tel" maxLength={10} value={addInput.phone} onChange={e=>setAddInput({phone:cleanPh(e.target.value),lookupStatus:"idle",foundUserId:null,name:""})} onKeyDown={e=>e.key==="Enter"&&doAddLookup(res.id)} placeholder="Phone" autoFocus style={{fontSize:".9rem"}}/></div>
                              {(addInput.lookupStatus==="idle"||addInput.lookupStatus==="searching")&&<button className="btn btn-s" disabled={cleanPh(addInput.phone).length<10||addInput.lookupStatus==="searching"} onClick={()=>doAddLookup(res.id)}>{addInput.lookupStatus==="searching"?"…":"Search →"}</button>}
                              {addInput.lookupStatus!=="idle"&&addInput.lookupStatus!=="searching"&&<button className="btn btn-s" onClick={resetAddInput}>✕</button>}
                              <button className="btn btn-s" onClick={()=>{setAddingTo(null);resetAddInput();}}>Cancel</button>
                            </div>
                            {addInput.lookupStatus==="found"&&addInput.foundUserId&&(()=>{const u=users.find(x=>x.id===addInput.foundUserId);return<div style={{display:"flex",alignItems:"center",gap:".5rem",marginBottom:".35rem"}}><span style={{color:"#2dc86e",fontWeight:600,fontSize:".85rem"}}>✓ {u?.name||addInput.name}</span>{u?.authProvider&&<span style={{fontSize:".7rem",color:"var(--muted)"}}>({u.authProvider})</span>}</div>;})()}
                            {addInput.lookupStatus==="duplicate"&&<div style={{background:"rgba(220,60,60,.1)",border:"1px solid rgba(220,60,60,.4)",borderRadius:5,padding:".4rem .65rem",marginBottom:".35rem",fontSize:".82rem",color:"var(--danger)",fontWeight:600}}>{addInput.name} is already assigned to this time slot.</div>}
                            {(addInput.lookupStatus==="notfound"||addInput.lookupStatus==="named")&&<div style={{display:"flex",gap:".4rem",alignItems:"center"}}><input placeholder="Player name" value={addInput.name} onChange={e=>setAddInput(p=>({...p,name:e.target.value,lookupStatus:e.target.value.trim()?"named":"notfound"}))} onKeyDown={e=>e.key==="Enter"&&addInput.name.trim()&&doAddPlayer(res.id)} autoFocus style={{flex:1,background:"var(--bg2)",border:"1px solid var(--bdr)",borderRadius:5,padding:".4rem .6rem",color:"var(--txt)",fontSize:".9rem"}}/><button className="btn btn-p" disabled={!addInput.name.trim()} onClick={()=>doAddPlayer(res.id)}>Add</button></div>}
                            {addInput.lookupStatus==="notfound"&&<div style={{fontSize:".72rem",color:"var(--muted)",marginTop:".25rem"}}>No account found — type a name to add as a guest.</div>}
                          </div>
                        ):(
                          canAddMore?<button className="btn btn-s" style={{marginTop:".5rem",width:"100%",fontSize:".9rem",padding:".6rem 0"}} onClick={()=>{setAddingTo(res.id);resetAddInput();}}>+ Add Player</button>:<div style={{fontSize:".8rem",color:"var(--muted)",marginTop:".5rem",fontStyle:"italic"}}>Player limit reached ({maxForRes}/{maxForRes})</div>
                        )}
                        </>
                      )}
                    </div>
                  </div>
                );
              };
              return(
                <div style={{borderTop:"1px solid var(--bdr)",padding:"1rem 1.2rem"}}>
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
        const wiRt=getType(wi.typeId);
        const wiIsPriv=wiRt?.style==="private";
        const wiIsOpen=wiRt?.style==="open";
        const wiDate=wi.date||today;
        const wiTime=showWI==="custom"?wi.customTime:showWI;
        const wiAllLanes=wiTime?buildLanes(wiDate,wiTime,reservations,resTypes,sessionTemplates).lanes:[];
        const wiFreeLanes=wiAllLanes.filter(l=>l.type===null).length;
        const offerSecondLane=wiIsPriv&&wiFreeLanes>=2;
        // Slot picker options for this date
        const wiDateTmpls=sessionTemplates.filter(tmpl=>tmpl.active&&tmpl.dayOfWeek===getDayName(wiDate));
        const wiDateRes=reservations.filter(res=>res.date===wiDate&&res.status!=="cancelled");
        const wiDateAllSlots=[...new Set([...wiDateTmpls.map(tmpl=>tmpl.startTime),...wiDateRes.map(res=>res.startTime)])].sort();
        const wiAvailSlots=wiDate===today?wiDateAllSlots.filter(t=>!slotIsHistory(t)):wiDateAllSlots;
        // Extra timeslots available (same date, same type, has capacity, not the primary)
        const wiExtraSlots=wi.extraSlots||[];
        const wiExtraTimes=wiExtraSlots.map(s=>s.time);
        const wiExtraAvail=wiTime&&wi.typeId?wiAvailSlots.filter(st=>{
          if(st===wiTime)return false;
          const el=buildLanes(wiDate,st,reservations,resTypes,sessionTemplates).lanes;
          if(wiIsPriv)return el.filter(l=>l.type===null).length>0;
          if(wiIsOpen&&wiRt?.mode){const c=openPlayCapacity(wiRt.mode,el);return c.total>=wi.playerCount;}
          return false;
        }):[];
        // Capacity check for current type+playerCount
        const wiCap=wiIsOpen&&wiRt?.mode&&wiTime?openPlayCapacity(wiRt.mode,wiAllLanes):null;
        const wiCapStatus=!wiCap?"ok":wi.playerCount>wiCap.total?"full":wi.playerCount>wiCap.maxSingle?"split":"ok";
        const splitB=wi.splitA>0?wi.playerCount-wi.splitA:0;
        const splitValid=wiCapStatus==="split"&&wi.splitA>0&&wi.splitA<wi.playerCount&&wi.splitA<=(wiCap?.blocks[0]||0)&&splitB<=(wiCap?.blocks[1]||0);
        // Filter types by what the slot can still accommodate
        const filteredResTypes=resTypes.filter(rt=>{
          if(!rt.active||!rt.availableForBooking)return false;
          if(!wiTime)return true;
          if(rt.style==="private")return wiFreeLanes>0;
          if(rt.style==="open"){const c=openPlayCapacity(rt.mode,wiAllLanes);return c.total>0;}
          return true;
        });
        const slotCount=1+(wiExtraTimes.length||0);
        const wiAmt=wiRt?(wiIsPriv?wiRt.price*((wi.addSecondLane?2:1)+wiExtraSlots.reduce((s,es)=>s+(es.addSecondLane?2:1),0)):wiRt.price*wi.playerCount*slotCount):0;
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
              {wi.lookupStatus==="found"&&wi.foundUserId&&(()=>{const u=users.find(x=>x.id===wi.foundUserId);return<div style={{display:"flex",alignItems:"center",gap:".5rem",background:"rgba(40,200,100,.1)",border:"1px solid rgba(40,200,100,.3)",borderRadius:6,padding:".6rem .85rem",marginBottom:".5rem"}}><span style={{background:"var(--acc2)",color:"var(--bg2)",borderRadius:"50%",width:28,height:28,display:"inline-flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:".75rem",flexShrink:0}}>{getInitials(u?.name||"")}</span><div><div style={{fontWeight:700,color:"var(--txt)",fontSize:".95rem"}}>{u?.name}</div><div style={{fontSize:".75rem",color:"var(--muted)"}}>{u?.phone?fmtPhone(u.phone):""}{u?.authProvider?` · ${u.authProvider}`:""}</div></div><span style={{marginLeft:"auto",color:"#2dc86e",fontWeight:600,fontSize:".85rem"}}>✓ Found</span></div>;})()}
              {(wi.lookupStatus==="notfound"||wi.lookupStatus==="named")&&<div style={{marginBottom:".5rem"}}>{wi.lookupStatus==="notfound"&&<div style={{fontSize:".8rem",color:"var(--muted)",marginBottom:".4rem"}}>No account found — enter a name to continue as a guest.</div>}<div className="f" style={{marginBottom:wi.lookupStatus==="named"?".35rem":0}}><label>Customer Name{wi.lookupStatus==="notfound"&&<span style={{color:"var(--danger)"}}> *</span>}</label><input value={wi.customerName} onChange={e=>setWi(p=>({...p,customerName:e.target.value,lookupStatus:e.target.value.trim()?"named":"notfound"}))} placeholder="First Last" autoFocus/></div>{wi.lookupStatus==="named"&&<div style={{fontSize:".75rem",color:"var(--muted)"}}>Guest walk-in — no existing account.</div>}</div>}
              {showWI==="custom"&&<div style={{marginBottom:".75rem"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:".35rem"}}>
                  <span style={{fontWeight:600,fontSize:".85rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:".04em"}}>Date &amp; Time</span>
                  <input type="date" value={wiDate} min={today} onChange={e=>setWi(p=>({...p,date:e.target.value,customTime:"",extraSlots:[],splitA:0}))} style={{fontSize:".82rem",padding:".25rem .5rem",background:"var(--bg2)",border:"1px solid var(--bdr)",borderRadius:5,color:"var(--txt)"}}/>
                </div>
                {wiAvailSlots.length===0&&<div style={{fontSize:".85rem",color:"var(--muted)",padding:".65rem",background:"var(--bg2)",border:"1px dashed var(--bdr)",borderRadius:6,textAlign:"center"}}>No slots available for this date.</div>}
                {wiAvailSlots.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:".4rem"}}>{wiAvailSlots.map(st=>{const sel=wi.customTime===st;const lns=buildLanes(wiDate,st,reservations,resTypes,sessionTemplates).lanes;const hasCapacity=lns.length===0||lns.some(l=>l.type===null)||lns.some(l=>l.type==="open"&&l.playerCount<laneCapacity(l.mode));return<button key={st} type="button" disabled={!hasCapacity} onClick={()=>hasCapacity&&setWi(p=>({...p,customTime:st,extraSlots:[],splitA:0}))} style={{padding:".4rem .9rem",borderRadius:20,fontSize:".9rem",fontWeight:sel?700:500,border:`2px solid ${sel?"var(--acc)":"var(--bdr)"}`,background:sel?"var(--accD)":"var(--bg2)",color:sel?"var(--accB)":!hasCapacity?"var(--muted)":"var(--txt)",cursor:hasCapacity?"pointer":"not-allowed",opacity:!hasCapacity&&!sel?.5:1}}>{fmt12(st)}{!hasCapacity?" ✕":""}</button>;})}</div>}
              </div>}
              <div className="f"><label>Type</label><div style={{display:"flex",flexWrap:"wrap",gap:".4rem"}}>{filteredResTypes.map(rt=>{const sel=wi.typeId===rt.id;return(<button key={rt.id} type="button" onClick={()=>setWi(p=>({...p,typeId:rt.id,splitA:0,extraSlots:[],playerCount:1}))} style={{padding:".55rem 1.2rem",borderRadius:20,fontSize:".9rem",fontWeight:sel?700:500,border:`2px solid ${sel?"var(--acc)":"var(--bdr)"}`,background:sel?"var(--accD)":"var(--bg2)",color:sel?"var(--accB)":"var(--txt)",cursor:"pointer",textTransform:"uppercase",letterSpacing:".04em"}}>{rt.name}</button>);})} {filteredResTypes.length===0&&<div style={{fontSize:".85rem",color:"var(--muted)",padding:".4rem 0",fontStyle:"italic"}}>{wiTime?"No types available for this slot.":"Select a time first."}</div>}</div></div>
              {offerSecondLane&&<div style={{background:"rgba(40,200,100,.08)",border:"1px solid rgba(40,200,100,.3)",borderRadius:8,padding:".65rem .9rem",marginBottom:".5rem",display:"flex",alignItems:"center",gap:".75rem",cursor:"pointer"}} onClick={()=>setWi(p=>({...p,addSecondLane:!p.addSecondLane}))}><input type="checkbox" checked={wi.addSecondLane} readOnly style={{width:18,height:18,cursor:"pointer",accentColor:"var(--acc)"}}/><div style={{flex:1}}><div style={{fontWeight:700,color:"#2dc86e",fontSize:".9rem"}}>{wi.addSecondLane?"Both lanes reserved":"Reserve both lanes"}</div><div style={{fontSize:".8rem",color:"var(--muted)"}}>{wi.addSecondLane?"Uncheck to book single lane only.":"Check to book both lanes — "+( wiRt?.mode==="versus"?"up to 24":"up to 12")+" players total."}</div></div><span style={{fontWeight:700,color:"var(--accB)",whiteSpace:"nowrap"}}>+{fmtMoney(wiRt?.price||0)}</span></div>}
              {!wiIsPriv&&<div className="f"><label>Player Count</label><div style={{display:"flex",alignItems:"center",gap:".75rem"}}><button type="button" className="btn btn-s" style={{width:48,height:48,fontSize:"1.6rem",padding:0,lineHeight:1,flexShrink:0}} disabled={!wi.typeId||wi.playerCount<=1} onClick={()=>setWi(p=>({...p,playerCount:Math.max(1,p.playerCount-1),splitA:0,extraSlots:[]}))}>−</button><span style={{minWidth:52,textAlign:"center",fontSize:"1.6rem",fontWeight:800,color:wi.typeId?"var(--txt)":"var(--muted)"}}>{wi.playerCount}</span><button type="button" className="btn btn-s" style={{width:48,height:48,fontSize:"1.6rem",padding:0,lineHeight:1,flexShrink:0}} disabled={!wi.typeId||wi.playerCount>=(wiCap?wiCap.total:99)} onClick={()=>setWi(p=>({...p,playerCount:Math.min(wiCap?wiCap.total:99,p.playerCount+1),splitA:0,extraSlots:[]}))}>+</button>{wi.typeId&&wiCap&&wiTime&&<span style={{fontSize:".82rem",color:wiCap.total<3?"var(--warn)":"var(--muted)",marginLeft:".25rem"}}>{wiCap.total} spot{wiCap.total!==1?"s":""} avail.</span>}</div>{!wi.typeId&&<div style={{fontSize:".78rem",color:"var(--muted)",marginTop:".3rem"}}>Select a type first.</div>}</div>}
              {wiIsPriv&&<div style={{fontSize:".82rem",color:"var(--muted)",marginBottom:".5rem",padding:".45rem .6rem",background:"var(--bg2)",border:"1px solid var(--bdr)",borderRadius:5}}>Private: up to <strong style={{color:"var(--txt)"}}>{wiRt?.maxPlayers||laneCapacity(wiRt?.mode||"coop")}</strong> players{wi.addSecondLane?` per lane (${(wiRt?.maxPlayers||laneCapacity(wiRt?.mode||"coop"))*2} total across both)`:""}</div>}
              {wiCapStatus==="full"&&<div style={{background:"rgba(184,50,50,.1)",border:"1px solid rgba(184,50,50,.4)",borderRadius:7,padding:".7rem 1rem",marginBottom:".5rem"}}><div style={{fontWeight:700,color:"var(--danger)",fontSize:".9rem",marginBottom:".2rem"}}>No room for {wi.playerCount} players</div><div style={{fontSize:".82rem",color:"var(--muted)"}}>All {wiRt?.mode} lanes are full at this time. Please choose a different time slot.</div></div>}
              {wiCapStatus==="split"&&(()=>{const b0=wiCap.blocks[0]||0;const b1=wiCap.blocks[1]||0;const maxA=Math.min(b0,wi.playerCount-1);return(<div style={{background:"rgba(184,150,12,.08)",border:"1px solid var(--warn)",borderRadius:7,padding:".75rem 1rem",marginBottom:".5rem"}}><div style={{fontWeight:700,color:"var(--warnL)",fontSize:".9rem",marginBottom:".35rem"}}>⚠ Group of {wi.playerCount} can't fit in one {wiRt?.mode} lane</div><div style={{fontSize:".82rem",color:"var(--muted)",marginBottom:".65rem"}}>Split across 2 lanes, or choose a different time.</div><div style={{display:"flex",alignItems:"center",gap:".6rem",flexWrap:"wrap",marginBottom:".45rem"}}><span style={{fontSize:".85rem",color:"var(--txt)",fontWeight:600}}>Lane A</span><span style={{fontSize:".75rem",color:"var(--muted)"}}>({b0} spot{b0!==1?"s":""} avail.)</span><div style={{display:"flex",alignItems:"center",gap:".4rem"}}><button type="button" className="btn btn-s" style={{width:40,height:40,fontSize:"1.3rem",padding:0,lineHeight:1}} disabled={wi.splitA<=1} onClick={()=>setWi(p=>({...p,splitA:Math.max(1,p.splitA-1)}))}>−</button><span style={{minWidth:36,textAlign:"center",fontSize:"1.15rem",fontWeight:700,color:"var(--txt)"}}>{wi.splitA||"—"}</span><button type="button" className="btn btn-s" style={{width:40,height:40,fontSize:"1.3rem",padding:0,lineHeight:1}} disabled={wi.splitA>=maxA} onClick={()=>setWi(p=>({...p,splitA:Math.min(maxA,p.splitA+1)}))}>+</button></div><span style={{fontSize:".85rem",color:"var(--muted)"}}>players</span></div><div style={{display:"flex",alignItems:"center",gap:".6rem",flexWrap:"wrap"}}><span style={{fontSize:".85rem",color:"var(--txt)",fontWeight:600}}>Lane B</span><span style={{fontSize:".75rem",color:"var(--muted)"}}>({b1} spot{b1!==1?"s":""} avail.)</span><span style={{minWidth:56,textAlign:"center",background:"var(--surf)",border:"1px solid var(--bdr)",borderRadius:5,padding:".3rem .4rem",color:wi.splitA>0&&splitB>b1?"var(--danger)":"var(--txt)",fontSize:".95rem",display:"inline-block"}}>{wi.splitA>0?splitB:"—"}</span><span style={{fontSize:".85rem",color:"var(--muted)"}}>players</span>{wi.splitA>0&&splitB>b1&&<span style={{fontSize:".75rem",color:"var(--danger)"}}>exceeds lane B capacity</span>}</div></div>);})()}
              {wiRt&&wiTime&&wiExtraAvail.length>0&&<div style={{marginBottom:".5rem"}}>
                <div style={{fontWeight:600,fontSize:".82rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:".04em",marginBottom:".35rem"}}>Add More Sessions</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:".35rem"}}>{wiExtraAvail.map(st=>{const sel=wiExtraTimes.includes(st);return<button key={st} type="button" onClick={()=>setWi(p=>({...p,extraSlots:sel?p.extraSlots.filter(x=>x.time!==st):[...p.extraSlots,{time:st,addSecondLane:p.addSecondLane}]}))} style={{padding:".35rem .75rem",borderRadius:20,fontSize:".85rem",fontWeight:sel?700:500,border:`2px solid ${sel?"var(--acc)":"var(--bdr)"}`,background:sel?"var(--accD)":"var(--bg2)",color:sel?"var(--accB)":"var(--txt)",cursor:"pointer"}}>{fmt12(st)}</button>;})}</div>
                {wiIsPriv&&wiExtraSlots.length>0&&wiExtraSlots.map(es=>{const esLanes=buildLanes(wiDate,es.time,reservations,resTypes,sessionTemplates).lanes;const esFree=esLanes.filter(l=>l.type===null).length;return(<div key={es.time} style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:es.addSecondLane?"rgba(40,200,100,.08)":"var(--bg2)",border:`1px solid ${es.addSecondLane?"rgba(40,200,100,.3)":"var(--bdr)"}`,borderRadius:7,padding:".5rem .75rem",marginTop:".4rem",cursor:"pointer"}} onClick={()=>setWi(p=>({...p,extraSlots:p.extraSlots.map(x=>x.time===es.time?{...x,addSecondLane:!x.addSecondLane}:x)}))}><div style={{display:"flex",alignItems:"center",gap:".5rem"}}><input type="checkbox" checked={es.addSecondLane} readOnly style={{width:16,height:16,accentColor:"var(--acc)",cursor:"pointer"}}/><span style={{fontSize:".85rem",color:"var(--txt)",fontWeight:600}}>{fmt12(es.time)}</span><span style={{fontSize:".8rem",color:es.addSecondLane?"#2dc86e":"var(--muted)"}}>— {es.addSecondLane?"both lanes reserved":"check to reserve both lanes"}</span></div><span style={{fontSize:".8rem",color:es.addSecondLane?"#2dc86e":"var(--muted)",fontWeight:600,whiteSpace:"nowrap"}}>+{fmtMoney(wiRt?.price||0)}</span></div>);}) }
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
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:".4rem"}}><span style={{color:"var(--muted)"}}>Players</span><span style={{color:"var(--txt)"}}>{wi.playerCount}{wiCapStatus==="split"&&splitValid?` (${wi.splitA}+${splitB} split)`:""}</span></div>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:".4rem"}}><span style={{color:"var(--muted)"}}>Session{slotCount>1?"s":""}</span><span style={{color:"var(--txt)",textAlign:"right"}}>{[wiTime,...wiExtraTimes].map(t=>fmt12(t)).join(", ")}{wiDate!==today?" · "+new Date(wiDate+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"}):""}</span></div>
                <div style={{borderTop:"1px solid var(--bdr)",marginTop:".6rem",paddingTop:".6rem",display:"flex",justifyContent:"space-between",alignItems:"baseline"}}><span style={{fontWeight:600,color:"var(--txt)"}}>Total Due</span><span style={{fontSize:"1.6rem",fontWeight:800,color:"var(--accB)"}}>{fmtMoney(wiAmt)}</span></div>
              </div>
              <div style={{background:"rgba(184,150,12,.08)",border:"1px solid var(--warn)",borderRadius:6,padding:".75rem 1rem",fontSize:".9rem",color:"var(--warnL)",marginBottom:"1rem",textAlign:"center"}}>💳 Present card terminal to customer for <strong>{fmtMoney(wiAmt)}</strong></div>
              <div className="ma"><button className="btn btn-s" onClick={()=>setWiStep("details")}>← Back</button><button className="btn btn-p" disabled={wiSaving} onClick={doCreateWalkIn}>{wiSaving?"Processing…":"Payment Collected — Complete Walk-In"}</button></div>
            </>}
          </div></div>
        );
      })()}
      {signingFor&&<WaiverModal
        playerName={signingFor.player.name}
        waiverDoc={activeWaiverDoc}
        onClose={()=>setSigningFor(null)}
        onSign={async(name)=>{const{player}=signingFor;if(!player.userId)return;const ts=new Date().toISOString();setUsers(p=>p.map(u=>u.id===player.userId?{...u,waivers:[...u.waivers,{signedAt:ts,signedName:name,waiverDocId:activeWaiverDoc?.id}],needsRewaiverDocId:null}:u));try{await signWaiver(player.userId,name,activeWaiverDoc?.id);}catch(e){}showMsg("Waiver signed for "+player.name);setSigningFor(null);}}
      />}
      {sendConfirm&&(
        <div className="mo"><div className="mc">
          <div className="mt2">Send Group?</div>
          <p style={{color:"var(--muted)",marginBottom:"1.2rem",lineHeight:1.6}}>Send all <strong style={{color:"var(--txt)"}}>Ready</strong> parties at <strong style={{color:"var(--acc)"}}>{fmt12(sendConfirm)}</strong> to the safety &amp; training room?<br/>No-shows will remain marked as No Show.</p>
          <div className="ma"><button className="btn btn-s" onClick={()=>setSendConfirm(null)}>No, Go Back</button><button className="btn btn-p" disabled={statusBusy===sendConfirm} onClick={()=>doSendGroup(sendConfirm)}>{statusBusy===sendConfirm?"Sending…":"Yes, Send Group"}</button></div>
        </div></div>
      )}
      {showMerch&&(
        <div className="mo"><div className="mc">
          <div className="mt2">🛍 Merchandise &amp; Equipment</div>
          <div style={{textAlign:"center",padding:"2rem 1rem",color:"var(--muted)"}}>
            <div style={{fontSize:"2rem",marginBottom:".75rem",opacity:.4}}>🏪</div>
            <div style={{fontSize:".95rem"}}>Inventory management coming soon.</div>
            <div style={{fontSize:".8rem",marginTop:".5rem"}}>T-shirts, swag, and equipment purchases will be processed here.</div>
          </div>
          <div className="ma"><button className="btn btn-p" onClick={()=>setShowMerch(false)}>Close</button></div>
        </div></div>
      )}
    </div>
  );
}
