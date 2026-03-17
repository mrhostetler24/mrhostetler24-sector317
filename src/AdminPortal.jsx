import { useState, useEffect, useMemo } from "react"
import { DAYS_OF_WEEK, ACCESS_LEVELS, PAGE_SIZE, todayStr, fmt, fmtMoney, fmtPhone, fmt12, cleanPh, sortTemplates, getSessionsForDate, getTierInfo, TIER_COLORS, TIER_SHINE } from "./utils.js"
import { AuthBadge, Toast, Toggle, WaiverTooltip, RunsCell, genDefaultLeaderboardName } from "./ui.jsx"
import {
  supabase, mergeUsers, updateUserAdmin, updateEmailPreferences, fetchEmailPreferences,
  applyStoreCredit, addPlayerToReservation, removePlayerFromReservation, updateReservation,
  upsertResType, upsertSessionTemplate, deleteSessionTemplate,
  upsertWaiverDoc, setActiveWaiverDoc, deleteWaiverDoc,
  upsertObjective, deleteObjective, fetchAllObjectives, updateShift
} from "./supabase.js"
import { emailStoreCreditApplied } from "./emails.js"
import { vizRenderName, audRenderName } from "./envRender.jsx"
import AccountPanel from "./AccountPanel.jsx"
import MergeAccountsModal from "./MergeAccountsModal.jsx"
import DeactivateStaffModal from "./DeactivateStaffModal.jsx"
import SchedulePanel from "./SchedulePanel.jsx"
import MerchPortal from "./MerchPortal.jsx"
import SocialPortal from "./SocialPortal.jsx"
import ReservationRow from "./ReservationRow.jsx"

function AdminPortal({user,reservations,setReservations,resTypes,setResTypes,sessionTemplates,setSessionTemplates,waiverDocs,setWaiverDocs,activeWaiverDoc,users,setUsers,shifts,setShifts,payments,setPayments,onAlert,userAuthDates=[],runs=[],staffRoles=[]}){
  const [tab,setTab]=useState("dashboard");
  const [schedTabOverride,setSchedTabOverride]=useState(null);
  const apEmployeeTabs=["social","schedule"];
  const apAdminTabs=["types","sessions","waivers","objectives"];
  const tabGroup=apAdminTabs.includes(tab)?"admin":apEmployeeTabs.includes(tab)?"employee":"company";
  const switchGroup=(g)=>{if(g==="company")setTab("dashboard");if(g==="employee")setTab("social");if(g==="admin")setTab("types");};
  const [toastMsg,setToastMsg]=useState(null);
  const [modal,setModal]=useState(null);
  const [deactivateModal,setDeactivateModal]=useState(null);
  const [showAccountFor,setShowAccountFor]=useState(null);
  const isAdmin=user.access==="admin";
  const isManager=user.access==="manager"||isAdmin;
  const [dashPeriod,setDashPeriod]=useState("all");
  const [dashFrom,setDashFrom]=useState("");
  const [dashTo,setDashTo]=useState("");
  const [recentPage,setRecentPage]=useState(0);
  const [runPage,setRunPage]=useState(0);
  const [userPage,setUserPage]=useState(0);
  const [dashViewTab,setDashViewTab]=useState("bookings");
  const [acknowledgedFlags,setAcknowledgedFlags]=useState(()=>{try{return new Set(JSON.parse(localStorage.getItem("ack-flags")||"[]"))}catch{return new Set()}});
  const [showAcknowledged,setShowAcknowledged]=useState(false);
  const [dismissedDups,setDismissedDups]=useState([]);
  const [careerRuns,setCareerRuns]=useState(null);
  const [friendsVersion,setFriendsVersion]=useState(0);
  useEffect(()=>{
    if(tab!=='social')return;
    supabase.from('v_leaderboard_cumulative').select('total_runs_played').eq('player_id',user.id).maybeSingle()
      .then(({data})=>setCareerRuns(data?.total_runs_played??0)).catch(()=>setCareerRuns(0));
  },[tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const [showWidgetMenu,setShowWidgetMenu]=useState(false);
  const [dashWidgets,setDashWidgets]=useState(()=>isAdmin
    ?{revenue:true,bookings:true,players:true,utilization:true,newUsers:true,leadTime:true,envCoop:true,envVs:true,avgRunTime:true}
    :{bookings:true,players:true,leadTime:true,envCoop:true,envVs:true,avgRunTime:true});
  const toggleWidget=id=>setDashWidgets(p=>({...p,[id]:!p[id]}));
  const showToast=msg=>{setToastMsg(msg);setTimeout(()=>setToastMsg(null),3200);};
  const [custSearch,setCustSearch]=useState("");
  const [custPage,setCustPage]=useState(1);
  const [resPage,setResPage]=useState(1);
  const [mergeTarget,setMergeTarget]=useState(null);
  const handleMergeUsers=async(winnerId,loserId)=>{
    await mergeUsers(winnerId,loserId);
    setUsers(prev=>prev.filter(u=>u.id!==loserId));
    setReservations(prev=>prev.map(r=>r.userId===loserId?{...r,userId:winnerId}:r));
    setPayments(prev=>prev.map(p=>p.userId===loserId?{...p,userId:winnerId}:p));
    setDismissedDups(prev=>[...prev,loserId]);
    showToast("Accounts merged successfully");
  };
  const getType=id=>resTypes.find(rt=>rt.id===id);
  const getUser=id=>users.find(u=>u.id===id);
  const alertShifts=shifts.filter(s=>s.conflicted);
  const today=todayStr();
  const [editRT,setEditRT]=useState(null);
  const [newRT,setNewRT]=useState({name:"",mode:"coop",style:"open",pricingMode:"per_person",price:55,maxPlayers:"",description:"",active:true,availableForBooking:true});
  const [editST,setEditST]=useState(null);
  const [newST,setNewST]=useState({dayOfWeek:"Monday",startTime:"18:00",maxSessions:2,active:true});
  const [editUser,setEditUser]=useState(null);
  const [editUserPrefs,setEditUserPrefs]=useState(null);
  useEffect(()=>{
    if(!editUser){setEditUserPrefs(null);return;}
    fetchEmailPreferences(editUser.id).then(p=>setEditUserPrefs({
      bookings:p.bookings??true,match_summary:p.match_summary??true,
      social:p.social??true,merchandise:p.merchandise??true,marketing:p.marketing??true,
    })).catch(()=>setEditUserPrefs({bookings:true,match_summary:true,social:true,merchandise:true,marketing:true}));
  },[editUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [userSaving,setUserSaving]=useState(false);
  const [applyCreditFor,setApplyCreditFor]=useState(null);
  const [applyCreditAmt,setApplyCreditAmt]=useState('');
  const [applyCreditReason,setApplyCreditReason]=useState('');
  const [applyCreditBusy,setApplyCreditBusy]=useState(false);
  const [newUser,setNewUser]=useState({name:"",phone:"",access:"staff",role:null,active:true,waivers:[],needsRewaiverDocId:null});
  const doSaveUser=async()=>{
    if(!editUser)return;
    // Intercept: if deactivating an active user who has future shifts
    const prevActive=users.find(u=>u.id===editUser.id)?.active;
    if(prevActive&&!editUser.active){
      const td=todayStr();
      const futureShifts=shifts.filter(s=>s.staffId===editUser.id&&s.date>td&&!s.open&&!s.conflicted);
      if(futureShifts.length>0){setDeactivateModal({user:editUser,futureShifts});return;}
    }
    setUserSaving(true);
    try{
      const updated=await updateUserAdmin(editUser.id,{
        name:editUser.name,phone:editUser.phone,access:editUser.access,role:editUser.role,active:editUser.active,
        ...(editUser.access==="customer"?{
          leaderboardName:editUser.leaderboardName||null,
          hideFromLeaderboard:editUser.hideFromLeaderboard??false,
          canBook:editUser.canBook??false,
        }:{}),
      });
      setUsers(p=>p.map(u=>u.id===updated.id?updated:u));
      if(editUserPrefs) await updateEmailPreferences(editUser.id,editUserPrefs).catch(()=>{});
      setModal(null);setEditUser(null);setEditUserPrefs(null);showToast("Saved");
    }catch(e){showToast("Error: "+e.message);}
    finally{setUserSaving(false);}
  };
  const doDeactivateUser=async(user)=>{
    setUserSaving(true);
    try{
      const updated=await updateUserAdmin(user.id,{
        name:user.name,phone:user.phone,access:user.access,role:user.role,active:user.active,
        ...(user.access==="customer"?{leaderboardName:user.leaderboardName||null,hideFromLeaderboard:user.hideFromLeaderboard??false}:{}),
      });
      setUsers(p=>p.map(u=>u.id===updated.id?updated:u));
      setModal(null);setEditUser(null);setDeactivateModal(null);showToast("Deactivated");
    }catch(e){showToast("Error: "+e.message);}
    finally{setUserSaving(false);}
  };
  const [newShift,setNewShift]=useState({staffId:"",date:"",start:"10:00",end:"18:00"});
  const [editWaiver,setEditWaiver]=useState(null);
  const [newWaiver,setNewWaiver]=useState({name:"",version:"1.0",body:"",active:false});
  const [adminObjectives,setAdminObjectives]=useState([]);
  const [editObj,setEditObj]=useState(null);
  const [newObj,setNewObj]=useState({name:"",description:"",mode:"all",active:true});
  const objF=editObj||newObj;const setObjF=fn=>editObj?setEditObj(p=>({...(typeof fn==="function"?fn(p):fn)})):setNewObj(p=>({...(typeof fn==="function"?fn(p):fn)}));
  useEffect(()=>{if(tab==="objectives"&&isAdmin)fetchAllObjectives().then(setAdminObjectives).catch(()=>{});},[tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveObj=async()=>{
    try{
      const saved=await upsertObjective(objF);
      if(editObj)setAdminObjectives(p=>p.map(o=>o.id===saved.id?saved:o));
      else setAdminObjectives(p=>[...p,saved].sort((a,b)=>a.name.localeCompare(b.name)));
      showToast(editObj?"Updated":"Created");setModal(null);setEditObj(null);
    }catch(e){showToast("Error: "+e.message);}
  };
  const doDeleteObj=async(id)=>{
    try{await deleteObjective(id);setAdminObjectives(p=>p.filter(o=>o.id!==id));showToast("Deleted");}
    catch(e){showToast("Error: "+e.message);}
  };
  const [resSubTab,setResSubTab]=useState("upcoming");
  const [showWI,setShowWI]=useState(false);
  const [wi,setWi]=useState({customerName:"",typeId:"coop-open",date:"",startTime:"",playerCount:1,status:"confirmed"});
  const sortTmpl=fn=>setSessionTemplates(p=>sortTemplates(typeof fn==="function"?fn(p):fn));
  const rtF=editRT||newRT;const setRTF=fn=>editRT?setEditRT(p=>({...(typeof fn==="function"?fn(p):fn)})):setNewRT(p=>({...(typeof fn==="function"?fn(p):fn)}));
  const stF=editST||newST;const setSTF=fn=>editST?setEditST(p=>({...(typeof fn==="function"?fn(p):fn)})):setNewST(p=>({...(typeof fn==="function"?fn(p):fn)}));
  const wF=editWaiver||newWaiver;const setWF=fn=>editWaiver?setEditWaiver(p=>({...(typeof fn==="function"?fn(p):fn)})):setNewWaiver(p=>({...(typeof fn==="function"?fn(p):fn)}));
  const canManageUser=u=>{if(isAdmin)return true;if(isManager)return u.access!=="admin";return false;};
  const saveRT=async()=>{try{const saved=await upsertResType({...rtF,price:+rtF.price,maxPlayers:rtF.maxPlayers?+rtF.maxPlayers:null});if(editRT)setResTypes(p=>p.map(rt=>rt.id===saved.id?saved:rt));else setResTypes(p=>[...p,saved]);showToast(editRT?"Updated":"Created");setModal(null);setEditRT(null);}catch(e){showToast("Error: "+e.message);}};
  const saveST=()=>{if(editST)sortTmpl(p=>p.map(st=>st.id===editST.id?editST:st));else sortTmpl(p=>[...p,{...newST,id:Date.now(),maxSessions:+newST.maxSessions}]);showToast(editST?"Updated":"Added");setModal(null);setEditST(null);};
  const saveWaiver=async()=>{
    try{
      if(editWaiver){
        const updated=await upsertWaiverDoc(editWaiver);
        setWaiverDocs(p=>p.map(w=>w.id===updated.id?updated:w));
        showToast("Waiver updated");
      }else{
        const nd=await upsertWaiverDoc(newWaiver);
        if(newWaiver.active){
          await setActiveWaiverDoc(nd.id);
          setWaiverDocs(p=>[nd,...p.map(w=>({...w,active:false}))]);
          setUsers(p=>p.map(u=>({...u,needsRewaiverDocId:nd.id})));
          onAlert("New waiver published — all users must re-sign before their next visit");
        }else{
          setWaiverDocs(p=>[...p,nd]);
        }
        showToast("Waiver created");
      }
    }catch(e){showToast("Error saving waiver: "+e.message);}
    setModal(null);setEditWaiver(null);
  };
  const setActiveWaiver=async id=>{
    try{
      await setActiveWaiverDoc(id);
      setWaiverDocs(p=>p.map(w=>({...w,active:w.id===id})));
      setUsers(p=>p.map(u=>({...u,needsRewaiverDocId:id})));
      onAlert("Active waiver changed — all users flagged for re-sign");
      showToast("Active waiver updated");
    }catch(e){showToast("Error: "+e.message);}
  };
  const addPlayer=async(resId,player)=>{
    try{
      const updated=await addPlayerToReservation(resId,player);
      setReservations(p=>p.map(r=>r.id===resId?updated:r));
      showToast(`${player.name} added`);
    }catch(e){showToast("Error adding player: "+e.message);}
  };
  const signWaiver=(uid,name)=>{const ts=new Date().toISOString();if(uid)setUsers(p=>p.map(u=>u.id===uid?{...u,waivers:[...u.waivers,{signedAt:ts,signedName:name,waiverDocId:activeWaiverDoc?.id}],needsRewaiverDocId:null}:u));showToast(`Waiver signed by ${name}`);};
  const cancelRes=id=>{setReservations(p=>p.map(r=>r.id===id?{...r,status:"cancelled"}:r));showToast("Cancelled");};
  const removePlayer=async(resId,playerId)=>{try{await removePlayerFromReservation(playerId);setReservations(p=>p.map(r=>r.id===resId?{...r,players:r.players.filter(x=>x.id!==playerId)}:r));showToast("Player removed");}catch(e){showToast("Error: "+e.message);}};
  const rescheduleRes=async(resId,date,startTime)=>{try{const updated=await updateReservation(resId,{date,startTime,rescheduled:true});setReservations(p=>p.map(r=>r.id===resId?{...r,date:updated.date,startTime:updated.startTime,rescheduled:true}:r));showToast("Rescheduled");}catch(e){showToast("Error: "+e.message);}};
  const upcomingRes=[...reservations].filter(r=>r.date>=today).sort((a,b)=>a.date.localeCompare(b.date)||a.startTime.localeCompare(b.startTime));
  const pastRes=[...reservations].filter(r=>r.date<today).sort((a,b)=>b.date.localeCompare(a.date)||b.startTime.localeCompare(a.startTime));
  const wiSlots=wi.date?getSessionsForDate(wi.date,sessionTemplates):[];
  const selWIType=resTypes.find(rt=>rt.active&&rt.id===wi.typeId);
  const calcWI=(tid,pc)=>{const rt=resTypes.find(x=>x.id===tid&&x.active);if(!rt)return 0;return rt.pricingMode==="flat"?rt.price:rt.price*pc;};

  // Dashboard date filter
  const dashRes=useMemo(()=>{
    const now=new Date();
    let from="",to="";
    if(dashPeriod==="day"){from=to=today;}
    else if(dashPeriod==="week"){const d=new Date(now);d.setDate(d.getDate()-d.getDay());from=d.toISOString().slice(0,10);to=today;}
    else if(dashPeriod==="month"){from=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-01`;to=today;}
    else if(dashPeriod==="year"){from=`${now.getFullYear()}-01-01`;to=today;}
    else if(dashPeriod==="custom"){from=dashFrom;to=dashTo;}
    if(!from)return reservations;
    return reservations.filter(r=>(!from||r.date>=from)&&(!to||r.date<=to));
  },[reservations,dashPeriod,dashFrom,dashTo,today]);

  // Duplicate account detection — phone-only users whose phone/email matches a social auth user
  const dupAlerts=useMemo(()=>{
    const authUsers=users.filter(u=>u.authProvider);
    const phoneOnly=users.filter(u=>!u.authProvider&&u.access==="customer");
    const dups=[];
    phoneOnly.forEach(po=>{
      const matchPhone=po.phone&&authUsers.find(a=>a.phone&&cleanPh(a.phone)===cleanPh(po.phone)&&a.id!==po.id);
      const matchEmail=po.email&&authUsers.find(a=>a.email&&a.email.toLowerCase()===po.email.toLowerCase()&&a.id!==po.id);
      if((matchPhone||matchEmail)&&!dismissedDups.includes(po.id)){
        dups.push({phoneOnlyUser:po,authUser:matchPhone||matchEmail,reason:matchPhone?"phone":"email"});
      }
    });
    return dups;
  },[users,dismissedDups]);

  return(
    <div className="content">
      {showAccountFor&&<AccountPanel user={showAccountFor} users={users} setUsers={setUsers} onClose={()=>setShowAccountFor(null)}/>}
      {mergeTarget&&<MergeAccountsModal users={users} targetUser={mergeTarget} reservations={reservations} onMerge={async(wId,lId)=>{await handleMergeUsers(wId,lId);setMergeTarget(null);}} onClose={()=>setMergeTarget(null)}/>}
      {toastMsg&&<Toast msg={toastMsg} onClose={()=>setToastMsg(null)}/>}
      {alertShifts.length>0&&<div className="alert-banner"><div className="alert-dot"/><strong style={{color:"var(--warnL)"}}>⚠ {alertShifts.length} shift conflict{alertShifts.length!==1?"s":""} need attention</strong><button className="btn btn-warn btn-sm" style={{marginLeft:"auto"}} onClick={()=>{setTab("schedule");setSchedTabOverride("conflict");}}>View →</button></div>}
      {modal==="rt"&&<div className="mo"><div className="mc"><div className="mt2">{editRT?"Edit":"New"} Type</div>
        <div className="f"><label>Name</label><input value={rtF.name} onChange={e=>setRTF(p=>({...p,name:e.target.value}))}/></div>
        <div className="g2"><div className="f"><label>Mode</label><select value={rtF.mode} onChange={e=>setRTF(p=>({...p,mode:e.target.value}))}><option value="coop">Co-Op</option><option value="versus">Versus</option></select></div><div className="f"><label>Style</label><select value={rtF.style} onChange={e=>setRTF(p=>({...p,style:e.target.value}))}><option value="open">Open</option><option value="private">Private</option></select></div></div>
        <div className="g2"><div className="f"><label>Pricing</label><select value={rtF.pricingMode} onChange={e=>setRTF(p=>({...p,pricingMode:e.target.value}))}><option value="per_person">Per Person</option><option value="flat">Flat Fee</option></select></div><div className="f"><label>Price ($)</label><input type="number" value={rtF.price} onChange={e=>setRTF(p=>({...p,price:e.target.value}))}/></div></div>
        {rtF.style==="private"&&<div className="f"><label>Max Players</label><input type="number" value={rtF.maxPlayers||""} onChange={e=>setRTF(p=>({...p,maxPlayers:e.target.value}))}/></div>}
        <div className="f"><label>Description</label><textarea value={rtF.description} onChange={e=>setRTF(p=>({...p,description:e.target.value}))} rows={2}/></div>
        <div className="g2"><div className="f"><label>Status</label><select value={rtF.active?"active":"inactive"} onChange={e=>setRTF(p=>({...p,active:e.target.value==="active"}))}><option value="active">Active</option><option value="inactive">Inactive</option></select></div><div className="f"><label>Bookable</label><select value={rtF.availableForBooking?"yes":"no"} onChange={e=>setRTF(p=>({...p,availableForBooking:e.target.value==="yes"}))}><option value="yes">Yes</option><option value="no">No</option></select></div></div>
        <div className="ma"><button className="btn btn-s" onClick={()=>{setModal(null);setEditRT(null);}}>Cancel</button><button className="btn btn-p" disabled={!rtF.name} onClick={saveRT}>Save</button></div>
      </div></div>}
      {modal==="st"&&<div className="mo"><div className="mc"><div className="mt2">{editST?"Edit":"Add"} Slot</div>
        <div className="g2"><div className="f"><label>Day</label><select value={stF.dayOfWeek} onChange={e=>setSTF(p=>({...p,dayOfWeek:e.target.value}))}>{DAYS_OF_WEEK.map(d=><option key={d}>{d}</option>)}</select></div><div className="f"><label>Start Time</label><input type="time" value={stF.startTime} onChange={e=>setSTF(p=>({...p,startTime:e.target.value}))}/></div></div>
        <div className="f"><label>Max Concurrent Open-Play</label><input type="number" min={1} max={10} value={stF.maxSessions} onChange={e=>setSTF(p=>({...p,maxSessions:+e.target.value}))}/></div>
        <div className="f"><label>Status</label><select value={stF.active?"active":"inactive"} onChange={e=>setSTF(p=>({...p,active:e.target.value==="active"}))}><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
        <div className="ma"><button className="btn btn-s" onClick={()=>{setModal(null);setEditST(null);}}>Cancel</button><button className="btn btn-p" onClick={saveST}>Save</button></div>
      </div></div>}
      {modal==="obj"&&<div className="mo"><div className="mc"><div className="mt2">{editObj?"Edit":"New"} Objective</div>
        <div className="f"><label>Name</label><input value={objF.name} onChange={e=>setObjF(p=>({...p,name:e.target.value}))}/></div>
        <div className="f"><label>Description</label><textarea value={objF.description||""} onChange={e=>setObjF(p=>({...p,description:e.target.value}))} rows={2}/></div>
        <div className="g2">
          <div className="f"><label>Mode</label><select value={objF.mode} onChange={e=>setObjF(p=>({...p,mode:e.target.value}))}><option value="all">All Modes</option><option value="coop">Coop Only</option><option value="versus">Versus Only</option></select></div>
          <div className="f"><label>Status</label><select value={objF.active?"active":"inactive"} onChange={e=>setObjF(p=>({...p,active:e.target.value==="active"}))}><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
        </div>
        <div className="ma"><button className="btn btn-s" onClick={()=>{setModal(null);setEditObj(null);}}>Cancel</button><button className="btn btn-p" disabled={!objF.name.trim()} onClick={saveObj}>Save</button></div>
      </div></div>}
      {deactivateModal&&<DeactivateStaffModal
        userToDeactivate={deactivateModal.user}
        futureShifts={deactivateModal.futureShifts}
        users={users}
        shifts={shifts}
        onConfirm={async(updates)=>{
          for(const u of updates){
            const upd=await updateShift(u.id,{staffId:u.staffId,open:u.open});
            setShifts(p=>p.map(s=>s.id===upd.id?upd:s));
          }
          await doDeactivateUser(deactivateModal.user);
        }}
        onCancel={()=>setDeactivateModal(null)}
      />}
      {modal==="user"&&<div className="mo"><div className="mc"><div className="mt2">{editUser?"Edit":"Add"} User</div>
        <div className="f"><label>Full Name</label><input value={editUser?.name||newUser.name} onChange={e=>editUser?setEditUser(p=>({...p,name:e.target.value})):setNewUser(p=>({...p,name:e.target.value}))}/></div>
        <div className="f"><label>Mobile</label><div className="phone-wrap"><span className="phone-prefix">+1</span><input type="tel" value={editUser?.phone||newUser.phone} onChange={e=>{const v=cleanPh(e.target.value);editUser?setEditUser(p=>({...p,phone:v})):setNewUser(p=>({...p,phone:v}));}} maxLength={10}/></div></div>
        {(()=>{const curAccess=editUser?.access||newUser.access;return <div className="g2"><div className="f"><label>Access</label><select value={curAccess} onChange={e=>{const acc=e.target.value;const role=acc==="customer"?null:(staffRoles[0]??null);editUser?setEditUser(p=>({...p,access:acc,role})):setNewUser(p=>({...p,access:acc,role}));}}><option value="customer">Customer</option><option value="staff">Staff</option><option value="manager">Manager</option>{isAdmin&&<option value="admin">Admin</option>}</select></div>{curAccess!=="customer"&&<div className="f"><label>Role</label><select value={editUser?.role||newUser.role||""} onChange={e=>editUser?setEditUser(p=>({...p,role:e.target.value})):setNewUser(p=>({...p,role:e.target.value}))}><option value="">— None —</option>{staffRoles.map(r=><option key={r}>{r}</option>)}</select></div>}</div>;})()}
        {editUser&&<div className="f"><label>Status</label><select value={editUser.active?"active":"inactive"} onChange={e=>setEditUser(p=>({...p,active:e.target.value==="active"}))}><option value="active">Active</option><option value="inactive">Inactive</option></select></div>}
        {editUser?.access==="customer"&&(()=>{
          const authEntry=userAuthDates.find(d=>d.userId===editUser.id);
          const fmtD=s=>s?new Date(s).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}):"—";
          return<>
            <div style={{background:"var(--surf2)",border:"1px solid var(--bdr)",borderRadius:5,padding:".6rem .9rem",marginBottom:".5rem",fontSize:".78rem",color:"var(--muted)",display:"flex",gap:"1.5rem",flexWrap:"wrap",alignItems:"center"}}>
              <span><strong style={{color:"var(--txt)"}}>Auth:</strong>&nbsp;<AuthBadge provider={editUser.authProvider}/></span>
              <span><strong style={{color:"var(--txt)"}}>User created:</strong>&nbsp;{fmtD(editUser.createdAt)}</span>
              {authEntry&&<span><strong style={{color:"var(--txt)"}}>Auth account:</strong>&nbsp;{fmtD(authEntry.authCreatedAt)}</span>}
            </div>
            <div className="f">
              <label>Leaderboard Name</label>
              <input value={editUser.leaderboardName||""} onChange={e=>setEditUser(p=>({...p,leaderboardName:e.target.value}))} placeholder={genDefaultLeaderboardName(editUser.name,editUser.phone)} maxLength={24}/>
            </div>
            <label style={{display:"flex",alignItems:"center",gap:".5rem",marginBottom:".45rem",cursor:"pointer",fontSize:".82rem",color:"var(--muted)"}}>
              <input type="checkbox" checked={editUser.hideFromLeaderboard??false} onChange={e=>setEditUser(p=>({...p,hideFromLeaderboard:e.target.checked}))} style={{accentColor:"var(--accB)",width:15,height:15,flexShrink:0}}/>
              Hide from all leaderboards
            </label>
            <label style={{display:"flex",alignItems:"center",gap:".5rem",marginBottom:".75rem",cursor:"pointer",fontSize:".82rem",color:"var(--muted)"}}>
              <input type="checkbox" checked={editUser.canBook??false} onChange={e=>setEditUser(p=>({...p,canBook:e.target.checked}))} style={{accentColor:"var(--accB)",width:15,height:15,flexShrink:0}}/>
              Can book missions
            </label>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"var(--surf2)",border:"1px solid var(--bdr)",borderRadius:5,padding:".5rem .75rem",marginBottom:".5rem"}}>
              <span style={{fontSize:".82rem",color:"var(--muted)"}}>Store Credits: <strong style={{color:"var(--accB)"}}>{fmtMoney(editUser.credits??0)}</strong></span>
              <button className="btn btn-ok btn-sm" onClick={()=>{setApplyCreditFor(editUser);setApplyCreditAmt('');setApplyCreditReason('');}}>Apply Credit</button>
            </div>
          </>;
        })()}
        {editUser&&editUserPrefs&&<>
          <div style={{fontWeight:700,fontSize:".78rem",textTransform:"uppercase",letterSpacing:".06em",color:"var(--muted)",margin:"1rem 0 .5rem"}}>Email Notifications</div>
          {[
            {key:"bookings",label:"Booking Confirmations & Reminders"},
            {key:"match_summary",label:"Post-Match Summaries"},
            {key:"social",label:"Social Notifications"},
            {key:"merchandise",label:"Order & Shipping Updates"},
            {key:"marketing",label:"Newsletter & Promotions"},
          ].map(({key,label})=>(
            <label key={key} style={{display:"flex",alignItems:"center",gap:".5rem",marginBottom:".45rem",cursor:"pointer",fontSize:".82rem",color:"var(--txt)"}}>
              <input type="checkbox" checked={editUserPrefs[key]??true} onChange={e=>setEditUserPrefs(p=>({...p,[key]:e.target.checked}))} style={{accentColor:"var(--accB)",width:15,height:15,flexShrink:0}}/>
              {label}
            </label>
          ))}
        </>}
        <div className="ma"><button className="btn btn-s" onClick={()=>{setModal(null);setEditUser(null);setEditUserPrefs(null);}}>Cancel</button><button className="btn btn-p" disabled={userSaving} onClick={()=>{if(editUser)doSaveUser();else{setUsers(p=>[...p,{...newUser,id:Date.now()}]);setModal(null);setEditUser(null);showToast("Saved");}}}>{userSaving?"Saving…":"Save"}</button></div>
      </div></div>}
      {applyCreditFor&&<div className="mo"><div className="mc" style={{maxWidth:400}}>
        <div className="mt2">Apply Store Credit</div>
        <p style={{color:"var(--muted)",fontSize:".85rem",marginBottom:"1rem"}}>Customer: <strong style={{color:"var(--txt)"}}>{applyCreditFor.name}</strong><br/>Current balance: <strong style={{color:"var(--accB)"}}>{fmtMoney(applyCreditFor.credits??0)}</strong></p>
        <div className="f"><label>Amount ($)</label><input type="number" min="0.01" step="0.01" placeholder="0.00" value={applyCreditAmt} onChange={e=>setApplyCreditAmt(e.target.value)}/></div>
        <div className="f"><label>Reason</label><input value={applyCreditReason} onChange={e=>setApplyCreditReason(e.target.value)} placeholder="e.g. compensation, promotional, referral"/></div>
        <div className="ma">
          <button className="btn btn-s" onClick={()=>setApplyCreditFor(null)}>Cancel</button>
          <button className="btn btn-ok" disabled={applyCreditBusy||!applyCreditAmt||parseFloat(applyCreditAmt)<=0||!applyCreditReason.trim()}
            onClick={async()=>{
              setApplyCreditBusy(true);
              try{
                const amt=parseFloat(applyCreditAmt);
                await applyStoreCredit(applyCreditFor.id,currentUser.id,amt,applyCreditReason.trim());
                const newCredits=(applyCreditFor.credits??0)+amt;
                setUsers(p=>p.map(u=>u.id===applyCreditFor.id?{...u,credits:newCredits}:u));
                if(editUser?.id===applyCreditFor.id) setEditUser(p=>({...p,credits:newCredits}));
                showToast(`${fmtMoney(amt)} credit applied to ${applyCreditFor.name}`);
                emailStoreCreditApplied(applyCreditFor.id,{amount:amt,reason:applyCreditReason.trim(),newBalance:newCredits});
                setApplyCreditFor(null);
              }catch(e){showToast('Error: '+e.message);}
              finally{setApplyCreditBusy(false);}
            }}>{applyCreditBusy?'Applying…':'Apply Credit →'}</button>
        </div>
      </div></div>}
      {modal==="shift"&&<div className="mo"><div className="mc"><div className="mt2">Schedule Shift</div>
        <div className="f"><label>Staff Member</label><select value={newShift.staffId} onChange={e=>setNewShift(p=>({...p,staffId:e.target.value}))}><option value="">Select…</option>{users.filter(u=>u.access!=="customer"&&u.active).map(s=><option key={s.id} value={s.id}>{s.name} — {s.role}</option>)}</select></div>
        <div className="f"><label>Date</label><input type="date" value={newShift.date} onChange={e=>setNewShift(p=>({...p,date:e.target.value}))}/></div>
        <div className="g2"><div className="f"><label>Start</label><input type="time" value={newShift.start} onChange={e=>setNewShift(p=>({...p,start:e.target.value}))}/></div><div className="f"><label>End</label><input type="time" value={newShift.end} onChange={e=>setNewShift(p=>({...p,end:e.target.value}))}/></div></div>
        <div className="ma"><button className="btn btn-s" onClick={()=>setModal(null)}>Cancel</button><button className="btn btn-p" onClick={()=>{setShifts(p=>[...p,{...newShift,id:Date.now(),staffId:+newShift.staffId}]);setModal(null);showToast("Shift scheduled");}}>Schedule</button></div>
      </div></div>}
      {modal==="waiver"&&<div className="mo"><div className="mc" style={{maxWidth:640}}><div className="mt2">{editWaiver?"Edit":"New"} Waiver</div>
        {!editWaiver&&<div style={{background:"rgba(184,150,12,.08)",border:"1px solid var(--warn)",borderRadius:5,padding:".75rem",marginBottom:"1rem",fontSize:".8rem",color:"var(--warnL)"}}>⚠ Publishing as active will require ALL users to re-sign before their next visit.</div>}
        <div className="g2"><div className="f"><label>Name</label><input value={wF.name} onChange={e=>setWF(p=>({...p,name:e.target.value}))}/></div><div className="f"><label>Version</label><input value={wF.version} onChange={e=>setWF(p=>({...p,version:e.target.value}))}/></div></div>
        <div className="f"><label>Waiver Body</label><textarea value={wF.body} onChange={e=>setWF(p=>({...p,body:e.target.value}))} rows={10}/></div>
        <div className="f"><label>Publish as Active</label><select value={wF.active?"yes":"no"} onChange={e=>setWF(p=>({...p,active:e.target.value==="yes"}))}><option value="no">No (draft)</option><option value="yes">Yes — publish & require re-sign</option></select></div>
        <div className="ma"><button className="btn btn-s" onClick={()=>{setModal(null);setEditWaiver(null);}}>Cancel</button><button className="btn btn-p" disabled={!wF.name||!wF.body} onClick={saveWaiver}>Save</button></div>
      </div></div>}
      {showWI&&<div className="mo"><div className="mc"><div className="mt2">Walk-In Reservation</div>
        <div className="f"><label>Customer Name</label><input value={wi.customerName} onChange={e=>setWi(p=>({...p,customerName:e.target.value}))}/></div>
        <div className="f"><label>Type</label><select value={wi.typeId} onChange={e=>setWi(p=>({...p,typeId:e.target.value,startTime:""}))}>{resTypes.filter(rt=>rt.active).map(rt=><option key={rt.id} value={rt.id}>{rt.name}</option>)}</select></div>
        <div className="g2"><div className="f"><label>Date</label><input type="date" value={wi.date} onChange={e=>setWi(p=>({...p,date:e.target.value,startTime:""}))}/></div><div className="f"><label>Time</label><select value={wi.startTime} onChange={e=>setWi(p=>({...p,startTime:e.target.value}))}><option value="">— Select —</option>{wiSlots.map(s=><option key={s.id} value={s.startTime}>{fmt12(s.startTime)}</option>)}<option value="custom">Custom…</option></select></div></div>
        {wi.startTime==="custom"&&<div className="f"><label>Custom Time</label><input type="time" value={wi.customTime||""} onChange={e=>setWi(p=>({...p,customTime:e.target.value}))}/></div>}
        <div className="g2"><div className="f"><label>Players</label><input type="number" min={1} max={selWIType?.maxPlayers||20} value={wi.playerCount} onChange={e=>setWi(p=>({...p,playerCount:Math.max(1,+e.target.value)}))}/></div><div className="f"><label>Status</label><select value={wi.status} onChange={e=>setWi(p=>({...p,status:e.target.value}))}><option value="confirmed">Confirmed</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></div></div>
        <div style={{background:"var(--accD)",border:"1px solid var(--acc2)",borderRadius:5,padding:".7rem",marginBottom:".5rem",display:"flex",justifyContent:"space-between"}}><span style={{color:"var(--muted)"}}>{selWIType?.name} · {wi.playerCount}p</span><strong style={{color:"var(--accB)"}}>{fmtMoney(calcWI(wi.typeId,wi.playerCount))}</strong></div>
        <div className="ma"><button className="btn btn-s" onClick={()=>{setShowWI(false);setWi({customerName:"",typeId:"coop-open",date:"",startTime:"",playerCount:1,status:"confirmed"});}}>Cancel</button><button className="btn btn-p" disabled={!wi.customerName.trim()||!wi.date||(!wi.startTime||(wi.startTime==="custom"&&!wi.customTime))} onClick={()=>{const st=wi.startTime==="custom"?wi.customTime:wi.startTime;setReservations(p=>[...p,{...wi,id:Date.now(),startTime:st,amount:calcWI(wi.typeId,wi.playerCount),players:[],userId:null}]);showToast("Walk-in added");setShowWI(false);setWi({customerName:"",typeId:"coop-open",date:"",startTime:"",playerCount:1,status:"confirmed"});}}>Add</button></div>
      </div></div>}
      {/* Desktop/tablet: flat single row */}
      <div className="tabs desktop-tabs">
        <button className={`tab${tab==="dashboard"?" on":""}`} onClick={()=>setTab("dashboard")}>Dashboard</button>
        <button className={`tab${tab==="social"?" on":""}`} onClick={()=>setTab("social")}>Social</button>
        <button className={`tab${tab==="reservations"?" on":""}`} onClick={()=>setTab("reservations")}>Reservations</button>
        {isManager&&<button className={`tab${tab==="customers"?" on":""}`} onClick={()=>setTab("customers")}>Customers{dupAlerts.length>0&&<span style={{background:"var(--danger)",color:"#fff",borderRadius:"50%",padding:"0 5px",fontSize:".65rem",marginLeft:".3rem"}}>{dupAlerts.length}</span>}</button>}
        {isAdmin&&<button className={`tab${tab==="types"?" on":""}`} onClick={()=>setTab("types")}>Res. Types</button>}
        {isAdmin&&<button className={`tab${tab==="sessions"?" on":""}`} onClick={()=>setTab("sessions")}>Sessions</button>}
        {isAdmin&&<button className={`tab${tab==="waivers"?" on":""}`} onClick={()=>setTab("waivers")}>Waivers</button>}
        {isAdmin&&<button className={`tab${tab==="objectives"?" on":""}`} onClick={()=>setTab("objectives")}>Objectives</button>}
        <button className={`tab${tab==="staff"?" on":""}`} onClick={()=>setTab("staff")}>Staff</button>
        <button className={`tab${tab==="schedule"?" on":""}`} onClick={()=>setTab("schedule")}>Schedule{alertShifts.length>0&&<span style={{background:"var(--warn)",color:"var(--bg2)",borderRadius:"50%",padding:"0 5px",fontSize:".65rem",marginLeft:".3rem"}}>{alertShifts.length}</span>}</button>
        {isManager&&<button className={`tab${tab==="merchandise"?" on":""}`} onClick={()=>setTab("merchandise")}>Merch</button>}
        <button className="btn btn-p btn-sm" style={{marginLeft:"auto",flexShrink:0}} onClick={()=>window.open(window.location.origin+window.location.pathname+"?ops=1","_blank")}>Operations ↗</button>
      </div>
      {/* Mobile: two-row grouped */}
      <div className="tabs-wrap mobile-tabs">
        <div className="tabs">
          <button className={`tab tab-grp${tabGroup==="company"?" on":""}`} onClick={()=>switchGroup("company")}>Company</button>
          <button className={`tab tab-grp${tabGroup==="employee"?" on":""}`} onClick={()=>switchGroup("employee")}>Employee</button>
          {isAdmin&&<button className={`tab tab-grp${tabGroup==="admin"?" on":""}`} onClick={()=>switchGroup("admin")}>Admin</button>}
          <button className="btn btn-p btn-sm" style={{marginLeft:"auto",flexShrink:0}} onClick={()=>window.open(window.location.origin+window.location.pathname+"?ops=1","_blank")}>OPS ↗</button>
        </div>
        <div className="tabs">
          {tabGroup==="company"&&<>
            <button className={`tab${tab==="dashboard"?" on":""}`} onClick={()=>setTab("dashboard")}>Dashboard</button>
            <button className={`tab${tab==="reservations"?" on":""}`} onClick={()=>setTab("reservations")}>Reservations</button>
            {isManager&&<button className={`tab${tab==="customers"?" on":""}`} onClick={()=>setTab("customers")}>Customers{dupAlerts.length>0&&<span style={{background:"var(--danger)",color:"#fff",borderRadius:"50%",padding:"0 5px",fontSize:".65rem",marginLeft:".3rem"}}>{dupAlerts.length}</span>}</button>}
            <button className={`tab${tab==="staff"?" on":""}`} onClick={()=>setTab("staff")}>Staff</button>
            {isManager&&<button className={`tab${tab==="merchandise"?" on":""}`} onClick={()=>setTab("merchandise")}>Merch</button>}
          </>}
          {tabGroup==="employee"&&<>
            <button className={`tab${tab==="social"?" on":""}`} onClick={()=>setTab("social")}>Social</button>
            <button className={`tab${tab==="schedule"?" on":""}`} onClick={()=>setTab("schedule")}>Schedule{alertShifts.length>0&&<span style={{background:"var(--warn)",color:"var(--bg2)",borderRadius:"50%",padding:"0 5px",fontSize:".65rem",marginLeft:".3rem"}}>{alertShifts.length}</span>}</button>
          </>}
          {tabGroup==="admin"&&isAdmin&&<>
            <button className={`tab${tab==="types"?" on":""}`} onClick={()=>setTab("types")}>Res. Types</button>
            <button className={`tab${tab==="sessions"?" on":""}`} onClick={()=>setTab("sessions")}>Sessions</button>
            <button className={`tab${tab==="waivers"?" on":""}`} onClick={()=>setTab("waivers")}>Waivers</button>
            <button className={`tab${tab==="objectives"?" on":""}`} onClick={()=>setTab("objectives")}>Objectives</button>
          </>}
        </div>
      </div>

      {tab==="dashboard"&&<>
        {/* Date filter bar + widget toggle */}
        <div style={{display:"flex",gap:".5rem",flexWrap:"wrap",alignItems:"center",background:"var(--surf)",border:"1px solid var(--bdr)",borderRadius:6,padding:".65rem 1rem",marginBottom:"1.1rem"}}>
          {[["all","All Time"],["day","Today"],["week","This Week"],["month","This Month"],["year","This Year"],["custom","Custom"]].map(([v,l])=>(
            <button key={v} className={`btn btn-sm ${dashPeriod===v?"btn-p":"btn-s"}`} onClick={()=>setDashPeriod(v)}>{l}</button>
          ))}
          {dashPeriod==="custom"&&<>
            <input type="date" value={dashFrom} onChange={e=>setDashFrom(e.target.value)} style={{background:"var(--bg2)",border:"1px solid var(--bdr)",borderRadius:4,color:"var(--txt)",padding:".28rem .6rem",fontSize:".8rem"}}/>
            <span style={{color:"var(--muted)",fontSize:".8rem"}}>→</span>
            <input type="date" value={dashTo} onChange={e=>setDashTo(e.target.value)} style={{background:"var(--bg2)",border:"1px solid var(--bdr)",borderRadius:4,color:"var(--txt)",padding:".28rem .6rem",fontSize:".8rem"}}/>
          </>}
          <span style={{marginLeft:"auto",fontSize:".75rem",color:"var(--muted)"}}>{dashRes.length} reservation{dashRes.length!==1?"s":""}</span>
          <div className="widget-menu">
            <button className={`btn btn-sm btn-s`} style={{display:"flex",alignItems:"center",gap:".35rem",borderColor:showWidgetMenu?"var(--acc)":"var(--bdr)"}} onClick={()=>setShowWidgetMenu(o=>!o)}>
              <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/><rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>
              Widgets
            </button>
            {showWidgetMenu&&<div className="widget-panel">
              <div className="widget-panel-title">Show / Hide Widgets</div>
              {[
                {id:"revenue",     label:"Revenue",        adminOnly:true},
                {id:"utilization", label:"Utilization",    adminOnly:true},
                {id:"newUsers",    label:"New Accounts",   adminOnly:true},
                {id:"bookings",    label:"Bookings",       adminOnly:false},
                {id:"players",     label:"Avg/Lane",       adminOnly:false},
                {id:"leadTime",    label:"Lead Time",      adminOnly:false},
                {id:"envCoop",     label:"Env — Co-Op",    adminOnly:false},
                {id:"envVs",       label:"Env — Versus",   adminOnly:false},
                {id:"avgRunTime",  label:"Avg Run Time",   adminOnly:false},
              ].filter(w=>isAdmin||!w.adminOnly).map(w=>{
                return <div key={w.id} className="widget-row">
                  <span>{w.label}</span>
                  <label className="toggle-switch" onClick={()=>toggleWidget(w.id)} style={{cursor:"pointer"}}>
                    <div className={`toggle-track${dashWidgets[w.id]?" on":""}`}><div className="toggle-knob"/></div>
                  </label>
                </div>;
              })}
            </div>}
          </div>
        </div>
        <div className="stats-grid">
          {(()=>{
            const active=dashRes.filter(r=>r.status!=="cancelled");
            const completed=dashRes.filter(r=>r.status==="completed");
            const revenue=active.reduce((s,r)=>s+r.amount,0);
            const coopRes=active.filter(r=>{const rt=getType(r.typeId);return rt?.mode==="coop";});
            const vsRes=active.filter(r=>{const rt=getType(r.typeId);return rt?.mode==="versus";});
            // Utilization — use actual roster size, fall back to playerCount if roster empty
            const allPlayers=active.reduce((s,r)=>s+(r.players.length>0?r.players.length:r.playerCount),0);
            const getOfferedSessions=()=>{
              const activeTmpls=sessionTemplates.filter(t=>t.active);
              if(!activeTmpls.length) return 0;
              const now=new Date();
              let from="",to=todayStr();
              if(dashPeriod==="day"){from=to=todayStr();}
              else if(dashPeriod==="week"){const d=new Date(now);d.setDate(d.getDate()-d.getDay());from=d.toISOString().slice(0,10);}
              else if(dashPeriod==="month"){from=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-01`;}
              else if(dashPeriod==="year"){from=`${now.getFullYear()}-01-01`;}
              else if(dashPeriod==="custom"){from=dashFrom;to=dashTo;}
              else{const dates=reservations.map(r=>r.date).sort();from=dates[0]||todayStr();}
              if(!from) return 0;
              let count=0;
              const start=new Date(from+"T12:00:00"),end=new Date(to+"T12:00:00");
              for(let d=new Date(start);d<=end;d.setDate(d.getDate()+1)){const dayName=d.toLocaleDateString("en-US",{weekday:"long"});count+=activeTmpls.filter(t=>t.dayOfWeek===dayName).length;}
              return count;
            };
            const offeredSessions=getOfferedSessions();
            const totalCapacity=offeredSessions*6.22;
            const utilPct=totalCapacity>0?Math.round((allPlayers/totalCapacity)*100):null;
            // Avg players per lane by type — all non-cancelled
            const byMode=(mode,style)=>active.filter(r=>{const rt=getType(r.typeId);return rt?.mode===mode&&rt?.style===style;});
            const activeCoopPriv=byMode("coop","private");
            const activeVsPriv=byMode("versus","private");
            const activeCoopOpen=byMode("coop","open");
            const activeVsOpen=byMode("versus","open");
            // Use actual roster size; fall back to playerCount if roster not yet filled
            const actualP=r=>r.players.length>0?r.players.length:r.playerCount;
            // For open play, group by (date,startTime) so each distinct lane = one data point
            const laneGroups=arr=>{const m={};arr.forEach(r=>{const k=`${r.date}|${r.startTime}`;m[k]=(m[k]||0)+actualP(r);});return Object.values(m);};
            const coopPrivLanes=activeCoopPriv.map(actualP);
            const vsPrivLanes=activeVsPriv.map(actualP);
            const coopOpenLanes=laneGroups(activeCoopOpen);
            const vsOpenLanes=laneGroups(activeVsOpen);
            const arrAvg=arr=>arr.length?arr.reduce((s,v)=>s+v,0)/arr.length:null;
            const fmt2=v=>v===null?"—":v.toFixed(2);
            const sum=arr=>arr.reduce((s,v)=>s+v,0);
            // Combined avg/lane across all 4 types
            const allLanes=[...coopPrivLanes,...vsPrivLanes,...coopOpenLanes,...vsOpenLanes];
            const avgPerLane=arrAvg(allLanes);
            // New users in period
            const now2=new Date();
            let uFrom="",uTo=today;
            if(dashPeriod==="day"){uFrom=uTo=today;}
            else if(dashPeriod==="week"){const d=new Date(now2);d.setDate(d.getDate()-d.getDay());uFrom=d.toISOString().slice(0,10);}
            else if(dashPeriod==="month"){uFrom=`${now2.getFullYear()}-${String(now2.getMonth()+1).padStart(2,"0")}-01`;}
            else if(dashPeriod==="year"){uFrom=`${now2.getFullYear()}-01-01`;}
            else if(dashPeriod==="custom"){uFrom=dashFrom;uTo=dashTo;}
            const newUsersInPeriod=users.filter(u=>{if(!u.createdAt)return !uFrom;const d=u.createdAt.slice(0,10);return(!uFrom||d>=uFrom)&&(!uTo||d<=uTo);});
            const authedInPeriod=userAuthDates.filter(d=>{const dt=d.authCreatedAt?.slice(0,10);return dt&&(!uFrom||dt>=uFrom)&&(!uTo||dt<=uTo);});
            // Env controls — filter runs to those belonging to dashRes
            // Deduplicate by reservationId: Versus sessions produce 2 runs (one per team)
            // but share the same visual/audio env — count each session once.
            const dashResIds=new Set(dashRes.map(r=>r.id));
            const dashRuns=runs.filter(r=>dashResIds.has(r.reservationId)&&r.elapsedSeconds!=null);
            const resById=Object.fromEntries(dashRes.map(r=>[r.id,r]));
            const runMode=r=>{const rt=getType(resById[r.reservationId]?.typeId);return rt?.mode??null;};
            const dedupByRes=arr=>{const seen=new Set();return arr.filter(r=>{if(seen.has(r.reservationId))return false;seen.add(r.reservationId);return true;});};
            const coopRuns=dedupByRes(dashRuns.filter(r=>runMode(r)==='coop'));
            const vsRuns=dedupByRes(dashRuns.filter(r=>runMode(r)==='versus'));
            // effective audio code: use r.audio if set, else derive from r.cranked (legacy)
            const audioCode=r=>r.audio??(r.cranked?'C':'T');
            const vizPct=(arr,code)=>arr.length?Math.round(arr.filter(r=>r.visual===code).length/arr.length*100):null;
            const audPct=(arr,code)=>arr.length?Math.round(arr.filter(r=>audioCode(r)===code).length/arr.length*100):null;
            // Env — only show non-zero entries, find dominant
            const vizNames={V:"Standard",C:"Cosmic",R:"Rave",S:"Strobe",B:"Dark"};
            const audNames={O:"Off",T:"Tunes",C:"Cranked"};
            const vizLine=arr=>{if(!arr.length)return"—";return Object.entries(vizNames).map(([k,n])=>{const p=vizPct(arr,k);return p>0?`${n} ${p}%`:null;}).filter(Boolean).join(" · ")||"—";};
            const audLine=arr=>{if(!arr.length)return"—";return Object.entries(audNames).map(([k,n])=>{const p=audPct(arr,k);return p>0?`${n} ${p}%`:null;}).filter(Boolean).join(" · ")||"—";};
            const vizAbbr={V:"Std",C:"Csm",R:"Rave",S:"Str",B:"Drk"};
            const audAbbr={O:"Off",T:"Tns",C:"Crd"};
            const vizLineS=arr=>{if(!arr.length)return"—";return Object.entries(vizAbbr).map(([k,n])=>{const p=vizPct(arr,k);return p>0?`${n} ${p}%`:null;}).filter(Boolean).join(" · ")||"—";};
            const audLineS=arr=>{if(!arr.length)return"—";return Object.entries(audAbbr).map(([k,n])=>{const p=audPct(arr,k);return p>0?`${n} ${p}%`:null;}).filter(Boolean).join(" · ")||"—";};
            const topViz=arr=>{if(!arr.length)return null;const cnts={};arr.forEach(r=>{cnts[r.visual]=(cnts[r.visual]||0)+1;});const [k,c]=Object.entries(cnts).sort((a,b)=>b[1]-a[1])[0]??[];return k?{code:k,name:vizNames[k]??k,pct:Math.round(c/arr.length*100)}:null;};
            const topAud=arr=>{if(!arr.length)return null;const cnts={};arr.forEach(r=>{const k=r.audio??(r.cranked?'C':'T');cnts[k]=(cnts[k]||0)+1;});const [k,c]=Object.entries(cnts).sort((a,b)=>b[1]-a[1])[0]??[];return k?{code:k,name:audNames[k]??k,pct:Math.round(c/arr.length*100)}:null;};
            // vizRenderName / audRenderName imported from ./envRender.jsx
            // Avg run time
            const fmtSec=s=>s===null?"—":`${String(Math.floor(s/60)).padStart(2,'0')}:${String(Math.floor(s%60)).padStart(2,'0')}`;
            const avgSec=arr=>arr.length?arr.reduce((s,r)=>s+r.elapsedSeconds,0)/arr.length:null;
            const fullTimerPct=arr=>arr.length?Math.round(arr.filter(r=>r.elapsedSeconds>=595).length/arr.length*100):null;
            // Lead time: avg hours from reservation createdAt → session start
            const leadHours=arr=>{const valid=arr.filter(r=>r.createdAt);if(!valid.length)return null;return valid.reduce((s,r)=>s+Math.max(0,(new Date(`${r.date}T${r.startTime}:00`)-new Date(r.createdAt))/3600000),0)/valid.length;};
            const fmtLT=h=>h===null?"—":h<24?`${h.toFixed(1)}h`:`${(h/24).toFixed(1)}d`;
            const w=dashWidgets;
            const revStr=fmtMoney(revenue);
            const revSzCls=revStr.length>10?" stat-val-xs":revStr.length>7?" stat-val-sm":"";
            return <>
              {isAdmin&&w.revenue&&(()=>{
                const coopOpenRev=activeCoopOpen.reduce((s,r)=>s+r.amount,0);
                const coopPrivRev=activeCoopPriv.reduce((s,r)=>s+r.amount,0);
                const vsOpenRev=activeVsOpen.reduce((s,r)=>s+r.amount,0);
                const vsPrivRev=activeVsPriv.reduce((s,r)=>s+r.amount,0);
                const now2=new Date();
                let pmtFrom="",pmtTo="";
                if(dashPeriod==="day"){pmtFrom=pmtTo=today;}
                else if(dashPeriod==="week"){const d=new Date(now2);d.setDate(d.getDate()-d.getDay());pmtFrom=d.toISOString().slice(0,10);pmtTo=today;}
                else if(dashPeriod==="month"){pmtFrom=`${now2.getFullYear()}-${String(now2.getMonth()+1).padStart(2,"0")}-01`;pmtTo=today;}
                else if(dashPeriod==="year"){pmtFrom=`${now2.getFullYear()}-01-01`;pmtTo=today;}
                else if(dashPeriod==="custom"){pmtFrom=dashFrom;pmtTo=dashTo;}
                const dashMerch=payments.filter(p=>p.merchOrderId&&p.status==="paid"&&(()=>{const d=p.createdAt?.slice(0,10)||"";return(!pmtFrom||d>=pmtFrom)&&(!pmtTo||d<=pmtTo);})());
                const merchRev=dashMerch.reduce((s,p)=>s+p.amount,0);
                const totalRev=revenue+merchRev;
                const totalStr=fmtMoney(totalRev);
                const szCls=totalStr.length>10?" stat-val-xs":totalStr.length>7?" stat-val-sm":"";
                return<div className="stat-card">
                  <div className="stat-lbl">Revenue</div>
                  <div className={`stat-val${szCls}`} style={{color:"var(--accB)"}}>{totalStr}</div>
                  <div className="stat-sub">Co-Op Open {fmtMoney(coopOpenRev)}</div>
                  <div className="stat-sub">Co-Op Priv {fmtMoney(coopPrivRev)}</div>
                  <div className="stat-sub">Vs Open {fmtMoney(vsOpenRev)}</div>
                  <div className="stat-sub">Vs Priv {fmtMoney(vsPrivRev)}</div>
                  <div className="stat-sub">Merch {fmtMoney(merchRev)}</div>
                </div>;
              })()}
              {w.bookings&&<div className="stat-card"><div className="stat-lbl">Bookings</div><div className="stat-val">{active.length}</div><div className="stat-sub">Co-Op Open {activeCoopOpen.length}</div><div className="stat-sub">Co-Op Priv {activeCoopPriv.length}</div><div className="stat-sub">Vs Open {activeVsOpen.length}</div><div className="stat-sub">Vs Priv {activeVsPriv.length}</div></div>}
              {w.players&&<div className="stat-card"><div className="stat-lbl">Avg / Lane</div><div className="stat-val">{fmt2(avgPerLane)}</div><div className="stat-sub">Co-Op Open {fmt2(arrAvg(coopOpenLanes))}</div><div className="stat-sub">Co-Op Priv {fmt2(arrAvg(coopPrivLanes))}</div><div className="stat-sub">Vs Open {fmt2(arrAvg(vsOpenLanes))}</div><div className="stat-sub">Vs Priv {fmt2(arrAvg(vsPrivLanes))}</div></div>}
              {isAdmin&&w.utilization&&<div className="stat-card"><div className="stat-lbl">Utilization</div><div className="stat-val" style={{color:utilPct===null?"var(--muted)":utilPct>=80?"var(--okB)":utilPct>=50?"var(--accB)":"var(--warnL)"}}>{utilPct!==null?utilPct+"%":"—"}</div><div className="stat-sub">{allPlayers} players · cap {Math.round(totalCapacity)}</div><div className="stat-sub">{active.length} booked / {offeredSessions} offered</div></div>}
              {isAdmin&&w.newUsers&&(()=>{
                const selfReg=newUsersInPeriod.filter(u=>!u.createdByUserId);
                const byKiosk=newUsersInPeriod.filter(u=>{if(!u.createdByUserId)return false;const c=users.find(x=>x.id===u.createdByUserId);return c?.access==='kiosk';});
                const byStaff=newUsersInPeriod.filter(u=>{if(!u.createdByUserId)return false;const c=users.find(x=>x.id===u.createdByUserId);return c?.access!=='kiosk';});
                return<div className="stat-card">
                  <div className="stat-lbl">New Accounts</div>
                  <div className="stat-val">{newUsersInPeriod.length}</div>
                  <div className="stat-sub">Self {selfReg.length}</div>
                  <div className="stat-sub">Kiosk {byKiosk.length}</div>
                  <div className="stat-sub">By Staff {byStaff.length}</div>
                </div>;
              })()}
              {w.leadTime&&<div className="stat-card"><div className="stat-lbl">Lead Time</div><div className="stat-val">{fmtLT(leadHours(active))}</div><div className="stat-sub">Co-Op Open {fmtLT(leadHours(activeCoopOpen))}</div><div className="stat-sub">Co-Op Priv {fmtLT(leadHours(activeCoopPriv))}</div><div className="stat-sub">Vs Open {fmtLT(leadHours(activeVsOpen))}</div><div className="stat-sub">Vs Priv {fmtLT(leadHours(activeVsPriv))}</div></div>}
              {w.envCoop&&(()=>{const tv=topViz(coopRuns);const ta=topAud(coopRuns);const vs={fontFamily:'var(--fd)',fontSize:'.95rem',fontWeight:700,lineHeight:1,whiteSpace:'nowrap'};return<div className="stat-card"><div className="stat-lbl">Env — Co-Op <span style={{fontWeight:400,opacity:.6}}>({coopRuns.length} runs)</span></div><div style={{display:'flex',alignItems:'baseline',justifyContent:'center',gap:'.35rem',margin:'.2rem 0 .15rem'}}>{tv?vizRenderName(tv.code,tv.name,vs):<span style={{...vs,color:'var(--muted)'}}>—</span>}<span style={{color:'var(--muted)',fontSize:'.75rem'}}>·</span>{ta?audRenderName(ta.code,ta.name,vs):<span style={{...vs,color:'var(--muted)'}}>—</span>}</div><div className="stat-sub" style={{whiteSpace:'normal',wordBreak:'break-word'}}>Viz: {vizLineS(coopRuns)}</div><div className="stat-sub" style={{whiteSpace:'normal',wordBreak:'break-word'}}>Aud: {audLineS(coopRuns)}</div></div>;})()}
              {w.envVs&&(()=>{const tv=topViz(vsRuns);const ta=topAud(vsRuns);const vs={fontFamily:'var(--fd)',fontSize:'.95rem',fontWeight:700,lineHeight:1,whiteSpace:'nowrap'};return<div className="stat-card"><div className="stat-lbl">Env — Versus <span style={{fontWeight:400,opacity:.6}}>({vsRuns.length} runs)</span></div><div style={{display:'flex',alignItems:'baseline',justifyContent:'center',gap:'.35rem',margin:'.2rem 0 .15rem'}}>{tv?vizRenderName(tv.code,tv.name,vs):<span style={{...vs,color:'var(--muted)'}}>—</span>}<span style={{color:'var(--muted)',fontSize:'.75rem'}}>·</span>{ta?audRenderName(ta.code,ta.name,vs):<span style={{...vs,color:'var(--muted)'}}>—</span>}</div><div className="stat-sub" style={{whiteSpace:'normal',wordBreak:'break-word'}}>Viz: {vizLineS(vsRuns)}</div><div className="stat-sub" style={{whiteSpace:'normal',wordBreak:'break-word'}}>Aud: {audLineS(vsRuns)}</div></div>;})()}
              {w.avgRunTime&&<div className="stat-card"><div className="stat-lbl">Avg Run Time</div><div className="stat-val">{fmtSec(avgSec(dashRuns))}</div><div className="stat-sub">Co-Op {fmtSec(avgSec(coopRuns))} · Versus {fmtSec(avgSec(vsRuns))}</div><div className="stat-sub">Full timer: Co-Op {fullTimerPct(coopRuns)??'—'}% · Versus {fullTimerPct(vsRuns)??'—'}%</div></div>}
            </>;
          })()}
        </div>

        {(()=>{
          const thirtyAgo=new Date();thirtyAgo.setDate(thirtyAgo.getDate()-30);const t30=thirtyAgo.toISOString().slice(0,10);
          // ── Bookings
          const recentSorted=[...reservations].filter(r=>r.createdAt&&r.createdAt.slice(0,10)>=t30).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
          const pageSize=50;const totalPages=Math.ceil(recentSorted.length/pageSize)||1;
          const pageRows=recentSorted.slice(recentPage*pageSize,(recentPage+1)*pageSize);
          // ── Runs
          const recentRuns=[...runs].filter(r=>r.createdAt&&r.createdAt.slice(0,10)>=t30).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
          const resMap=Object.fromEntries(reservations.map(r=>[r.id,r]));
          const vizLabel={V:"Standard",C:"Cosmic",R:"Rave",S:"Strobe",B:"Dark"};
          const audLabel=r=>{if(r.audio==="O")return"Off";if(r.audio==="C")return"Cranked";if(r.audio==="T")return"Tunes";return r.cranked?"Cranked":"Tunes";};
          const fmtRunSec=s=>s==null?"—":`${String(Math.floor(s/60)).padStart(2,"0")}:${String(Math.floor(s%60)).padStart(2,"0")}`;
          // ── New Users
          const recentUsers=[...users].filter(u=>u.createdAt&&u.createdAt.slice(0,10)>=t30).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
          const userById=Object.fromEntries(users.map(u=>[u.id,u]));
          // ── Flags: unpaid (all-time active), cancelled + no-show (last 90 days)
          const ninetyAgo=new Date();ninetyAgo.setDate(ninetyAgo.getDate()-90);const t90=ninetyAgo.toISOString().slice(0,10);
          const today=new Date().toISOString().slice(0,10);
          const unpaidRows=reservations.filter(r=>r.paid===false&&r.status!=="cancelled").map(r=>({...r,_flag:"unpaid"}));
          const cancelledRows=reservations.filter(r=>r.status==="cancelled"&&r.date>=t90).map(r=>({...r,_flag:"cancelled"}));
          const noshowRows=reservations.filter(r=>r.status==="no-show"&&r.date>=t90).map(r=>({...r,_flag:"no-show"}));
          const rescheduledRows=reservations.filter(r=>r.rescheduled===true&&r.date>=t90).map(r=>({...r,_flag:"rescheduled"}));
          const flagRows=[...unpaidRows,...rescheduledRows,...noshowRows,...cancelledRows].sort((a,b)=>b.date.localeCompare(a.date)||b.startTime.localeCompare(a.startTime));
          const visibleFlagRows=flagRows.filter(r=>!acknowledgedFlags.has(r.id+r._flag));
          const ackFlag=key=>{const next=new Set(acknowledgedFlags);next.add(key);setAcknowledgedFlags(next);try{localStorage.setItem("ack-flags",JSON.stringify([...next]))}catch{}};
          const flagBadge=flag=>flag==="unpaid"?{bg:"rgba(192,57,43,.15)",color:"#e07060",label:"Unpaid"}:flag==="rescheduled"?{bg:"rgba(58,130,200,.15)",color:"var(--accB)",label:"Rescheduled"}:flag==="no-show"?{bg:"rgba(180,120,0,.15)",color:"var(--warnL)",label:"No-Show"}:{bg:"var(--surf2)",color:"var(--muted)",label:"Cancelled"};
          const tabBtnStyle=active=>({padding:".35rem .9rem",borderRadius:20,fontSize:".78rem",fontWeight:active?700:500,cursor:"pointer",border:`1px solid ${active?"var(--acc)":"var(--bdr)"}`,background:active?"var(--accD)":"var(--surf)",color:active?"var(--accB)":"var(--muted)"});
          return <div className="tw">
            <div className="th" style={{gap:".5rem",flexWrap:"wrap"}}>
              <button style={tabBtnStyle(dashViewTab==="bookings")} onClick={()=>{setDashViewTab("bookings");setRecentPage(0);}}>Bookings <span style={{opacity:.65}}>({recentSorted.length})</span></button>
              <button style={tabBtnStyle(dashViewTab==="runs")} onClick={()=>{setDashViewTab("runs");setRunPage(0);}}>Runs <span style={{opacity:.65}}>({recentRuns.length})</span></button>
              <button style={tabBtnStyle(dashViewTab==="users")} onClick={()=>{setDashViewTab("users");setUserPage(0);}}>New Users <span style={{opacity:.65}}>({recentUsers.length})</span></button>
              <button style={{...tabBtnStyle(dashViewTab==="flags"),borderColor:visibleFlagRows.length>0&&dashViewTab!=="flags"?"#e07060":"",color:visibleFlagRows.length>0&&dashViewTab!=="flags"?"#e07060":""}} onClick={()=>setDashViewTab("flags")}>⚑ Flags <span style={{opacity:.65}}>({visibleFlagRows.length})</span></button>
              <span style={{marginLeft:"auto",fontSize:".73rem",color:"var(--muted)"}}>last 30 days</span>
            </div>

            {dashViewTab==="bookings"&&<>
              <table><thead><tr><th>Booked</th><th>Customer</th><th>Type</th><th>Session</th><th>Players</th>{isAdmin&&<th>Amount</th>}<th>Status</th></tr></thead>
                <tbody>{pageRows.map(r=>{const rt=getType(r.typeId);return <tr key={r.id}><td style={{fontSize:".76rem",color:"var(--muted)",whiteSpace:"nowrap"}}>{fmt(r.createdAt?.slice(0,10))}<br/>{r.createdAt?new Date(r.createdAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):""}</td><td>{r.customerName}</td><td><span className={`badge b-${rt?.mode}`} style={{marginRight:".3rem"}}>{rt?.mode}</span><span className={`badge b-${rt?.style}`}>{rt?.style}</span></td><td>{fmt(r.date)}<br/><span style={{fontSize:".76rem",color:"var(--muted)"}}>{fmt12(r.startTime)}</span></td><td>{r.playerCount}</td>{isAdmin&&<td style={{color:"var(--accB)",fontWeight:600}}>{fmtMoney(r.amount)}</td>}<td><span className={`badge ${r.status==="confirmed"?"b-ok":r.status==="completed"?"b-done":r.status==="no-show"?"b-noshow":"b-cancel"}`}>{r.status}</span></td></tr>;})}
                </tbody>
              </table>
              {totalPages>1&&<div style={{display:"flex",gap:".5rem",justifyContent:"center",padding:".75rem 0",alignItems:"center"}}>
                <button className="btn btn-sm btn-s" disabled={recentPage===0} onClick={()=>setRecentPage(p=>p-1)}>← Prev</button>
                <span style={{fontSize:".8rem",color:"var(--muted)"}}>{recentPage+1} / {totalPages}</span>
                <button className="btn btn-sm btn-s" disabled={recentPage>=totalPages-1} onClick={()=>setRecentPage(p=>p+1)}>Next →</button>
              </div>}
            </>}

            {dashViewTab==="runs"&&(()=>{const rpSize=50;const rpTotal=Math.ceil(recentRuns.length/rpSize)||1;const rpRows=recentRuns.slice(runPage*rpSize,(runPage+1)*rpSize);return<>
              <table><thead><tr><th>Scored</th><th>Customer</th><th>Session</th><th>Visual</th><th>Audio</th><th>Time</th><th>Score</th></tr></thead>
                <tbody>{!recentRuns.length&&<tr><td colSpan={7} style={{textAlign:"center",color:"var(--muted)",padding:"2.5rem"}}>No runs in last 30 days.</td></tr>}
                {rpRows.map(r=>{const res=resMap[r.reservationId];const rt=res?getType(res.typeId):null;return <tr key={r.id}>
                  <td style={{fontSize:".76rem",color:"var(--muted)",whiteSpace:"nowrap"}}>{r.createdAt?fmt(r.createdAt.slice(0,10)):""}<br/>{r.createdAt?new Date(r.createdAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):""}</td>
                  <td><div>{res?.customerName||"—"}</div><div style={{fontSize:".72rem",color:"var(--muted)"}}>{res?`${fmt(res.date)} ${fmt12(res.startTime)}`:""}</div></td>
                  <td>{rt&&<><span className={`badge b-${rt.mode}`} style={{marginRight:".3rem"}}>{rt.mode}</span><span className={`badge b-${rt.style}`}>{rt.style}</span></>}</td>
                  <td>{r.visual?vizRenderName(r.visual,vizLabel[r.visual]||r.visual,{fontFamily:'var(--fd)',fontSize:'.82rem',fontWeight:700}):<span style={{color:'var(--muted)'}}>—</span>}</td>
                  <td>{(()=>{const ac=r.audio||(r.cranked?'C':'T');return audRenderName(ac,audLabel(r),{fontFamily:'var(--fd)',fontSize:'.82rem',fontWeight:700});})()}</td>
                  <td style={{fontFamily:"var(--fd)",color:"var(--accB)"}}>{fmtRunSec(r.elapsedSeconds)}</td>
                  <td style={{fontFamily:"var(--fd)",fontWeight:700,color:r.score!=null?"var(--txt)":"var(--muted)"}}>{r.score!=null?Number(r.score).toFixed(1):"—"}</td>
                </tr>;})}
                </tbody>
              </table>
              {rpTotal>1&&<div style={{display:"flex",gap:".5rem",justifyContent:"center",padding:".75rem 0",alignItems:"center"}}>
                <button className="btn btn-sm btn-s" disabled={runPage===0} onClick={()=>setRunPage(p=>p-1)}>← Prev</button>
                <span style={{fontSize:".8rem",color:"var(--muted)"}}>{runPage+1} / {rpTotal}</span>
                <button className="btn btn-sm btn-s" disabled={runPage>=rpTotal-1} onClick={()=>setRunPage(p=>p+1)}>Next →</button>
              </div>}
            </>;})()}

            {dashViewTab==="flags"&&(()=>{
              const ackedFlagRows=flagRows.filter(r=>acknowledgedFlags.has(r.id+r._flag));
              const displayRows=[...visibleFlagRows,...(showAcknowledged?ackedFlagRows:[])];
              return <>
              {!displayRows.length&&<div style={{textAlign:"center",color:"var(--muted)",padding:"2.5rem .5rem"}}>No unpaid, cancelled, or no-show reservations to show.</div>}
              {!!displayRows.length&&<table><thead><tr><th>Session</th><th>Booked</th><th>Customer</th><th>Type</th><th>Players</th>{isAdmin&&<th>Amount</th>}<th>Flag</th><th style={{textAlign:"right"}}>{isManager&&ackedFlagRows.length>0&&<button onClick={()=>setShowAcknowledged(v=>!v)} style={{fontSize:".68rem",padding:".15rem .5rem",borderRadius:4,border:"1px solid var(--bdr)",background:showAcknowledged?"var(--accD)":"var(--surf2)",color:showAcknowledged?"var(--accB)":"var(--muted)",cursor:"pointer",whiteSpace:"nowrap"}}>{showAcknowledged?"Hide Ack'd":"Show Ack'd ("+ackedFlagRows.length+")"}</button>}</th></tr></thead>
                <tbody>{displayRows.map(r=>{const rt=getType(r.typeId);const fb=flagBadge(r._flag);const isAcked=acknowledgedFlags.has(r.id+r._flag);return <tr key={r.id+r._flag} style={isAcked?{opacity:.45}:{}}>
                  <td><strong style={{fontSize:".88rem"}}>{fmt(r.date)}</strong><br/><span style={{fontSize:".76rem",color:"var(--muted)"}}>{fmt12(r.startTime)}</span></td>
                  <td style={{fontSize:".76rem",color:"var(--muted)",whiteSpace:"nowrap"}}>{r.createdAt?fmt(r.createdAt.slice(0,10)):""}<br/>{r.createdAt?new Date(r.createdAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):""}</td>
                  <td>{r.customerName}</td>
                  <td>{rt&&<><span className={`badge b-${rt.mode}`} style={{marginRight:".3rem"}}>{rt.mode}</span><span className={`badge b-${rt.style}`}>{rt.style}</span></>}</td>
                  <td>{r.playerCount}</td>
                  {isAdmin&&<td style={{color:"var(--accB)",fontWeight:600}}>{fmtMoney(r.amount)}</td>}
                  <td><span style={{fontSize:".75rem",padding:".2rem .55rem",borderRadius:4,fontWeight:700,background:fb.bg,color:fb.color}}>{fb.label}</span></td>
                  <td>{isAcked?<span style={{fontSize:".72rem",color:"var(--muted)"}}>✓ Done</span>:<button onClick={()=>ackFlag(r.id+r._flag)} style={{fontSize:".72rem",padding:".2rem .55rem",borderRadius:4,border:"1px solid var(--bdr)",background:"var(--surf2)",color:"var(--muted)",cursor:"pointer"}}>Acknowledge</button>}</td>
                </tr>;})}
                </tbody>
              </table>}
              <div style={{fontSize:".72rem",color:"var(--muted)",padding:".6rem .8rem",borderTop:"1px solid var(--bdr)",marginTop:".25rem"}}>
                Unpaid: all-time active bookings. Rescheduled, cancelled &amp; no-show: last 90 days.
              </div>
            </>;})()}

            {dashViewTab==="users"&&(()=>{const upSize=50;const upTotal=Math.ceil(recentUsers.length/upSize)||1;const upRows=recentUsers.slice(userPage*upSize,(userPage+1)*upSize);return<>
              <table><thead><tr><th>Created</th><th>Name</th><th>Phone</th><th>Access</th><th>Auth</th><th>Created By</th></tr></thead>
                <tbody>{!recentUsers.length&&<tr><td colSpan={6} style={{textAlign:"center",color:"var(--muted)",padding:"2.5rem"}}>No new users in last 30 days.</td></tr>}
                {upRows.map(u=>{const creator=u.createdByUserId?userById[u.createdByUserId]:null;return <tr key={u.id}>
                  <td style={{fontSize:".76rem",color:"var(--muted)",whiteSpace:"nowrap"}}>{fmt(u.createdAt.slice(0,10))}<br/>{new Date(u.createdAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</td>
                  <td><strong>{u.name||"—"}</strong><div style={{fontSize:".72rem",color:"var(--muted)"}}>{u.email||""}</div></td>
                  <td style={{fontFamily:"monospace",fontSize:".83rem"}}>{fmtPhone(u.phone)}</td>
                  <td><span className={`badge al-${u.access}`}>{ACCESS_LEVELS[u.access]?.label||u.access}</span></td>
                  <td><AuthBadge provider={u.authProvider}/></td>
                  <td style={{fontSize:".82rem"}}>{creator?<span title={creator.email||""}>{creator.name}</span>:<span style={{color:"var(--muted)",fontStyle:"italic"}}>{u.createdByUserId?"Unknown":"Self / System"}</span>}</td>
                </tr>;})}
                </tbody>
              </table>
              {upTotal>1&&<div style={{display:"flex",gap:".5rem",justifyContent:"center",padding:".75rem 0",alignItems:"center"}}>
                <button className="btn btn-sm btn-s" disabled={userPage===0} onClick={()=>setUserPage(p=>p-1)}>← Prev</button>
                <span style={{fontSize:".8rem",color:"var(--muted)"}}>{userPage+1} / {upTotal}</span>
                <button className="btn btn-sm btn-s" disabled={userPage>=upTotal-1} onClick={()=>setUserPage(p=>p+1)}>Next →</button>
              </div>}
            </>;})()}
          </div>;
        })()}

      </>}

      {tab==="reservations"&&<>
        <div className="ph"><div className="ph-left"><div className="pt">Reservations</div></div></div>
        <div className="tabs" style={{marginBottom:"1rem"}}>
          <button className={`tab${resSubTab==="upcoming"?" on":""}`} onClick={()=>{setResSubTab("upcoming");setResPage(1);}}>Upcoming ({upcomingRes.length})</button>
          <button className={`tab${resSubTab==="past"?" on":""}`} onClick={()=>{setResSubTab("past");setResPage(1);}}>Past ({pastRes.length})</button>
        </div>
        {(()=>{
          const rows=resSubTab==="upcoming"?upcomingRes:pastRes;
          const totalPages=Math.max(1,Math.ceil(rows.length/PAGE_SIZE));
          const page=Math.min(resPage,totalPages);
          const pageRows=rows.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE);
          const pager=rows.length>PAGE_SIZE&&(
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:".5rem 0",fontSize:".84rem",color:"var(--muted)"}}>
              <span>{(page-1)*PAGE_SIZE+1}–{Math.min(page*PAGE_SIZE,rows.length)} of {rows.length} reservations</span>
              <div style={{display:"flex",gap:".4rem",alignItems:"center"}}>
                <button className="btn btn-sm btn-s" disabled={page<=1} onClick={()=>setResPage(p=>p-1)}>← Prev</button>
                <span style={{padding:"0 .25rem"}}>Page {page} / {totalPages}</span>
                <button className="btn btn-sm btn-s" disabled={page>=totalPages} onClick={()=>setResPage(p=>p+1)}>Next →</button>
              </div>
            </div>);
          return(<>{pager}
          <div className="tw"><div className="th"><span className="ttl">{resSubTab==="upcoming"?"Upcoming Sessions":"Past Sessions"}</span><span style={{fontSize:".74rem",color:"var(--muted)"}}>Click row to expand</span></div>
          <table><thead><tr><th>Customer / Date</th><th>Type</th><th>Players</th><th>Status</th>{isAdmin&&<th>Amount</th>}</tr></thead>
            <tbody>{!pageRows.length&&<tr><td colSpan={isAdmin?5:4} style={{textAlign:"center",color:"var(--muted)",padding:"2.5rem"}}>No {resSubTab} reservations.</td></tr>}{pageRows.map(r=><ReservationRow key={r.id} res={r} resTypes={resTypes} users={users} waiverDocs={waiverDocs} activeWaiverDoc={activeWaiverDoc} canManage={true} isAdmin={isAdmin} currentUser={user} sessionTemplates={sessionTemplates} reservations={reservations} isStaff={true} onAddPlayer={addPlayer} onSignWaiver={signWaiver} onCancel={cancelRes} onRemovePlayer={removePlayer} onReschedule={rescheduleRes}/>)}</tbody>
          </table></div>{pager}</>);
        })()}
      </>}

      {tab==="types"&&<>
        <div className="ph"><div className="ph-left"><div className="pt">Reservation Types</div></div>{isAdmin&&<button className="btn btn-p" onClick={()=>{setEditRT(null);setNewRT({name:"",mode:"coop",style:"open",pricingMode:"per_person",price:55,maxPlayers:"",description:"",active:true,availableForBooking:true});setModal("rt");}}>+ Add</button>}</div>
        <div className="rt-grid">{resTypes.map(rt=><div key={rt.id} className={`rt-card${rt.active?"":" inactive"}`}>
          <div className="fb" style={{marginBottom:".5rem"}}><div className="rt-name">{rt.name}</div><span className={`badge ${rt.active?"b-ok":"b-cancel"}`}>{rt.active?"Active":"Off"}</span></div>
          <div className="rt-desc">{rt.description}</div><div className="rt-meta"><span className={`badge b-${rt.mode}`}>{rt.mode}</span><span className={`badge b-${rt.style}`}>{rt.style}</span></div>
          <div style={{fontFamily:"var(--fd)",fontSize:"1.3rem",fontWeight:700,color:"var(--accB)",marginBottom:".6rem"}}>{fmtMoney(rt.price)}{rt.pricingMode==="flat"?" flat":" / player"}{rt.maxPlayers&&<span style={{fontSize:".72rem",color:"var(--muted)",fontFamily:"var(--fb)"}}> (max {rt.maxPlayers})</span>}</div>
          <div className="rt-toggle-row"><Toggle on={!!rt.availableForBooking} onChange={v=>{setResTypes(p=>p.map(r=>r.id===rt.id?{...r,availableForBooking:v}:r));showToast(`${v?"Enabled":"Disabled"} for booking`);}}/><span style={{color:rt.availableForBooking?"var(--okB)":"var(--dangerL)",fontWeight:600}}>{rt.availableForBooking?"Bookable":"Disabled"}</span></div>
          {isManager&&<div style={{display:"flex",gap:".5rem",flexWrap:"wrap",marginTop:".5rem"}}><button className="btn btn-sm btn-s" onClick={()=>{setEditRT({...rt});setModal("rt");}}>Edit</button><button className="btn btn-sm btn-s" onClick={()=>{setResTypes(p=>p.map(r=>r.id===rt.id?{...r,active:!r.active}:r));showToast("Updated");}}>{rt.active?"Deactivate":"Activate"}</button>{isAdmin&&<button className="btn btn-sm btn-d" onClick={()=>{setResTypes(p=>p.filter(r=>r.id!==rt.id));showToast("Removed");}}>Remove</button>}</div>}
        </div>)}</div>
      </>}

      {tab==="sessions"&&<>
        <div className="ph"><div className="ph-left"><div className="pt">Session Slots</div></div>{isManager&&<button className="btn btn-p" onClick={()=>{setEditST(null);setNewST({dayOfWeek:"Monday",startTime:"18:00",maxSessions:2,active:true});setModal("st");}}>+ Add</button>}</div>
        {DAYS_OF_WEEK.map(day=>{const ds=sortTemplates(sessionTemplates.filter(s=>s.dayOfWeek===day));if(!ds.length)return null;return <div key={day} className="tw" style={{marginBottom:"1rem"}}><div className="th"><span className="ttl">{day}</span></div>{ds.map(st=><div key={st.id} className="st-row" style={{opacity:st.active?1:.45}}><span style={{fontFamily:"var(--fd)",fontSize:"1rem",fontWeight:700,color:"var(--accB)",width:90}}>{fmt12(st.startTime)}</span><span style={{fontSize:".85rem",flex:1}}>{st.maxSessions} available lane{st.maxSessions!==1?"s":""}</span><span className={`badge ${st.active?"b-ok":"b-cancel"}`} style={{marginRight:".5rem"}}>{st.active?"Active":"Off"}</span>{isManager&&<div style={{display:"flex",gap:".4rem"}}><button className="btn btn-sm btn-s" onClick={()=>{setEditST({...st});setModal("st");}}>Edit</button><button className="btn btn-sm btn-s" onClick={()=>{sortTmpl(p=>p.map(s=>s.id===st.id?{...s,active:!s.active}:s));showToast("Updated");}}>{st.active?"Disable":"Enable"}</button>{isAdmin&&<button className="btn btn-sm btn-d" onClick={()=>{sortTmpl(p=>p.filter(s=>s.id!==st.id));showToast("Removed");}}>Remove</button>}</div>}</div>)}</div>;})}
      </>}

      {tab==="waivers"&&<>
        <div className="ph"><div className="ph-left"><div className="pt">Waivers</div><div className="ps">Waiver history is permanent. Only admins can add or edit.</div></div>{isAdmin&&<button className="btn btn-p" onClick={()=>{setEditWaiver(null);setNewWaiver({name:"",version:"1.0",body:"",active:false});setModal("waiver");}}>+ New</button>}</div>
        {[...waiverDocs].sort((a,b)=>{if(a.active&&!b.active)return -1;if(!a.active&&b.active)return 1;return (b.createdAt||"").localeCompare(a.createdAt||"");}).map(w=><div key={w.id} className="waiver-doc-card" style={{borderLeftColor:w.active?"var(--acc)":"var(--bdr)"}}><div className="fb" style={{marginBottom:".6rem"}}><div><div style={{fontFamily:"var(--fd)",fontSize:"1.05rem",fontWeight:700,textTransform:"uppercase"}}>{w.name} <span style={{fontWeight:400,color:"var(--muted)"}}>v{w.version}</span></div><div style={{fontSize:".74rem",color:"var(--muted)",marginTop:".1rem"}}>Created {fmtTS(w.createdAt)}</div></div><div style={{display:"flex",gap:".5rem",alignItems:"center"}}>{w.active?<span className="badge b-ok">● Active</span>:<span className="badge" style={{background:"var(--surf2)",color:"var(--muted)"}}>Inactive</span>}</div></div><div style={{background:"var(--bg2)",border:"1px solid var(--bdr)",borderRadius:4,padding:".75rem",fontSize:".78rem",color:"var(--muted)",maxHeight:100,overflowY:"auto",whiteSpace:"pre-wrap",lineHeight:1.6,marginBottom:".75rem"}}>{w.body.slice(0,350)}{w.body.length>350?"…":""}</div><div style={{display:"flex",gap:".5rem",flexWrap:"wrap"}}>{isAdmin&&<button className="btn btn-sm btn-s" onClick={()=>{setEditWaiver({...w});setModal("waiver");}}>Edit</button>}{!w.active&&isAdmin&&<button className="btn btn-sm btn-ok" onClick={()=>setActiveWaiver(w.id)}>Set Active</button>}{w.active&&<span style={{fontSize:".74rem",color:"var(--muted)",fontStyle:"italic",padding:".3rem .5rem"}}>🔒 Cannot delete active version</span>}</div></div>)}
      </>}

      {tab==="objectives"&&isAdmin&&<>
        <div className="ph"><div className="ph-left"><div className="pt">Mission Objectives</div><div className="ps">Control which objectives appear in each game mode.</div></div><button className="btn btn-p" onClick={()=>{setEditObj(null);setNewObj({name:"",description:"",mode:"all",active:true});setModal("obj");}}>+ Add</button></div>
        {adminObjectives.length===0&&<div style={{color:"var(--muted)",fontSize:".85rem",padding:"1rem 0"}}>No objectives yet.</div>}
        <div className="tw"><table><thead><tr><th>Name</th><th>Description</th><th>Mode</th><th>Status</th><th></th></tr></thead>
          <tbody>{adminObjectives.map(o=><tr key={o.id}>
            <td><strong>{o.name}</strong></td>
            <td style={{color:"var(--muted)",fontSize:".83rem"}}>{o.description||"—"}</td>
            <td><span className={`badge b-${o.mode==="all"?"open":o.mode}`} style={{textTransform:"capitalize"}}>{o.mode==="all"?"All Modes":o.mode==="coop"?"Coop Only":"Versus Only"}</span></td>
            <td><span className={`badge ${o.active?"b-ok":"b-cancel"}`}>{o.active?"Active":"Inactive"}</span></td>
            <td><div style={{display:"flex",gap:".4rem"}}>
              <button className="btn btn-sm btn-s" onClick={()=>{setEditObj({...o});setModal("obj");}}>Edit</button>
              <button className="btn btn-sm btn-d" onClick={()=>{if(window.confirm(`Delete "${o.name}"?`))doDeleteObj(o.id);}}>Delete</button>
            </div></td>
          </tr>)}
          </tbody>
        </table></div>
      </>}

      {tab==="staff"&&<>
        <div className="ph"><div className="ph-left"><div className="pt">Staff Management</div><div className="ps">{isAdmin?"Full access":"Managers can manage staff"}</div></div><button className="btn btn-p" onClick={()=>{setEditUser(null);setNewUser({name:"",phone:"",access:"staff",role:null,active:true,waivers:[],needsRewaiverDocId:null});setModal("user");}}>+ Add Staff</button></div>
        <div className="tw"><table><thead><tr><th>Name</th><th>Mobile</th><th>Role</th><th>Access</th><th>Auth</th><th>Waiver</th><th>Status</th><th></th></tr></thead>
          <tbody>{users.filter(u=>u.access!=="customer"&&canManageUser(u)).map(u=><tr key={u.id}>
            <td><strong>{u.name}</strong></td><td style={{fontFamily:"monospace",fontSize:".83rem"}}>{fmtPhone(u.phone)}</td><td>{u.role||"—"}</td>
            <td><span className={`badge al-${u.access}`}>{ACCESS_LEVELS[u.access]?.label}</span></td>
            <td><AuthBadge provider={u.authProvider}/></td>
            <td><WaiverTooltip user={u} waiverDocs={waiverDocs} activeWaiverDoc={activeWaiverDoc} readOnly={true}/></td>
            <td><span className={`badge ${u.active?"b-ok":"b-cancel"}`}>{u.active?"Active":"Off"}</span></td>
            <td><div style={{display:"flex",gap:".4rem"}}>
              {canManageUser(u)&&!(u.access==="admin"&&!isAdmin)&&<>
                <button className="btn btn-sm btn-s" onClick={()=>{setEditUser({...u});setModal("user");}}>Edit</button>
                <button className={`btn btn-sm ${u.active?"btn-d":"btn-ok"}`} onClick={async()=>{
                  try{
                    const updated=await updateUserAdmin(u.id,{name:u.name,phone:u.phone,access:u.access,role:u.role,active:!u.active});
                    setUsers(p=>p.map(x=>x.id===updated.id?updated:x));
                    showToast(`${u.name} ${updated.active?"enabled":"disabled"}`);
                  }catch(e){showToast("Error: "+e.message);}
                }}>{u.active?"Disable":"Enable"}</button>
              </>}
              {u.access==="admin"&&!isAdmin&&<span style={{fontSize:".72rem",color:"var(--muted)",fontStyle:"italic"}}>Protected</span>}
            </div></td>
          </tr>)}
          </tbody>
        </table></div>
      </>}

      {tab==="schedule"&&<>
        <div className="ph"><div className="ph-left"><div className="pt">Schedule</div></div><button className="btn btn-p" onClick={()=>setModal("shift")}>+ Add Shift</button></div>
        <SchedulePanel currentUser={user} shifts={shifts} setShifts={setShifts} users={users} isManager={isManager} onAlert={msg=>onAlert(msg)} tabOverride={schedTabOverride} onTabOverrideConsumed={()=>setSchedTabOverride(null)}/>
      </>}

      {tab==="merchandise"&&isManager&&<MerchPortal surface="admin" currentUser={user} users={users} setUsers={setUsers} setPayments={setPayments} onAlert={onAlert} isAdmin={isAdmin}/>}

      {tab==="social"&&<SocialPortal user={user} users={users} setUsers={setUsers} reservations={reservations} resTypes={resTypes} runs={runs} careerRuns={careerRuns} onEditProfile={()=>setShowAccountFor(user)} onFriendsChanged={()=>setFriendsVersion(v=>v+1)}/>}

      {tab==="customers"&&isManager&&<>
        <div className="ph"><div className="ph-left"><div className="pt">Customers</div><div className="ps">All customers — social auth and phone-only</div></div></div>
        <div style={{display:"flex",gap:".6rem",alignItems:"center",marginBottom:"1rem"}}>
          <input value={custSearch} onChange={e=>{setCustSearch(e.target.value);setCustPage(1);}} placeholder="Search by name or phone…" style={{flex:1,background:"var(--bg2)",border:"1px solid var(--bdr)",borderRadius:5,padding:".55rem .9rem",color:"var(--txt)",fontSize:".9rem",outline:"none"}}/>
          {custSearch&&<button className="btn btn-s" style={{whiteSpace:"nowrap"}} onClick={()=>{setCustSearch("");setCustPage(1);}}>✕ Clear</button>}
        </div>
        {/* Duplicate account alerts */}
        {dupAlerts.map(d=>(
          <div key={d.phoneOnlyUser.id} className="dup-alert">
            <div className="dup-alert-title">⚠ Potential Duplicate Account</div>
            <div className="dup-alert-sub">
              Phone-only user <strong style={{color:"var(--txt)"}}>{d.phoneOnlyUser.name}</strong> ({fmtPhone(d.phoneOnlyUser.phone)}) matches authenticated user <strong style={{color:"var(--txt)"}}>{d.authUser.name}</strong> by {d.reason}.
              Review to merge or dismiss.
            </div>
            <div style={{display:"flex",gap:".5rem",flexWrap:"wrap"}}>
              <button className="btn btn-sm btn-ok" onClick={async()=>{
                try{await handleMergeUsers(d.authUser.id,d.phoneOnlyUser.id);}
                catch(e){showToast("Merge failed: "+e.message);}
              }}>Merge → Keep Auth User</button>
              <button className="btn btn-sm btn-s" onClick={()=>setDismissedDups(p=>[...p,d.phoneOnlyUser.id])}>Dismiss (False Positive)</button>
            </div>
          </div>
        ))}
        {(()=>{
          const q=custSearch.trim().toLowerCase();
          const digits=cleanPh(custSearch);
          const filtered=users.filter(u=>u.active!==false&&(!q||(u.name||"").toLowerCase().includes(q)||(digits.length>=3&&(u.phone||"").includes(digits)))).sort((a,b)=>(a.name||"").localeCompare(b.name||""));
          const totalPages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));
          const page=Math.min(custPage,totalPages);
          const pageItems=filtered.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE);
          const pager=filtered.length>PAGE_SIZE&&(
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:".5rem 0",fontSize:".84rem",color:"var(--muted)"}}>
              <span>{(page-1)*PAGE_SIZE+1}–{Math.min(page*PAGE_SIZE,filtered.length)} of {filtered.length} people</span>
              <div style={{display:"flex",gap:".4rem",alignItems:"center"}}>
                <button className="btn btn-sm btn-s" disabled={page<=1} onClick={()=>setCustPage(p=>p-1)}>← Prev</button>
                <span style={{padding:"0 .25rem"}}>Page {page} / {totalPages}</span>
                <button className="btn btn-sm btn-s" disabled={page>=totalPages} onClick={()=>setCustPage(p=>p+1)}>Next →</button>
              </div>
            </div>);
          if(filtered.length===0&&q) return <div className="tw"><table><thead><tr><th>Name</th><th>Leaderboard Name</th><th>Mobile</th><th>Auth</th><th>Bookings</th><th>Runs</th><th>Spent</th><th>Waiver</th><th></th></tr></thead><tbody><tr><td colSpan={9} style={{textAlign:"center",padding:"1.5rem",color:"var(--muted)"}}>
            No customers found for <strong style={{color:"var(--txt)"}}>&ldquo;{custSearch}&rdquo;</strong>
            <button className="btn btn-p btn-sm" style={{marginLeft:"1rem"}} onClick={()=>{
              const isPhone=digits.length>=7;
              setEditUser(null);
              setNewUser({name:isPhone?"":custSearch,phone:isPhone?digits:"",access:"customer",role:"",active:true,waivers:[],needsRewaiverDocId:null});
              setModal("user");
            }}>+ Create Customer</button>
          </td></tr></tbody></table></div>;
          return <>{pager}<div className="tw"><table><thead><tr><th>Name</th><th>Leaderboard Name</th><th>Mobile</th><th>Auth</th><th>Bookings</th><th>Runs</th><th>Spent</th><th>Waiver</th><th></th></tr></thead>
            <tbody>{pageItems.map(c=>{
              const cr=reservations.filter(r=>r.userId===c.id);
              const valid=hasValidWaiver(c,activeWaiverDoc);
              const wd=latestWaiverDate(c);
              const isDup=dupAlerts.some(d=>d.phoneOnlyUser.id===c.id||d.authUser.id===c.id);
              const isStaff=c.access!=='customer';
              const cResIds=new Set(reservations.filter(r=>r.userId===c.id||r.players?.some(p=>p.userId===c.id)).map(r=>r.id));
              const cTotalRuns=runs.filter(r=>cResIds.has(r.reservationId)).length;
              const{current:cTier}=getTierInfo(cTotalRuns);
              const cTierCol=TIER_COLORS[cTier.key];
              return <tr key={c.id} style={{background:isDup?"rgba(184,150,12,.04)":""}}>
                <td><strong>{c.name}</strong>{isStaff&&<span className="badge" style={{marginLeft:".4rem",fontSize:".6rem",background:"var(--acc2)",color:"var(--accB)",border:"1px solid var(--acc)"}}>{c.access==='admin'?'Admin':c.access==='manager'?'Mgr':'Staff'}</span>}{isDup&&<span className="badge b-warn" style={{marginLeft:".4rem",fontSize:".6rem"}}>⚠ dup</span>}</td>
                <td><span style={{display:"inline-flex",alignItems:"center",gap:".4rem"}}><img src={`/${cTier.key}.png`} alt={cTier.key} style={{height:15,width:"auto",maxWidth:28,display:"block",flexShrink:0,objectFit:"contain",...(TIER_SHINE[cTier.key]?{filter:TIER_SHINE[cTier.key]}:{})}}/><span style={{fontFamily:"monospace",fontSize:".85rem",color:"var(--txt)"}}>{c.leaderboardName||genDefaultLeaderboardName(c.name,c.phone)}</span></span></td>
                <td style={{fontFamily:"monospace",fontSize:".83rem"}}>{fmtPhone(c.phone)}</td>
                <td><AuthBadge provider={c.authProvider}/></td>
                <td>{cr.length}</td>
                <td><RunsCell runs={runs} reservations={reservations} resTypes={resTypes} userId={c.id}/></td>
                <td style={{color:"var(--accB)",fontWeight:600}}>{fmtMoney(cr.reduce((s,r)=>s+r.amount,0))}</td>
                <td>{valid?<span className="badge b-ok">Valid</span>:wd?<span className="badge b-warn">Exp.</span>:<span className="badge b-cancel">None</span>}</td>
                <td style={{display:"flex",gap:".25rem",flexWrap:"wrap"}}><button className="btn btn-sm btn-s" onClick={()=>{setEditUser({...c});setModal("user");}}>Edit</button><button className="btn btn-sm btn-warn" onClick={()=>setMergeTarget(c)}>Merge</button><button className={`btn btn-sm ${c.active?"btn-d":"btn-ok"}`} onClick={async()=>{
                  try{
                    const updated=await updateUserAdmin(c.id,{name:c.name,phone:c.phone,access:c.access,role:c.role,active:!c.active,leaderboardName:c.leaderboardName||null,hideFromLeaderboard:c.hideFromLeaderboard??false});
                    setUsers(p=>p.map(x=>x.id===updated.id?updated:x));
                    showToast(`${c.name} ${updated.active?"enabled":"disabled"}`);
                  }catch(e){showToast("Error: "+e.message);}
                }}>{c.active?"Disable":"Enable"}</button></td>
              </tr>;
            })}</tbody></table></div>{pager}</>;
        })()}
      </>}

    </div>
  );
}

export default AdminPortal
