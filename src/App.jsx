import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from "react";
import { isStaffBlocked } from './stampUtils.js';
import './app.css';
import { DAYS_OF_WEEK, ACCESS_LEVELS, PAGE_SIZE, fmt, fmtMoney, fmtPhone, fmt12, fmtTS, getDayName, cleanPh, todayStr, addDaysStr, sortTemplates, hasValidWaiver, latestWaiverDate, latestWaiverEntry, TIER_THRESHOLDS, TIER_COLORS, TIER_SHINE, getTierInfo, getSessionsForDate, buildLanes, laneCapacity, openPlayCapacity, getSlotStatus, dateHasAvailability, get60Dates, getInitials } from './utils.js';
import { AuthBadge, Toast, Toggle, WaiverTooltip, RunsCell, WaiverModal, WaiverViewModal, PhoneInput, PlayerPhoneInput, genDefaultLeaderboardName, validateLbName, DateNav } from './ui.jsx';
import BookingWizard from './BookingWizard.jsx';
import { emailStoreCreditApplied, emailWelcome } from './emails.js';
import LandingPage from "./LandingPage.jsx";
import MerchPortal from "./MerchPortal.jsx";
import OpsView from "./OpsView.jsx";
import KioskPage from "./KioskPage.jsx";
import StaffingScheduler from "./StaffingScheduler.jsx";
import SocialPortal from "./SocialPortal.jsx";
import {
  supabase,
  fetchAllUsers, fetchUserByPhone, createUser, createGuestUser, updateUser, updateOwnProfile, updateUserAdmin, linkOAuthUser, deleteUser, signWaiver, applyStoreCredit, deductUserCredits,
  fetchWaiverDocs, upsertWaiverDoc, setActiveWaiverDoc, deleteWaiverDoc,
  fetchStaffRoles,
  fetchResTypes, upsertResType, deleteResType,
  fetchSessionTemplates, upsertSessionTemplate, deleteSessionTemplate,
  fetchReservations, fetchAvailabilityReservations, createReservation, updateReservation, addPlayerToReservation, removePlayerFromReservation, syncReservationPlayers,
  fetchShifts, createShift, updateShift, deleteShift, claimShift, flagShiftConflict,
  approveShiftConflict, declineShiftConflict, assignShift, adminEditShift,
  createPayment, fetchPayments, mergeUsers, linkAuthToGuest,
  fetchRunsForReservations, fetchUserAuthDates, calculateRunScore,
  fetchShiftTemplates, fetchTemplateSlots, fetchSlotAssignments,
  fetchStaffBlocks, fetchAllStaffBlocks, createStaffBlock, updateStaffBlock, deleteStaffBlock,

  fetchUserRoles,
  fetchFriends,
  fetchEmailPreferences, updateEmailPreferences,
} from "./supabase.js";
const LOGO_URI = "/logo.png";
const APP_VERSION = __GIT_HASH__;

// ─────────────────────────────────────────────────────────────────────────────
// ReservationModifyWizard
// Handles: reschedule (any type) and upgrade open→private (only when sole booker)
// ─────────────────────────────────────────────────────────────────────────────
function ReservationModifyWizard({res,mode,resTypes,sessionTemplates,reservations,currentUser,isStaff=false,onClose,onReschedule,onUpgrade,onMoveAndUpgrade}){
  const rt=resTypes.find(x=>x.id===res.typeId);
  const privateType=resTypes.find(x=>x.mode===rt?.mode&&x.style==="private"&&x.active&&x.availableForBooking);
  const allDates=get60Dates(sessionTemplates);

  // ── Reschedule state ──
  const [selDate,setSelDate]=useState(null);
  const [selTime,setSelTime]=useState(null);

  // ── Upgrade state ──
  // Check if this customer is the ONLY booker on this slot/type
  const slotMates=reservations.filter(r=>
    r.id!==res.id &&
    r.date===res.date &&
    r.startTime===res.startTime &&
    r.status!=="cancelled" &&
    resTypes.find(x=>x.id===r.typeId)?.mode===rt?.mode
  );
  const isSoleBooker=slotMates.length===0;
  const alreadyPaid=res.amount||0;
  const privatePrice=privateType?.price??0;
  const perPersonPaid=rt?.pricingMode==="per_person"?(alreadyPaid/Math.max(1,res.playerCount)):0;
  const upgradeBalance=Math.max(0, privatePrice - alreadyPaid);

  // For "move and upgrade": find slots where they'd be sole private booker
  const availMap=useMemo(()=>{
    if(!privateType) return {};
    const m={};
    allDates.forEach(d=>{m[d]=dateHasAvailability(d,privateType.id,reservations,resTypes,sessionTemplates);});
    return m;
  },[privateType,reservations,resTypes,sessionTemplates]);

  // ── Reschedule availability ──
  const reschedAvailMap=useMemo(()=>{
    if(!rt) return {};
    const m={};
    allDates.forEach(d=>{m[d]=dateHasAvailability(d,rt.id,reservations,resTypes,sessionTemplates);});
    return m;
  },[rt,reservations,resTypes,sessionTemplates]);

  // Set of "date:startTime" where currentUser already has a non-cancelled booking (excluding the one being rescheduled)
  const userBookedTimes=useMemo(()=>{
    const s=new Set();
    (reservations??[]).forEach(r=>{
      if(r.id!==res.id&&r.userId===currentUser?.id&&r.status!=='cancelled')
        s.add(r.date+':'+r.startTime);
    });
    return s;
  },[reservations,res.id,currentUser]);

  // Availability map accounting for user's existing bookings (for date picker)
  const reschedAvailMapForUser=useMemo(()=>{
    if(!rt) return {};
    if(isStaff) return reschedAvailMap;
    const m={};
    allDates.forEach(d=>{
      if(!reschedAvailMap[d]){m[d]=false;return;}
      m[d]=getSessionsForDate(d,sessionTemplates).some(t=>
        !userBookedTimes.has(d+':'+t.startTime)&&
        getSlotStatus(d,t.startTime,rt.id,reservations,resTypes,sessionTemplates).available
      );
    });
    return m;
  },[rt,reschedAvailMap,allDates,sessionTemplates,userBookedTimes,reservations,resTypes,isStaff]);

  const slotsForDate=selDate?getSessionsForDate(selDate,sessionTemplates):[];

  const isReschedule=mode==="reschedule";
  const isUpgrade=mode==="upgrade";

  // Upgrade: show conflict notice if not sole booker, offer move options
  const [upgradeChoice,setUpgradeChoice]=useState(null); // null | 'here' | 'move'

  if(isUpgrade&&!privateType){
    return <div className="mo"><div className="mc" style={{maxWidth:460}}>
      <div className="mt2">Upgrade Unavailable</div>
      <p style={{color:"var(--muted)",fontSize:".88rem",marginBottom:"1.25rem"}}>No private booking type is configured for {rt?.mode} mode. Contact staff to upgrade.</p>
      <div className="ma"><button className="btn btn-s" onClick={onClose}>Close</button></div>
    </div></div>;
  }

  // ── UPGRADE: sole booker → instant upgrade ──────────────────────────────
  if(isUpgrade&&isSoleBooker&&upgradeChoice===null){
    return <div className="mo"><div className="mc" style={{maxWidth:500}}>
      <div className="mt2">⬆ Upgrade to Private</div>
      <p style={{color:"var(--muted)",fontSize:".85rem",marginBottom:"1rem"}}>
        You're the only one booked in this slot — you can upgrade your <strong style={{color:"var(--txt)"}}>{rt?.mode==="coop"?"Co-Op":"Versus"} Open Play</strong> reservation to a <strong style={{color:"var(--txt)"}}>Private</strong> session right now.
      </p>
      <div style={{background:"var(--surf2)",border:"1px solid var(--bdr)",borderRadius:5,padding:".85rem 1rem",marginBottom:"1.25rem"}}>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:".85rem",marginBottom:".4rem"}}>
          <span style={{color:"var(--muted)"}}>Already paid</span><span style={{color:"var(--accB)"}}>−{fmtMoney(alreadyPaid)}</span>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:".85rem",marginBottom:".4rem"}}>
          <span style={{color:"var(--muted)"}}>Private rate</span><span>{fmtMoney(privatePrice)}</span>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:"1rem",fontWeight:700,borderTop:"1px solid var(--bdr)",paddingTop:".5rem",marginTop:".3rem"}}>
          <span>Balance due</span><span style={{color:upgradeBalance>0?"var(--warn)":"var(--okB)"}}>{upgradeBalance>0?fmtMoney(upgradeBalance):"No additional charge 🎉"}</span>
        </div>
      </div>
      {upgradeBalance>0&&<>
        <div className="gd-badge"><span style={{color:"var(--okB)"}}>🔒</span><div><strong style={{color:"var(--txt)"}}>Secured by GoDaddy Payments</strong></div></div>
        <div className="g2"><div className="f"><label>Card Number</label><input placeholder="•••• •••• •••• ••••"/></div><div className="f"><label>Expiry</label><input placeholder="MM / YY"/></div></div>
        <div className="g2"><div className="f"><label>CVV</label><input placeholder="•••"/></div><div className="f"><label>ZIP</label><input placeholder="46032"/></div></div>
      </>}
      <div className="ma">
        <button className="btn btn-s" onClick={onClose}>Cancel</button>
        <button className="btn btn-p" onClick={()=>onUpgrade(res.id,privateType.id,upgradeBalance)}>
          {upgradeBalance>0?`Pay ${fmtMoney(upgradeBalance)} & Upgrade`:"Confirm Upgrade →"}
        </button>
      </div>
    </div></div>;
  }

  // ── UPGRADE: not sole booker → offer choice ─────────────────────────────
  if(isUpgrade&&!isSoleBooker&&upgradeChoice===null){
    return <div className="mo"><div className="mc" style={{maxWidth:500}}>
      <div className="mt2">⬆ Upgrade to Private</div>
      <p style={{color:"var(--muted)",fontSize:".85rem",marginBottom:"1rem"}}>
        There {slotMates.length===1?"is":"are"} <strong style={{color:"var(--warn)"}}>{slotMates.length} other {slotMates.length===1?"booking":"bookings"}</strong> in your current timeslot, so this slot can't be converted to private. To upgrade, you'll need to move to an open private slot.
      </p>
      <div style={{background:"var(--surf2)",border:"1px solid var(--bdr)",borderRadius:5,padding:".75rem 1rem",marginBottom:"1.25rem",fontSize:".85rem"}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:".3rem"}}><span style={{color:"var(--muted)"}}>Already paid</span><span style={{color:"var(--accB)"}}>−{fmtMoney(alreadyPaid)}</span></div>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:".3rem"}}><span style={{color:"var(--muted)"}}>Private rate</span><span>{fmtMoney(privatePrice)}</span></div>
        <div style={{display:"flex",justifyContent:"space-between",fontWeight:700,borderTop:"1px solid var(--bdr)",paddingTop:".4rem",marginTop:".3rem"}}><span>Balance due if moved</span><span style={{color:upgradeBalance>0?"var(--warn)":"var(--okB)"}}>{upgradeBalance>0?fmtMoney(upgradeBalance):"No additional charge 🎉"}</span></div>
      </div>
      <div className="ma" style={{flexDirection:"column",gap:".6rem",alignItems:"stretch"}}>
        <button className="btn btn-p" style={{width:"100%"}} onClick={()=>setUpgradeChoice("move")}>Pick a New Slot & Upgrade →</button>
        <button className="btn btn-s" style={{width:"100%"}} onClick={onClose}>Keep Current Booking</button>
      </div>
    </div></div>;
  }

  // ── UPGRADE move: pick a new private slot ──────────────────────────────
  if(isUpgrade&&upgradeChoice==="move"){
    const moveSlotsForDate=selDate?getSessionsForDate(selDate,sessionTemplates):[];
    const moveSlotStatuses=useMemo(()=>moveSlotsForDate.map(t=>({tmpl:t,st:getSlotStatus(selDate,t.startTime,privateType?.id,reservations,resTypes,sessionTemplates)})),[moveSlotsForDate,selDate,privateType,reservations,resTypes,sessionTemplates]);
    return <div className="mo"><div className="mc" style={{maxWidth:560}}>
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between"}}>
        <div className="mt2">Pick a New Slot — Private {rt?.mode==="coop"?"Co-Op":"Versus"}</div>
        <button className="btn btn-s btn-sm" style={{padding:".25rem .6rem",lineHeight:1,flexShrink:0,marginLeft:".5rem"}} onClick={onClose} title="Close">✕</button>
      </div>
      <p style={{color:"var(--muted)",fontSize:".85rem",marginBottom:"1rem"}}>Select a date and time where your group will have the lane to yourselves.</p>
      {!selDate&&<>
        <div className="date-grid-hdr">{["Su","Mo","Tu","We","Th","Fr","Sa"].map(d=><div key={d} style={{textAlign:"center",fontSize:".62rem",color:"var(--muted)",padding:".2rem",textTransform:"uppercase"}}>{d}</div>)}</div>
        {(()=>{const grouped={};allDates.slice(0,42).forEach(d=>{const mo=new Date(d+"T12:00:00").toLocaleDateString("en-US",{month:"long",year:"numeric"});(grouped[mo]=grouped[mo]||[]).push(d);});return Object.entries(grouped).map(([mo,dates])=>{const offset=new Date(dates[0]+"T12:00:00").getDay();return <div key={mo}><div className="cal-month">{mo}</div><div className="date-grid">{Array.from({length:offset}).map((_,i)=><div key={i}/>)}{dates.map(d=>{const dt=new Date(d+"T12:00:00");const avail=availMap[d];return <div key={d} className={`date-cell${!avail?" na":""}`} onClick={()=>avail&&setSelDate(d)}><div className="dc-day">{dt.toLocaleDateString("en-US",{weekday:"short"})}</div><div className="dc-num">{dt.getDate()}</div></div>;})}</div></div>;});})()}
      </>}
      {selDate&&!selTime&&<>
        <p style={{fontSize:".84rem",color:"var(--txt)",marginBottom:".6rem"}}>Available times on <strong>{fmt(selDate)}</strong></p>
        <div className="slot-grid">{moveSlotStatuses.map(({tmpl:t,st})=><div key={t.id} className={`slot-card${!st.available?" unavail":""}`} onClick={()=>st.available&&setSelTime(t.startTime)}><div className="slot-time">{fmt12(t.startTime)}</div>{st.available?<div className="slot-info" style={{color:"var(--okB)"}}>Available</div>:<div className="slot-reason">{st.reason}</div>}</div>)}</div>
        <button className="btn btn-s btn-sm" style={{marginTop:".5rem"}} onClick={()=>setSelDate(null)}>← Change Date</button>
      </>}
      {selDate&&selTime&&<>
        <div style={{background:"var(--surf2)",border:"1px solid var(--bdr)",borderRadius:5,padding:".85rem 1rem",marginBottom:"1rem"}}>
          <div style={{fontFamily:"var(--fd)",fontSize:".72rem",color:"var(--muted)",letterSpacing:".08em",marginBottom:".3rem"}}>NEW SLOT</div>
          <div style={{fontSize:".95rem",fontWeight:700,color:"var(--txt)"}}>{fmt(selDate)} · {fmt12(selTime)}</div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:".84rem",marginTop:".6rem",borderTop:"1px solid var(--bdr)",paddingTop:".5rem"}}>
            <span style={{color:"var(--muted)"}}>Balance due</span>
            <span style={{color:upgradeBalance>0?"var(--warn)":"var(--okB)",fontWeight:700}}>{upgradeBalance>0?fmtMoney(upgradeBalance):"No additional charge 🎉"}</span>
          </div>
        </div>
        {upgradeBalance>0&&<>
          <div className="gd-badge"><span style={{color:"var(--okB)"}}>🔒</span><div><strong style={{color:"var(--txt)"}}>Secured by GoDaddy Payments</strong></div></div>
          <div className="g2"><div className="f"><label>Card Number</label><input placeholder="•••• •••• •••• ••••"/></div><div className="f"><label>Expiry</label><input placeholder="MM / YY"/></div></div>
          <div className="g2"><div className="f"><label>CVV</label><input placeholder="•••"/></div><div className="f"><label>ZIP</label><input placeholder="46032"/></div></div>
        </>}
        <div className="ma">
          <button className="btn btn-s" onClick={()=>setSelTime(null)}>← Back</button>
          <button className="btn btn-p" onClick={()=>onMoveAndUpgrade(res.id,selDate,selTime,privateType.id,upgradeBalance)}>
            {upgradeBalance>0?`Pay ${fmtMoney(upgradeBalance)} & Upgrade`:"Move & Upgrade →"}
          </button>
        </div>
      </>}
      {!(selDate&&selTime)&&<div className="ma"><button className="btn btn-s" onClick={()=>setUpgradeChoice(null)}>← Back</button></div>}
    </div></div>;
  }

  // ── RESCHEDULE ─────────────────────────────────────────────────────────
  if(isReschedule){
    const reschedSlots=selDate?getSessionsForDate(selDate,sessionTemplates):[];
    const reschedSlotStatuses=useMemo(()=>reschedSlots.map(t=>({tmpl:t,st:getSlotStatus(selDate,t.startTime,rt?.id,reservations,resTypes,sessionTemplates)})),[reschedSlots,selDate,rt,reservations,resTypes,sessionTemplates]);
    const resDateTime=new Date(`${res.date}T${res.startTime}`);
    const hoursUntil=(resDateTime-Date.now())/(1000*60*60);
    const isWithin24h=!isStaff&&hoursUntil>0&&hoursUntil<24;
    return <div className="mo"><div className="mc" style={{maxWidth:560}}>
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between"}}>
        <div className="mt2">Reschedule Reservation</div>
        <button className="btn btn-s btn-sm" style={{padding:".25rem .6rem",lineHeight:1,flexShrink:0,marginLeft:".5rem"}} onClick={onClose} title="Close">✕</button>
      </div>
      <p style={{color:"var(--muted)",fontSize:".85rem",marginBottom:"1rem"}}>
        Current: <strong style={{color:"var(--txt)"}}>{fmt(res.date)} · {fmt12(res.startTime)}</strong>
      </p>
      {isWithin24h&&<p style={{fontSize:".82rem",color:"var(--warn)",marginBottom:".75rem",padding:".5rem .75rem",background:"var(--surf2)",border:"1px solid var(--warn)",borderRadius:4}}>This reservation is within 24 hours — rescheduling is limited to the same day only.</p>}
      {!selDate&&<>
        <p style={{fontSize:".82rem",color:"var(--muted)",marginBottom:".6rem"}}>Pick a new date:</p>
        <div className="date-grid-hdr">{["Su","Mo","Tu","We","Th","Fr","Sa"].map(d=><div key={d} style={{textAlign:"center",fontSize:".62rem",color:"var(--muted)",padding:".2rem",textTransform:"uppercase"}}>{d}</div>)}</div>
        {(()=>{const grouped={};allDates.slice(0,42).forEach(d=>{const mo=new Date(d+"T12:00:00").toLocaleDateString("en-US",{month:"long",year:"numeric"});(grouped[mo]=grouped[mo]||[]).push(d);});return Object.entries(grouped).map(([mo,dates])=>{const offset=new Date(dates[0]+"T12:00:00").getDay();return <div key={mo}><div className="cal-month">{mo}</div><div className="date-grid">{Array.from({length:offset}).map((_,i)=><div key={i}/>)}{dates.map(d=>{const dt=new Date(d+"T12:00:00");const avail=reschedAvailMapForUser[d];const isCurrent=d===res.date;const dayLocked=isWithin24h&&d!==res.date;return <div key={d} className={`date-cell${isCurrent?" sel":""}${(!avail||dayLocked)?" na":""}`} onClick={()=>avail&&!dayLocked&&setSelDate(d)}><div className="dc-day">{dt.toLocaleDateString("en-US",{weekday:"short"})}</div><div className="dc-num">{dt.getDate()}</div></div>;})}</div></div>;});})()}
      </>}
      {selDate&&!selTime&&<>
        <p style={{fontSize:".84rem",color:"var(--txt)",marginBottom:".6rem"}}>Available times on <strong>{fmt(selDate)}</strong>:</p>
        <div className="slot-grid">{reschedSlotStatuses.map(({tmpl:t,st})=>{
          const isCurrent=selDate===res.date&&t.startTime===res.startTime;
          const userHasHere=!isStaff&&!isCurrent&&userBookedTimes.has(selDate+':'+t.startTime);
          const isAvail=!isCurrent&&!userHasHere&&st.available;
          return <div key={t.id} className={`slot-card${isCurrent?" added":(!isAvail&&!isCurrent)?" unavail":""}`} onClick={()=>isAvail&&setSelTime(t.startTime)}>
            <div className="slot-time">{fmt12(t.startTime)}</div>
            {isCurrent?<div className="slot-info" style={{color:"var(--muted)"}}>Current</div>
             :userHasHere?<div className="slot-reason">Already booked</div>
             :st.available?<div className="slot-info" style={{color:"var(--okB)"}}>{(()=>{const cap=rt?.mode==="versus"?12:6;const spots=st.spotsLeft??cap;return spots<cap?`${spots} spot${spots!==1?"s":""} left`:"Available";})()}</div>
             :<div className="slot-reason">{st.reason}</div>}
          </div>;
        })}</div>
        <button className="btn btn-s btn-sm" style={{marginTop:".5rem"}} onClick={()=>setSelDate(null)}>← Change Date</button>
      </>}
      {selDate&&selTime&&<>
        <div style={{background:"var(--surf2)",border:"1px solid var(--acc2)",borderRadius:5,padding:".85rem 1rem",marginBottom:"1.25rem"}}>
          <div style={{fontFamily:"var(--fd)",fontSize:".72rem",color:"var(--muted)",letterSpacing:".08em",marginBottom:".3rem"}}>NEW TIME</div>
          <div style={{fontSize:".95rem",fontWeight:700,color:"var(--txt)"}}>{fmt(selDate)} · {fmt12(selTime)}</div>
          <div style={{fontSize:".72rem",color:"var(--muted)",marginTop:".3rem"}}>No additional charge — same reservation type</div>
        </div>
        <div className="ma">
          <button className="btn btn-s" onClick={()=>setSelTime(null)}>← Back</button>
          <button className="btn btn-p" onClick={()=>onReschedule(res.id,selDate,selTime)}>Confirm Reschedule →</button>
        </div>
      </>}
      {!selDate&&<div className="ma"><button className="btn btn-s" onClick={onClose}>Cancel</button></div>}
    </div></div>;
  }

  return null;
}

function ReservationRow({res,resTypes,users,waiverDocs,activeWaiverDoc,canManage,isAdmin=false,currentUser=null,sessionTemplates=[],reservations=[],isStaff=false,onAddPlayer,onSignWaiver,onCancel,onRemovePlayer,onReschedule}){
  const [open,setOpen]=useState(false);
  const [addPhone,setAddPhone]=useState("");
  const [addName,setAddName]=useState("");
  const [addStatus,setAddStatus]=useState("idle"); // idle | searching | found | notfound | named
  const [addUserId,setAddUserId]=useState(null);
  const [addHasAccount,setAddHasAccount]=useState(true);
  const [wTarget,setWTarget]=useState(null);
  const [removeConfirm,setRemoveConfirm]=useState(null);
  const [showReschedModal,setShowReschedModal]=useState(false);
  const nameRef=useRef(null);
  const rt=resTypes.find(x=>x.id===res.typeId);
  const isUp=res.date>=todayStr();
  const isEditable=isUp&&res.status!=='completed'&&res.status!=='no-show';

  // Async DB lookup — same pattern as PlayerPhoneInput so saved players re-resolve correctly
  const lookup=useCallback(async(val)=>{
    const c=cleanPh(val);
    if(c.length<10){setAddStatus("idle");setAddUserId(null);setAddName("");setAddHasAccount(true);return;}
    setAddStatus("searching");
    const dbUser=await fetchUserByPhone(c);
    if(dbUser){
      setAddStatus("found");
      setAddUserId(dbUser.id);
      setAddName(dbUser.name);
      setAddHasAccount(!!dbUser.authProvider); // has social auth = has real account
    } else {
      setAddStatus("notfound");
      setAddUserId(null);
      setAddName("");
      setAddHasAccount(false);
      // Focus name field after render
      setTimeout(()=>nameRef.current?.focus(),80);
    }
  },[]);

  const [doAddErr,setDoAddErr]=useState(null);
  const [doAddBusy,setDoAddBusy]=useState(false);
  // Commit the add — creates a guest user row in DB if player has no account
  const doAdd=async()=>{
    setDoAddErr(null);
    if(addStatus==="found"){
      const fu=users.find(u=>u.id===addUserId);
      onAddPlayer(res.id,{userId:addUserId,name:fu?.name||addName,phone:cleanPh(addPhone)});
      setAddPhone("");setAddName("");setAddStatus("idle");setAddUserId(null);setAddHasAccount(true);
    } else if((addStatus==="notfound"||addStatus==="named")&&addName.trim()){
      setDoAddBusy(true);
      try{
        const guest=await createGuestUser({
          name:addName.trim(),
          phone:cleanPh(addPhone)||null,
          createdByUserId:currentUser?.id??null,
        });
        onAddPlayer(res.id,{userId:guest.id,name:addName.trim(),phone:cleanPh(addPhone)});
        setAddPhone("");setAddName("");setAddStatus("idle");setAddUserId(null);setAddHasAccount(true);
      }catch(e){
        setDoAddErr("Could not create guest account: "+e.message);
      }finally{
        setDoAddBusy(false);
      }
    }
  };

  // Build mailto invite link
  const buildInvite=(phone)=>{
    const subject=encodeURIComponent("You've been added to a Sector 317 reservation!");
    const body=encodeURIComponent(
`Hey — you've been added to a Sector 317 reservation by ${res.customerName}!

SECTOR 317 — CQB Tactical Experience
${res.date ? `📅 Date: ${fmt(res.date)}` : ""}${res.startTime ? `\n⏰ Time: ${fmt12(res.startTime)}` : ""}

To speed up check-in, please do the following BEFORE you arrive:

1. CREATE YOUR ACCOUNT
   Visit sector317.com and sign in with Google, Microsoft, or Apple to create your free account.

2. SIGN YOUR WAIVER
   Once logged in, sign your digital liability waiver. This is required before you can play.

3. ARRIVE EARLY
   Plan to arrive at least 30 minutes before your session time for briefing and gear up.

Questions? Visit sector317.com or reply to this email.

See you on the field — SECTOR 317`
    );
    return `mailto:?subject=${subject}&body=${body}`;
  };

  const wOk=res.players.filter(p=>hasValidWaiver(users.find(x=>x.id===p.userId),activeWaiverDoc)).length;

  return(
    <>
      {showReschedModal&&onReschedule&&<ReservationModifyWizard res={res} mode="reschedule" resTypes={resTypes} sessionTemplates={sessionTemplates} reservations={reservations} currentUser={currentUser} isStaff={isStaff} onClose={()=>setShowReschedModal(false)} onReschedule={(resId,date,startTime)=>{onReschedule(resId,date,startTime);setShowReschedModal(false);}}/>}
      {wTarget&&<WaiverModal playerName={wTarget.name} waiverDoc={activeWaiverDoc} onClose={()=>setWTarget(null)} onSign={name=>{onSignWaiver(wTarget.userId,name);setWTarget(null);}}/>}
      <tr onClick={()=>setOpen(o=>!o)} style={{cursor:"pointer"}}>
        <td><div style={{display:"flex",alignItems:"center",gap:".5rem"}}><button className={`expand-toggle${open?" open":""}`} onClick={e=>{e.stopPropagation();setOpen(o=>!o)}}>{open?"▾":"▸"}</button><div><div style={{fontWeight:600}}>{res.customerName}</div><div style={{fontSize:".74rem",color:"var(--muted)"}}>{fmt(res.date)} · {fmt12(res.startTime)}</div></div></div></td>
        <td><div style={{fontSize:".82rem"}}>{rt?.name}</div><div style={{display:"flex",gap:".3rem",marginTop:".2rem"}}><span className={`badge b-${rt?.mode}`}>{rt?.mode}</span><span className={`badge b-${rt?.style}`}>{rt?.style}</span></div></td>
        <td><div>{res.players.length}/{res.playerCount}</div><div style={{fontSize:".72rem",color:wOk>0&&wOk>=res.players.length?"var(--okB)":"var(--warnL)"}}>{wOk}/{res.players.length} waivers ✓</div></td>
        <td><span className={`badge ${res.status==="confirmed"?"b-ok":res.status==="completed"?"b-done":res.status==="no-show"?"b-noshow":"b-cancel"}`}>{res.status}</span></td>
        {isAdmin&&<td style={{color:"var(--accB)",fontWeight:600}}>{fmtMoney(res.amount)}</td>}
      </tr>
      {open&&<tr><td colSpan={isAdmin?5:4} style={{padding:0}}><div className="res-expand">
        {!res.players.length&&<div style={{padding:".75rem 1.25rem",fontSize:".82rem",color:"var(--muted)"}}>No players added yet.</div>}
        {res.players.map((p,i)=>{
          const u=users.find(x=>x.id===p.userId);
          const wSigned=hasValidWaiver(u,activeWaiverDoc);
          return(
            <div className="player-row" key={i}>
              <span className="player-name">{p.name}</span>
              <span className="player-phone">{fmtPhone(u?.phone)||"—"}</span>
              {/* Waiver status badge */}
              <span style={{
                fontSize:".68rem",fontWeight:700,letterSpacing:".06em",textTransform:"uppercase",
                padding:".15rem .55rem",borderRadius:3,flexShrink:0,
                background:wSigned?"rgba(90,138,58,.18)":"rgba(192,57,43,.14)",
                color:wSigned?"var(--okB)":"var(--dangerL)",
                border:`1px solid ${wSigned?"var(--ok)":"var(--danger)"}`,
              }}>{wSigned?"✓ Waiver":"⚠ No Waiver"}</span>
              {!wSigned&&isUp&&<button className="btn btn-warn btn-sm" onClick={()=>setWTarget({...p})}>Sign</button>}
              {canManage&&isEditable&&onRemovePlayer&&p.id&&(removeConfirm===p.id
                ?<span style={{display:"flex",gap:".3rem",alignItems:"center"}}><span style={{fontSize:".73rem",color:"var(--warnL)"}}>Remove?</span><button className="btn btn-d btn-sm" onClick={()=>{onRemovePlayer(res.id,p.id);setRemoveConfirm(null);}}>Yes</button><button className="btn btn-s btn-sm" onClick={()=>setRemoveConfirm(null)}>No</button></span>
                :<button className="btn btn-d btn-sm" onClick={()=>setRemoveConfirm(p.id)}>× Remove</button>
              )}
            </div>
          );
        })}
        {canManage&&isEditable&&<div className="add-player-row">
          {/* Phone input */}
          <div className="f">
            <label>Add Player — Cell Number</label>
            <div className="phone-wrap" style={{background:"var(--bg2)"}}>
              <span className="phone-prefix">+1</span>
              <input
                type="tel" placeholder="Enter phone number with area code"
                value={addPhone} maxLength={10}
                onChange={e=>{setAddPhone(e.target.value);if(cleanPh(e.target.value).length===10)lookup(e.target.value);else{setAddStatus("idle");setAddUserId(null);setAddName("");}}}
                onKeyDown={e=>{if(e.key==="Enter"){if(addStatus==="found")doAdd();else if(cleanPh(addPhone).length===10)lookup(addPhone);}}}
              />
            </div>
            {/* Status feedback */}
            {addStatus==="searching"&&<div style={{fontSize:".74rem",color:"var(--muted)",marginTop:".2rem"}}>🔍 Looking up...</div>}
            {addStatus==="found"&&(()=>{
              const fu=users.find(u=>u.id===addUserId);
              const wSigned=hasValidWaiver(fu,activeWaiverDoc);
              return(
                <div style={{marginTop:".35rem"}}>
                  <div style={{display:"flex",alignItems:"center",gap:".4rem",fontSize:".78rem"}}>
                    <span style={{background:"var(--acc2)",color:"var(--bg2)",borderRadius:"50%",width:22,height:22,display:"inline-flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:".65rem",flexShrink:0}}>{getInitials(fu?.name||addName)}</span>
                    <strong style={{color:"var(--txt)"}}>{fu?.name||addName}</strong>
                    {fu?.authProvider&&<span style={{fontSize:".68rem",color:"var(--muted)"}}>({fu.authProvider})</span>}
                    <span style={{
                      fontSize:".65rem",fontWeight:700,padding:".1rem .45rem",borderRadius:3,
                      background:wSigned?"rgba(90,138,58,.18)":"rgba(192,57,43,.14)",
                      color:wSigned?"var(--okB)":"var(--dangerL)",
                      border:`1px solid ${wSigned?"var(--ok)":"var(--danger)"}`,
                    }}>{wSigned?"✓ Waiver signed":"⚠ Waiver needed"}</span>
                  </div>
                  {!addHasAccount&&<div style={{fontSize:".73rem",color:"var(--warnL)",marginTop:".3rem"}}>⚠ This number has no account — <a href={buildInvite(addPhone)} style={{color:"var(--accB)",textDecoration:"underline"}}>Send invite email</a></div>}
                </div>
              );
            })()}
            {addStatus==="notfound"&&<div style={{fontSize:".74rem",color:"var(--warnL)",marginTop:".2rem"}}>⚠ Nothing found — add their name and we'll prep their account</div>}
          </div>
          {/* Name field — only shown when not found in DB */}
          {(addStatus==="notfound"||addStatus==="named")&&(
            <div className="f">
              <label>Full Name <span style={{color:"var(--danger)"}}>*</span></label>
              <div style={{display:"flex",gap:".5rem",alignItems:"center"}}>
                <input
                  ref={nameRef}
                  value={addName}
                  onChange={e=>{setAddName(e.target.value);if(e.target.value.trim())setAddStatus("named");else setAddStatus("notfound");}}
                  onKeyDown={e=>{if(e.key==="Enter"&&addName.trim())doAdd();}}
                  placeholder="First Last (required)"
                  style={{flex:1}}
                />
              </div>
              {/* No-account invite prompt */}
              <div style={{fontSize:".73rem",color:"var(--muted)",marginTop:".3rem",display:"flex",alignItems:"center",gap:".4rem",flexWrap:"wrap"}}>
                <span>⚠ No Sector 317 account found.</span>
                <a href={buildInvite(addPhone)} style={{color:"var(--accB)",textDecoration:"underline",fontWeight:600}}>📧 Send invite email</a>
                <span style={{color:"var(--muted)"}}>— they'll need to create an account &amp; sign waiver before arrival.</span>
              </div>
            </div>
          )}
          {/* Action buttons */}
          {doAddErr&&<div style={{fontSize:".76rem",color:"var(--dangerL)",background:"rgba(192,57,43,.1)",border:"1px solid var(--danger)",borderRadius:4,padding:".4rem .7rem",marginBottom:".4rem"}}>⚠ {doAddErr}</div>}
          <div style={{paddingBottom:".9rem",display:"flex",gap:".5rem",alignItems:"center",flexWrap:"wrap"}}>
            {(addStatus==="found"||((addStatus==="notfound"||addStatus==="named")&&addName.trim()))&&(
              <button
                className="btn btn-p btn-sm"
                disabled={doAddBusy}
                onClick={doAdd}
              >{doAddBusy?"Adding…":"+ Add Player"}</button>
            )}
            {onReschedule&&!showReschedModal&&<button className="btn btn-s btn-sm" onClick={()=>setShowReschedModal(true)}>📅 Reschedule</button>}
            {onCancel&&res.status==="confirmed"&&<button className="btn btn-d btn-sm" onClick={()=>onCancel(res.id)}>Cancel Res.</button>}
          </div>
        </div>}
      </div></td></tr>}
    </>
  );
}

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
  function blockIsResolved(block){
    if(block.status!=='pending')return false;
    return !shifts.some(s=>{
      if(s.staffId!==currentUser.id)return false;
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
        <button className={`tab${tab==="blocks"?" on":""}`} onClick={()=>setTab("blocks")}>My Blocks {staffBlocks.filter(b=>b.status==='pending'&&!blockIsResolved(b)).length>0&&<span style={{background:'var(--warn)',color:'var(--bg2)',borderRadius:'50%',padding:'0 5px',fontSize:'.62rem',marginLeft:'.25rem'}}>{staffBlocks.filter(b=>b.status==='pending'&&!blockIsResolved(b)).length}</span>}</button>
      </div>
      {tab==="mine"&&<>
        {isAdmin&&<div style={{marginBottom:'.5rem'}}>
          <button className="btn btn-s btn-sm" style={{opacity:hideAdminShifts?.6:1}} onClick={()=>setHideAdminShifts(p=>!p)}>
            {hideAdminShifts?'Show Admin Shifts':'Hide Admin Shifts'}
          </button>
        </div>}
        {!visMine.length&&<div className="empty"><div className="ei">📅</div><p>No shifts scheduled.</p></div>}
        {visMine.map(s=><div key={s.id} className={`shift-card mine${s.conflicted?" conflict":""}`} style={{padding:'.5rem 1rem',flexWrap:'nowrap'}}>
          <div style={{fontFamily:"var(--fd)",fontSize:".92rem",fontWeight:700,minWidth:160,flexShrink:0,color:s.conflicted?"var(--warnL)":"var(--accB)"}}>{getDayName(s.date)+', '+fmt(s.date)}</div>
          <div style={{flex:1,display:'flex',alignItems:'center',gap:'.55rem',flexWrap:'wrap',minWidth:0}}>
            <span style={{fontSize:".88rem",color:"var(--txt)",whiteSpace:'nowrap'}}>{fmt12(s.start)}–{fmt12(s.end)}</span>
            {fmtDur(s.start,s.end)&&<span style={{fontSize:".82rem",color:"var(--muted)",whiteSpace:'nowrap'}}>{fmtDur(s.start,s.end)}</span>}
            {s.role&&<span style={{fontSize:".73rem",background:"var(--surf2)",color:"var(--txt)",borderRadius:3,padding:".1rem .4rem",border:"1px solid var(--bdr)",flexShrink:0,whiteSpace:'nowrap'}}>{s.role}</span>}
            {s.conflicted&&<span className="badge b-conflict" style={{fontSize:'.7rem',flexShrink:0}}>Awaiting Manager</span>}
            {s.conflicted&&s.conflictNote&&<span style={{fontSize:".78rem",color:"var(--warnL)",fontStyle:'italic',whiteSpace:'nowrap'}}>"{s.conflictNote}"</span>}
          </div>
          {!s.conflicted&&s.date>=today&&<button className="btn btn-warn btn-sm" style={{flexShrink:0}} onClick={()=>{setCNote("");setConflictModal(s);}}>Flag Conflict</button>}
        </div>)}
        {!isManager&&<StaffStandardSchedule userId={currentUser.id}/>}
      </>}
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
          const resolved=blockIsResolved(b);
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
        {allStaffSub==='employee-blocks'&&(()=>{const staffUsers=users.filter(u=>u.access!=='customer'&&u.access!=='kiosk'&&u.active!==false).sort((a,b)=>a.name.localeCompare(b.name));const anyBlocks=allStaffBlocks.length>0;return<>{!anyBlocks&&<div className="empty"><div className="ei">📅</div><p>No staff availability blocks on record.</p></div>}{staffUsers.map(u=>{const ub=allStaffBlocks.filter(b=>b.staffId===u.id).sort((a,b2)=>a.startDate.localeCompare(b2.startDate));if(!ub.length)return null;return<div key={u.id} style={{marginBottom:'1.25rem'}}><div style={{fontFamily:'var(--fd)',fontSize:'.88rem',fontWeight:700,color:'var(--accB)',marginBottom:'.4rem',letterSpacing:'.04em',textTransform:'uppercase'}}>{u.name}</div>{ub.map(b=>{const dr=b.startDate===b.endDate?fmt(b.startDate):fmt(b.startDate)+' – '+fmt(b.endDate);const tr=(!b.startTime||!b.endTime)?'All day':fmt12(b.startTime)+' – '+fmt12(b.endTime);return<div key={b.id} className="shift-card" style={{marginBottom:'.3rem',padding:'.45rem .85rem'}}><div style={{flex:1}}><div style={{fontSize:'.86rem',fontWeight:600,color:'var(--txt)'}}>{dr}</div><div style={{fontSize:'.78rem',color:'var(--muted)'}}>{tr}{b.label?' · '+b.label:''}</div></div><span className={`badge ${b.status==='pending'?'b-conflict':'b-ok'}`} style={{fontSize:'.65rem',flexShrink:0}}>{b.status==='pending'?'Pending':'Confirmed'}</span></div>;})}</div>;})}</>;})()}
      </div>}
      {tab==="templates"&&isManager&&<StaffingScheduler currentUser={currentUser} shifts={shifts} setShifts={setShifts} users={users} isManager={isManager} onAlert={onAlert} initialView="templates" embedded={true}/>}
    </div>
  );
}

function AccountPanel({user,users,setUsers,onClose}){
  const [name,setName]=useState(user.name||"");
  const [phone,setPhone]=useState(user.phone||"");
  const [email,setEmail]=useState(user.email||"");
  const [lbName,setLbName]=useState(user.leaderboardName||"");
  const [hideFromLb,setHideFromLb]=useState(user.hideFromLeaderboard??false);
  const [saving,setSaving]=useState(false);
  const [saved,setSaved]=useState(false);
  const [err,setErr]=useState(null);
  // Email preferences
  const DEFAULT_PREFS={bookings:true,match_summary:true,social:true,merchandise:true,marketing:true};
  const [emailPrefs,setEmailPrefs]=useState(DEFAULT_PREFS);
  const [prefsSaving,setPrefsSaving]=useState(false);
  const [prefsSaved,setPrefsSaved]=useState(false);
  useEffect(()=>{
    fetchEmailPreferences(user.id).then(p=>setEmailPrefs({
      bookings:p.bookings??true,match_summary:p.match_summary??true,
      social:p.social??true,merchandise:p.merchandise??true,marketing:p.marketing??true,
    })).catch(()=>{});
  },[user.id]);// eslint-disable-line react-hooks/exhaustive-deps
  const EMAIL_PREF_ROWS=[
    {key:"bookings",label:"Booking Confirmations & Reminders",desc:"Confirmation emails and day-before reminders for your reservations."},
    {key:"match_summary",label:"Post-Match Summaries",desc:"Performance debrief emailed after each completed session."},
    {key:"social",label:"Social Notifications",desc:"Friend requests, accepted connections, and messages from other operatives."},
    {key:"merchandise",label:"Order & Shipping Updates",desc:"Purchase confirmations, shipping notifications, and pickup-ready alerts."},
    {key:"marketing",label:"Newsletter & Promotions",desc:"Sector 317 news, special events, and promotional offers."},
  ];
  const saveEmailPrefs=async()=>{
    setPrefsSaving(true);
    try{
      await updateEmailPreferences(user.id,emailPrefs);
      setPrefsSaved(true);setTimeout(()=>setPrefsSaved(false),3000);
    }catch(e){setErr("Preferences error: "+e.message);}
    finally{setPrefsSaving(false);}
  };
  const lbErr=validateLbName(lbName,users,user.id);
  const phoneClean=cleanPh(phone);
  const canSave=name.trim().length>=2&&phoneClean.length===10&&!lbErr;

  const handleSave=async()=>{
    if(!canSave)return;
    setSaving(true);setErr(null);
    try{
      const defaultLb=genDefaultLeaderboardName(name.trim(),phoneClean);
      const updated=await updateOwnProfile(user.id,{
        name:name.trim(),
        phone:phoneClean,
        email:email.trim()||null,
        leaderboardName:lbName.trim()||defaultLb,
        hideFromLeaderboard:hideFromLb,
      });
      setUsers(prev=>prev.map(u=>u.id===user.id?updated:u));
      setSaved(true);setTimeout(()=>setSaved(false),3000);
    }catch(e){setErr(e.message);}
    finally{setSaving(false);}
  };

  return(<>
    <div className="slide-panel-overlay" onClick={onClose}/>
    <div className="slide-panel">
      <div className="slide-panel-head">
        <span className="slide-panel-head-title">⚙ Account Settings</span>
        <button className="btn btn-s btn-sm" onClick={onClose}>✕ Close</button>
      </div>
      <div className="slide-panel-body">
        <div style={{background:"var(--surf2)",border:"1px solid var(--bdr)",borderRadius:5,padding:".75rem 1rem",marginBottom:"1.25rem",fontSize:".8rem",color:"var(--muted)"}}>
          {user.authProvider
            ?<span>Signed in via <strong style={{color:"var(--accB)"}}>{user.authProvider}</strong> · {user.email}</span>
            :<span style={{color:"var(--warnL)"}}>⚠ No social account linked — link Google or Microsoft to book</span>}
        </div>
        <div className="f">
          <label>Full Name <span style={{color:"var(--dangerL)"}}>*</span></label>
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="First Last"/>
        </div>
        <div className="f">
          <label>Mobile Number <span style={{color:"var(--dangerL)"}}>*</span></label>
          <PhoneInput value={phone} onChange={setPhone}/>
          <div style={{fontSize:".7rem",color:"var(--muted)",marginTop:".25rem"}}>Used for check-in and group management. Never shared.</div>
        </div>
        <div className="f">
          <label>Email Address <span style={{color:"var(--muted)",fontWeight:400}}>(optional)</span></label>
          <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/>
          <div style={{fontSize:".7rem",color:"var(--muted)",marginTop:".25rem"}}>Shown on your social profile if not hidden. Not used for login.</div>
        </div>
        <div className="f">
          <label>Leaderboard Name <span style={{color:"var(--muted)",fontWeight:400}}>(optional)</span></label>
          <input value={lbName} onChange={e=>setLbName(e.target.value)} placeholder={genDefaultLeaderboardName(name||user.name,phone||user.phone)} maxLength={24} disabled={hideFromLb}/>
          <div style={{fontSize:".7rem",color:lbErr?"var(--dangerL)":"var(--muted)",marginTop:".25rem"}}>
            {lbErr||"Shown on the public leaderboard. Leave blank to use your initials + last 4 of phone."}
          </div>
          <label style={{display:"flex",alignItems:"center",gap:".5rem",marginTop:".6rem",cursor:"pointer",fontSize:".82rem",color:"var(--muted)"}}>
            <input type="checkbox" checked={hideFromLb} onChange={e=>setHideFromLb(e.target.checked)} style={{accentColor:"var(--accB)",width:15,height:15,flexShrink:0}}/>
            Hide my account from all leaderboards
          </label>
        </div>
        {err&&<div style={{background:"rgba(192,57,43,.1)",border:"1px solid var(--danger)",borderRadius:5,padding:".6rem .85rem",fontSize:".8rem",color:"var(--dangerL)",marginBottom:".75rem"}}>⚠ {err}</div>}
        {saved&&<div style={{color:"var(--okB)",fontSize:".85rem",marginBottom:".75rem"}}>✓ Changes saved</div>}
        <button className="btn btn-p btn-full" disabled={!canSave||saving} onClick={handleSave}>{saving?"Saving…":"Save Changes"}</button>
        {!user.authProvider&&<div style={{marginTop:"1.25rem"}}>
          <div style={{fontSize:".74rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:".08em",fontWeight:700,marginBottom:".65rem"}}>Link Social Account</div>
          {[{id:"google",label:"Link Google"},{id:"microsoft",label:"Link Microsoft"}].map(p=>(
            <button key={p.id} className="btn btn-s btn-full" style={{marginBottom:".5rem",textTransform:"none"}}
              onClick={async()=>{const{error}=await supabase.auth.signInWithOAuth({provider:p.id==="microsoft"?"azure":p.id,options:{redirectTo:"https://www.sector317.com"}});if(error)setErr("Error linking: "+error.message);}}>
              🔗 {p.label}
            </button>
          ))}
        </div>}
        {/* Email Notification Preferences */}
        <div style={{marginTop:"1.75rem",borderTop:"1px solid var(--bdr)",paddingTop:"1.25rem"}}>
          <div style={{fontSize:".74rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:".08em",fontWeight:700,marginBottom:"1rem"}}>Email Notifications</div>
          {user.email
            ? EMAIL_PREF_ROWS.map(row=>(
              <div key={row.key} style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:"1rem",marginBottom:".9rem"}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:".85rem",color:"var(--txt)",fontWeight:600}}>{row.label}</div>
                  <div style={{fontSize:".75rem",color:"var(--muted)",marginTop:".15rem",lineHeight:1.4}}>{row.desc}</div>
                </div>
                <label style={{display:"flex",alignItems:"center",flexShrink:0,cursor:"pointer"}}>
                  <input type="checkbox" checked={emailPrefs[row.key]??true}
                    onChange={e=>setEmailPrefs(p=>({...p,[row.key]:e.target.checked}))}
                    style={{accentColor:"var(--accB)",width:16,height:16}}/>
                </label>
              </div>
            ))
            : <div style={{background:"rgba(255,193,7,.08)",border:"1px solid var(--warn)",borderRadius:5,padding:".65rem .9rem",fontSize:".8rem",color:"var(--warnL)"}}>
                ⚠ Add an email address above to receive email notifications.
              </div>
          }
          {user.email&&<>
            {prefsSaved&&<div style={{color:"var(--okB)",fontSize:".82rem",marginBottom:".5rem"}}>✓ Preferences saved</div>}
            <button className="btn btn-s" disabled={prefsSaving} onClick={saveEmailPrefs} style={{marginTop:".25rem"}}>
              {prefsSaving?"Saving…":"Save Notification Preferences"}
            </button>
          </>}
        </div>
      </div>
    </div>
  </>);
}

function ReceiptModal({res,resTypes,user,onClose}){
  const rt=resTypes.find(x=>x.id===res.typeId);
  const refNum=String(res.id).toUpperCase().replace(/-/g,"").slice(0,12);
  const printReceipt=()=>{
    const w=window.open("","_blank","width=680,height=820");
    w.document.write(`<!DOCTYPE html><html><head><title>Receipt — Sector 317</title><style>
      *{margin:0;padding:0;box-sizing:border-box;}
      body{font-family:'Segoe UI',Arial,sans-serif;background:#fff;color:#111;padding:2.5rem 3rem;}
      .logo{font-family:Arial Black,Arial,sans-serif;font-size:2rem;font-weight:900;letter-spacing:.12em;color:#c8e03a;text-shadow:0 0 12px rgba(200,224,58,.4);margin-bottom:.15rem;}
      .tagline{font-size:.78rem;color:#555;letter-spacing:.1em;text-transform:uppercase;margin-bottom:2rem;}
      h2{font-size:1.1rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;border-bottom:2px solid #c8e03a;padding-bottom:.5rem;margin-bottom:1.25rem;color:#111;}
      .row{display:flex;justify-content:space-between;padding:.5rem 0;border-bottom:1px solid #eee;font-size:.92rem;}
      .row .lbl{color:#555;}
      .row .val{font-weight:600;color:#111;}
      .total-row{display:flex;justify-content:space-between;padding:.75rem 0;margin-top:.5rem;font-size:1.1rem;font-weight:700;border-top:2px solid #111;}
      .status-badge{display:inline-block;background:#c8e03a;color:#111;font-size:.72rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;padding:.2rem .65rem;border-radius:20px;margin-left:.5rem;}
      .footer{margin-top:2.5rem;font-size:.74rem;color:#888;text-align:center;line-height:1.6;}
      .ref{font-size:.72rem;color:#888;font-family:monospace;margin-top:.25rem;}
      @media print{body{padding:1.5rem 2rem;}}
    </style></head><body>
      <div class="logo">SECTOR 317</div>
      <div class="tagline">Indoor Tactical Experience · Noblesville, IN</div>
      <h2>Booking Receipt</h2>
      <div class="row"><span class="lbl">Reference #</span><span class="val" style="font-family:monospace">${refNum}</span></div>
      <div class="row"><span class="lbl">Customer</span><span class="val">${res.customerName||user.name}</span></div>
      <div class="row"><span class="lbl">Session Type</span><span class="val">${rt?.name||"—"}</span></div>
      <div class="row"><span class="lbl">Reservation</span><span class="val">${new Date(res.date+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"})} · ${fmt12(res.startTime)}</span></div>
      <div class="row"><span class="lbl">Players</span><span class="val">${res.playerCount}</span></div>
      <div class="row"><span class="lbl">Status</span><span class="val">${res.status.charAt(0).toUpperCase()+res.status.slice(1)}<span class="status-badge">${res.paid?"PAID":"PENDING"}</span></span></div>
      <div class="total-row"><span>Amount Charged</span><span>${fmtMoney(res.amount)}</span></div>
      <div class="footer">
        Sector 317 · sector317.com · Noblesville, IN<br/>
        Payment processed securely via GoDaddy Payments<br/>
        <span class="ref">Receipt generated ${new Date().toLocaleString("en-US",{dateStyle:"long",timeStyle:"short"})}</span><br/>
        <em>Please retain this receipt for your records. For questions, contact us at sector317.com.</em>
      </div>
      <script>window.onload=()=>{window.print();}<\/script>
    </body></html>`);
    w.document.close();
  };
  return(
    <div className="mo">
      <div className="mc" style={{maxWidth:520}}>
        <div className="mt2" style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:".5rem"}}>
          <span>🧾 Booking Receipt</span>
          <span style={{fontFamily:"monospace",fontSize:".75rem",color:"var(--muted)",fontWeight:400}}>#{refNum}</span>
        </div>
        {/* Business header */}
        <div style={{background:"var(--bg2)",border:"1px solid var(--acc2)",borderRadius:6,padding:".85rem 1rem",marginBottom:"1rem",display:"flex",alignItems:"center",gap:.75+"rem"}}>
          <div style={{flex:1}}>
            <div style={{fontFamily:"var(--fd)",fontSize:"1.1rem",color:"var(--acc)",letterSpacing:".12em",fontWeight:900}}>SECTOR 317</div>
            <div style={{fontSize:".7rem",color:"var(--muted)",letterSpacing:".08em",textTransform:"uppercase"}}>Indoor Tactical Experience · Noblesville, IN</div>
          </div>
          <div style={{fontSize:".72rem",color:"var(--muted)",textAlign:"right"}}>sector317.com</div>
        </div>
        {/* Receipt rows */}
        {[
          ["Reference #", <span style={{fontFamily:"monospace",fontSize:".85rem"}}>{refNum}</span>],
          ["Customer", res.customerName||user.name],
          ["Session Type", rt?.name||"—"],
          ["Reservation", new Date(res.date+"T12:00:00").toLocaleDateString("en-US",{weekday:"short",year:"numeric",month:"short",day:"numeric"})+" · "+fmt12(res.startTime)],
          ["Players", res.playerCount],
          ["Status", <span style={{display:"flex",alignItems:"center",gap:".4rem"}}><span className={`badge ${res.status==="confirmed"?"b-ok":res.status==="completed"?"b-done":res.status==="no-show"?"b-noshow":"b-cancel"}`}>{res.status}</span>{res.paid&&<span style={{fontSize:".68rem",background:"var(--okD)",color:"var(--okB)",padding:".1rem .45rem",borderRadius:20,fontWeight:700,letterSpacing:".06em"}}>PAID</span>}</span>],
        ].map(([lbl,val])=>(
          <div key={lbl} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:".45rem 0",borderBottom:"1px solid var(--bdr)",fontSize:".85rem"}}>
            <span style={{color:"var(--muted)"}}>{lbl}</span>
            <span style={{fontWeight:600,color:"var(--txt)",textAlign:"right"}}>{val}</span>
          </div>
        ))}
        {/* Total */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:".75rem 0",marginTop:".25rem",borderTop:"2px solid var(--bdr)",fontSize:"1.05rem",fontWeight:700}}>
          <span style={{color:"var(--txt)"}}>Amount Charged</span>
          <span style={{color:"var(--acc)",fontFamily:"var(--fd)",fontSize:"1.15rem"}}>{fmtMoney(res.amount)}</span>
        </div>
        {/* Footer note */}
        <div style={{fontSize:".72rem",color:"var(--muted)",marginTop:".5rem",lineHeight:1.5,textAlign:"center"}}>
          Payment processed securely via GoDaddy Payments<br/>
          <em>Retain this receipt for business expense records.</em>
        </div>
        <div className="ma" style={{marginTop:"1.25rem",gap:".75rem"}}>
          <button className="btn btn-s" onClick={onClose}>Close</button>
          <button className="btn btn-p" onClick={printReceipt}>🖨 Print Receipt</button>
        </div>
      </div>
    </div>
  );
}

function PaymentReceiptModal({payment,onClose}){
  const s=payment.snapshot||{};
  const printReceipt=()=>{
    const w=window.open("","_blank","width=680,height=820");
    if(!w)return;
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Receipt</title><style>
      body{font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:560px;margin:2rem auto;color:#111;font-size:14px;}
      .logo{font-size:1.5rem;font-weight:900;letter-spacing:.14em;color:#c8e03a;}
      .tagline{font-size:.72rem;color:#666;letter-spacing:.08em;text-transform:uppercase;margin-bottom:1.5rem;}
      .row{display:flex;justify-content:space-between;padding:.4rem 0;border-bottom:1px solid #eee;}
      .lbl{color:#666;}.val{font-weight:600;text-align:right;}
      .total-row{display:flex;justify-content:space-between;font-size:1.1rem;font-weight:700;padding:.75rem 0;border-top:2px solid #111;margin-top:.5rem;}
      .footer{font-size:.7rem;color:#888;margin-top:1.5rem;line-height:1.6;text-align:center;}
      .ref{font-family:monospace;}
      @media print{body{padding:1.5rem 2rem;}}
    </style></head><body>
      <div class="logo">SECTOR 317</div>
      <div class="tagline">Indoor Tactical Experience · Noblesville, IN</div>
      <h2>Booking Receipt</h2>
      <div class="row"><span class="lbl">Reference #</span><span class="val" style="font-family:monospace">${s.refNum}</span></div>
      <div class="row"><span class="lbl">Customer</span><span class="val">${s.customerName||'—'}</span></div>
      <div class="row"><span class="lbl">Session Type</span><span class="val">${s.sessionType||'—'}</span></div>
      <div class="row"><span class="lbl">Reservation</span><span class="val">${s.date?new Date(s.date+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"})+(s.startTime?' · '+fmt12(s.startTime):''):'—'}</span></div>
      <div class="row"><span class="lbl">Players</span><span class="val">${s.playerCount}</span></div>
      <div class="row"><span class="lbl">Purchased</span><span class="val">${payment.createdAt?new Date(payment.createdAt).toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})+' · '+new Date(payment.createdAt).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:true}):'—'}</span></div>
      ${s.cardLast4?`<div class="row"><span class="lbl">Card</span><span class="val">•••• •••• •••• ${s.cardLast4}${s.cardExpiry?' · Exp '+s.cardExpiry:''}</span></div><div class="row"><span class="lbl">Cardholder</span><span class="val">${s.cardHolder||'—'}</span></div>`:''}
      <div class="row"><span class="lbl">Status</span><span class="val">${payment.status.toUpperCase()}</span></div>
      <div class="total-row"><span>Amount Charged</span><span>${fmtMoney(payment.amount)}</span></div>
      <div class="footer">
        Sector 317 · sector317.com · Noblesville, IN<br/>
        Payment processed securely via GoDaddy Payments<br/>
        <span class="ref">Receipt generated ${new Date().toLocaleString("en-US",{dateStyle:"long",timeStyle:"short"})}</span><br/>
        <em>Please retain this receipt for your records. For questions, contact us at sector317.com.</em>
      </div>
      <script>window.onload=()=>{window.print();}<\/script>
    </body></html>`);
    w.document.close();
  };
  return(
    <div className="mo"><div className="mc" style={{maxWidth:520}}>
      <div className="mt2" style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:".5rem"}}>
        <span>🧾 Booking Receipt</span>
        <span style={{fontFamily:"monospace",fontSize:".75rem",color:"var(--muted)",fontWeight:400}}>#{s.refNum}</span>
      </div>
      <div style={{background:"var(--bg2)",border:"1px solid var(--acc2)",borderRadius:6,padding:".85rem 1rem",marginBottom:"1rem",display:"flex",alignItems:"center",gap:.75+"rem"}}>
        <div style={{flex:1}}>
          <div style={{fontFamily:"var(--fd)",fontSize:"1.1rem",color:"var(--acc)",letterSpacing:".12em",fontWeight:900}}>SECTOR 317</div>
          <div style={{fontSize:".7rem",color:"var(--muted)",letterSpacing:".08em",textTransform:"uppercase"}}>Indoor Tactical Experience · Noblesville, IN</div>
        </div>
        <div style={{fontSize:".72rem",color:"var(--muted)",textAlign:"right"}}>sector317.com</div>
      </div>
      {[
        ["Reference #",<span style={{fontFamily:"monospace",fontSize:".85rem"}}>{s.refNum}</span>],
        ["Customer",s.customerName||"—"],
        ["Session Type",s.sessionType||"—"],
        ["Reservation",s.date?(new Date(s.date+"T12:00:00").toLocaleDateString("en-US",{weekday:"short",year:"numeric",month:"short",day:"numeric"})+(s.startTime?" · "+fmt12(s.startTime):"")):"—"],
        ["Players",s.playerCount],
        ["Purchased",payment.createdAt?(new Date(payment.createdAt).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})+" · "+new Date(payment.createdAt).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:true})):"—"],
        ...(s.cardLast4?[["Card","•••• •••• •••• "+s.cardLast4+(s.cardExpiry?" · Exp "+s.cardExpiry:"")],["Cardholder",s.cardHolder||"—"]]:[] ),
        ["Status",<span className="badge b-ok" style={{textTransform:"uppercase"}}>{payment.status}</span>],
      ].map(([lbl,val])=>(
        <div key={lbl} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:".45rem 0",borderBottom:"1px solid var(--bdr)",fontSize:".85rem"}}>
          <span style={{color:"var(--muted)"}}>{lbl}</span>
          <span style={{fontWeight:600,color:"var(--txt)",textAlign:"right"}}>{val}</span>
        </div>
      ))}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:".75rem 0",marginTop:".25rem",borderTop:"2px solid var(--bdr)",fontSize:"1.05rem",fontWeight:700}}>
        <span style={{color:"var(--txt)"}}>Amount Charged</span>
        <span style={{color:"var(--acc)",fontFamily:"var(--fd)",fontSize:"1.15rem"}}>{fmtMoney(payment.amount)}</span>
      </div>
      <div style={{fontSize:".72rem",color:"var(--muted)",marginTop:".5rem",lineHeight:1.5,textAlign:"center"}}>
        Payment processed securely via GoDaddy Payments<br/>
        <em>Retain this receipt for business expense records.</em>
      </div>
      <div className="ma" style={{marginTop:"1.25rem",gap:".75rem"}}>
        <button className="btn btn-s" onClick={onClose}>Close</button>
        <button className="btn btn-p" onClick={printReceipt}>🖨 Print Receipt</button>
      </div>
    </div></div>
  );
}

function CustomerPortal({user,reservations,setReservations,resTypes,sessionTemplates,users,setUsers,waiverDocs,activeWaiverDoc,onBook,onPayCreate,onFinalize,onSignWaiver,autoBook=false,onAutoBookDone,payments=[],setPayments,runs=[],onAlert}){
  const [tab,setTab]=useState("social");
  const [resSub,setResSub]=useState("upcoming");
  const [expandedPastId,setExpandedPastId]=useState(null);
  const [lbPlayerFilter,setLbPlayerFilter]=useState("all");
  const [lbPeriod,setLbPeriod]=useState("alltime");
  const [lbMode,setLbMode]=useState("avg");
  const [lbPage,setLbPage]=useState(1);
  const [lbData,setLbData]=useState([]);
  const [lbCareerMap,setLbCareerMap]=useState({});
  const [lbLoading,setLbLoading]=useState(false);
  const [friendIds,setFriendIds]=useState(new Set());
  const [friendsVersion,setFriendsVersion]=useState(0);
  useEffect(()=>{if(!user)return;fetchFriends(user.id).then(({data})=>{const ids=(data??[]).map(f=>f.user_id_1===user.id?f.user_id_2:f.user_id_1);setFriendIds(new Set(ids));}).catch(()=>{});},[user&&user.id,friendsVersion]);// eslint-disable-line react-hooks/exhaustive-deps
  const [lbError,setLbError]=useState(null);
  const [showBook,setShowBook]=useState(false);
  useEffect(()=>{if(autoBook){setShowBook(true);onAutoBookDone?.();}},[]);// eslint-disable-line react-hooks/exhaustive-deps
  const [availRes,setAvailRes]=useState([]);
  useEffect(()=>{if(showBook)fetchAvailabilityReservations().then(setAvailRes).catch(()=>{});},[showBook]);// eslint-disable-line react-hooks/exhaustive-deps
  const [wOpen,setWOpen]=useState(false);
  const [wViewOpen,setWViewOpen]=useState(false);
  const [showAccount,setShowAccount]=useState(false);
  const [receiptRes,setReceiptRes]=useState(null);
  const [viewPayment,setViewPayment]=useState(null);
  const [waiverAlert,setWaiverAlert]=useState(()=>!hasValidWaiver(user,activeWaiverDoc));
  const [editResId,setEditResId]=useState(null);
  const [saveGroupError,setSaveGroupError]=useState(null);
  const [saveGroupBusy,setSaveGroupBusy]=useState(false);
  const [modifyRes,setModifyRes]=useState(null); // {res, mode:'reschedule'|'upgrade'}
  const [now,setNow]=useState(()=>new Date());
  useEffect(()=>{const id=setInterval(()=>setNow(new Date()),60000);return()=>clearInterval(id);},[]);
  const [playerInputs,setPlayerInputs]=useState([]);
  const [bookerIsPlayer,setBookerIsPlayer]=useState(true);
  const [player1Input,setPlayer1Input]=useState({phone:"",userId:null,name:"",status:"idle"});
  const [careerRuns,setCareerRuns]=useState(null);
  const [lbHideSaving,setLbHideSaving]=useState(false);
  useEffect(()=>{
    supabase.from('v_leaderboard_cumulative').select('total_runs_played').eq('player_id',user.id).maybeSingle()
      .then(({data})=>setCareerRuns(data?.total_runs_played??0))
      .catch(()=>setCareerRuns(0));
  },[]);// eslint-disable-line react-hooks/exhaustive-deps
  // Leaderboard view map (mirrors leaderboard.html VIEW_MAP)
  const LB_VIEW_MAP={
    avg:{alltime:{view:'v_leaderboard',rankCol:'rank_all_time'},yearly:{view:'v_leaderboard_yearly',rankCol:'rank_yearly'},monthly:{view:'v_leaderboard_monthly',rankCol:'rank_monthly'},weekly:{view:'v_leaderboard_weekly',rankCol:'rank_weekly'}},
    cum:{alltime:{view:'v_leaderboard_cumulative',rankCol:'rank_all_time'},yearly:{view:'v_leaderboard_yearly_cumulative',rankCol:'rank_yearly'},monthly:{view:'v_leaderboard_monthly_cumulative',rankCol:'rank_monthly'},weekly:{view:'v_leaderboard_weekly_cumulative',rankCol:'rank_weekly'}},
  };
  useEffect(()=>{
    if(tab!=='leaderboard') return;
    setLbLoading(true);setLbError(null);setLbPage(1);
    const {view}=LB_VIEW_MAP[lbMode][lbPeriod];
    const q=lbPlayerFilter==="friends"&&friendIds.size>0
      ?supabase.from(view).select('*').in('player_id',[...friendIds,user.id]).order('leaderboard_score',{ascending:false})
      :supabase.from(view).select('*').order('leaderboard_score',{ascending:false}).limit(200);
    q.then(async ({data,error})=>{
      if(error){setLbError(error.message);setLbData([]);}
      else{
        const rows=data??[];
        setLbData(rows);
        if(lbPeriod!=='alltime'&&rows.length>0){
          const ids=rows.map(r=>r.player_id);
          const {data:career}=await supabase.from('v_leaderboard_cumulative').select('player_id,total_runs_played').in('player_id',ids);
          const map={};(career??[]).forEach(r=>{map[r.player_id]=r.total_runs_played;});
          setLbCareerMap(map);
        } else {
          setLbCareerMap({});
        }
      }
    })
      .catch(e=>setLbError(e.message))
      .finally(()=>setLbLoading(false));
  },[tab,lbMode,lbPeriod,lbPlayerFilter,friendIds]);// eslint-disable-line react-hooks/exhaustive-deps
  const today=todayStr();
  const myRes=reservations.filter(r=>r.userId===user.id);
  const isSessionOver=r=>{if(r.date<today)return true;if(r.date>today)return false;const c=new Date(`${r.date}T${r.startTime}`);c.setHours(c.getHours()+1);return now>=c;};
  const upcoming=myRes.filter(r=>!isSessionOver(r)&&r.status!=="cancelled").sort((a,b)=>a.date.localeCompare(b.date)||a.startTime.localeCompare(b.startTime));
  const past=myRes.filter(r=>isSessionOver(r)).sort((a,b)=>b.date.localeCompare(a.date)||b.startTime.localeCompare(a.startTime));
  const valid=hasValidWaiver(user,activeWaiverDoc);
  const wDate=latestWaiverDate(user);
  const editRes=reservations.find(r=>r.id===editResId);
  useEffect(()=>{
    if(!editRes)return;
    const allP=editRes.players||[];
    const bookerInList=allP.some(p=>p.userId===user.id);
    setBookerIsPlayer(bookerInList||allP.length===0);
    const nonBooker=allP.filter(p=>p.userId!==user.id);
    // Restore status: found if userId known, named if name+phone but no userId, idle if empty
    const toInput=ep=>ep
      ? {phone:ep.phone||"",userId:ep.userId||null,name:ep.name||"",
         status:ep.userId?"found":(ep.name?"named":"idle")}
      : {phone:"",userId:null,name:"",status:"idle"};
    if(!bookerInList&&nonBooker.length>0){
      setPlayer1Input(toInput(nonBooker[0]));
      setPlayerInputs(Array.from({length:Math.max(0,(editRes.playerCount||1)-1)},(_,i)=>toInput(nonBooker[i+1])));
    } else {
      setPlayer1Input({phone:"",userId:null,name:"",status:"idle"});
      setPlayerInputs(Array.from({length:Math.max(0,(editRes.playerCount||1)-1)},(_,i)=>toInput(nonBooker[i])));
    }
  },[editResId]);

  const saveGroup=async()=>{
    setSaveGroupError(null);
    // Guard: check for duplicates before saving
    const allInputIds=[
      bookerIsPlayer?user.id:player1Input.userId,
      ...playerInputs.map(p=>p.userId)
    ].filter(Boolean);
    const hasDup=allInputIds.length!==new Set(allInputIds).size;
    if(hasDup){setSaveGroupError("Duplicate player detected — each player can only appear once on the roster.");return;}
    setSaveGroupBusy(true);
    // Helper: ensure guest players have a DB user row
    const resolvePlayer=async(p)=>{
      if(p.userId) return p;
      if(!p.name?.trim()) return p;
      const phone=cleanPh(p.phone||"");
      if(phone.length!==10) throw new Error(`Phone number required for new guest "${p.name.trim()}". Search by phone first, then add their name.`);
      const guest=await createGuestUser({name:p.name.trim(),phone,createdByUserId:user.id});
      setUsers(prev=>[...prev,guest]);
      return {...p,userId:guest.id};
    };
    try{
      let p1;
      if(bookerIsPlayer){
        p1={userId:user.id,name:user.name};
      } else {
        p1=await resolvePlayer({
          userId:player1Input.userId??null,
          name:player1Input.name||(player1Input.userId?users.find(u=>u.id===player1Input.userId)?.name||"":""),
          phone:player1Input.phone||"",
        });
      }
      const extraRaw=playerInputs.filter(p=>p.phone||p.name).map(p=>({
        userId:p.userId??null,
        name:p.name||(p.userId?users.find(u=>u.id===p.userId)?.name||"":""),
        phone:p.phone||"",
      }));
      const extra=await Promise.all(extraRaw.map(resolvePlayer));
      const newPlayers=[p1,...extra].filter(p=>p.name?.trim());
      const updatedPlayers=await syncReservationPlayers(editResId,newPlayers);
      setReservations(prev=>prev.map(r=>r.id===editResId?{...r,players:updatedPlayers}:r));
      setEditResId(null);
    }catch(err){
      setSaveGroupError(err.message||"Failed to save group. Please try again.");
    }finally{
      setSaveGroupBusy(false);
    }
  };
  return(
    <div className="content">
      {showAccount&&<AccountPanel user={user} users={users} setUsers={setUsers} onClose={()=>setShowAccount(false)}/>}
      {modifyRes&&<ReservationModifyWizard
        res={modifyRes.res}
        mode={modifyRes.mode}
        resTypes={resTypes}
        sessionTemplates={sessionTemplates}
        reservations={reservations}
        currentUser={user}
        onClose={()=>setModifyRes(null)}
        onReschedule={(id,date,startTime)=>{
          updateReservation(id,{date,startTime,rescheduled:true}).then(updated=>{
            setReservations(p=>p.map(r=>r.id===id?{...r,date:updated.date,startTime:updated.startTime,rescheduled:true}:r));
          }).catch(()=>{
            setReservations(p=>p.map(r=>r.id===id?{...r,date,startTime,rescheduled:true}:r));
          });
          setModifyRes(null);
        }}
        onUpgrade={(id,newTypeId,amountDue)=>{
          updateReservation(id,{typeId:newTypeId,amount:(reservations.find(r=>r.id===id)?.amount||0)+amountDue}).then(updated=>{
            setReservations(p=>p.map(r=>r.id===id?{...r,typeId:newTypeId,amount:updated.amount}:r));
          }).catch(()=>{
            setReservations(p=>p.map(r=>r.id===id?{...r,typeId:newTypeId}:r));
          });
          setModifyRes(null);
        }}
        onMoveAndUpgrade={(id,newDate,newStartTime,newTypeId,amountDue)=>{
          const res=reservations.find(r=>r.id===id);
          updateReservation(id,{date:newDate,startTime:newStartTime,typeId:newTypeId,amount:(res?.amount||0)+amountDue}).then(updated=>{
            setReservations(p=>p.map(r=>r.id===id?{...r,date:newDate,startTime:newStartTime,typeId:newTypeId,amount:updated.amount}:r));
          }).catch(()=>{
            setReservations(p=>p.map(r=>r.id===id?{...r,date:newDate,startTime:newStartTime,typeId:newTypeId}:r));
          });
          setModifyRes(null);
        }}
      />}
      {showBook&&<BookingWizard resTypes={resTypes} sessionTemplates={sessionTemplates} reservations={reservations} allReservations={availRes.length?availRes:reservations} currentUser={user} users={users} activeWaiverDoc={activeWaiverDoc} onBook={b=>{onBook(b);setShowBook(false);}} onPayCreate={onPayCreate} onFinalize={async items=>{await onFinalize(items);setShowBook(false);}} onClose={()=>setShowBook(false)}/>}
      {receiptRes&&<ReceiptModal res={receiptRes} resTypes={resTypes} user={user} onClose={()=>setReceiptRes(null)}/>}
      {viewPayment&&<PaymentReceiptModal payment={viewPayment} onClose={()=>setViewPayment(null)}/>}
      {waiverAlert&&<div className="mo"><div className="mc" style={{maxWidth:480}}>
        <div className="mt2" style={{color:"var(--warn)"}}>⚠ Waiver Required</div>
        <p style={{color:"var(--muted)",marginBottom:"1rem",fontSize:".88rem"}}>You don't have a current signed waiver on file. A valid waiver is required before you can play. Sign now to get cleared for your next mission.</p>
        <div className="ma" style={{gap:".75rem"}}>
          <button className="btn btn-s" onClick={()=>setWaiverAlert(false)}>Remind Me Later</button>
          <button className="btn btn-p" onClick={()=>{setWaiverAlert(false);setWOpen(true);}}>Sign My Waiver Now →</button>
        </div>
      </div></div>}
      {wOpen&&<WaiverModal playerName={user.name} waiverDoc={activeWaiverDoc} onClose={()=>setWOpen(false)} onSign={(name,isMinor)=>{onSignWaiver(user.id,name,isMinor);setWOpen(false);}}/>}
      {wViewOpen&&<WaiverViewModal user={user} waiverDocs={waiverDocs} activeWaiverDoc={activeWaiverDoc} onClose={()=>setWViewOpen(false)}/>}
      {editResId&&editRes&&<div className="mo"><div className="mc" style={{maxWidth:540}}>
        <div className="mt2">Manage Team</div>
        <p style={{color:"var(--muted)",fontSize:".82rem",marginBottom:".5rem"}}>{editRes.customerName} · {fmt(editRes.date)} · {fmt12(editRes.startTime)} · {editRes.playerCount} players</p>
        <p style={{fontSize:".78rem",color:"var(--muted)",marginBottom:"1rem"}}>Add your group's phone numbers to speed up check-in and waiver signing at the venue:</p>
        <div className="player-inputs">
          {/* Player 1 — booker or someone else */}
          {bookerIsPlayer
            ?<div style={{background:"var(--accD)",border:"1px solid var(--acc2)",borderRadius:5,padding:".7rem 1rem",marginBottom:".5rem",fontSize:".85rem"}}>
              <div style={{fontSize:".68rem",fontFamily:"var(--fd)",letterSpacing:".1em",color:"var(--acc)",marginBottom:".4rem"}}>PLAYER 1</div>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:".5rem"}}>
                <div style={{display:"flex",alignItems:"center",gap:".6rem"}}>
                  <span style={{background:"var(--acc2)",color:"var(--bg2)",borderRadius:"50%",width:24,height:24,display:"inline-flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:".72rem",flexShrink:0}}>{getInitials(user.name)}</span>
                  <strong>{user.name}</strong><span style={{fontSize:".75rem",color:"var(--okB)"}}>— you</span>
                </div>
                <label style={{display:"flex",alignItems:"center",gap:".4rem",fontSize:".78rem",color:"var(--muted)",cursor:"pointer"}}>
                  <input type="checkbox" checked={!bookerIsPlayer} onChange={e=>{setBookerIsPlayer(!e.target.checked);setPlayer1Input({phone:"",userId:null,name:"",status:"idle"});}} style={{accentColor:"var(--acc)"}}/>
                  Booking for someone else
                </label>
              </div>
            </div>
            :<div style={{marginBottom:".5rem"}}>
              <PlayerPhoneInput index={null} label="Player 1" value={player1Input} users={users} bookerUserId={null} onChange={setPlayer1Input} showFullName={true}/>
              <label style={{display:"flex",alignItems:"center",gap:".4rem",fontSize:".78rem",color:"var(--muted)",cursor:"pointer",marginTop:".35rem"}}>
                <input type="checkbox" checked={!bookerIsPlayer} onChange={e=>{setBookerIsPlayer(!e.target.checked);setPlayer1Input({phone:"",userId:null,name:"",status:"idle"});}} style={{accentColor:"var(--acc)"}}/>
                Booking for someone else
              </label>
            </div>
          }
          {/* Remaining players */}
          {playerInputs.map((pi,i)=>{
            const currentUserIds=[
              bookerIsPlayer?user.id:player1Input.userId,
              ...playerInputs.filter((_,j)=>j!==i).map(p=>p.userId)
            ].filter(Boolean);
            return <div key={i} style={{display:"flex",alignItems:"flex-start",gap:".5rem"}}>
              <div style={{flex:1}}><PlayerPhoneInput index={i} value={pi} users={users} bookerUserId={user.id} activeWaiverDoc={activeWaiverDoc} existingUserIds={currentUserIds} onChange={v=>setPlayerInputs(p=>{const n=[...p];n[i]=v;return n;})}/></div>
              {(pi.name||pi.phone)&&<button className="btn btn-d btn-sm" style={{marginTop:"1.6rem",flexShrink:0}} onClick={()=>setPlayerInputs(p=>{const n=[...p];n[i]={phone:"",userId:null,name:"",status:"idle"};return n;})} title="Clear player">✕</button>}
            </div>;
          })}
        </div>
        {playerInputs.length<(editRes?.playerCount||1)-1&&<button className="btn btn-s btn-sm" style={{marginBottom:".75rem"}} onClick={()=>setPlayerInputs(p=>[...p,{phone:"",userId:null,name:"",status:"idle"}])}>+ Add Player Slot</button>}
        {editRes?.typeId&&resTypes.find(x=>x.id===editRes.typeId)?.style==="open"&&<div style={{fontSize:".74rem",color:"var(--muted)",marginBottom:".75rem",background:"var(--surf2)",border:"1px solid var(--bdr)",borderRadius:4,padding:".5rem .75rem"}}>⚠ Open play — removing players does not issue a refund. Contact staff for refund requests.</div>}
        {saveGroupError&&<div style={{background:"rgba(192,57,43,.1)",border:"1px solid var(--danger)",borderRadius:5,padding:".6rem .85rem",fontSize:".8rem",color:"var(--dangerL)",marginBottom:".75rem"}}>⚠ {saveGroupError}</div>}
        <div className="ma">
          <button className="btn btn-s" onClick={()=>{setEditResId(null);setSaveGroupError(null);}}>Cancel</button>
          <button className="btn btn-p" disabled={saveGroupBusy} onClick={saveGroup}>{saveGroupBusy?"Saving…":"Save Team"}</button>
        </div>
      </div></div>}
      <div className="hero">
        <div style={{flex:1,minWidth:0}}>
          <h2>Welcome, Operative {user.name.split(" ")[0]}</h2>
          <div style={{display:"flex",alignItems:"center",gap:".5rem",flexWrap:"wrap",marginTop:".3rem"}}>
            <button
              onClick={()=>valid?setWViewOpen(true):setWOpen(true)}
              style={{background:valid?"rgba(200,224,58,.12)":"rgba(192,57,43,.15)",border:`1px solid ${valid?"rgba(200,224,58,.4)":"rgba(192,57,43,.5)"}`,borderRadius:20,padding:".18rem .65rem",fontSize:".75rem",fontFamily:"var(--fd)",letterSpacing:".06em",textTransform:"uppercase",color:valid?"var(--accB)":"var(--dangerL)",cursor:"pointer",fontWeight:700,flexShrink:0}}>
              {valid?"✓ Waiver on File":"⚠ Sign Waiver"}
            </button>
            {!valid&&wDate&&<span style={{fontSize:".72rem",color:"var(--muted)"}}>Expired {fmtTS(wDate)}</span>}
          </div>
        </div>
        <button className="btn btn-p" style={{flexShrink:0}} onClick={()=>setShowBook(true)}>+ Book Mission</button>
      </div>
      {/* ── Top info row: Leaderboard + Rank combined · Store Credits ── */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:".75rem",marginBottom:"1.5rem"}}>
        {/* Leaderboard + Rank combined card */}
        <div style={{background:"var(--surf)",border:"1px solid var(--bdr)",borderTop:"3px solid var(--acc2)",borderRadius:6,padding:".85rem 1rem",display:"flex",flexDirection:"column",gap:".45rem"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:".5rem",flexWrap:"wrap"}}>
            <div style={{fontFamily:"var(--fd)",fontSize:".82rem",color:"var(--acc2)",letterSpacing:".08em",textTransform:"uppercase"}}>🏆 Leaderboard</div>
            {careerRuns!==null&&(()=>{
              const{current}=getTierInfo(careerRuns);
              const col=TIER_COLORS[current.key];
              return <div style={{display:"flex",alignItems:"center",gap:".35rem"}}>
                <img src={`/${current.key}.png`} alt={current.key} style={{height:14,width:"auto",maxWidth:28,display:"block",flexShrink:0,objectFit:"contain",...(TIER_SHINE[current.key]?{filter:TIER_SHINE[current.key]}:{})}}/>
                <span style={{fontFamily:"var(--fd)",fontSize:".82rem",letterSpacing:".06em",textTransform:"uppercase",color:col}}>{current.name}</span>
              </div>;
            })()}
          </div>
          <div style={{fontSize:".88rem",color:user.hideFromLeaderboard?"var(--muted)":"var(--txt)",fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
            {user.hideFromLeaderboard?"Hidden":user.leaderboardName||genDefaultLeaderboardName(user.name,user.phone)}
          </div>
          {careerRuns!==null&&(()=>{
            const{next,sessionsToNext}=getTierInfo(careerRuns);
            return <div style={{fontSize:".72rem",color:"var(--muted)"}}>
              {next?<>{sessionsToNext} session{sessionsToNext!==1?"s":""} to <strong style={{color:TIER_COLORS[next.key]}}>{next.name}</strong></>:"Maximum rank achieved."}
              {" · "}{careerRuns} career run{careerRuns!==1?"s":""}
            </div>;
          })()}
          <label style={{display:"flex",alignItems:"center",gap:".4rem",cursor:"pointer",fontSize:".75rem",color:"var(--muted)",marginTop:".1rem",userSelect:"none"}}>
            <input type="checkbox" checked={user.hideFromLeaderboard??false} disabled={lbHideSaving}
              style={{accentColor:"var(--accB)",width:13,height:13,flexShrink:0,cursor:"pointer"}}
              onChange={async e=>{
                setLbHideSaving(true);
                try{
                  const updated=await updateOwnProfile(user.id,{
                    name:user.name,phone:user.phone,
                    leaderboardName:user.leaderboardName||genDefaultLeaderboardName(user.name,user.phone),
                    hideFromLeaderboard:e.target.checked,
                  });
                  setUsers(prev=>prev.map(u=>u.id===user.id?updated:u));
                }catch(_){}
                finally{setLbHideSaving(false);}
              }}/>
            Hide from leaderboard
          </label>
          <button className="btn btn-s btn-sm" style={{marginTop:"auto",alignSelf:"flex-start"}} onClick={()=>setShowAccount(true)}>Edit Account</button>
        </div>
        {(user.credits??0)>0&&<div style={{background:"var(--surf)",border:"1px solid var(--bdr)",borderTop:"3px solid var(--ok)",borderRadius:6,padding:".85rem 1rem",display:"flex",flexDirection:"column",gap:".35rem"}}>
          <div style={{fontFamily:"var(--fd)",fontSize:".82rem",color:"var(--muted)",letterSpacing:".08em",textTransform:"uppercase"}}>Store Credits</div>
          <div style={{fontFamily:"var(--fd)",fontSize:"1.1rem",color:"var(--okB)",fontWeight:700}}>{fmtMoney(user.credits)}</div>
          <div style={{fontSize:".75rem",color:"var(--muted)"}}>Available for bookings &amp; merchandise</div>
        </div>}
      </div>
      {/* Primary Tab Bar */}
      <div className="tabs" style={{marginBottom:"1.1rem",borderBottom:"1px solid var(--bdr)"}}>
        <button className={`tab${tab==="social"?" on":""}`} onClick={()=>setTab("social")}>Social</button>
        <button className={`tab${tab==="reservations"?" on":""}`} onClick={()=>setTab("reservations")}>Reservations</button>
        <button className={`tab${tab==="payments"?" on":""}`} onClick={()=>setTab("payments")}>Payments</button>
        <button className={`tab${tab==="leaderboard"?" on":""}`} onClick={()=>setTab("leaderboard")}>Leaderboard</button>
        <button className={`tab${tab==="shop"?" on":""}`} onClick={()=>setTab("shop")}>Shop</button>
      </div>

      {/* ── RESERVATIONS TAB ── */}
      {tab==="reservations"&&(()=>{
        return <>
          <div className="tabs" style={{marginBottom:"1rem",borderBottom:"1px solid var(--bdr)"}}>
            <button className={`tab${resSub==="upcoming"?" on":""}`} onClick={()=>setResSub("upcoming")}>Upcoming ({upcoming.length})</button>
            <button className={`tab${resSub==="past"?" on":""}`} onClick={()=>setResSub("past")}>Past ({past.length})</button>
          </div>
          {resSub==="upcoming"&&(
            <div className="tw"><table><thead><tr><th>Type</th><th>Date & Time</th><th>Players</th><th>Amount</th><th>Status</th><th></th></tr></thead>
              <tbody>{upcoming.map(r=>{const rt=resTypes.find(x=>x.id===r.typeId);return <tr key={r.id}>
                <td><div style={{fontWeight:600}}>{rt?.name}</div><div style={{display:"flex",gap:".3rem",marginTop:".2rem"}}><span className={`badge b-${rt?.mode}`}>{rt?.mode}</span><span className={`badge b-${rt?.style}`}>{rt?.style}</span></div></td>
                <td>{fmt(r.date)}<br/><span style={{fontSize:".76rem",color:"var(--muted)"}}>{fmt12(r.startTime)}</span></td>
                <td style={{color:"var(--accB)"}}>{r.players.length}/{r.playerCount}</td>
                <td style={{color:"var(--accB)",fontWeight:600}}>{fmtMoney(r.amount)}</td>
                <td><span className={`badge ${r.status==="confirmed"?"b-ok":r.status==="completed"?"b-done":r.status==="no-show"?"b-noshow":"b-cancel"}`}>{r.status}</span></td>
                <td><div style={{display:"flex",gap:".35rem",flexWrap:"wrap"}}>
                  {r.status!=="completed"&&r.status!=="no-show"&&<>
                    <button className="btn btn-s btn-sm" onClick={()=>setEditResId(r.id)}>Manage Team</button>
                    <button className="btn btn-s btn-sm" onClick={()=>setModifyRes({res:r,mode:"reschedule"})}>Reschedule</button>
                    {rt?.style==="open"&&<button className="btn btn-ok btn-sm" onClick={()=>setModifyRes({res:r,mode:"upgrade"})}>⬆ Upgrade</button>}
                  </>}
                </div></td>
              </tr>;})}
              </tbody></table>
              {!upcoming.length&&<div className="empty"><div className="ei">🎯</div><p>No upcoming missions.</p></div>}
            </div>
          )}
          {resSub==="past"&&(()=>{
            const fmtSec=s=>{if(s==null)return null;const m=Math.floor(s/60),sec=s%60;return`${m}:${String(sec).padStart(2,'0')}`;};
            const VIZ={V:'Standard',C:'Cosmic',R:'Rave',S:'Strobe',CS:'Cosmic+Strobe',B:'Dark'};
            const AUD={C:'Cranked',O:'Off',T:'Tunes'};
            const OPD={easy:'Easy',medium:'Medium',hard:'Hard',elite:'Elite'};
            const TC={1:{name:'Blue',col:'#3b82f6'},2:{name:'Red',col:'#ef4444'}};
            const audLbl=rn=>rn.audio?AUD[rn.audio]||rn.audio:(rn.cranked?'Cranked':'Standard');
            const Pill=({v})=><span style={{display:'inline-block',background:'var(--bg2)',border:'1px solid var(--bdr)',borderRadius:4,padding:'1px 7px',fontSize:'.67rem',color:'var(--muted)',marginRight:'.3rem',marginBottom:'.2rem'}}>{v}</span>;
            return <div className="tw"><table><thead><tr><th>Type</th><th>Date & Time</th><th>Players</th><th>Amount</th><th>Status</th><th></th></tr></thead>
              <tbody>{past.map(r=>{
                const rt=resTypes.find(x=>x.id===r.typeId);
                const resRuns=runs.filter(rn=>rn.reservationId===r.id);
                const isExpanded=expandedPastId===r.id;
                const myTeam=r.players.find(p=>p.userId===user.id)?.team??null;
                return <Fragment key={r.id}>
                  <tr style={{cursor:resRuns.length?"pointer":"default"}} onClick={()=>resRuns.length?setExpandedPastId(isExpanded?null:r.id):null}>
                    <td><div style={{fontWeight:600}}>{rt?.name}</div><div style={{display:"flex",gap:".3rem",marginTop:".2rem"}}><span className={`badge b-${rt?.mode}`}>{rt?.mode}</span><span className={`badge b-${rt?.style}`}>{rt?.style}</span></div></td>
                    <td>{fmt(r.date)}<br/><span style={{fontSize:".76rem",color:"var(--muted)"}}>{fmt12(r.startTime)}</span></td>
                    <td style={{color:"var(--accB)"}}>{r.players.length}/{r.playerCount}</td>
                    <td style={{color:"var(--accB)",fontWeight:600}}>{fmtMoney(r.amount)}</td>
                    <td><span className={`badge ${r.status==="confirmed"?"b-ok":r.status==="completed"?"b-done":r.status==="no-show"?"b-noshow":"b-cancel"}`}>{r.status}</span></td>
                    <td style={{textAlign:"right"}}>{resRuns.length>0&&<span style={{fontSize:".72rem",color:"var(--accB)",fontWeight:600}}>{isExpanded?"▲":"▼"} Check your scores!</span>}</td>
                  </tr>
                  {isExpanded&&resRuns.length>0&&<tr key={r.id+"-runs"}><td colSpan={6} style={{background:"var(--surf2)",padding:0,borderBottom:"1px solid var(--bdr)"}}>
                    <div style={{padding:".85rem 1rem"}}>
                      {rt?.mode==='versus'?(()=>{
                        const roleColor=role=>{if(!role)return'var(--muted)';const r=role.toLowerCase();if(r.includes('hunt'))return'#c8e03a';if(r.includes('coyot'))return'#c4a882';return'var(--muted)';};
                        const groups={};
                        resRuns.forEach(rn=>{const k=rn.runNumber??0;(groups[k]=groups[k]||[]).push(rn);});
                        const sortedGroups=Object.entries(groups).sort(([a],[b])=>Number(a)-Number(b));
                        // session_runs.team is now the stable original group (1=Blue, 2=Red always).
                        // winningTeam and role are also stable — no mapping needed.
                        const mwNum=r.warWinnerTeam!=null?r.warWinnerTeam:null;
                        const iWon=mwNum!=null&&myTeam!=null&&mwNum===Number(myTeam);
                        return <>
                          <div style={{display:'flex',alignItems:'center',gap:'.6rem',marginBottom:'.85rem',flexWrap:'wrap'}}>
                            {myTeam!=null&&<div style={{display:'flex',alignItems:'center',gap:'.35rem',background:'var(--bg2)',border:'1px solid var(--bdr)',borderRadius:4,padding:'.18rem .55rem',fontSize:'.68rem'}}>
                              <div style={{width:8,height:8,borderRadius:'50%',background:TC[Number(myTeam)]?.col??'var(--muted)',flexShrink:0}}/>
                              <span style={{color:'var(--muted)',fontFamily:'var(--fd)',letterSpacing:'.06em',textTransform:'uppercase'}}>Your team:</span>
                              <span style={{fontWeight:700,color:TC[Number(myTeam)]?.col??'var(--txt)'}}>{TC[Number(myTeam)]?.name??'Team '+myTeam}</span>
                            </div>}
                            {mwNum!=null&&<div style={{display:'flex',alignItems:'center',gap:'.35rem',background:iWon?'rgba(34,197,94,.08)':'var(--bg2)',border:'1px solid '+(iWon?'rgba(34,197,94,.25)':'var(--bdr)'),borderRadius:4,padding:'.18rem .55rem',fontSize:'.68rem'}}>
                              <div style={{width:8,height:8,borderRadius:'50%',background:TC[mwNum]?.col??'var(--acc)',flexShrink:0}}/>
                              <span style={{color:'var(--muted)',fontFamily:'var(--fd)',letterSpacing:'.06em',textTransform:'uppercase'}}>Match:</span>
                              <span style={{fontWeight:700,color:TC[mwNum]?.col??'var(--acc)'}}>{TC[mwNum]?.name??'Team '+mwNum} wins</span>
                              {iWon&&<span style={{fontWeight:700,color:'var(--okB)',marginLeft:'.2rem'}}>— You won!</span>}
                            </div>}
                          </div>
                          {sortedGroups.map(([runNum,grp],runIdx)=>{
                            const teamRuns=[...grp].sort((a,b)=>{if(myTeam==null)return (a.team??0)-(b.team??0);if(Number(a.team)===Number(myTeam))return -1;if(Number(b.team)===Number(myTeam))return 1;return (a.team??0)-(b.team??0);});
                            const runWinTeam=grp[0]?.winningTeam!=null?Number(grp[0].winningTeam):null;
                            const runTime=fmtSec(grp[0]?.elapsedSeconds);
                            const rEnv=grp[0];
                            return <div key={runNum} style={{marginBottom:'.6rem',border:'1px solid var(--bdr)',borderRadius:7,overflow:'hidden',background:'var(--surf)'}}>
                              <div style={{background:'var(--bg2)',padding:'.3rem .85rem',fontSize:'.67rem',fontFamily:'var(--fd)',letterSpacing:'.08em',textTransform:'uppercase',color:'var(--muted)',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:'.3rem'}}>
                                <div style={{display:'flex',alignItems:'center',gap:'.5rem',flexWrap:'wrap'}}>
                                  <span style={{color:'var(--txt)',fontWeight:700}}>Run {runNum}</span>
                                  {rEnv.structure&&<span>Structure: {rEnv.structure}</span>}
                                  {rEnv.visual&&<Pill v={(VIZ[rEnv.visual]||rEnv.visual)+' Visual'}/>}
                                  <Pill v={audLbl(rEnv)+' Audio'}/>
                                </div>
                                <div style={{display:'flex',gap:'.5rem',alignItems:'center'}}>
                                  {runTime&&<span>{runTime}</span>}
                                  {runWinTeam!=null&&<span style={{color:TC[runWinTeam]?.col??'var(--acc)',fontWeight:700}}>{(TC[runWinTeam]?.name??'Team '+runWinTeam)+' wins'}</span>}
                                </div>
                              </div>
                              <div style={{display:'flex'}}>
                                {teamRuns.map((rn,ti)=>{
                                  const tc=TC[rn.team]||{name:'Team '+(rn.team??'?'),col:'var(--muted)'};
                                  const isMe=myTeam!=null&&Number(rn.team)===Number(myTeam);
                                  const sc=rn.score??calculateRunScore(rn);
                                  const won=rn.winningTeam!=null&&Number(rn.team)===Number(rn.winningTeam);
                                  const displayRole=rn.role?rn.role.charAt(0).toUpperCase()+rn.role.slice(1):null;
                                  const rc=roleColor(displayRole);
                                  const teamPlayers=r.players.filter(p=>Number(p.team)===Number(rn.team));
                                  return <div key={rn.id} style={{flex:1,padding:'.6rem .9rem',borderLeft:isMe?`3px solid ${tc.col}`:'none',borderRight:ti<teamRuns.length-1?'1px solid var(--bdr)':'none',background:won?tc.col+'18':undefined}}>
                                    <div style={{display:'flex',alignItems:'center',gap:'.35rem',marginBottom:'.3rem',flexWrap:'wrap'}}>
                                      <div style={{width:9,height:9,borderRadius:'50%',background:tc.col,flexShrink:0}}/>
                                      <span style={{fontWeight:700,fontSize:'.8rem',color:tc.col}}>{tc.name}</span>
                                      {displayRole&&<span style={{fontSize:'.72rem',fontWeight:700,color:rc,textTransform:'capitalize',letterSpacing:'.03em'}}>· {displayRole}</span>}
                                      {isMe&&<span style={{fontSize:'.62rem',background:'var(--accD)',color:'var(--accB)',padding:'1px 6px',borderRadius:99,marginLeft:'auto',flexShrink:0,whiteSpace:'nowrap'}}>← You</span>}
                                    </div>
                                    <div style={{fontFamily:'var(--fd)',fontSize:'1.35rem',fontWeight:700,color:won?tc.col:'var(--txt)'}}>{sc}</div>
                                    <div style={{display:'flex',gap:'.25rem',flexWrap:'wrap',marginTop:'.25rem'}}>
                                      {displayRole==='Hunter'&&rn.objectiveComplete!=null&&<span style={{fontSize:'.64rem',padding:'1px 6px',borderRadius:3,background:rn.objectiveComplete?'rgba(34,197,94,.12)':'rgba(239,68,68,.1)',color:rn.objectiveComplete?'var(--okB)':'var(--dangerL)',border:'1px solid '+(rn.objectiveComplete?'rgba(34,197,94,.3)':'rgba(239,68,68,.3)')}}>{rn.objectiveComplete?'✓ Objective':'✗ Objective'}</span>}
                                      {won&&<span style={{fontSize:'.64rem',padding:'1px 6px',borderRadius:3,background:'rgba(34,197,94,.12)',color:'var(--okB)',border:'1px solid rgba(34,197,94,.3)'}}>✓ Won run</span>}
                                    </div>
                                    {teamPlayers.length>0&&<div style={{marginTop:'.4rem',display:'flex',flexWrap:'wrap',gap:'.15rem .5rem'}}>{teamPlayers.map((p,i)=><span key={i} style={{fontSize:'.68rem',color:p.userId===user.id?'var(--accB)':'var(--muted)',fontWeight:p.userId===user.id?700:400}}>{p.name||'—'}</span>)}</div>}
                                  </div>;
                                })}
                              </div>
                            </div>;
                          })}
                        </>;
                      })():(()=>{
                        return <>
                          <div style={{display:'flex',flexWrap:'wrap',gap:'.5rem'}}>
                            {resRuns.map((rn,i)=>{
                              const sc=rn.score??calculateRunScore(rn);
                              const t=fmtSec(rn.elapsedSeconds);
                              return <div key={rn.id} style={{background:'var(--surf)',border:'1px solid var(--bdr)',borderLeft:`3px solid ${rn.objectiveComplete?'var(--acc)':'var(--danger)'}`,borderRadius:6,padding:'.6rem .85rem',minWidth:200}}>
                                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'.3rem'}}>
                                  <span style={{fontSize:'.68rem',fontFamily:'var(--fd)',letterSpacing:'.08em',textTransform:'uppercase',color:'var(--muted)'}}>Run {rn.runNumber??i+1}</span>
                                  {t&&<span style={{fontSize:'.68rem',color:'var(--muted)'}}>{t}</span>}
                                </div>
                                <div style={{marginBottom:'.3rem',display:'flex',flexWrap:'wrap',gap:'.2rem'}}>
                                  {rn.visual&&<Pill v={(VIZ[rn.visual]||rn.visual)+' Visual'}/>}
                                  <Pill v={audLbl(rn)+' Audio'}/>
                                  {rn.structure&&<Pill v={'Structure: '+rn.structure}/>}
                                  {rn.liveOpDifficulty&&<Pill v={'OP: '+(OPD[rn.liveOpDifficulty]||rn.liveOpDifficulty)}/>}
                                </div>
                                <div style={{fontFamily:'var(--fd)',fontSize:'1.35rem',fontWeight:700,color:'var(--accB)',marginBottom:'.35rem'}}>{sc}</div>
                                <div style={{display:'flex',flexWrap:'wrap',gap:'.25rem'}}>
                                  <span style={{fontSize:'.64rem',padding:'1px 6px',borderRadius:3,background:rn.targetsEliminated?'rgba(34,197,94,.12)':'rgba(239,68,68,.1)',color:rn.targetsEliminated?'var(--okB)':'var(--dangerL)',border:'1px solid '+(rn.targetsEliminated?'rgba(34,197,94,.3)':'rgba(239,68,68,.3)')}}>{rn.targetsEliminated?'✓ Targets':'✗ Missed'}</span>
                                  <span style={{fontSize:'.64rem',padding:'1px 6px',borderRadius:3,background:rn.objectiveComplete?'rgba(34,197,94,.12)':'rgba(239,68,68,.1)',color:rn.objectiveComplete?'var(--okB)':'var(--dangerL)',border:'1px solid '+(rn.objectiveComplete?'rgba(34,197,94,.3)':'rgba(239,68,68,.3)')}}>{rn.objectiveComplete?'✓ Objective':'✗ Objective'}</span>
                                </div>
                              </div>;
                            })}
                          </div>
                        </>;
                      })()}
                    </div>
                  </td></tr>}
                </Fragment>;
              })}
              </tbody></table>
              {!past.length&&<div className="empty"><div className="ei">🏁</div><p>No past missions yet.</p></div>}
            </div>;
          })()}
        </>;
      })()}

      {/* ── PAYMENTS TAB ── */}
      {tab==="payments"&&(()=>{
        const isAdmin=["staff","manager","admin"].includes(user.access);
        const myPayments=isAdmin?payments:payments.filter(p=>p.userId===user.id);
        return <div className="tw"><table><thead><tr><th>Purchase Date</th><th>Reference</th>{isAdmin&&<th>Customer</th>}<th>Session</th><th>Card</th><th>Amount</th><th>Status</th><th></th></tr></thead>
          <tbody>{myPayments.map(p=>{const s=p.snapshot||{};return(
            <tr key={p.id}>
              <td><div>{p.createdAt?new Date(p.createdAt).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}):fmt(s.date||"")}</div><div style={{fontSize:".72rem",color:"var(--muted)"}}>{p.createdAt?new Date(p.createdAt).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:true}):""}</div></td>
              <td style={{fontFamily:"monospace",fontSize:".78rem"}}>{s.refNum||p.id.slice(0,8).toUpperCase()}</td>
              {isAdmin&&<td style={{fontSize:".85rem"}}>{p.customerName}</td>}
              <td><div style={{fontSize:".85rem",fontWeight:600}}>{s.sessionType||"—"}</div><div style={{fontSize:".72rem",color:"var(--muted)",textTransform:"capitalize"}}>{s.mode} · {s.style}</div><div style={{fontSize:".72rem",color:"var(--muted)"}}>{s.date?new Date(s.date+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})+" · "+fmt12(s.startTime):""}</div></td>
              <td style={{fontSize:".82rem"}}>{s.cardLast4?<><div>{"•••• "+s.cardLast4}</div><div style={{fontSize:".72rem",color:"var(--muted)"}}>{s.cardHolder||""}{s.cardExpiry?" · "+s.cardExpiry:""}</div></>:<span style={{color:"var(--muted)"}}>—</span>}</td>
              <td style={{color:"var(--accB)",fontWeight:600}}>{fmtMoney(p.amount)}</td>
              <td><span style={{fontSize:".72rem",background:"var(--okD)",color:"var(--okB)",padding:".15rem .5rem",borderRadius:20,fontWeight:700,letterSpacing:".05em",textTransform:"uppercase"}}>{p.status}</span></td>
              <td><button className="btn btn-s btn-sm" onClick={()=>setViewPayment(p)}>🧾 Receipt</button></td>
            </tr>
          )})}</tbody></table>
          {!myPayments.length&&<div className="empty"><div className="ei">💳</div><p>No payment history yet.</p></div>}
        </div>;
      })()}

      {/* ── LEADERBOARD TAB ── */}
      {tab==="leaderboard"&&(()=>{
        const {rankCol}=LB_VIEW_MAP[lbMode][lbPeriod];
        const myRow=lbData.find(r=>r.player_id===user.id);
        const fmtSec2=s=>s?`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`:"—";
        const renderLbRow=(r,pinned=false)=>{
          const rank=r[rankCol]??'?';
          const sc=Number(r.leaderboard_score??0).toFixed(lbMode==='avg'?1:0);
          const avgT=fmtSec2(r.avg_seconds);
          const runCount=lbMode==='avg'?(r.runs_in_avg??r.total_runs??0):(r.total_runs??r.total_runs_played??0);
          const runsLbl=lbMode==='avg'?`${runCount} runs avg`:`${runCount} total runs`;
          const isMe=r.player_id===user.id;
          const tierRunCount=lbCareerMap[r.player_id]??r.total_runs_played??runCount;
          const {current:tier}=getTierInfo(tierRunCount);
          const tierCol=TIER_COLORS[tier.key];
          return <tr key={r.player_id+(pinned?'-pin':'')} style={pinned||isMe?{background:"var(--accD)"}:{}}>
            <td style={{textAlign:"center",fontFamily:"var(--fd)",fontSize:"1rem",whiteSpace:"nowrap",paddingRight:".5rem",color:rank===1?"var(--gold)":rank===2?"var(--silver)":rank===3?"var(--bronze)":"var(--muted)"}}>
              {rank===1?"🥇":rank===2?"🥈":rank===3?"🥉":`#${rank}`}
            </td>
            <td>
              <div style={{display:"flex",alignItems:"center",gap:".45rem"}}>
                <img src={`/${tier.key}.png`} alt={tier.key} style={{height:16,width:"auto",maxWidth:32,display:"block",flexShrink:0,objectFit:"contain",opacity:.9,...(TIER_SHINE[tier.key]?{filter:TIER_SHINE[tier.key]}:{})}}/>
                <div>
                  <div style={{fontFamily:"var(--fc)",fontWeight:700,fontSize:"1rem",color:isMe?"var(--accB)":"var(--txt)"}}>{r.player_name??'Unknown'}{isMe&&<span style={{fontSize:".7rem",color:"var(--acc2)",marginLeft:".5rem"}}>← you</span>}</div>
                  <div style={{fontSize:".68rem",color:"var(--muted)",marginTop:".1rem"}}><span style={{fontFamily:"var(--fd)",letterSpacing:".05em",color:tierCol,textTransform:"uppercase",marginRight:".35rem"}}>{tier.name}</span>{runsLbl} · ⏱ avg {avgT}</div>
                </div>
              </div>
            </td>
            <td style={{textAlign:"right"}}>
              <div style={{fontFamily:"var(--fd)",fontSize:"1.1rem",color:"var(--accB)"}}>{sc}</div>
              <div style={{fontSize:".68rem",color:"var(--muted)"}}>{lbMode==='avg'?'avg score':'total score'}</div>
            </td>
          </tr>;
        };
        return <>
          {/* Player filter layer */}
          <div style={{display:"flex",gap:".4rem",marginBottom:".75rem",flexWrap:"wrap",alignItems:"center"}}>
            <span style={{fontSize:".72rem",color:"var(--muted)",fontFamily:"var(--fc)",letterSpacing:".08em",textTransform:"uppercase",marginRight:".25rem"}}>Filter:</span>
            {["all","friends"].map(f=><button key={f} className={`btn btn-sm ${lbPlayerFilter===f?"btn-p":"btn-s"}`} onClick={()=>setLbPlayerFilter(f)} style={{textTransform:"capitalize"}}>{f==="all"?"All Players":"Friends"}</button>)}
          </div>
          {/* Mode toggle */}
          <div style={{display:"flex",gap:".4rem",marginBottom:".75rem",flexWrap:"wrap",alignItems:"center"}}>
            <span style={{fontSize:".72rem",color:"var(--muted)",fontFamily:"var(--fc)",letterSpacing:".08em",textTransform:"uppercase",marginRight:".25rem"}}>Mode:</span>
            <button className={`btn btn-sm ${lbMode==="avg"?"btn-p":"btn-s"}`} onClick={()=>setLbMode("avg")}>Avg Top 50</button>
            <button className={`btn btn-sm ${lbMode==="cum"?"btn-p":"btn-s"}`} onClick={()=>setLbMode("cum")}>Cumulative</button>
          </div>
          {/* Period sub-tabs */}
          <div className="tabs" style={{marginBottom:"1rem",borderBottom:"1px solid var(--bdr)"}}>
            {[["alltime","All Time"],["yearly","This Year"],["monthly","This Month"],["weekly","This Week"]].map(([p,l])=>(
              <button key={p} className={`tab${lbPeriod===p?" on":""}`} onClick={()=>setLbPeriod(p)}>{l}</button>
            ))}
          </div>
          {lbLoading&&<div style={{textAlign:"center",padding:"2rem",color:"var(--muted)"}}>Loading…</div>}
          {lbError&&<div style={{textAlign:"center",padding:"2rem",color:"var(--dangerL)"}}>⚠ {lbError}</div>}
          {!lbLoading&&!lbError&&(()=>{
            const LB_PAGE_SIZE=25;
            const totalPages=Math.max(1,Math.ceil(lbData.length/LB_PAGE_SIZE));
            const page=Math.min(lbPage,totalPages);
            const pagedData=lbData.slice((page-1)*LB_PAGE_SIZE,page*LB_PAGE_SIZE);
            return <div className="tw">
              {myRow&&<div style={{marginBottom:".75rem",borderRadius:6,overflow:"hidden",border:"1px solid var(--acc2)"}}>
                <div style={{background:"var(--accD)",padding:".4rem 1rem",fontSize:".7rem",fontFamily:"var(--fd)",letterSpacing:".1em",color:"var(--acc2)",textTransform:"uppercase"}}>Your Placement</div>
                <table><tbody>{renderLbRow(myRow,true)}</tbody></table>
              </div>}
              {!myRow&&<div style={{background:"var(--surf2)",border:"1px solid var(--bdr)",borderRadius:6,padding:".75rem 1rem",marginBottom:".75rem",fontSize:".82rem",color:"var(--muted)"}}>
                {user.hideFromLeaderboard
                  ?"Your account is hidden from leaderboards. Uncheck \"Hide my account\" in account settings to appear."
                  :"You don't appear on this leaderboard yet — complete a scored run to get ranked."}
              </div>}
              <table><thead><tr>
                <th style={{textAlign:"center",whiteSpace:"nowrap"}}>Rank</th>
                <th>Operative</th>
                <th style={{textAlign:"right"}}>Score</th>
              </tr></thead><tbody>
                {pagedData.map(r=>renderLbRow(r))}
              </tbody></table>
              {!lbData.length&&<div className="empty"><div className="ei">🎯</div><p>No scores yet — be the first!</p></div>}
              {lbPlayerFilter==="friends"&&friendIds.size===0&&<div className="empty" style={{marginTop:".75rem"}}><div className="ei">👥</div><p style={{color:"var(--muted)",fontSize:".9rem",marginBottom:".5rem"}}>Well, this is awkward... You have no friends.</p><p style={{color:"var(--muted)",fontSize:".78rem"}}>Add some <button className="btn btn-s btn-sm" style={{display:"inline",padding:"1px 10px",fontSize:".78rem",verticalAlign:"middle"}} onClick={()=>setTab("social")}>HERE</button></p></div>}
              {totalPages>1&&<div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:".75rem",marginTop:"1rem",flexWrap:"wrap"}}>
                <button className="btn btn-s btn-sm" disabled={page<=1} onClick={()=>setLbPage(p=>p-1)}>← Prev</button>
                <span style={{fontSize:".82rem",color:"var(--muted)",fontFamily:"var(--fc)"}}>Page {page} of {totalPages} · {lbData.length} operatives</span>
                <button className="btn btn-s btn-sm" disabled={page>=totalPages} onClick={()=>setLbPage(p=>p+1)}>Next →</button>
              </div>}
            </div>;
          })()}
        </>;
      })()}

      {/* ── SHOP TAB ── */}
      {tab==="shop"&&<MerchPortal surface="storefront" currentUser={user} setPayments={setPayments} onAlert={onAlert}/>}

      {/* ── SOCIAL TAB ── */}
      {tab==="social"&&<SocialPortal
        user={user}
        users={users}
        setUsers={setUsers}
        reservations={reservations}
        resTypes={resTypes}
        runs={runs}
        careerRuns={careerRuns}
        onEditProfile={()=>setShowAccount(true)}
        onFriendsChanged={()=>setFriendsVersion(v=>v+1)}
      />}

    </div>
  );
}

function StaffPortal({user,reservations,setReservations,resTypes,users,setUsers,waiverDocs,activeWaiverDoc,shifts,setShifts,runs=[],onSignWaiver,onAddPlayer,onAlert,navTarget,onNavConsumed}){
  const [tab,setTab]=useState("today");
  const [schedTabOverride,setSchedTabOverride]=useState(null);
  const [showAccount,setShowAccount]=useState(false);
  const [careerRuns,setCareerRuns]=useState(null);
  const [friendsVersion,setFriendsVersion]=useState(0);
  const today=todayStr();
  const todayRes=[...reservations].filter(r=>r.date===today&&r.status!=="cancelled").sort((a,b)=>a.startTime.localeCompare(b.startTime));
  const upcoming=[...reservations].filter(r=>r.date>today&&r.status!=="cancelled").sort((a,b)=>a.date.localeCompare(b.date)||a.startTime.localeCompare(b.startTime)).slice(0,25);
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
      <div className="hero"><h2>{user.name}</h2></div>
      <div className="tabs">
        <button className={`tab${tab==="today"?" on":""}`} onClick={()=>setTab("today")}>Today ({todayRes.length})</button>
        <button className={`tab${tab==="upcoming"?" on":""}`} onClick={()=>setTab("upcoming")}>Upcoming</button>
        <button className={`tab${tab==="schedule"?" on":""}`} onClick={()=>setTab("schedule")}>My Schedule</button>
        <button className={`tab${tab==="social"?" on":""}`} onClick={()=>setTab("social")}>Social</button>
        <button className="btn btn-p btn-sm" style={{marginLeft:"auto",flexShrink:0}} onClick={()=>window.open(window.location.origin+window.location.pathname+"?ops=1","_blank")}>Operations ↗</button>
      </div>
      {(tab==="today"||tab==="upcoming")&&<>
        {!(tab==="today"?todayRes:upcoming).length&&<div className="empty"><div className="ei">{tab==="today"?"🎯":"📅"}</div><p>No {tab==="today"?"sessions today":"upcoming sessions"}.</p></div>}
        {!!(tab==="today"?todayRes:upcoming).length&&<div className="tw"><div className="th"><span className="ttl">{tab==="today"?"Today's Sessions":"Upcoming"}</span><span style={{fontSize:".74rem",color:"var(--muted)"}}>Click row to expand</span></div>
          <table><thead><tr><th>Customer / Date</th><th>Type</th><th>Players</th><th>Status</th></tr></thead>
            <tbody>{(tab==="today"?todayRes:upcoming).map(r=><ReservationRow key={r.id} res={r} resTypes={resTypes} users={users} waiverDocs={waiverDocs} activeWaiverDoc={activeWaiverDoc} canManage={true} currentUser={user} onAddPlayer={onAddPlayer} onSignWaiver={(uid,name)=>onSignWaiver(uid,name)} onRemovePlayer={async(resId,playerId)=>{try{await removePlayerFromReservation(playerId);setReservations(p=>p.map(r=>r.id===resId?{...r,players:r.players.filter(x=>x.id!==playerId)}:r));}catch(e){onAlert("Error removing player: "+e.message);}}} onReschedule={(user.access==='manager'||user.access==='admin')?async(resId,date,startTime)=>{try{const updated=await updateReservation(resId,{date,startTime,rescheduled:true});setReservations(p=>p.map(r=>r.id===resId?{...r,date:updated.date,startTime:updated.startTime,rescheduled:true}:r));}catch(e){onAlert("Error rescheduling: "+e.message);}}:undefined}/>)}</tbody>
          </table></div>}
      </>}
      {tab==="schedule"&&<SchedulePanel currentUser={user} shifts={shifts} setShifts={setShifts} users={users} isManager={false} onAlert={onAlert} tabOverride={schedTabOverride} onTabOverrideConsumed={()=>setSchedTabOverride(null)}/>}
      {tab==="social"&&<SocialPortal user={user} users={users} setUsers={setUsers} reservations={reservations} resTypes={resTypes} runs={runs} careerRuns={careerRuns} onEditProfile={()=>setShowAccount(true)} onFriendsChanged={()=>setFriendsVersion(v=>v+1)}/>}
    </div>
  );
}

function MergeAccountsModal({users,targetUser,reservations,onMerge,onClose}){
  const [query,setQuery]=useState("");
  const [selected,setSelected]=useState(null);
  const [saving,setSaving]=useState(false);
  const [err,setErr]=useState(null);
  const q=query.trim().toLowerCase();
  const options=users.filter(u=>
    u.id!==targetUser.id &&
    u.active!==false &&
    !u.name?.includes("[merged]") &&
    (q===""||u.name?.toLowerCase().includes(q)||u.phone?.includes(q))
  );
  const bookingCount=uid=>reservations.filter(r=>r.userId===uid).length;
  return(
    <div className="mo"><div className="mc">
      <div className="mt2">Merge Accounts</div>
      <div style={{background:"var(--surf2)",border:"1px solid var(--bdr)",borderRadius:5,padding:".65rem .9rem",marginBottom:"1rem",fontSize:".83rem"}}>
        Keeping: <strong style={{color:"var(--accB)"}}>{targetUser.name}</strong>
        {targetUser.authProvider&&<span style={{marginLeft:".5rem",color:"var(--muted)"}}>{targetUser.authProvider}</span>}
      </div>
      {!selected&&<>
        <div style={{fontSize:".78rem",color:"var(--muted)",marginBottom:".6rem"}}>Select the account to absorb. Its bookings, player records, and payments will move to <strong>{targetUser.name}</strong>, then it will be deactivated.</div>
        <div className="f"><label>Search by name or phone</label><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Type to filter…" autoFocus/></div>
        <div style={{maxHeight:220,overflowY:"auto",border:"1px solid var(--bdr)",borderRadius:5}}>
          {options.length===0&&<div style={{padding:"1rem",textAlign:"center",color:"var(--muted)",fontSize:".8rem"}}>No matching users</div>}
          {options.map(u=>(
            <div key={u.id} onClick={()=>setSelected(u)} style={{padding:".55rem .85rem",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:"1px solid var(--bdr)",background:"transparent"}} onMouseEnter={e=>e.currentTarget.style.background="var(--surf2)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <div>
                <div style={{fontWeight:600,fontSize:".88rem"}}>{u.name}</div>
                <div style={{fontSize:".75rem",color:"var(--muted)",fontFamily:"monospace"}}>{u.phone?`(${u.phone.slice(0,3)}) ${u.phone.slice(3,6)}-${u.phone.slice(6)}`:"—"}</div>
              </div>
              <div style={{display:"flex",gap:".4rem",alignItems:"center"}}>
                {u.authProvider&&<span style={{fontSize:".7rem",background:"var(--acc2)",color:"var(--accB)",padding:"2px 6px",borderRadius:99}}>{u.authProvider}</span>}
                <span style={{fontSize:".75rem",color:"var(--muted)"}}>{bookingCount(u.id)} booking{bookingCount(u.id)!==1?"s":""}</span>
              </div>
            </div>
          ))}
        </div>
      </>}
      {selected&&<>
        <div style={{background:"rgba(184,150,12,.06)",border:"1px solid var(--warn)",borderRadius:5,padding:".75rem .9rem",marginBottom:".75rem"}}>
          <div style={{fontWeight:600,marginBottom:".3rem"}}>Merge <span style={{color:"var(--warnL)"}}>{selected.name}</span> → <span style={{color:"var(--accB)"}}>{targetUser.name}</span>?</div>
          <div style={{fontSize:".8rem",color:"var(--muted)"}}>All of {selected.name}'s bookings ({bookingCount(selected.id)}), player records, and payments will transfer to {targetUser.name}.</div>
          <div style={{fontSize:".8rem",color:"var(--warnL)",marginTop:".3rem"}}>⚠ {selected.name}'s account will be deactivated and cannot be undone.</div>
        </div>
        {err&&<div style={{color:"var(--err)",fontSize:".8rem",marginBottom:".5rem"}}>{err}</div>}
      </>}
      <div className="ma">
        {selected?<>
          <button className="btn btn-s" onClick={()=>{setSelected(null);setErr(null);}}>← Back</button>
          <button className="btn btn-p" style={{background:"var(--err)",borderColor:"var(--err)"}} disabled={saving} onClick={async()=>{setSaving(true);setErr(null);try{await onMerge(targetUser.id,selected.id);}catch(e){setErr(e.message);setSaving(false);}}}>
            {saving?"Merging…":"Confirm Merge"}
          </button>
        </>:<>
          <button className="btn btn-s" onClick={onClose}>Cancel</button>
        </>}
      </div>
    </div></div>
  );
}

function DeactivateStaffModal({userToDeactivate,futureShifts,users,shifts,onConfirm,onCancel}){
  const [choice,setChoice]=useState('open');
  const [reassignTo,setReassignTo]=useState('');
  const [userRoles,setUserRoles]=useState([]);
  const [saving,setSaving]=useState(false);
  useEffect(()=>{fetchUserRoles().then(r=>setUserRoles(r)).catch(()=>{});},[]);
  const activeStaff=users.filter(u=>u.active&&u.id!==userToDeactivate.id&&['staff','manager','admin'].includes(u.access));
  function tmToMin(t){if(!t)return 0;const p=(t+'').split(':').map(Number);return p[0]*60+(p[1]||0);}
  function canFillRole(su,role){if(!role)return true;if(su.role===role)return true;return userRoles.some(r=>r.userId===su.id&&r.role===role);}
  function hasConflict(su,shift){return shifts.some(s=>{if(s.staffId!==su.id||s.id===shift.id||s.date!==shift.date)return false;return tmToMin(s.start)<tmToMin(shift.end)&&tmToMin(s.end)>tmToMin(shift.start);});}
  const target=reassignTo?users.find(u=>u.id===reassignTo):null;
  const assignable=target?futureShifts.filter(s=>canFillRole(target,s.role)&&!hasConflict(target,s)):[];
  const willOpen=choice==='open'?futureShifts.length:futureShifts.length-assignable.length;
  async function handleConfirm(){
    setSaving(true);
    try{
      const updates=futureShifts.map(s=>{
        if(choice==='reassign'&&target&&canFillRole(target,s.role)&&!hasConflict(target,s))
          return{id:s.id,staffId:target.id,open:false};
        return{id:s.id,staffId:null,open:true};
      });
      await onConfirm(updates);
    }finally{setSaving(false);}
  }
  return(
    <div className="mo"><div className="mc" style={{maxWidth:480}}>
      <div className="mt2">Handle Shifts — {userToDeactivate.name}</div>
      <p style={{fontSize:'.88rem',color:'var(--muted)',margin:'0 0 .75rem'}}>{futureShifts.length} upcoming assigned shift{futureShifts.length!==1?'s':''} must be handled before deactivating.</p>
      <div style={{display:'flex',flexDirection:'column',gap:'.5rem',marginBottom:'1rem'}}>
        <label style={{display:'flex',alignItems:'center',gap:'.5rem',cursor:'pointer',fontSize:'.88rem'}}>
          <input type="radio" name="dchoice" checked={choice==='open'} onChange={()=>{setChoice('open');setReassignTo('');}}/>
          Mark all {futureShifts.length} shifts as <strong style={{marginLeft:'.25rem'}}>Open</strong>
        </label>
        <label style={{display:'flex',alignItems:'center',gap:'.5rem',cursor:'pointer',fontSize:'.88rem'}}>
          <input type="radio" name="dchoice" checked={choice==='reassign'} onChange={()=>setChoice('reassign')}/>
          Reassign to another staff member
        </label>
      </div>
      {choice==='reassign'&&<>
        <div className="f"><label>Reassign to</label>
          <select value={reassignTo} onChange={e=>setReassignTo(e.target.value)}>
            <option value="">— select staff —</option>
            {activeStaff.map(u=><option key={u.id} value={u.id}>{u.name}{u.role?' ('+u.role+')':''}</option>)}
          </select>
        </div>
        {target&&<div style={{fontSize:'.8rem',color:'var(--muted)',marginBottom:'.75rem',padding:'.5rem .65rem',background:'var(--bg2)',borderRadius:'var(--r)',border:'1px solid var(--bdr)'}}>
          <strong style={{color:assignable.length?'var(--okB)':'var(--muted)'}}>{assignable.length}</strong> of {futureShifts.length} shifts will be assigned to {target.name}
          {willOpen>0&&<>, <strong style={{color:'var(--warn)'}}>{willOpen}</strong> will remain <strong>Open</strong> (role or time conflict)</>}.
        </div>}
      </>}
      <div className="ma">
        <button className="btn btn-s" onClick={onCancel}>Cancel</button>
        <button className="btn btn-warn" disabled={saving||(choice==='reassign'&&!reassignTo)} onClick={handleConfirm}>{saving?'Applying…':'Confirm & Deactivate'}</button>
      </div>
    </div></div>
  );
}

function AdminPortal({user,reservations,setReservations,resTypes,setResTypes,sessionTemplates,setSessionTemplates,waiverDocs,setWaiverDocs,activeWaiverDoc,users,setUsers,shifts,setShifts,payments,setPayments,onAlert,userAuthDates=[],runs=[],staffRoles=[]}){
  const [tab,setTab]=useState("dashboard");
  const [schedTabOverride,setSchedTabOverride]=useState(null);
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
  const [dashViewTab,setDashViewTab]=useState("bookings");
  const [acknowledgedFlags,setAcknowledgedFlags]=useState(()=>{try{return new Set(JSON.parse(localStorage.getItem("ack-flags")||"[]"))}catch{return new Set()}});
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
  const [resSubTab,setResSubTab]=useState("upcoming");
  const [showWI,setShowWI]=useState(false);
  const [wi,setWi]=useState({customerName:"",typeId:"coop-open",date:"",startTime:"",playerCount:1,status:"confirmed"});
  const sortTmpl=fn=>setSessionTemplates(p=>sortTemplates(typeof fn==="function"?fn(p):fn));
  const rtF=editRT||newRT;const setRTF=fn=>editRT?setEditRT(p=>({...(typeof fn==="function"?fn(p):fn)})):setNewRT(p=>({...(typeof fn==="function"?fn(p):fn)}));
  const stF=editST||newST;const setSTF=fn=>editST?setEditST(p=>({...(typeof fn==="function"?fn(p):fn)})):setNewST(p=>({...(typeof fn==="function"?fn(p):fn)}));
  const wF=editWaiver||newWaiver;const setWF=fn=>editWaiver?setEditWaiver(p=>({...(typeof fn==="function"?fn(p):fn)})):setNewWaiver(p=>({...(typeof fn==="function"?fn(p):fn)}));
  const canManageUser=u=>{if(isAdmin)return true;if(isManager)return u.access!=="admin";return false;};
  const saveRT=()=>{if(editRT)setResTypes(p=>p.map(rt=>rt.id===editRT.id?editRT:rt));else setResTypes(p=>[...p,{...newRT,id:`rt-${Date.now()}`,price:+newRT.price,maxPlayers:newRT.maxPlayers?+newRT.maxPlayers:null}]);showToast(editRT?"Updated":"Created");setModal(null);setEditRT(null);};
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
      const res=reservations.find(r=>r.id===resId);
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
            <label style={{display:"flex",alignItems:"center",gap:".5rem",marginBottom:".75rem",cursor:"pointer",fontSize:".82rem",color:"var(--muted)"}}>
              <input type="checkbox" checked={editUser.hideFromLeaderboard??false} onChange={e=>setEditUser(p=>({...p,hideFromLeaderboard:e.target.checked}))} style={{accentColor:"var(--accB)",width:15,height:15,flexShrink:0}}/>
              Hide from all leaderboards
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
      <div className="tabs">
        <button className={`tab${tab==="dashboard"?" on":""}`} onClick={()=>setTab("dashboard")}>Dashboard</button>
        <button className={`tab${tab==="social"?" on":""}`} onClick={()=>setTab("social")}>Social</button>
        <button className={`tab${tab==="reservations"?" on":""}`} onClick={()=>setTab("reservations")}>Reservations</button>
        {isManager&&<button className={`tab${tab==="customers"?" on":""}`} onClick={()=>setTab("customers")}>Customers{dupAlerts.length>0&&<span style={{background:"var(--danger)",color:"#fff",borderRadius:"50%",padding:"0 5px",fontSize:".65rem",marginLeft:".3rem"}}>{dupAlerts.length}</span>}</button>}
        {isAdmin&&<button className={`tab${tab==="types"?" on":""}`} onClick={()=>setTab("types")}>Res. Types</button>}
        {isAdmin&&<button className={`tab${tab==="sessions"?" on":""}`} onClick={()=>setTab("sessions")}>Sessions</button>}
        {isAdmin&&<button className={`tab${tab==="waivers"?" on":""}`} onClick={()=>setTab("waivers")}>Waivers</button>}
        <button className={`tab${tab==="staff"?" on":""}`} onClick={()=>setTab("staff")}>Staff</button>
        <button className={`tab${tab==="schedule"?" on":""}`} onClick={()=>setTab("schedule")}>Schedule{alertShifts.length>0&&<span style={{background:"var(--warn)",color:"var(--bg2)",borderRadius:"50%",padding:"0 5px",fontSize:".65rem",marginLeft:".3rem"}}>{alertShifts.length}</span>}</button>
        {isManager&&<button className={`tab${tab==="merchandise"?" on":""}`} onClick={()=>setTab("merchandise")}>Merchandise</button>}
        <button className="btn btn-p btn-sm" style={{marginLeft:"auto"}} onClick={()=>window.open(window.location.origin+window.location.pathname+"?ops=1","_blank")}>Operations ↗</button>
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
            const vizColor={V:"#dce3ef",C:"#a78bfa",R:"#f472b6",S:"#60a5fa",B:"#1a2533"};
            const vizExtra={B:{textShadow:"0 0 8px rgba(255,255,255,.9),0 0 18px rgba(255,255,255,.55),0 0 32px rgba(255,255,255,.2)"}};
            const audColor={O:"var(--muted)",T:"var(--accB)",C:"#f97316"};
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
              {isAdmin&&w.revenue&&(()=>{const coopRev=coopRes.reduce((s,r)=>s+r.amount,0);const vsRev=vsRes.reduce((s,r)=>s+r.amount,0);return<div className="stat-card"><div className="stat-lbl">Revenue</div><div className={`stat-val${revSzCls}`} style={{color:"var(--accB)"}}>{revStr}</div><div className="stat-sub">Co-Op {fmtMoney(coopRev)} · Versus {fmtMoney(vsRev)}</div></div>;})()}
              {w.bookings&&<div className="stat-card"><div className="stat-lbl">Bookings</div><div className="stat-val">{active.length}</div><div className="stat-sub">{coopRes.length} co-op · {vsRes.length} vs</div></div>}
              {w.players&&<div className="stat-card"><div className="stat-lbl">Avg / Lane</div><div className="stat-val">{fmt2(avgPerLane)}</div><div className="stat-sub">Priv Co-Op {fmt2(arrAvg(coopPrivLanes))} · Priv Vs {fmt2(arrAvg(vsPrivLanes))}</div><div className="stat-sub">Open Co-Op {fmt2(arrAvg(coopOpenLanes))} · Open Vs {fmt2(arrAvg(vsOpenLanes))}</div></div>}
              {isAdmin&&w.utilization&&<div className="stat-card"><div className="stat-lbl">Utilization</div><div className="stat-val" style={{color:utilPct===null?"var(--muted)":utilPct>=80?"var(--okB)":utilPct>=50?"var(--accB)":"var(--warnL)"}}>{utilPct!==null?utilPct+"%":"—"}</div><div className="stat-sub">{offeredSessions} sessions</div></div>}
              {isAdmin&&w.newUsers&&<div className="stat-card"><div className="stat-lbl">New Accounts</div><div className="stat-val">{newUsersInPeriod.length}</div><div className="stat-sub">{authedInPeriod.length} set up auth</div></div>}
              {w.leadTime&&<div className="stat-card"><div className="stat-lbl">Lead Time</div><div className="stat-val">{fmtLT(leadHours(active))}</div><div className="stat-sub">CP {fmtLT(leadHours(activeCoopPriv))} · VP {fmtLT(leadHours(activeVsPriv))}</div><div className="stat-sub">CO {fmtLT(leadHours(activeCoopOpen))} · VO {fmtLT(leadHours(activeVsOpen))}</div></div>}
              {w.envCoop&&(()=>{const tv=topViz(coopRuns);const ta=topAud(coopRuns);const vs={fontFamily:'var(--fd)',fontSize:'.95rem',fontWeight:700,lineHeight:1,whiteSpace:'nowrap'};return<div className="stat-card"><div className="stat-lbl">Env — Co-Op <span style={{fontWeight:400,opacity:.6}}>({coopRuns.length} runs)</span></div><div style={{display:'flex',alignItems:'baseline',justifyContent:'center',gap:'.35rem',margin:'.2rem 0 .15rem'}}>{tv?<span style={{...vs,color:vizColor[tv.code]??'var(--accB)',...(vizExtra[tv.code]||{})}}>{tv.name}</span>:<span style={{...vs,color:'var(--muted)'}}>—</span>}<span style={{color:'var(--muted)',fontSize:'.75rem'}}>·</span>{ta?<span style={{...vs,color:audColor[ta.code]??'var(--accB)'}}>{ta.name}</span>:<span style={{...vs,color:'var(--muted)'}}>—</span>}</div><div className="stat-sub" style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>Viz: {vizLineS(coopRuns)}</div><div className="stat-sub" style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>Aud: {audLineS(coopRuns)}</div></div>;})()}
              {w.envVs&&(()=>{const tv=topViz(vsRuns);const ta=topAud(vsRuns);const vs={fontFamily:'var(--fd)',fontSize:'.95rem',fontWeight:700,lineHeight:1,whiteSpace:'nowrap'};return<div className="stat-card"><div className="stat-lbl">Env — Versus <span style={{fontWeight:400,opacity:.6}}>({vsRuns.length} runs)</span></div><div style={{display:'flex',alignItems:'baseline',justifyContent:'center',gap:'.35rem',margin:'.2rem 0 .15rem'}}>{tv?<span style={{...vs,color:vizColor[tv.code]??'var(--accB)',...(vizExtra[tv.code]||{})}}>{tv.name}</span>:<span style={{...vs,color:'var(--muted)'}}>—</span>}<span style={{color:'var(--muted)',fontSize:'.75rem'}}>·</span>{ta?<span style={{...vs,color:audColor[ta.code]??'var(--accB)'}}>{ta.name}</span>:<span style={{...vs,color:'var(--muted)'}}>—</span>}</div><div className="stat-sub" style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>Viz: {vizLineS(vsRuns)}</div><div className="stat-sub" style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>Aud: {audLineS(vsRuns)}</div></div>;})()}
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
              <button style={tabBtnStyle(dashViewTab==="runs")} onClick={()=>setDashViewTab("runs")}>Runs <span style={{opacity:.65}}>({recentRuns.length})</span></button>
              <button style={tabBtnStyle(dashViewTab==="users")} onClick={()=>setDashViewTab("users")}>New Users <span style={{opacity:.65}}>({recentUsers.length})</span></button>
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

            {dashViewTab==="runs"&&<>
              <table><thead><tr><th>Scored</th><th>Customer</th><th>Session</th><th>Visual</th><th>Audio</th><th>Time</th><th>Score</th></tr></thead>
                <tbody>{!recentRuns.length&&<tr><td colSpan={7} style={{textAlign:"center",color:"var(--muted)",padding:"2.5rem"}}>No runs in last 30 days.</td></tr>}
                {recentRuns.map(r=>{const res=resMap[r.reservationId];const rt=res?getType(res.typeId):null;return <tr key={r.id}>
                  <td style={{fontSize:".76rem",color:"var(--muted)",whiteSpace:"nowrap"}}>{r.createdAt?fmt(r.createdAt.slice(0,10)):""}<br/>{r.createdAt?new Date(r.createdAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):""}</td>
                  <td><div>{res?.customerName||"—"}</div><div style={{fontSize:".72rem",color:"var(--muted)"}}>{res?`${fmt(res.date)} ${fmt12(res.startTime)}`:""}</div></td>
                  <td>{rt&&<><span className={`badge b-${rt.mode}`} style={{marginRight:".3rem"}}>{rt.mode}</span><span className={`badge b-${rt.style}`}>{rt.style}</span></>}</td>
                  <td style={{fontSize:".82rem"}}>{vizLabel[r.visual]||r.visual||"—"}</td>
                  <td style={{fontSize:".82rem"}}>{audLabel(r)}</td>
                  <td style={{fontFamily:"var(--fd)",color:"var(--accB)"}}>{fmtRunSec(r.elapsedSeconds)}</td>
                  <td style={{fontFamily:"var(--fd)",fontWeight:700,color:r.score!=null?"var(--txt)":"var(--muted)"}}>{r.score!=null?Number(r.score).toFixed(1):"—"}</td>
                </tr>;})}
                </tbody>
              </table>
            </>}

            {dashViewTab==="flags"&&<>
              {!visibleFlagRows.length&&<div style={{textAlign:"center",color:"var(--muted)",padding:"2.5rem .5rem"}}>{flagRows.length>0?"All flags acknowledged.":"No unpaid, cancelled, or no-show reservations to show."}</div>}
              {!!visibleFlagRows.length&&<table><thead><tr><th>Session</th><th>Booked</th><th>Customer</th><th>Type</th><th>Players</th>{isAdmin&&<th>Amount</th>}<th>Flag</th><th></th></tr></thead>
                <tbody>{visibleFlagRows.map(r=>{const rt=getType(r.typeId);const fb=flagBadge(r._flag);return <tr key={r.id+r._flag}>
                  <td><strong style={{fontSize:".88rem"}}>{fmt(r.date)}</strong><br/><span style={{fontSize:".76rem",color:"var(--muted)"}}>{fmt12(r.startTime)}</span></td>
                  <td style={{fontSize:".76rem",color:"var(--muted)",whiteSpace:"nowrap"}}>{r.createdAt?fmt(r.createdAt.slice(0,10)):""}<br/>{r.createdAt?new Date(r.createdAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):""}</td>
                  <td>{r.customerName}</td>
                  <td>{rt&&<><span className={`badge b-${rt.mode}`} style={{marginRight:".3rem"}}>{rt.mode}</span><span className={`badge b-${rt.style}`}>{rt.style}</span></>}</td>
                  <td>{r.playerCount}</td>
                  {isAdmin&&<td style={{color:"var(--accB)",fontWeight:600}}>{fmtMoney(r.amount)}</td>}
                  <td><span style={{fontSize:".75rem",padding:".2rem .55rem",borderRadius:4,fontWeight:700,background:fb.bg,color:fb.color}}>{fb.label}</span></td>
                  <td><button onClick={()=>ackFlag(r.id+r._flag)} style={{fontSize:".72rem",padding:".2rem .55rem",borderRadius:4,border:"1px solid var(--bdr)",background:"var(--surf2)",color:"var(--muted)",cursor:"pointer"}}>Acknowledge</button></td>
                </tr>;})}
                </tbody>
              </table>}
              <div style={{fontSize:".72rem",color:"var(--muted)",padding:".6rem .8rem",borderTop:"1px solid var(--bdr)",marginTop:".25rem"}}>
                Unpaid: all-time active bookings. Rescheduled, cancelled &amp; no-show: last 90 days.
              </div>
            </>}

            {dashViewTab==="users"&&<>
              <table><thead><tr><th>Created</th><th>Name</th><th>Phone</th><th>Access</th><th>Auth</th><th>Created By</th></tr></thead>
                <tbody>{!recentUsers.length&&<tr><td colSpan={6} style={{textAlign:"center",color:"var(--muted)",padding:"2.5rem"}}>No new users in last 30 days.</td></tr>}
                {recentUsers.map(u=>{const creator=u.createdByUserId?userById[u.createdByUserId]:null;return <tr key={u.id}>
                  <td style={{fontSize:".76rem",color:"var(--muted)",whiteSpace:"nowrap"}}>{fmt(u.createdAt.slice(0,10))}<br/>{new Date(u.createdAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</td>
                  <td><strong>{u.name||"—"}</strong><div style={{fontSize:".72rem",color:"var(--muted)"}}>{u.email||""}</div></td>
                  <td style={{fontFamily:"monospace",fontSize:".83rem"}}>{fmtPhone(u.phone)}</td>
                  <td><span className={`badge al-${u.access}`}>{ACCESS_LEVELS[u.access]?.label||u.access}</span></td>
                  <td><AuthBadge provider={u.authProvider}/></td>
                  <td style={{fontSize:".82rem"}}>{creator?<span title={creator.email||""}>{creator.name}</span>:<span style={{color:"var(--muted)",fontStyle:"italic"}}>{u.createdByUserId?"Unknown":"Self / System"}</span>}</td>
                </tr>;})}
                </tbody>
              </table>
            </>}
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


function CompleteProfile({user,onComplete,onSignOut}){
  const [phone,setPhone]=useState("");
  const [name,setName]=useState(user.name||"");
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState(null);
  const clean=cleanPh(phone);
  const canSave=name.trim().length>=2&&clean.length===10;

  const handleSave=async()=>{
    if(!canSave)return;
    setSaving(true);setError(null);
    try{await onComplete({name:name.trim(),phone:clean});}
    catch(err){setError(err.message);setSaving(false);}
  };

  return(
    <div className="login-wrap"><div className="login-grid"/>
      <div className="login-card">
        <img src={LOGO_URI} className="login-logo" alt="Sector 317"/>
        <div className="login-divider"/>
        <div style={{textAlign:"center",marginBottom:"1.25rem"}}>
          <div style={{fontFamily:"var(--fd)",fontSize:"1.1rem",fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",color:"var(--accB)",marginBottom:".35rem"}}>Welcome to Sector 317!</div>
          <div style={{fontSize:".84rem",color:"var(--muted)"}}>Just a couple things before you dive in.</div>
        </div>
        <div style={{background:"var(--surf)",border:"1px solid var(--acc2)",borderLeft:"4px solid var(--acc)",borderRadius:6,padding:".85rem 1rem",marginBottom:"1.25rem",fontSize:".82rem",color:"var(--muted)"}}>
          Signed in as <strong style={{color:"var(--txt)"}}>{user.name}</strong> via <strong style={{color:"var(--accB)"}}>{user.authProvider}</strong>
        </div>
        <div className="f">
          <label>Full Name <span style={{color:"var(--dangerL)"}}>*</span></label>
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="First Last" autoFocus/>
          <div style={{fontSize:".72rem",color:"var(--muted)",marginTop:".25rem"}}>This is how staff will greet you at check-in</div>
        </div>
        <div className="f">
          <label>Mobile Number <span style={{color:"var(--dangerL)"}}>*</span></label>
          <PhoneInput value={phone} onChange={setPhone} onEnter={handleSave}/>
          <div style={{fontSize:".72rem",color:"var(--muted)",marginTop:".25rem"}}>Used for check-in and group management. Never shared.</div>
        </div>
        {name.trim()&&clean.length===10&&<div style={{fontSize:".72rem",color:"var(--muted)",background:"var(--surf2)",border:"1px solid var(--bdr)",borderRadius:4,padding:".5rem .75rem",marginBottom:".75rem"}}>
          🏆 Your leaderboard name will be <strong style={{color:"var(--accB)"}}>{genDefaultLeaderboardName(name.trim(),clean)}</strong> — you can change it later in account settings.
        </div>}
        {error&&<div style={{background:"rgba(239,68,68,.1)",border:"1px solid var(--danger)",borderRadius:5,padding:".6rem .85rem",fontSize:".8rem",color:"var(--dangerL)",marginBottom:".75rem"}}>⚠ {error}</div>}
        <button className="btn btn-p btn-full" disabled={!canSave||saving} onClick={handleSave} style={{marginBottom:".65rem"}}>{saving?"Saving…":"Complete Setup →"}</button>
        <button className="btn btn-s btn-full" style={{fontSize:".8rem",textTransform:"none"}} onClick={onSignOut}>← Sign out and use a different account</button>
        <div className="sms-note" style={{marginTop:".85rem"}}>Your information is private and secure.</div>
      </div>
    </div>
  );
}

function LoginScreen({onLogin}){
  const [pending,setPending]=useState(null);
  const [authError,setAuthError]=useState(null);

  const socialProviders=[
    {id:"google",  provider:"google", label:"Continue with Google",
      icon:<svg viewBox="0 0 24 24" width="20" height="20" style={{flexShrink:0}}><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>},
    {id:"microsoft",provider:"azure",  label:"Continue with Microsoft",
      icon:<svg viewBox="0 0 24 24" width="20" height="20" style={{flexShrink:0}}><rect x="1" y="1" width="10.5" height="10.5" fill="#F25022"/><rect x="12.5" y="1" width="10.5" height="10.5" fill="#7FBA00"/><rect x="1" y="12.5" width="10.5" height="10.5" fill="#00A4EF"/><rect x="12.5" y="12.5" width="10.5" height="10.5" fill="#FFB900"/></svg>},
  ];

  const doSocial=async(id,provider)=>{
    setAuthError(null);setPending(id);
    const {error}=await supabase.auth.signInWithOAuth({provider,options:{redirectTo:"https://www.sector317.com"}});
    if(error){setAuthError(error.message);setPending(null);}
  };

  return(
    <div className="login-wrap"><div className="login-grid"/>
      <div className="login-card">
        <img src={LOGO_URI} className="login-logo" alt="Sector 317"/>
        <div className="login-divider"/>
        <div className="step-label">Sign in to access your account</div>
        {socialProviders.map(p=>(
          <button key={p.id} className="btn btn-s btn-full" disabled={!!pending}
            style={{display:"flex",alignItems:"center",justifyContent:"center",gap:".65rem",marginBottom:".65rem",padding:".75rem 1.1rem",fontSize:".85rem",letterSpacing:".03em",textTransform:"none"}}
            onClick={()=>doSocial(p.id,p.provider)}>
            {pending===p.id
              ?<span style={{fontSize:".8rem",color:"var(--muted)"}}>Redirecting to {p.id}…</span>
              :<>{p.icon}<span>{p.label}</span></>}
          </button>
        ))}
        {authError&&<div style={{background:"rgba(239,68,68,.1)",border:"1px solid var(--danger)",borderRadius:5,padding:".6rem .85rem",fontSize:".8rem",color:"var(--dangerL)",marginBottom:".5rem"}}>⚠ {authError}</div>}
        <div style={{marginTop:"1rem",fontSize:".75rem",color:"var(--muted)",textAlign:"center",lineHeight:1.5}}>
          New here? Sign in above to create your account. Staff access is managed by your administrator.
        </div>
        <div className="sms-note" style={{marginTop:".85rem"}}>Your data is secured and never shared.</div>
      </div>
    </div>
  );
}

export default function App(){
  const [showLanding,setShowLanding]=useState(!new URLSearchParams(window.location.search).has('login'));
  const [bookOnLogin,setBookOnLogin]=useState(false);
  const [currentUser,setCurrentUser]=useState(null);
  const [pendingUser,setPendingUser]=useState(null); // user who logged in but needs phone
  const [staffRoles,setStaffRoles]=useState([]);
  const [resTypes,setResTypes]=useState([]);
  const [sessionTemplates,setSessionTemplates]=useState([]);
  const [reservations,setReservations]=useState([]);
  const [users,setUsers]=useState([]);
  const [waiverDocs,setWaiverDocs]=useState([]);
  const [shifts,setShifts]=useState([]);
  const [payments,setPayments]=useState([]);
  const [runs,setRuns]=useState([]);
  const [userAuthDates,setUserAuthDates]=useState([]);
  const [loading,setLoading]=useState(true);
  const paymentGroups=useRef({}); // tracks paymentGroupId → true to prevent duplicate payment records
  const [dbError,setDbError]=useState(null);
  const [toastAlert,setToastAlert]=useState(null);
  const activeWaiver=waiverDocs.find(d=>d.active);
  const showToast=msg=>{setToastAlert(msg);setTimeout(()=>setToastAlert(null),5000);};

 // ── Load PUBLIC reference data on mount (safe for anon)
useEffect(() => {
  (async () => {
    try {
      const [w, rt, st, sr] = await Promise.all([
        fetchWaiverDocs(),
        fetchResTypes(),
        fetchSessionTemplates(),
        fetchStaffRoles(),
      ]);

      setWaiverDocs(w);
      setResTypes(rt);
      setSessionTemplates(sortTemplates(st));
      setStaffRoles(sr);
      setLoading(false);
    } catch (err) {
      console.error("DB load error:", err);
      setDbError(err.message);
      setLoading(false);
    }
  })();
}, []);

// ── Load PRIVATE data only after auth/app user exists
useEffect(() => {
  if (!currentUser) return; // must be logged into the app first

  (async () => {
    try {
      const [u, res, sh, pmt] = await Promise.all([
        fetchAllUsers(),
        fetchReservations(),
        fetchShifts(),
        fetchPayments(),
      ]);

      setUsers(u);
      setReservations(res);
      setShifts(sh);
      setPayments(pmt);
      // Load runs + auth dates in background — non-blocking for dashboard widgets
      fetchRunsForReservations(res.map(r=>r.id)).then(setRuns).catch(()=>{});
      fetchUserAuthDates().then(setUserAuthDates).catch(()=>{});
    } catch (err) {
      console.error("Private DB load error:", err);
      showToast("Data load error: " + err.message);
    }
  })();
}, [currentUser?.id]);

  // ── Listen for Supabase OAuth callback (runs after redirect back from Google/Microsoft)
  useEffect(()=>{
    // Check for existing session on page load (handles OAuth redirect return)
    supabase.auth.getSession().then(({data:{session}})=>{
      if(session?.user){handleOAuthSession(session);}
    });
    // Subscribe to future auth state changes (sign in / sign out)
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,session)=>{
      if(session?.user){handleOAuthSession(session);}
    });
    return()=>subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  const handleOAuthSession = async (session) => {
  if (currentUser) return; // already logged in
  if (!session?.user) return; // no auth user (anon / landing page)

  const { user: authUser } = session;

  // Extra safety: if this ever fires on landing page without a real session, bail out.
  const { data: { session: liveSession } } = await supabase.auth.getSession();
  if (!liveSession?.user) return;

  const provider =
    authUser.app_metadata?.provider === "azure"
      ? "microsoft"
      : authUser.app_metadata?.provider || "google";

  const name =
    authUser.user_metadata?.full_name ||
    authUser.user_metadata?.name ||
    authUser.email?.split("@")[0] ||
    "Player";

  const email = authUser.email || "";

  try {
    // Look for existing app user matched by email or supabase auth id (local cache only)
    let found = users.find((u) => u.email === email || u.authId === authUser.id);

    // IMPORTANT: Do NOT query public.users unless authenticated (landing page is anon)
    if (!found) {
      // Prefer auth_id (authoritative). Email lookup is optional fallback.
      let byAuthId = null;

      const { data: authRow, error: authErr } = await supabase
        .from("users")
        .select("*")
        .eq("auth_id", authUser.id)
        .maybeSingle();

      if (authErr) throw authErr;
      if (authRow) {
        byAuthId = authRow;
      } else if (email) {
        // Optional fallback: email match (only runs after authenticated guard above)
        const { data: byEmail, error: emailErr } = await supabase
          .from("users")
          .select("*")
          .eq("email", email)
          .maybeSingle();

        if (emailErr) throw emailErr;
        if (byEmail) byAuthId = byEmail;
      }

      if (byAuthId) {
        found = {
          ...byAuthId,
          authProvider: byAuthId.auth_provider,
          needsRewaiverDocId: byAuthId.needs_rewaiver_doc_id,
          waivers: byAuthId.waivers ?? [],
          authId: byAuthId.auth_id ?? byAuthId.authId, // normalize
        };
      }
    }

    if (found) {
      // Kiosk session leaked into main app — sign out silently and bail
      if (found.access === 'kiosk') {
        await supabase.auth.signOut();
        return;
      }

      // Existing user — store auth_id and email for faster future lookups, then log in
      const updates = {};
      if (!found.authId && authUser.id) updates.authId = authUser.id;
      if (!found.email && email) updates.email = email;
      if (found.authProvider !== provider) updates.authProvider = provider;

      if (Object.keys(updates).length) {
        // Use SECURITY DEFINER RPC — bypasses RLS for the case where auth_id is not yet set
        found = await linkOAuthUser(found.id, updates.authId ?? found.authId, updates.email ?? found.email, updates.authProvider ?? found.authProvider);
        setUsers((prev) => prev.map((u) => (u.id === found.id ? found : u)));
      }

      setCurrentUser(found);
    } else {
      // New OAuth user — only show CompleteProfile if they don't have a phone yet
      // Let the profile completion flow create/link the public.users record.
      setPendingUser({ name, email, authProvider: provider, authId: authUser.id });
    }
  } catch (err) {
    console.error("OAuth session error:", err);
    showToast("Sign-in error: " + (err?.message || String(err)));
  }
};

  const handleLogin=async user=>{
    try{
      // Try to find existing user by id or phone
      let found=users.find(u=>u.id===user.id);
      if(!found&&user.phone){found=await fetchUserByPhone(user.phone);}
      if(found){
        // Update authProvider if changed
        if(user.authProvider&&found.authProvider!==user.authProvider){
          found=await updateUser(found.id,{authProvider:user.authProvider});
          setUsers(prev=>prev.map(u=>u.id===found.id?found:u));
        }
        // Existing user with phone — go straight in
        setCurrentUser(found);
      } else {
        // New social login — check if they have a phone number
        if(!user.phone){
          // No phone — show CompleteProfile screen before creating DB record
          setPendingUser(user);
        } else {
          // Has phone (demo/staff login) — create and go in
          const newUser=await createUser({...user,waivers:[],needsRewaiverDocId:null});
          setUsers(prev=>[...prev,newUser]);
          setCurrentUser(newUser);
        }
      }
    }catch(err){
      console.error("Login error:",err);
      showToast("Login error: "+err.message);
    }
  };

  const handleCompleteProfile=async({name,phone})=>{
    try{
      const existing=await fetchUserByPhone(phone);
      if(existing){
        // Phone already in system — link social auth to that guest account via SECURITY DEFINER RPC
        // (direct updateUser is blocked by RLS because the guest row has auth_id = null)
        const merged=await linkAuthToGuest(
          existing.id,
          pendingUser.authId||existing.authId,
          pendingUser.email||existing.email||'',
          pendingUser.authProvider||'',
        );
        setUsers(prev=>prev.map(u=>u.id===merged.id?merged:u));
        setCurrentUser(merged);
      } else {
        // Brand new — create with auto-generated leaderboard name
        const defaultLbName=genDefaultLeaderboardName(name,phone);
        const newUser=await createUser({
          name,phone,
          email:pendingUser.email||null,
          authId:pendingUser.authId||null,
          access:"customer",
          authProvider:pendingUser.authProvider,
          leaderboardName:defaultLbName,
          waivers:[],
          needsRewaiverDocId:null,
        });
        setUsers(prev=>[...prev,newUser]);
        setCurrentUser(newUser);
        if(newUser.email) emailWelcome(newUser.id);
      }
      setPendingUser(null);
    }catch(err){throw err;}
  };

  const handleBook=async b=>{
    try{
      const p1=b.player1||{userId:currentUser.id,name:currentUser.name};
      // Resolve guest users for extra players (throws on failure — no silent fallback)
      const resolveExtra=async(p)=>{
        if(p.userId) return {userId:p.userId,name:p.name||(users.find(u=>u.id===p.userId)?.name||"")};
        if(!p.name?.trim()) return null;
        const guest=await createGuestUser({name:p.name.trim(),phone:p.phone||null,createdByUserId:currentUser.id});
        return {userId:guest.id,name:guest.name};
      };
      const extraResolved=(await Promise.all((b.extraPlayers||[]).filter(p=>p.phone||p.name).map(resolveExtra))).filter(Boolean);
      const players=[p1,...extraResolved];
      const newRes=await createReservation({...b,status:"confirmed",players:[]});
      // Insert players — await all so failures surface immediately
      const savedPlayers=await Promise.all(players.map(p=>addPlayerToReservation(newRes.id,p)));
      // Use actual DB rows (with real IDs) so local state matches reload
      setReservations(p=>[{...newRes,players:savedPlayers},...p]);
      // Create ONE payment record per checkout transaction (group). Multi-lane bookings
      // share a paymentGroupId — only the first reservation in the group creates the record.
      const groupId=b.paymentGroupId;
      const alreadyCreated=groupId&&paymentGroups.current[groupId];
      if(!alreadyCreated){
        try{
          const rt=resTypes.find(x=>x.id===newRes.typeId);
          const totalAmt=b.totalTransactionAmount??newRes.amount;
          const snapshot={
            customerName: newRes.customerName,
            sessionType:  rt?.name??'—',
            mode:         rt?.mode??'—',
            style:        rt?.style??'—',
            date:         newRes.date,
            startTime:    newRes.startTime,
            playerCount:  b.totalPlayerCount??newRes.playerCount,
            amount:       totalAmt,
            status:       newRes.status,
            paid:         newRes.paid,
            refNum:       newRes.id.replace(/-/g,'').slice(0,12).toUpperCase(),
            transactionAt:new Date().toISOString(),
            cardLast4:    b.cardLast4??null,
            cardExpiry:   b.cardExpiry??null,
            cardHolder:   b.cardHolder??null,
          };
          const pmt=await createPayment({userId:currentUser.id,reservationId:newRes.id,customerName:newRes.customerName,amount:totalAmt,status:'paid',snapshot});
          setPayments(prev=>[pmt,...prev]);
          if(groupId) paymentGroups.current[groupId]=true;
        }catch(pmtErr){console.warn("Payment record error:",pmtErr.message);}
      }
    }catch(err){showToast("Booking error: "+err.message);}
  };

  // Creates reservations + payment immediately at Pay click (no players yet)
  const handlePayCreate=async({bookings,userId,customerName,paymentGroupId,totalTransactionAmount,totalPlayerCount,cardLast4,cardExpiry,cardHolder,creditsApplied=0})=>{
    const created=[];
    for(const b of bookings){
      const newRes=await createReservation({typeId:b.typeId,userId,customerName,date:b.date,startTime:b.startTime,playerCount:b.playerCount,amount:b.amount,status:"confirmed",paid:true,players:[]});
      setReservations(p=>[{...newRes,players:[]},...p]);
      created.push({startTime:b.startTime,laneIdx:b.laneIdx,resId:newRes.id});
    }
    if(created.length>0&&!paymentGroups.current[paymentGroupId]){
      try{
        const rt=resTypes.find(x=>x.id===bookings[0].typeId);
        const snapshot={customerName,sessionType:rt?.name??'—',mode:rt?.mode??'—',style:rt?.style??'—',date:bookings[0].date,startTime:bookings[0].startTime,playerCount:totalPlayerCount,amount:totalTransactionAmount,status:'confirmed',paid:true,refNum:created[0].resId.replace(/-/g,'').slice(0,12).toUpperCase(),transactionAt:new Date().toISOString(),cardLast4:cardLast4??null,cardExpiry:cardExpiry??null,cardHolder:cardHolder??null};
        const pmt=await createPayment({userId,reservationId:created[0].resId,customerName,amount:totalTransactionAmount,status:'paid',snapshot});
        setPayments(prev=>[pmt,...prev]);
        paymentGroups.current[paymentGroupId]=true;
        if(creditsApplied>0){
          try{
            const newBal=await deductUserCredits(userId,creditsApplied);
            setUsers(prev=>prev.map(u=>u.id===userId?{...u,credits:newBal}:u));
          }catch(credErr){console.warn("Credits deduction error:",credErr.message);}
        }
      }catch(pmtErr){console.warn("Payment record error:",pmtErr.message);}
    }
    return created;
  };

  // Adds players to pre-created reservations after Set Team step
  const handleFinalize=async(playerItems)=>{
    for(const item of playerItems){
      const resolveExtra=async(p)=>{
        if(p.userId) return {userId:p.userId,name:p.name||(users.find(u=>u.id===p.userId)?.name||''),team:p.team??null};
        if(!p.name?.trim()) return null;
        const guest=await createGuestUser({name:p.name.trim(),phone:p.phone||null,createdByUserId:currentUser.id});
        return {userId:guest.id,name:guest.name,team:p.team??null};
      };
      const resolved=(await Promise.all(item.players.map(resolveExtra))).filter(Boolean);
      const saved=await Promise.all(resolved.map(p=>addPlayerToReservation(item.resId,p)));
      setReservations(p=>p.map(r=>r.id===item.resId?{...r,players:[...(r.players||[]),...saved]}:r));
    }
  };

  const handleSignWaiver=async(uid,name)=>{
    try{
      await signWaiver(uid,name,activeWaiver?.id);
      const ts=new Date().toISOString();
      const entry={signedAt:ts,signedName:name,waiverDocId:activeWaiver?.id};
      const addEntry=u=>({...u,waivers:[...(u.waivers||[]),entry],needsRewaiverDocId:null});
      setUsers(p=>p.map(u=>u.id===uid?addEntry(u):u));
      setCurrentUser(u=>u&&u.id===uid?addEntry(u):u);
    }catch(err){showToast("Waiver error: "+err.message);}
  };

  const handleAddPlayer=async(resId,player)=>{
    try{
      const newPlayer=await addPlayerToReservation(resId,player);
      setReservations(p=>p.map(r=>r.id===resId?{...r,players:[...(r.players||[]),newPlayer]}:r));
    }catch(err){showToast("Error adding player: "+err.message);}
  };

  const handleSetResTypes=async(updater)=>{
    const next=typeof updater==="function"?updater(resTypes):updater;
    setResTypes(next);
    // Sync any upserted items back to DB (caller is responsible for calling upsertResType directly for new/edited)
  };

  const handleSetSessionTemplates=async(updater)=>{
    const next=sortTemplates(typeof updater==="function"?updater(sessionTemplates):updater);
    setSessionTemplates(next);
  };

  const handleSetWaiverDocs=async(updater)=>{
    const next=typeof updater==="function"?updater(waiverDocs):updater;
    setWaiverDocs(next);
  };

  const handleSetUsers=async(updater)=>{
    const next=typeof updater==="function"?updater(users):updater;
    setUsers(next);
  };

  const handleSetReservations=async(updater)=>{
    const next=typeof updater==="function"?updater(reservations):updater;
    setReservations(next);
  };

  const handleSetShifts=async(updater)=>{
    const next=typeof updater==="function"?updater(shifts):updater;
    setShifts(next);
  };

  const handleAlert=msg=>{setToastAlert(msg);setTimeout(()=>setToastAlert(null),5000);};
  const liveUser=users.find(u=>u.id===currentUser?.id)||currentUser;
  const portal=!liveUser?null:liveUser.access==="customer"?"customer":liveUser.access==="staff"?"staff":"admin";
  const [viewAs,setViewAs]=useState(null); // null | "manager" | "staff" | "customer"
  const [viewAsOpen,setViewAsOpen]=useState(false);
  const [navMenuOpen,setNavMenuOpen]=useState(false);
  const [staffNavTarget,setStaffNavTarget]=useState(null);
  const isAdminOrManager=liveUser&&(liveUser.access==="admin"||liveUser.access==="manager");
  const canViewAs=liveUser&&(isAdminOrManager||liveUser.access==="staff");
  const effectivePortal=viewAs?(viewAs==="customer"?"customer":viewAs==="staff"?"staff":"admin"):portal;
  const effectiveUser=viewAs?{...liveUser,access:viewAs}:liveUser;
  const [showNavAccount,setShowNavAccount]=useState(false);
  const [showBackTop,setShowBackTop]=useState(false);
  const contentRef=useRef(null);
  useEffect(()=>{
    const handler=()=>{
      const el=document.querySelector('.content');
      if(el)setShowBackTop(el.scrollTop>300);
    };
    const el=document.querySelector('.content');
    el?.addEventListener('scroll',handler,{passive:true});
    return()=>el?.removeEventListener('scroll',handler);
  },[liveUser]);

  if(window.location.pathname==='/kiosk')return <><KioskPage/></>;

  if(loading)return(
    <>
    <div style={{minHeight:"100vh",background:"var(--bg)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:"1.5rem"}}>
      <img src={LOGO_URI} style={{height:80,opacity:.85}} alt="Sector 317"/>
      <div style={{width:48,height:48,border:"3px solid var(--bdr)",borderTop:"3px solid var(--acc)",borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div></>
  );

  if(dbError)return(
    <>
    <div style={{minHeight:"100vh",background:"var(--bg)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:"1rem",padding:"2rem",textAlign:"center"}}>
      <img src={LOGO_URI} style={{height:60,opacity:.7}} alt="Sector 317"/>
      <div style={{color:"var(--dangerL)",fontFamily:"var(--fd)",fontSize:"1.1rem",fontWeight:700}}>Database Connection Error</div>
      <div style={{color:"var(--muted)",fontSize:".85rem",maxWidth:400}}>{dbError}</div>
      <div style={{color:"var(--muted)",fontSize:".78rem",maxWidth:400,background:"var(--surf)",border:"1px solid var(--bdr)",borderRadius:6,padding:"1rem",textAlign:"left"}}>
        <strong style={{color:"var(--txt)"}}>Check:</strong><br/>
        1. VITE_SUPABASE_URL is set in Vercel Environment Variables<br/>
        2. VITE_SUPABASE_ANON_KEY is set in Vercel Environment Variables<br/>
        3. Tables exist in Supabase (run the schema SQL)
      </div>
      <button className="btn btn-s" onClick={()=>window.location.reload()}>Retry</button>
    </div></>
  );

  if(showLanding&&!currentUser&&!pendingUser)return <LandingPage resTypes={resTypes} onEnterApp={()=>setShowLanding(false)} onBookNow={()=>{setBookOnLogin(true);setShowLanding(false);}}/>;
  if(pendingUser)return <><CompleteProfile user={pendingUser} onComplete={handleCompleteProfile} onSignOut={()=>{setPendingUser(null);setShowLanding(true);}}/></>;
  if(!liveUser)return <><LoginScreen onLogin={handleLogin}/></>;

  // ── Standalone Ops window (opened via Operations ↗ button) ───────────────
  const isOpsWindow = new URLSearchParams(window.location.search).has('ops')
  if(isOpsWindow && portal !== 'customer'){
    return(<>
      
      <div className="app">
        <nav className="nav">
          <div className="nav-brand"><img src={LOGO_URI} className="nav-logo" alt="Sector 317"/><span style={{fontSize:".7rem",color:"var(--muted)",marginLeft:".4rem",alignSelf:"flex-end",paddingBottom:2}}>v{APP_VERSION}</span></div>
          <div className="nav-right">
            <span className="nav-user">{liveUser.name}</span>
            {liveUser.authProvider&&<AuthBadge provider={liveUser.authProvider}/>}
            <span className={`nbadge al-${liveUser.access}`}>{ACCESS_LEVELS[liveUser.access]?.label}</span>
            <button className="nbtn" onClick={async()=>{await supabase.auth.signOut();window.close();}}>Sign Out</button>
          </div>
        </nav>
        <div className="content">
          <OpsView reservations={reservations} setReservations={handleSetReservations} resTypes={resTypes} sessionTemplates={sessionTemplates} users={users} setUsers={handleSetUsers} activeWaiverDoc={activeWaiver} currentUser={liveUser} setPayments={setPayments}/>
        </div>
      </div>
    </>);
  }

  return(<>
    
    <div className="app">
      {toastAlert&&<Toast msg={toastAlert} variant="alert" onClose={()=>setToastAlert(null)}/>}
      {showBackTop&&<button className="back-to-top" title="Back to top" onClick={()=>{document.querySelector('.content')?.scrollTo({top:0,behavior:'smooth'});setShowBackTop(false);}}>↑</button>}
      {showNavAccount&&liveUser&&<AccountPanel user={liveUser} users={users} setUsers={handleSetUsers} onClose={()=>setShowNavAccount(false)}/>}
      <nav className="nav">
        <div className="nav-brand" onClick={()=>setCurrentUser(null)}>
          <img src={LOGO_URI} className="nav-logo" alt="Sector 317"/>
          <span style={{fontSize:".7rem",color:"var(--muted)",marginLeft:".4rem",alignSelf:"flex-end",paddingBottom:2}}>v{APP_VERSION}</span>
        </div>
        {/* Desktop nav-right */}
        <div className="nav-right nav-right-desktop">
          {!viewAs&&<span className="nav-user" onClick={()=>setShowNavAccount(true)} title="Edit account settings">{liveUser.name} ⚙</span>}
          {!viewAs&&liveUser.authProvider&&<AuthBadge provider={liveUser.authProvider}/>}
          {viewAs?(
            <span style={{display:"inline-flex",alignItems:"center",gap:".5rem",background:"rgba(200,224,58,.12)",border:"1px solid rgba(200,224,58,.35)",borderRadius:5,padding:".25rem .75rem",fontSize:".78rem",fontWeight:600,color:"var(--accB)"}}>
              {ACCESS_LEVELS[liveUser.access]?.label} viewing as {ACCESS_LEVELS[viewAs]?.label}
              <button className="nbtn" style={{padding:".1rem .55rem",fontSize:".72rem",border:"1px solid var(--bdr)",borderRadius:4,marginLeft:".25rem"}} onClick={()=>{setViewAs(null);setViewAsOpen(false);}}>Back</button>
            </span>
          ):(
            <div style={{position:"relative"}}>
              <span className={`nbadge al-${liveUser.access}`} style={canViewAs?{cursor:"pointer",userSelect:"none"}:{}} onClick={()=>canViewAs&&setViewAsOpen(p=>!p)} title={canViewAs?"Preview as role":undefined}>
                {ACCESS_LEVELS[liveUser.access]?.label}{canViewAs?" ▾":""}
              </span>
              {viewAsOpen&&<div style={{position:"absolute",right:0,top:"calc(100% + 6px)",background:"var(--surf)",border:"1px solid var(--bdr)",borderRadius:7,padding:".4rem",zIndex:500,minWidth:140,boxShadow:"0 4px 20px rgba(0,0,0,.4)"}}>
                <div style={{fontSize:".65rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:".08em",padding:".2rem .5rem .4rem",fontWeight:700}}>Preview As</div>
                {(liveUser.access==="admin"?["manager","staff","customer"]:liveUser.access==="manager"?["staff","customer"]:["customer"]).map(role=>(
                  <div key={role} style={{padding:".45rem .75rem",borderRadius:5,cursor:"pointer",fontSize:".85rem",color:"var(--txt)",fontWeight:500}} onClick={()=>{setViewAs(role);setViewAsOpen(false);}}
                    onMouseEnter={e=>e.currentTarget.style.background="var(--bg2)"} onMouseLeave={e=>e.currentTarget.style.background=""}>
                    {ACCESS_LEVELS[role]?.label}
                  </div>
                ))}
                <div style={{borderTop:"1px solid var(--bdr)",marginTop:".3rem",paddingTop:".3rem"}}>
                  <div style={{padding:".35rem .75rem",borderRadius:5,cursor:"pointer",fontSize:".82rem",color:"var(--muted)"}} onClick={()=>setViewAsOpen(false)}
                    onMouseEnter={e=>e.currentTarget.style.background="var(--bg2)"} onMouseLeave={e=>e.currentTarget.style.background=""}>
                    Cancel
                  </div>
                </div>
              </div>}
            </div>
          )}
          <button className="nbtn" onClick={async()=>{await supabase.auth.signOut();setCurrentUser(null);setPendingUser(null);setShowLanding(true);}}>Sign Out</button>
        </div>
        {/* Mobile hamburger */}
        <button className="nav-hamburger" onClick={()=>setNavMenuOpen(p=>!p)} aria-label="Menu">
          <span/><span/><span/>
        </button>
        {/* Mobile dropdown menu */}
        {navMenuOpen&&<>
          <div className="nav-mobile-overlay" onClick={()=>setNavMenuOpen(false)}/>
          <div className="nav-mobile-menu">
            <div className="nav-mobile-row" onClick={()=>{setShowNavAccount(true);setNavMenuOpen(false);}}>
              <span style={{fontWeight:700,fontSize:".9rem"}}>{liveUser.name}</span>
              <span style={{fontSize:".75rem",color:"var(--muted)"}}>⚙ Account</span>
            </div>
            {liveUser.authProvider&&<div className="nav-mobile-row" style={{gap:".5rem"}}>
              <AuthBadge provider={liveUser.authProvider}/>
              <span style={{fontSize:".78rem",color:"var(--muted)"}}>{liveUser.authProvider}</span>
            </div>}
            <div className="nav-mobile-row" style={{justifyContent:"space-between"}}>
              <span style={{fontSize:".78rem",color:"var(--muted)"}}>Role</span>
              <span className={`nbadge al-${liveUser.access}`}>{ACCESS_LEVELS[liveUser.access]?.label}</span>
            </div>
            {viewAs&&<div className="nav-mobile-row" style={{justifyContent:"space-between"}}>
              <span style={{fontSize:".78rem",color:"var(--accB)",fontWeight:600}}>Viewing as {ACCESS_LEVELS[viewAs]?.label}</span>
              <button className="nbtn" style={{padding:".15rem .6rem",fontSize:".72rem",border:"1px solid var(--bdr)",borderRadius:4}} onClick={()=>{setViewAs(null);setViewAsOpen(false);setNavMenuOpen(false);}}>Back</button>
            </div>}
            {!viewAs&&canViewAs&&<>
              <div style={{fontSize:".65rem",color:"var(--muted)",textTransform:"uppercase",letterSpacing:".08em",padding:".5rem 1rem .2rem",fontWeight:700}}>Preview As</div>
              {(liveUser.access==="admin"?["manager","staff","customer"]:liveUser.access==="manager"?["staff","customer"]:["customer"]).map(role=>(
                <div key={role} className="nav-mobile-row nav-mobile-action" onClick={()=>{setViewAs(role);setNavMenuOpen(false);}}>
                  {ACCESS_LEVELS[role]?.label}
                </div>
              ))}
            </>}
            <div style={{borderTop:"1px solid var(--bdr)",margin:".4rem 0"}}/>
            <div className="nav-mobile-row nav-mobile-action" style={{color:"var(--dangerL)"}} onClick={async()=>{await supabase.auth.signOut();setCurrentUser(null);setPendingUser(null);setShowLanding(true);setNavMenuOpen(false);}}>
              Sign Out
            </div>
          </div>
        </>}
      </nav>
      <div className="main">
        {effectivePortal==="customer"&&<CustomerPortal user={effectiveUser} reservations={reservations} setReservations={handleSetReservations} resTypes={resTypes} sessionTemplates={sessionTemplates} users={users} setUsers={handleSetUsers} waiverDocs={waiverDocs} activeWaiverDoc={activeWaiver} onBook={handleBook} onPayCreate={handlePayCreate} onFinalize={handleFinalize} onSignWaiver={handleSignWaiver} autoBook={bookOnLogin&&liveUser?.access==="customer"} onAutoBookDone={()=>setBookOnLogin(false)} payments={payments} setPayments={setPayments} runs={runs} onAlert={handleAlert}/>}
        {effectivePortal==="staff"&&<StaffPortal user={effectiveUser} reservations={reservations} setReservations={handleSetReservations} resTypes={resTypes} users={users} setUsers={handleSetUsers} waiverDocs={waiverDocs} activeWaiverDoc={activeWaiver} shifts={shifts} setShifts={handleSetShifts} runs={runs} onSignWaiver={handleSignWaiver} onAddPlayer={handleAddPlayer} onAlert={handleAlert} navTarget={staffNavTarget} onNavConsumed={()=>setStaffNavTarget(null)}/>}
        {effectivePortal==="admin"&&<AdminPortal user={effectiveUser} reservations={reservations} setReservations={handleSetReservations} resTypes={resTypes} setResTypes={handleSetResTypes} sessionTemplates={sessionTemplates} setSessionTemplates={handleSetSessionTemplates} waiverDocs={waiverDocs} setWaiverDocs={handleSetWaiverDocs} activeWaiverDoc={activeWaiver} users={users} setUsers={handleSetUsers} shifts={shifts} setShifts={handleSetShifts} payments={payments} setPayments={setPayments} onAlert={handleAlert} userAuthDates={userAuthDates} runs={runs} staffRoles={staffRoles}/>}
      </div>
    </div>
  </>);
}
