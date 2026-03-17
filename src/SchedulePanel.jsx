import { useState, useEffect } from "react"
import { todayStr, addDaysStr, fmt, fmt12, getDayName } from "./utils.js"
import { DateNav } from "./ui.jsx"
import { isStaffBlocked } from "./stampUtils.js"
import {
  fetchShiftTemplates, fetchTemplateSlots, fetchSlotAssignments,
  fetchStaffBlocks, fetchAllStaffBlocks, createStaffBlock, updateStaffBlock, deleteStaffBlock,
  flagShiftConflict, approveShiftConflict, declineShiftConflict, assignShift, adminEditShift, fetchUserRoles
} from "./supabase.js"
import StaffingScheduler from "./StaffingScheduler.jsx"

function StaffStandardSchedule({userId}){
  const [tmpl,setTmpl]=useState(null);
  const [mySlots,setMySlots]=useState([]);
  const [loading,setLoading]=useState(true);
  const DAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const fmt12s=t=>{const[h,m]=t.split(':').map(Number);const ampm=h>=12?'pm':'am';return (h%12||12)+':'+String(m).padStart(2,'0')+ampm;};
  useEffect(()=>{
    (async()=>{
      try{
        const tmpls=await fetchShiftTemplates();
        const active=tmpls.find(t=>t.active);
        if(!active)return;
        setTmpl(active);
        const[slotsData,asgnsData]=await Promise.all([fetchTemplateSlots(active.id),fetchSlotAssignments(active.id)]);
        setMySlots(
          asgnsData.filter(a=>a.staffId===userId)
            .map(a=>({slot:slotsData.find(s=>s.id===a.slotId),wk:a.weekNumber}))
            .filter(x=>x.slot)
            .sort((a,b)=>a.wk-b.wk||a.slot.dayOfWeek-b.slot.dayOfWeek||a.slot.startTime.localeCompare(b.slot.startTime))
        );
      }finally{setLoading(false);}
    })();
  },[userId]);
  if(loading||!tmpl||mySlots.length===0)return null;
  const wk1=mySlots.filter(x=>x.wk===1);
  const wk2=mySlots.filter(x=>x.wk===2);
  return(
    <div style={{marginTop:'1.25rem',border:'1px solid var(--bdr)',borderRadius:6,padding:'1rem'}}>
      <div style={{fontWeight:600,marginBottom:'.6rem',fontSize:'.95rem'}}>My Standard Schedule — {tmpl.name}</div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1rem'}}>
        {[{label:'Week 1',items:wk1},{label:'Week 2',items:wk2}].map(({label,items})=>(
          <div key={label}>
            <div style={{fontSize:'.75rem',color:'var(--txt2)',marginBottom:'.3rem',textTransform:'uppercase',letterSpacing:'.05em'}}>{label}</div>
            {items.length===0
              ?<div style={{fontSize:'.83rem',opacity:.45}}>No shifts</div>
              :items.map(({slot})=>(
                <div key={slot.id} style={{fontSize:'.875rem',marginBottom:'.18rem'}}>
                  <span style={{minWidth:'2.5rem',display:'inline-block'}}>{DAYS[slot.dayOfWeek]}</span>
                  {' '}{fmt12s(slot.startTime)}–{fmt12s(slot.endTime)}
                  {slot.role&&<span style={{opacity:.55}}> · {slot.role}</span>}
                </div>
              ))
            }
          </div>
        ))}
      </div>
    </div>
  );
}

function SchedulePanel({currentUser,shifts,setShifts,users,isManager,onAlert,tabOverride,onTabOverrideConsumed}){
  const [tab,setTab]=useState("mine");
  const [conflictModal,setConflictModal]=useState(null);
  const [cNote,setCNote]=useState("");
  const [staffBlocks,setStaffBlocks]=useState([]);
  const [blocksLoaded,setBlocksLoaded]=useState(false);
  const [userRoles,setUserRoles]=useState([]);
  const [blockDraft,setBlockDraft]=useState({startDate:todayStr(),endDate:todayStr(),isFullDay:true,startTime:'09:00',endTime:'17:00',label:''});
  const [addingBlock,setAddingBlock]=useState(false);
  const [editingBlockId,setEditingBlockId]=useState(null);
  const [blockSaving,setBlockSaving]=useState(false);
  const [shiftOpBusy,setShiftOpBusy]=useState(false);
  const [selectedDay,setSelectedDay]=useState(todayStr());
  const [hideAdminShifts,setHideAdminShifts]=useState(true);
  const [allStaffSub,setAllStaffSub]=useState('roster');
  const [myShiftsSub,setMyShiftsSub]=useState('upcoming');
  const [weekStart,setWeekStart]=useState(todayStr());
  const [assignModal,setAssignModal]=useState(null);
  const [assignTarget,setAssignTarget]=useState('');
  const [editShiftModal,setEditShiftModal]=useState(null); // {id,staffId,start,end,date,role}
  const [allStaffBlocks,setAllStaffBlocks]=useState([]);
  const today=todayStr();
  function timeToMin(t){if(!t)return 0;const p=(t+'').split(':').map(Number);return p[0]*60+(p[1]||0);}
  function fmtDur(s,e){const m=timeToMin(e)-timeToMin(s);if(m<=0)return '';return Math.floor(m/60)+' hr'+(m%60?' '+m%60+' min':'');}
  function computeRemaining(ss,se,bs,be){let s2=ss,e2=se;if(bs<=s2&&be>=e2)return 0;if(bs<=s2)s2=be;else if(be>=e2)e2=bs;else e2=bs;return Math.max(0,e2-s2);}
  useEffect(()=>{
    if(tabOverride){setTab(tabOverride);onTabOverrideConsumed?.();}
  },[tabOverride]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{
    if(!blocksLoaded){
      fetchStaffBlocks(currentUser.id).then(b=>{setStaffBlocks(b);setBlocksLoaded(true);}).catch(()=>{});
    }
    fetchUserRoles().then(setUserRoles).catch(()=>{});
    if(isManager) fetchAllStaffBlocks().then(setAllStaffBlocks).catch(()=>{});
  },[]);// eslint-disable-line react-hooks/exhaustive-deps
  function blockIsResolvedFor(block, staffId){
    if(block.status!=='pending')return false;
    return !shifts.some(s=>{
      if(s.staffId!==staffId)return false;
      if(s.role==='Admin')return false;       // Admin shifts were never flagged — don't count them
      if(s.conflicted)return false;           // still-conflicted shifts are in-flight, not blocking resolution
      if(s.date<block.startDate||s.date>block.endDate)return false;
      if(!block.startTime||!block.endTime)return true;
      const bs=timeToMin(block.startTime),be=timeToMin(block.endTime);
      const ss2=timeToMin(s.start),se2=timeToMin(s.end);
      return !(bs>=se2||be<=ss2);
    });
  }
  async function handleAddBlock(){
    setBlockSaving(true);
    try{
      const conflictingShifts=shifts.filter(s=>{
        if(s.staffId!==currentUser.id||s.conflicted||s.role==='Admin')return false;
        if(s.date<blockDraft.startDate||s.date>blockDraft.endDate)return false;
        if(blockDraft.isFullDay)return true;
        const bs=timeToMin(blockDraft.startTime),be=timeToMin(blockDraft.endTime);
        const ss2=timeToMin(s.start),se2=timeToMin(s.end);
        if(bs>=se2||be<=ss2)return false;
        return computeRemaining(ss2,se2,bs,be)<180;
      });
      const hasConflicts=conflictingShifts.length>0;
      const block=await createStaffBlock({staffId:currentUser.id,startDate:blockDraft.startDate,endDate:blockDraft.endDate,startTime:blockDraft.isFullDay?null:blockDraft.startTime,endTime:blockDraft.isFullDay?null:blockDraft.endTime,label:blockDraft.label||null,status:hasConflicts?'pending':'confirmed'});
      for(const shift of conflictingShifts){
        const note='Availability block'+(blockDraft.label?': '+blockDraft.label:'');
        await flagShiftConflict(shift.id,note);
        setShifts(prev=>prev.map(s=>s.id===shift.id?{...s,conflicted:true,conflictNote:note}:s));
      }
      setStaffBlocks(prev=>[...prev,block].sort((a,b)=>a.startDate.localeCompare(b.startDate)));
      setAddingBlock(false);
      setBlockDraft({startDate:todayStr(),endDate:todayStr(),isFullDay:true,startTime:'09:00',endTime:'17:00',label:''});
      if(hasConflicts)onAlert('Block saved — '+conflictingShifts.length+' shift'+(conflictingShifts.length>1?'s':'')+' flagged for coverage.');
    }catch(e){onAlert('Error saving block: '+e.message);}finally{setBlockSaving(false);}
  }
  async function handleDeleteBlock(id){
    try{await deleteStaffBlock(id);setStaffBlocks(prev=>prev.filter(b=>b.id!==id));}
    catch(e){onAlert('Error deleting block: '+e.message);}
  }
  function startEditBlock(b){
    setBlockDraft({startDate:b.startDate,endDate:b.endDate,isFullDay:!b.startTime,startTime:b.startTime||'09:00',endTime:b.endTime||'17:00',label:b.label||''});
    setEditingBlockId(b.id);
    setAddingBlock(false);
  }
  async function handleUpdateBlock(){
    setBlockSaving(true);
    try{
      const updated=await updateStaffBlock(editingBlockId,{startDate:blockDraft.startDate,endDate:blockDraft.endDate,startTime:blockDraft.isFullDay?null:blockDraft.startTime,endTime:blockDraft.isFullDay?null:blockDraft.endTime,label:blockDraft.label||null});
      setStaffBlocks(prev=>prev.map(b=>b.id===editingBlockId?updated:b).sort((a,b2)=>a.startDate.localeCompare(b2.startDate)));
      setEditingBlockId(null);
      setBlockDraft({startDate:todayStr(),endDate:todayStr(),isFullDay:true,startTime:'09:00',endTime:'17:00',label:''});
    }catch(e){onAlert('Error updating block: '+e.message);}finally{setBlockSaving(false);}
  }
  const mine=[...shifts].filter(s=>s.staffId===currentUser.id).sort((a,b)=>a.date.localeCompare(b.date));
  const conflicts=shifts.filter(s=>s.conflicted);
  const avail=shifts.filter(s=>{
    if(!((!s.staffId&&(s.open||s.templateSlotId))||(s.conflicted&&s.staffId&&s.staffId!==currentUser.id)))return false;
    return!shifts.some(x=>x.staffId===currentUser.id&&x.role!=='Admin'&&x.date===s.date&&x.start<s.end&&x.end>s.start);
  });
  const dayShifts=[...shifts].filter(s=>s.date===selectedDay).sort((a,b)=>timeToMin(a.start)-timeToMin(b.start));
  const dayAvail=avail.filter(s=>s.date===selectedDay).sort((a,b)=>timeToMin(a.start)-timeToMin(b.start));
  const isAdmin=currentUser?.access==='admin';
  const adminUserIds=new Set(users.filter(u=>u.access==='admin').map(u=>u.id));
  const visShifts=hideAdminShifts&&isAdmin?dayShifts.filter(s=>s.role!=='Admin'):dayShifts;
  const visMine=hideAdminShifts&&isAdmin?mine.filter(s=>s.role!=='Admin'):mine;
  const getU=id=>users.find(u=>u.id===id);
  const maxWeekStartFn=()=>addDaysStr(today,84);
  const weekDays2=Array.from({length:7},(_,i)=>addDaysStr(weekStart,i));
  const weekShifts2=(()=>{const base=shifts.filter(s=>s.date>=weekStart&&s.date<=weekDays2[6]);return hideAdminShifts&&isAdmin?base.filter(s=>s.role!=='Admin'):base;})();
  const weekRows2=(()=>{const ids=new Set(weekShifts2.map(s=>s.staffId).filter(Boolean));const hasOpen=weekShifts2.some(s=>!s.staffId);const rows=[];for(const id of ids){const u=users.find(x=>x.id===id);rows.push({id,name:u?.name??'Unknown',role:u?.role??u?.access??'—'});}rows.sort((a,b)=>a.name.localeCompare(b.name));if(hasOpen)rows.push({id:null,name:'Unassigned',role:'—'});return rows;})();
  return(
    <div>
      {conflictModal&&<div className="mo"><div className="mc" style={{maxWidth:420}}>
        <div className="mt2">Flag Conflict</div>
        <p style={{color:"var(--muted)",fontSize:".85rem",marginBottom:"1rem"}}><strong style={{color:"var(--txt)"}}>{fmt(conflictModal.date)}</strong> ({fmt12(conflictModal.start)}–{fmt12(conflictModal.end)})<br/>Managers will be notified of your conflict.</p>
        <div className="f"><label>Reason</label><input value={cNote} onChange={e=>setCNote(e.target.value)} placeholder="e.g. family commitment, medical" required/></div>
        <div className="ma"><button className="btn btn-s" onClick={()=>setConflictModal(null)}>Cancel</button><button className="btn btn-warn" disabled={shiftOpBusy||!cNote.trim()} onClick={async()=>{if(shiftOpBusy)return;setShiftOpBusy(true);try{await flagShiftConflict(conflictModal.id,cNote||null);setShifts(p=>p.map(s=>s.id===conflictModal.id?{...s,conflicted:true,conflictNote:cNote}:s));onAlert(currentUser.name+' flagged a conflict for '+fmt(conflictModal.date));setConflictModal(null);}catch(e){onAlert('Error flagging conflict: '+e.message);}finally{setShiftOpBusy(false);}}}>Flag →</button></div>
      </div></div>}
      {assignModal&&(()=>{const s=assignModal.shift;const eligible=users.filter(u=>{if(u.id===s.staffId)return false;if(u.access==='customer')return false;if(s.role&&u.role!==s.role&&!userRoles.some(r=>r.userId===u.id&&r.role===s.role))return false;if(isStaffBlocked(u.id,s.date,s.start,s.end,allStaffBlocks))return false;return!shifts.some(x=>x.id!==s.id&&x.staffId===u.id&&x.role!=='Admin'&&x.date===s.date&&x.start<s.end&&x.end>s.start);});return(<div className="mo" onClick={()=>{setAssignModal(null);setAssignTarget('')}}><div className="mc" style={{maxWidth:360}} onClick={e=>e.stopPropagation()}>
        <div className="mt2">Assign Shift</div>
        <p style={{color:"var(--muted)",fontSize:".85rem",marginBottom:"1rem"}}>{s.role&&<><strong style={{color:"var(--txt)"}}>{s.role}</strong> · </>}{fmt(s.date)} {fmt12(s.start)}–{fmt12(s.end)}</p>
        {eligible.length===0?<p style={{color:"var(--muted)",fontSize:".85rem"}}>No eligible staff available at this time.</p>:<div className="f"><label>Assign to</label><select value={assignTarget} onChange={e=>setAssignTarget(e.target.value)} style={{width:'100%'}}><option value="">— select staff —</option>{eligible.map(u=><option key={u.id} value={u.id}>{u.name}{u.role?` (${u.role})`:''}</option>)}</select></div>}
        <div className="ma"><button className="btn btn-s" onClick={()=>{setAssignModal(null);setAssignTarget('')}}>Cancel</button><button className="btn btn-ok" disabled={!assignTarget||shiftOpBusy} onClick={async()=>{if(!assignTarget||shiftOpBusy)return;setShiftOpBusy(true);try{const updated=await assignShift(s.id,assignTarget);setShifts(p=>p.map(x=>x.id===s.id?(updated||{...x,staffId:assignTarget,conflicted:false,conflictNote:null,open:false}):x));onAlert('Shift assigned to '+(users.find(u=>u.id===assignTarget)?.name??'staff'));setAssignModal(null);setAssignTarget('');}catch(e){onAlert('Error assigning shift: '+e.message);}finally{setShiftOpBusy(false);}}}>{shiftOpBusy?'Saving…':'Confirm'}</button></div>
      </div></div>);})()}
      {editShiftModal&&<div className="mo" onClick={()=>setEditShiftModal(null)}><div className="mc" style={{maxWidth:380}} onClick={e=>e.stopPropagation()}>
        <div className="mt2">Edit Shift — {fmt(editShiftModal.date)}</div>
        {(()=>{const em=editShiftModal;const eligible=users.filter(u=>{if(u.access==='customer'||u.active===false)return false;if(em.role&&u.role!==em.role&&!userRoles.some(r=>r.userId===u.id&&r.role===em.role))return false;if(isStaffBlocked(u.id,em.date,em.start,em.end,allStaffBlocks))return false;return!shifts.some(x=>x.id!==em.id&&x.staffId===u.id&&x.role!=='Admin'&&x.date===em.date&&x.start<em.end&&x.end>em.start);});return(<div className="f"><label>Assigned Staff</label><select value={em.staffId} onChange={e=>setEditShiftModal(p=>({...p,staffId:e.target.value}))} style={{width:'100%'}}><option value="">— Unassigned —</option>{eligible.map(u=><option key={u.id} value={u.id}>{u.name}{u.role?` (${u.role})`:''}</option>)}{em.staffId&&!eligible.find(u=>u.id===em.staffId)&&(()=>{const cur=users.find(u=>u.id===em.staffId);return cur?<option key={cur.id} value={cur.id}>{cur.name}{cur.role?` (${cur.role})`:''} ⚠ conflict</option>:null;})()}</select></div>);})()}
        <div className="g2"><div className="f"><label>Start</label><input type="time" value={editShiftModal.start} onChange={e=>setEditShiftModal(p=>({...p,start:e.target.value}))}/></div><div className="f"><label>End</label><input type="time" value={editShiftModal.end} onChange={e=>setEditShiftModal(p=>({...p,end:e.target.value}))}/></div></div>
        <div className="ma"><button className="btn btn-s" onClick={()=>setEditShiftModal(null)}>Cancel</button><button className="btn btn-ok" disabled={shiftOpBusy} onClick={async()=>{if(shiftOpBusy)return;setShiftOpBusy(true);try{const staffId=editShiftModal.staffId||null;const updated=await adminEditShift(editShiftModal.id,{staffId,start:editShiftModal.start,end:editShiftModal.end,open:!staffId});setShifts(p=>p.map(x=>x.id===editShiftModal.id?(updated||{...x,staffId,start:editShiftModal.start,end:editShiftModal.end,open:!staffId}):x));setEditShiftModal(null);}catch(e){onAlert('Error saving shift: '+e.message);}finally{setShiftOpBusy(false);}}}>{shiftOpBusy?'Saving…':'Save'}</button></div>
      </div></div>}
      <div className="tabs">
        <button className={`tab${tab==="mine"?" on":""}`} onClick={()=>setTab("mine")}>My Shifts</button>
        <button className={`tab${tab==="available"?" on":""}`} onClick={()=>setTab("available")}>Available ({avail.length})</button>
        {isManager&&<button className={`tab${tab==="conflict"?" on":""}`} onClick={()=>setTab("conflict")}>Conflicts {conflicts.length>0&&<span style={{background:"var(--warn)",color:"var(--bg2)",borderRadius:"50%",padding:"0 5px",fontSize:".62rem",marginLeft:".25rem"}}>{conflicts.length}</span>}</button>}
        {isManager&&<button className={`tab${tab==="all"?" on":""}`} onClick={()=>setTab("all")}>All Staff</button>}
        {isManager&&<button className={`tab${tab==="templates"?" on":""}`} onClick={()=>setTab("templates")}>Templates</button>}
        <button className={`tab${tab==="blocks"?" on":""}`} onClick={()=>setTab("blocks")}>My Blocks {staffBlocks.filter(b=>b.status==='pending'&&!blockIsResolvedFor(b,currentUser.id)).length>0&&<span style={{background:'var(--warn)',color:'var(--bg2)',borderRadius:'50%',padding:'0 5px',fontSize:'.62rem',marginLeft:'.25rem'}}>{staffBlocks.filter(b=>b.status==='pending'&&!blockIsResolvedFor(b,currentUser.id)).length}</span>}</button>
      </div>
      {tab==="mine"&&(()=>{
        const mineUpcoming=visMine.filter(s=>s.date>=today);
        const minePast=[...visMine.filter(s=>s.date<today)].reverse();
        const mineDisplay=myShiftsSub==='upcoming'?mineUpcoming:minePast;
        return <>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'.65rem',flexWrap:'wrap',gap:'.4rem'}}>
            <div style={{display:'flex',gap:'.3rem'}}>
              <button className={`btn btn-sm${myShiftsSub==='upcoming'?' btn-p':' btn-s'}`} onClick={()=>setMyShiftsSub('upcoming')}>Upcoming {mineUpcoming.length>0&&<span style={{marginLeft:'.2rem',opacity:.8}}>({mineUpcoming.length})</span>}</button>
              <button className={`btn btn-sm${myShiftsSub==='past'?' btn-p':' btn-s'}`} onClick={()=>setMyShiftsSub('past')}>Past {minePast.length>0&&<span style={{marginLeft:'.2rem',opacity:.8}}>({minePast.length})</span>}</button>
            </div>
            {isAdmin&&<button className="btn btn-s btn-sm" style={{opacity:hideAdminShifts?.6:1}} onClick={()=>setHideAdminShifts(p=>!p)}>{hideAdminShifts?'Show Admin Shifts':'Hide Admin Shifts'}</button>}
          </div>
          {!mineDisplay.length&&<div className="empty"><div className="ei">📅</div><p>{myShiftsSub==='upcoming'?'No upcoming shifts.':'No past shifts.'}</p></div>}
          {mineDisplay.map(s=><div key={s.id} className={`shift-card mine${s.conflicted?" conflict":""}`} style={{padding:'.5rem 1rem',flexWrap:'nowrap',opacity:myShiftsSub==='past'?.7:1}}>
            <div style={{fontFamily:"var(--fd)",fontSize:".92rem",fontWeight:700,minWidth:160,flexShrink:0,color:s.conflicted?"var(--warnL)":myShiftsSub==='past'?"var(--muted)":"var(--accB)"}}>{getDayName(s.date)+', '+fmt(s.date)}</div>
            <div style={{flex:1,display:'flex',alignItems:'center',gap:'.55rem',flexWrap:'wrap',minWidth:0}}>
              <span style={{fontSize:".88rem",color:"var(--txt)",whiteSpace:'nowrap'}}>{fmt12(s.start)}–{fmt12(s.end)}</span>
              {fmtDur(s.start,s.end)&&<span style={{fontSize:".82rem",color:"var(--muted)",whiteSpace:'nowrap'}}>{fmtDur(s.start,s.end)}</span>}
              {s.role&&<span style={{fontSize:".73rem",background:"var(--surf2)",color:"var(--txt)",borderRadius:3,padding:".1rem .4rem",border:"1px solid var(--bdr)",flexShrink:0,whiteSpace:'nowrap'}}>{s.role}</span>}
              {s.conflicted&&<span className="badge b-conflict" style={{fontSize:'.7rem',flexShrink:0}}>Awaiting Manager</span>}
              {s.conflicted&&s.conflictNote&&<span style={{fontSize:".78rem",color:"var(--warnL)",fontStyle:'italic',whiteSpace:'nowrap'}}>"{s.conflictNote}"</span>}
            </div>
            {!s.conflicted&&s.date>=today&&<button className="btn btn-warn btn-sm" style={{flexShrink:0}} onClick={()=>{setCNote("");setConflictModal(s);}}>Flag Conflict</button>}
          </div>)}
          {!isManager&&myShiftsSub==='upcoming'&&<StaffStandardSchedule userId={currentUser.id}/>}
        </>;
      })()}
      {tab==="conflict"&&isManager&&<>
        {!conflicts.length&&<div className="empty"><div className="ei">✅</div><p>No conflicted shifts.</p></div>}
        {conflicts.map(s=>{const orig=getU(s.staffId);return <div key={s.id} className="shift-card conflict" style={{padding:'.5rem 1rem',flexDirection:'column',gap:'.35rem'}}>
          <div style={{display:'flex',alignItems:'center',gap:'.55rem',flexWrap:'wrap'}}>
            <div style={{fontFamily:"var(--fd)",fontSize:".92rem",fontWeight:700,color:"var(--warnL)",flexShrink:0}}>{getDayName(s.date)+', '+fmt(s.date)}</div>
            <span style={{fontSize:".88rem",color:"var(--txt)",whiteSpace:'nowrap'}}>{fmt12(s.start)}–{fmt12(s.end)}</span>
            {fmtDur(s.start,s.end)&&<span style={{fontSize:".82rem",color:"var(--muted)",whiteSpace:'nowrap'}}>{fmtDur(s.start,s.end)}</span>}
            {s.role&&<span style={{fontSize:".73rem",background:"var(--surf2)",color:"var(--txt)",borderRadius:3,padding:".1rem .4rem",border:"1px solid var(--bdr)",flexShrink:0,whiteSpace:'nowrap'}}>{s.role}</span>}
            <span className="badge b-conflict" style={{fontSize:'.65rem',flexShrink:0}}>conflict</span>
          </div>
          {orig&&<div style={{fontSize:".82rem",color:"var(--muted)"}}>Assigned: <strong style={{color:"var(--txt)"}}>{orig.name}</strong></div>}
          {s.conflictNote&&<div style={{fontSize:".82rem",color:"var(--warnL)",fontStyle:'italic'}}>"{s.conflictNote}"</div>}
          <div style={{display:"flex",gap:".4rem",flexShrink:0,marginTop:'.15rem'}}>
            <button className="btn btn-ok btn-sm" disabled={shiftOpBusy} onClick={async()=>{if(shiftOpBusy)return;setShiftOpBusy(true);try{const updated=await approveShiftConflict(s.id);setShifts(p=>p.map(x=>x.id===s.id?(updated||{...x,conflicted:false,conflictNote:null,staffId:null,open:true}):x));onAlert('Conflict approved — shift released to Available pool');}catch(e){onAlert('Error approving conflict: '+e.message);}finally{setShiftOpBusy(false);}}}>Approve</button>
            <button className="btn btn-d btn-sm" disabled={shiftOpBusy} onClick={async()=>{if(shiftOpBusy)return;setShiftOpBusy(true);try{const updated=await declineShiftConflict(s.id);setShifts(p=>p.map(x=>x.id===s.id?(updated||{...x,conflicted:false,conflictNote:null}):x));onAlert('Conflict declined — '+(orig?.name??'staff')+' remains on shift');}catch(e){onAlert('Error declining conflict: '+e.message);}finally{setShiftOpBusy(false);}}}>Decline</button>
            <button className="btn btn-s btn-sm" disabled={shiftOpBusy} onClick={()=>setAssignModal({shift:s})}>Assign</button>
          </div>
        </div>;})}
      </>}
      {tab==="available"&&<>
        {!avail.length&&<div className="empty"><div className="ei">📋</div><p>No available shifts.</p></div>}
        {[...avail].sort((a,b)=>a.date.localeCompare(b.date)||timeToMin(a.start)-timeToMin(b.start)).map(s=>{
          const blockConflict=isStaffBlocked(currentUser.id,s.date,s.start,s.end,staffBlocks);
          return <div key={s.id} className="shift-card available" style={{padding:'.5rem 1rem',flexWrap:'nowrap'}}>
            <div style={{fontFamily:"var(--fd)",fontSize:".92rem",fontWeight:700,color:"var(--okB)",minWidth:160,flexShrink:0}}>{getDayName(s.date)+', '+fmt(s.date)}</div>
            <div style={{flex:1,display:'flex',alignItems:'center',gap:'.55rem',flexWrap:'wrap',minWidth:0}}>
              <span style={{fontSize:".88rem",color:"var(--txt)",whiteSpace:'nowrap'}}>{fmt12(s.start)}–{fmt12(s.end)}</span>
              {fmtDur(s.start,s.end)&&<span style={{fontSize:".82rem",color:"var(--muted)",whiteSpace:'nowrap'}}>{fmtDur(s.start,s.end)}</span>}
              {s.role&&<span style={{fontSize:".73rem",background:"var(--surf2)",color:"var(--txt)",borderRadius:3,padding:".1rem .4rem",border:"1px solid var(--bdr)",flexShrink:0,whiteSpace:'nowrap'}}>{s.role}</span>}
              {blockConflict&&<span style={{fontSize:".78rem",color:"var(--warnL)",fontStyle:'italic',whiteSpace:'nowrap'}}>Conflicts with your Blocks</span>}
            </div>
            {isManager
              ?<button className="btn btn-ok btn-sm" style={{flexShrink:0}} disabled={shiftOpBusy} onClick={()=>setAssignModal({shift:s})}>Assign</button>
              :blockConflict
                ?<button className="btn btn-warn btn-sm" style={{flexShrink:0}} onClick={()=>setTab('blocks')}>Edit my blocks</button>
                :<button className="btn btn-ok btn-sm" style={{flexShrink:0}} disabled={shiftOpBusy} onClick={async()=>{if(shiftOpBusy)return;if(shifts.some(x=>x.staffId===currentUser.id&&x.role!=='Admin'&&x.date===s.date&&x.start<s.end&&x.end>s.start)){onAlert('You already have a shift at this time.');return;}setShiftOpBusy(true);try{const claimed=await claimShift(s.id);if(claimed){setShifts(p=>p.map(x=>x.id===s.id?claimed:x));}onAlert(currentUser.name+' picked up shift on '+fmt(s.date));}catch(e){onAlert('Error claiming shift: '+e.message);}finally{setShiftOpBusy(false);}}}> Claim</button>
            }
          </div>;
        })}
        {isManager&&<button className="btn btn-s btn-sm" style={{marginTop:".5rem"}} onClick={()=>{const d=prompt("Date (YYYY-MM-DD):");const st=prompt("Start (HH:MM):");const en=prompt("End (HH:MM):");if(d&&st&&en)setShifts(p=>[...p,{id:Date.now(),staffId:null,date:d,start:st,end:en,open:true}]);}}>+ Post Open Shift</button>}
      </>}
      {tab==="blocks"&&<div>
        {!addingBlock&&<button className="btn btn-s btn-sm" style={{marginBottom:'.75rem'}} onClick={()=>setAddingBlock(true)}>+ Add Block</button>}
        {addingBlock&&<div style={{background:'var(--bg2)',borderRadius:'var(--r)',padding:'1rem',marginBottom:'1rem',border:'1px solid var(--border)'}}>
          <div style={{fontWeight:700,marginBottom:'.5rem'}}>New Availability Block</div>
          <div className="f"><label>Start Date</label><input type="date" value={blockDraft.startDate} onChange={e=>setBlockDraft(p=>({...p,startDate:e.target.value,endDate:e.target.value>p.endDate?e.target.value:p.endDate}))}/></div>
          <div className="f"><label>End Date</label><input type="date" value={blockDraft.endDate} min={blockDraft.startDate} onChange={e=>setBlockDraft(p=>({...p,endDate:e.target.value}))}/></div>
          <div style={{display:'flex',alignItems:'center',gap:'.5rem',margin:'.35rem 0 .5rem'}}><input type="checkbox" id="block-fullday" checked={blockDraft.isFullDay} onChange={e=>setBlockDraft(p=>({...p,isFullDay:e.target.checked}))}/><label htmlFor="block-fullday" style={{cursor:'pointer',fontSize:'.9rem',margin:0}}>All Day</label></div>
          {!blockDraft.isFullDay&&<><div className="f"><label>Start Time</label><input type="time" value={blockDraft.startTime} onChange={e=>setBlockDraft(p=>({...p,startTime:e.target.value}))}/></div><div className="f"><label>End Time</label><input type="time" value={blockDraft.endTime} onChange={e=>setBlockDraft(p=>({...p,endTime:e.target.value}))}/></div></>}
          <div className="f"><label>Label (optional)</label><input value={blockDraft.label} onChange={e=>setBlockDraft(p=>({...p,label:e.target.value}))} placeholder="e.g. Vacation, Doctor appt"/></div>
          <div className="ma"><button className="btn btn-s" onClick={()=>setAddingBlock(false)}>Cancel</button><button className="btn btn-ok" disabled={blockSaving} onClick={handleAddBlock}>{blockSaving?'Saving…':'Save Block'}</button></div>
        </div>}
        {!staffBlocks.length&&!addingBlock&&<div className="empty"><div className="ei">📅</div><p>No availability blocks set.</p></div>}
        {staffBlocks.map(b=>{
          const resolved=blockIsResolvedFor(b,currentUser.id);
          const dateRange=b.startDate===b.endDate?fmt(b.startDate):fmt(b.startDate)+' – '+fmt(b.endDate);
          const timeRange=(!b.startTime||!b.endTime)?'All day':fmt12(b.startTime)+' – '+fmt12(b.endTime);
          if(editingBlockId===b.id) return <div key={b.id} style={{background:'var(--bg2)',borderRadius:'var(--r)',padding:'1rem',marginBottom:'.5rem',border:'1px solid var(--border)'}}>
            <div style={{fontWeight:700,marginBottom:'.5rem'}}>Edit Block</div>
            <div className="f"><label>Start Date</label><input type="date" value={blockDraft.startDate} onChange={e=>setBlockDraft(p=>({...p,startDate:e.target.value,endDate:e.target.value>p.endDate?e.target.value:p.endDate}))}/></div>
            <div className="f"><label>End Date</label><input type="date" value={blockDraft.endDate} min={blockDraft.startDate} onChange={e=>setBlockDraft(p=>({...p,endDate:e.target.value}))}/></div>
            <div style={{display:'flex',alignItems:'center',gap:'.5rem',margin:'.35rem 0 .5rem'}}><input type="checkbox" id={'edit-fullday-'+b.id} checked={blockDraft.isFullDay} onChange={e=>setBlockDraft(p=>({...p,isFullDay:e.target.checked}))}/><label htmlFor={'edit-fullday-'+b.id} style={{cursor:'pointer',fontSize:'.9rem',margin:0}}>All Day</label></div>
            {!blockDraft.isFullDay&&<><div className="f"><label>Start Time</label><input type="time" value={blockDraft.startTime} onChange={e=>setBlockDraft(p=>({...p,startTime:e.target.value}))}/></div><div className="f"><label>End Time</label><input type="time" value={blockDraft.endTime} onChange={e=>setBlockDraft(p=>({...p,endTime:e.target.value}))}/></div></>}
            <div className="f"><label>Label (optional)</label><input value={blockDraft.label} onChange={e=>setBlockDraft(p=>({...p,label:e.target.value}))} placeholder="e.g. Vacation, Doctor appt"/></div>
            <div className="ma"><button className="btn btn-s" onClick={()=>setEditingBlockId(null)}>Cancel</button><button className="btn btn-ok" disabled={blockSaving} onClick={handleUpdateBlock}>{blockSaving?'Saving…':'Save Changes'}</button></div>
          </div>;
          return <div key={b.id} className="shift-card" style={{marginBottom:'.5rem'}}>
            <div style={{flex:1}}>
              <div style={{fontFamily:'var(--fd)',fontSize:'1rem',fontWeight:700,color:'var(--accB)'}}>{dateRange}</div>
              <div style={{fontSize:'.82rem',color:'var(--muted)'}}>{timeRange}</div>
              {b.label&&<div style={{fontSize:'.78rem',color:'var(--muted)',marginTop:'.1rem'}}>{b.label}</div>}
              <div style={{marginTop:'.3rem'}}>
                {resolved?<span className="badge b-ok" style={{fontSize:'.7rem'}}>✓ Cleared</span>:b.status==='pending'?<span className="badge b-conflict" style={{fontSize:'.7rem'}}>⏳ Pending coverage</span>:<span className="badge b-ok" style={{fontSize:'.7rem'}}>✓ Confirmed</span>}
              </div>
            </div>
            <div style={{display:'flex',gap:'.4rem'}}>
              <button className="btn btn-s btn-sm" onClick={()=>startEditBlock(b)}>Edit</button>
              <button className="btn btn-d btn-sm" onClick={()=>handleDeleteBlock(b.id)}>Remove</button>
            </div>
          </div>;
        })}
      </div>}
      {tab==="all"&&isManager&&<div>
        <div className="tabs" style={{marginBottom:'1rem'}}>
          <button className={`tab${allStaffSub==='roster'?' on':''}`} onClick={()=>setAllStaffSub('roster')}>Daily Roster</button>
          <button className={`tab${allStaffSub==='week'?' on':''}`} onClick={()=>setAllStaffSub('week')}>Week View</button>
          <button className={`tab${allStaffSub==='employee-blocks'?' on':''}`} onClick={()=>setAllStaffSub('employee-blocks')}>Employee Blocks</button>
        </div>
        {allStaffSub==='roster'&&<>
          <div style={{display:'flex',alignItems:'center',gap:'.5rem',flexWrap:'wrap',marginBottom:'.5rem'}}>
            <DateNav selected={selectedDay} today={today} onChange={setSelectedDay}/>
            {isAdmin&&<><span style={{color:'var(--bdr)',margin:'0 .1rem'}}>|</span><button className="btn btn-s btn-sm" style={{opacity:hideAdminShifts?.6:1}} onClick={()=>setHideAdminShifts(p=>!p)}>{hideAdminShifts?'Show Admin Shifts':'Hide Admin Shifts'}</button></>}
          </div>
          {!visShifts.length&&<div className="empty"><div className="ei">📅</div><p>No shifts on this date.</p></div>}
          {visShifts.map(s=>{
            const m=getU(s.staffId);
            const unassigned=!s.staffId||s.open;
            return <div key={s.id} className="shift-card" style={{padding:'.5rem 1rem',flexWrap:'nowrap',borderLeft:unassigned?'3px solid var(--warn)':'',background:unassigned?'rgba(255,160,0,.07)':''}}>
              <div style={{flex:1,display:'flex',alignItems:'center',gap:'.55rem',flexWrap:'wrap',minWidth:0}}>
                <span style={{fontSize:".88rem",color:"var(--txt)",whiteSpace:'nowrap',fontWeight:600}}>{fmt12(s.start)}–{fmt12(s.end)}</span>
                {fmtDur(s.start,s.end)&&<span style={{fontSize:".82rem",color:"var(--muted)",whiteSpace:'nowrap'}}>{fmtDur(s.start,s.end)}</span>}
                {s.role&&<span style={{fontSize:".73rem",background:"var(--surf2)",color:"var(--txt)",borderRadius:3,padding:".1rem .4rem",border:"1px solid var(--bdr)",flexShrink:0,whiteSpace:'nowrap'}}>{s.role}</span>}
                {unassigned
                  ?<span style={{fontSize:".78rem",color:"var(--warn)",fontWeight:600}}>⚠️ Unassigned</span>
                  :<span style={{fontSize:".85rem",color:"var(--txt)"}}>{m?.name}</span>}
                {s.conflicted&&<span className="badge b-conflict" style={{fontSize:'.7rem'}}>Conflict</span>}
              </div>
              <div style={{display:'flex',gap:'.35rem',flexShrink:0}}>
                {s.date>=today&&<button className="btn btn-s btn-sm" onClick={()=>setEditShiftModal({id:s.id,staffId:s.staffId||'',start:s.start,end:s.end,date:s.date,role:s.role})}>Edit</button>}
                <button className="btn btn-d btn-sm" onClick={()=>setShifts(p=>p.filter(x=>x.id!==s.id))}>Remove</button>
              </div>
            </div>;
          })}
        </>}
        {allStaffSub==='week'&&<>
          <div style={{display:'flex',alignItems:'center',gap:'.65rem',marginBottom:'1rem',flexWrap:'wrap'}}>
            <button className="btn btn-s btn-sm" disabled={weekStart<=today} onClick={()=>setWeekStart(p=>addDaysStr(p,-7))}>← Prev</button>
            <span style={{fontSize:'.88rem',fontFamily:'var(--fd)',minWidth:210,textAlign:'center'}}>{fmt(weekStart)} – {fmt(weekDays2[6])}</span>
            <button className="btn btn-s btn-sm" disabled={weekStart>=maxWeekStartFn()} onClick={()=>setWeekStart(p=>{const n=addDaysStr(p,7);return n>maxWeekStartFn()?maxWeekStartFn():n;})}>Next →</button>
            <button className="btn btn-s btn-sm" onClick={()=>setWeekStart(today)}>Today</button>
            {isAdmin&&<><span style={{color:'var(--bdr)',margin:'0 .1rem'}}>|</span><button className="btn btn-s btn-sm" style={{opacity:hideAdminShifts?.6:1}} onClick={()=>setHideAdminShifts(p=>!p)}>{hideAdminShifts?'Show Admin Shifts':'Hide Admin Shifts'}</button></>}
          </div>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:'.8rem'}}>
              <thead>
                <tr style={{background:'var(--surf2)'}}>
                  <th style={{padding:'.45rem .75rem',textAlign:'left',borderBottom:'1px solid var(--bdr)',color:'var(--muted)',minWidth:110,fontWeight:600,fontSize:'.72rem',letterSpacing:'.04em',textTransform:'uppercase'}}>Staff</th>
                  {weekDays2.map(d=><th key={d} style={{padding:'.45rem .55rem',textAlign:'center',borderBottom:'1px solid var(--bdr)',color:d===today?'var(--acc)':'var(--txt)',minWidth:88,fontWeight:d===today?700:500,fontSize:'.72rem'}}>
                    {getDayName(d).slice(0,3)+' '+new Date(d+'T00:00:00').getDate()}
                  </th>)}
                </tr>
              </thead>
              <tbody>
                {weekRows2.length===0
                  ?<tr><td colSpan={8} style={{padding:'1.5rem',textAlign:'center',color:'var(--muted)',fontStyle:'italic'}}>No shifts scheduled for this week.</td></tr>
                  :weekRows2.map((row,ri)=><tr key={row.id??'__open'} style={{borderBottom:ri<weekRows2.length-1?'1px solid var(--bdr)':'none'}}>
                    <td style={{padding:'.45rem .75rem',verticalAlign:'middle'}}>
                      <div style={{fontSize:'.84rem',fontWeight:500}}>{row.name}</div>
                    </td>
                    {weekDays2.map(d=>{
                      const dayS=weekShifts2.filter(s=>s.date===d&&(row.id?s.staffId===row.id:!s.staffId));
                      return <td key={d} style={{padding:'.35rem .4rem',textAlign:'center',verticalAlign:'top',background:d===today?'rgba(90,138,58,.04)':undefined}}>
                        {dayS.map(s=>{
                          const st=s.conflicted?'conflict':s.open?'open':'ok';
                          return <div key={s.id} style={{background:st==='conflict'?'rgba(184,150,12,.15)':st==='open'?'rgba(90,138,58,.1)':'var(--surf2)',borderRadius:4,padding:'.2rem .3rem',marginBottom:'.2rem',lineHeight:1.35}}>
                            <div style={{fontSize:'.73rem',fontFamily:'var(--fd)'}}>{s.role?s.role+' | ':''}{fmt12(s.start)}–{fmt12(s.end)}</div>
                            {st!=='ok'&&<div style={{fontSize:'.65rem',color:st==='conflict'?'var(--warnL)':'var(--okB)',marginTop:'.1rem'}}>{st}</div>}
                          </div>;
                        })}
                      </td>;
                    })}
                  </tr>)
                }
              </tbody>
            </table>
          </div>
        </>}
        {allStaffSub==='employee-blocks'&&(()=>{const staffUsers=users.filter(u=>u.access!=='customer'&&u.access!=='kiosk'&&u.active!==false).sort((a,b)=>a.name.localeCompare(b.name));const anyBlocks=allStaffBlocks.length>0;return<>{!anyBlocks&&<div className="empty"><div className="ei">📅</div><p>No staff availability blocks on record.</p></div>}{staffUsers.map(u=>{const ub=allStaffBlocks.filter(b=>b.staffId===u.id).sort((a,b2)=>a.startDate.localeCompare(b2.startDate));if(!ub.length)return null;return<div key={u.id} style={{marginBottom:'1.25rem'}}><div style={{fontFamily:'var(--fd)',fontSize:'.88rem',fontWeight:700,color:'var(--accB)',marginBottom:'.4rem',letterSpacing:'.04em',textTransform:'uppercase'}}>{u.name}</div>{ub.map(b=>{const dr=b.startDate===b.endDate?fmt(b.startDate):fmt(b.startDate)+' – '+fmt(b.endDate);const tr=(!b.startTime||!b.endTime)?'All day':fmt12(b.startTime)+' – '+fmt12(b.endTime);return<div key={b.id} className="shift-card" style={{marginBottom:'.3rem',padding:'.45rem .85rem'}}><div style={{flex:1}}><div style={{fontSize:'.86rem',fontWeight:600,color:'var(--txt)'}}>{dr}</div><div style={{fontSize:'.78rem',color:'var(--muted)'}}>{tr}{b.label?' · '+b.label:''}</div></div>{(()=>{const br=blockIsResolvedFor(b,u.id);return<span className={`badge ${br||b.status!=='pending'?'b-ok':'b-conflict'}`} style={{fontSize:'.65rem',flexShrink:0}}>{br?'✓ Cleared':b.status==='pending'?'Pending':'Confirmed'}</span>;})()}</div>;})}</div>;})}</>;})()}
      </div>}
      {tab==="templates"&&isManager&&<StaffingScheduler currentUser={currentUser} shifts={shifts} setShifts={setShifts} users={users} isManager={isManager} onAlert={onAlert} initialView="templates" embedded={true}/>}
    </div>
  );
}

export default SchedulePanel
