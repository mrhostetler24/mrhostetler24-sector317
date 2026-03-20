// UNUSED — staff now routed to AdminPortal (2026-03-19). Safe to delete after ~1 week if no issues.
// Uncomment the block below to restore standalone StaffPortal functionality.

/*
import { useState, useEffect } from "react"
import { todayStr } from "./utils.js"
import { supabase, removePlayerFromReservation, updateReservation } from "./supabase.js"
import AccountPanel from "./AccountPanel.jsx"
import SchedulePanel from "./SchedulePanel.jsx"
import MerchPortal from "./MerchPortal.jsx"
import SocialPortal from "./SocialPortal.jsx"
import ReservationRow from "./ReservationRow.jsx"

function StaffPortal({user,reservations,setReservations,resTypes,users,setUsers,setPayments,waiverDocs,activeWaiverDoc,shifts,setShifts,runs=[],onSignWaiver,onAddPlayer,onAlert,navTarget,onNavConsumed}){
  const [tab,setTab]=useState("today");
  const [schedTabOverride,setSchedTabOverride]=useState(null);
  const [showAccount,setShowAccount]=useState(false);
  const [careerRuns,setCareerRuns]=useState(null);
  const [friendsVersion,setFriendsVersion]=useState(0);
  const today=todayStr();
  const todayRes=[...reservations].filter(r=>r.date===today&&r.status!=="cancelled").sort((a,b)=>a.startTime.localeCompare(b.startTime));
  const upcoming=[...reservations].filter(r=>r.date>today&&r.status!=="cancelled").sort((a,b)=>a.date.localeCompare(b.date)||a.startTime.localeCompare(b.startTime)).slice(0,25);
  const spEmployeeTabs=["schedule","social"];
  const spTabGroup=spEmployeeTabs.includes(tab)?"employee":"company";
  const spSwitchGroup=(g)=>{if(g==="company")setTab("today");if(g==="employee")setTab("social");};
  useEffect(()=>{
    if(navTarget){setTab("schedule");setSchedTabOverride(navTarget);onNavConsumed?.();}
  },[navTarget]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{
    if(tab!=='social')return;
    supabase.from('v_leaderboard_cumulative').select('total_runs_played').eq('player_id',user.id).maybeSingle()
      .then(({data})=>setCareerRuns(data?.total_runs_played??0)).catch(()=>setCareerRuns(0));
  },[tab]); // eslint-disable-line react-hooks/exhaustive-deps
  return(
    <div className="content">
      {showAccount&&<AccountPanel user={user} users={users} setUsers={setUsers} onClose={()=>setShowAccount(false)}/>}
      {/* Desktop/tablet: flat single row *\/}
      <div className="tabs desktop-tabs">
        <button className={`tab${tab==="today"?" on":""}`} onClick={()=>setTab("today")}>Today ({todayRes.length})</button>
        <button className={`tab${tab==="upcoming"?" on":""}`} onClick={()=>setTab("upcoming")}>Upcoming</button>
        <button className={`tab${tab==="merch"?" on":""}`} onClick={()=>setTab("merch")}>Merch</button>
        <button className={`tab${tab==="schedule"?" on":""}`} onClick={()=>setTab("schedule")}>My Schedule</button>
        <button className={`tab${tab==="social"?" on":""}`} onClick={()=>setTab("social")}>Social</button>
        <button className="btn btn-p btn-sm" style={{marginLeft:"auto",flexShrink:0}} onClick={()=>window.open(window.location.origin+window.location.pathname+"?ops=1","_blank")}>Operations ↗</button>
      </div>
      {/* Mobile: two-row grouped *\/}
      <div className="tabs-wrap mobile-tabs">
        <div className="tabs">
          <button className={`tab tab-grp${spTabGroup==="company"?" on":""}`} onClick={()=>spSwitchGroup("company")}>Company</button>
          <button className={`tab tab-grp${spTabGroup==="employee"?" on":""}`} onClick={()=>spSwitchGroup("employee")}>Employee</button>
          <button className="btn btn-p btn-sm" style={{marginLeft:"auto",flexShrink:0}} onClick={()=>window.open(window.location.origin+window.location.pathname+"?ops=1","_blank")}>OPS ↗</button>
        </div>
        <div className="tabs">
          {spTabGroup==="company"&&<>
            <button className={`tab${tab==="today"?" on":""}`} onClick={()=>setTab("today")}>Today ({todayRes.length})</button>
            <button className={`tab${tab==="upcoming"?" on":""}`} onClick={()=>setTab("upcoming")}>Upcoming</button>
            <button className={`tab${tab==="merch"?" on":""}`} onClick={()=>setTab("merch")}>Merch</button>
          </>}
          {spTabGroup==="employee"&&<>
            <button className={`tab${tab==="schedule"?" on":""}`} onClick={()=>setTab("schedule")}>My Schedule</button>
            <button className={`tab${tab==="social"?" on":""}`} onClick={()=>setTab("social")}>Social</button>
          </>}
        </div>
      </div>
      {(tab==="today"||tab==="upcoming")&&<>
        {!(tab==="today"?todayRes:upcoming).length&&<div className="empty"><div className="ei">{tab==="today"?"🎯":"📅"}</div><p>No {tab==="today"?"sessions today":"upcoming sessions"}.</p></div>}
        {!!(tab==="today"?todayRes:upcoming).length&&<div className="tw"><div className="th"><span className="ttl">{tab==="today"?"Today's Sessions":"Upcoming"}</span><span style={{fontSize:".74rem",color:"var(--muted)"}}>Click row to expand</span></div>
          <table><thead><tr><th>Customer / Date</th><th>Type</th><th>Players</th><th>Status</th></tr></thead>
            <tbody>{(tab==="today"?todayRes:upcoming).map(r=><ReservationRow key={r.id} res={r} resTypes={resTypes} users={users} waiverDocs={waiverDocs} activeWaiverDoc={activeWaiverDoc} canManage={true} currentUser={user} onAddPlayer={onAddPlayer} onSignWaiver={(uid,name)=>onSignWaiver(uid,name)} onRemovePlayer={async(resId,playerId)=>{try{await removePlayerFromReservation(playerId);setReservations(p=>p.map(r=>r.id===resId?{...r,players:r.players.filter(x=>x.id!==playerId)}:r));}catch(e){onAlert("Error removing player: "+e.message);}}} onReschedule={(user.access==='manager'||user.access==='admin')?async(resId,date,startTime)=>{try{const updated=await updateReservation(resId,{date,startTime,rescheduled:true});setReservations(p=>p.map(r=>r.id===resId?{...r,date:updated.date,startTime:updated.startTime,rescheduled:true}:r));}catch(e){onAlert("Error rescheduling: "+e.message);}}:undefined}/>)}</tbody>
          </table></div>}
      </>}
      {tab==="merch"&&<MerchPortal currentUser={user} users={users} setUsers={setUsers} setPayments={setPayments} onAlert={onAlert}/>}
      {tab==="schedule"&&<SchedulePanel currentUser={user} shifts={shifts} setShifts={setShifts} users={users} isManager={false} onAlert={onAlert} tabOverride={schedTabOverride} onTabOverrideConsumed={()=>setSchedTabOverride(null)}/>}
      {tab==="social"&&<SocialPortal user={user} users={users} setUsers={setUsers} reservations={reservations} resTypes={resTypes} runs={runs} careerRuns={careerRuns} onEditProfile={()=>setShowAccount(true)} onFriendsChanged={()=>setFriendsVersion(v=>v+1)}/>}
    </div>
  );
}

export default StaffPortal
*/
