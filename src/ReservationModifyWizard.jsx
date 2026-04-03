import { useState, useMemo, useEffect } from "react"
import { get60Dates, getSessionsForDate, getSlotStatus, dateHasAvailability, fmt, fmtMoney, fmt12 } from "./utils.js"

// ─────────────────────────────────────────────────────────────────────────────
// DateCalendarGrid — shared calendar rendering used in booking/reschedule flows
// ─────────────────────────────────────────────────────────────────────────────
function DateCalendarGrid({ dates, getCell }) {
  const grouped = {}
  dates.slice(0, 42).forEach(d => {
    const mo = new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" })
    ;(grouped[mo] = grouped[mo] || []).push(d)
  })
  return Object.entries(grouped).map(([mo, ds]) => {
    const offset = new Date(ds[0] + "T12:00:00").getDay()
    return (
      <div key={mo}>
        <div className="cal-month">{mo}</div>
        <div className="date-grid">
          {Array.from({ length: offset }).map((_, i) => <div key={i} />)}
          {ds.map(d => {
            const dt = new Date(d + "T12:00:00")
            const { cls, onClick } = getCell(d)
            return (
              <div key={d} className={cls} onClick={onClick}>
                <div className="dc-day">{dt.toLocaleDateString("en-US", { weekday: "short" })}</div>
                <div className="dc-num">{dt.getDate()}</div>
              </div>
            )
          })}
        </div>
      </div>
    )
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// ReservationModifyWizard
// Handles: reschedule (any type) and upgrade open→private (only when sole booker)
// ─────────────────────────────────────────────────────────────────────────────
function ReservationModifyWizard({res,mode,resTypes,sessionTemplates,reservations,allReservations,currentUser,isStaff=false,onClose,onReschedule,onUpgrade,onMoveAndUpgrade}){
  const _allRes=allReservations??reservations;
  const rt=resTypes.find(x=>x.id===res.typeId);
  const privateType=resTypes.find(x=>x.mode===rt?.mode&&x.style==="private"&&x.active&&x.availableForBooking);
  const allDates=useMemo(()=>get60Dates(sessionTemplates),[sessionTemplates]);

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
  const [showCalendar,setShowCalendar]=useState(false);
  useEffect(()=>{if(mode==="reschedule"){const id=setTimeout(()=>setShowCalendar(true),0);return()=>clearTimeout(id);}},[mode]);

  const availMap=useMemo(()=>{
    if(!privateType||!showCalendar) return {};
    const m={};
    allDates.forEach(d=>{m[d]=dateHasAvailability(d,privateType.id,_allRes,resTypes,sessionTemplates);});
    return m;
  },[privateType,showCalendar,allDates,_allRes,resTypes,sessionTemplates]);

  // ── Reschedule availability ──
  const reschedAvailMap=useMemo(()=>{
    if(!rt||!showCalendar) return {};
    const m={};
    allDates.forEach(d=>{m[d]=dateHasAvailability(d,rt.id,_allRes,resTypes,sessionTemplates);});
    return m;
  },[rt,showCalendar,allDates,_allRes,resTypes,sessionTemplates]);

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
    if(!rt||!showCalendar) return {};
    if(isStaff) return reschedAvailMap;
    const m={};
    allDates.forEach(d=>{
      if(!reschedAvailMap[d]){m[d]=false;return;}
      const isPrivateRes=rt.style==="private";
      m[d]=getSessionsForDate(d,sessionTemplates).some(t=>{
        if(userBookedTimes.has(d+':'+t.startTime))return false;
        const st=getSlotStatus(d,t.startTime,rt.id,_allRes,resTypes,sessionTemplates);
        if(!st.available)return false;
        return isPrivateRes?(st.slotsLeft??0)>=1:(st.spotsLeft??0)>=res.playerCount;
      });
    });
    return m;
  },[rt,showCalendar,reschedAvailMap,allDates,sessionTemplates,userBookedTimes,_allRes,resTypes,isStaff]);

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
        <button className="btn btn-p" style={{width:"100%"}} onClick={()=>{setShowCalendar(true);setUpgradeChoice("move");}}>Pick a New Slot & Upgrade →</button>
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
        <DateCalendarGrid dates={allDates} getCell={d => ({
          cls: `date-cell${!availMap[d] ? ' na' : ''}`,
          onClick: () => availMap[d] && setSelDate(d)
        })} />
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
    const reschedSlotStatuses=useMemo(()=>reschedSlots.map(t=>({tmpl:t,st:getSlotStatus(selDate,t.startTime,rt?.id,_allRes,resTypes,sessionTemplates)})),[reschedSlots,selDate,rt,_allRes,resTypes,sessionTemplates]);
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
        <DateCalendarGrid dates={allDates} getCell={d => {
          const avail = reschedAvailMapForUser[d]
          const isCurrent = d === res.date
          const dayLocked = isWithin24h && d !== res.date
          return {
            cls: `date-cell${isCurrent ? ' sel' : ''}${(!avail || dayLocked) ? ' na' : ''}`,
            onClick: () => avail && !dayLocked && setSelDate(d)
          }
        }} />
      </>}
      {selDate&&!selTime&&<>
        <p style={{fontSize:".84rem",color:"var(--txt)",marginBottom:".6rem"}}>Available times on <strong>{fmt(selDate)}</strong>:</p>
        <div className="slot-grid">{reschedSlotStatuses.map(({tmpl:t,st})=>{
          const isCurrent=selDate===res.date&&t.startTime===res.startTime;
          const userHasHere=!isStaff&&!isCurrent&&userBookedTimes.has(selDate+':'+t.startTime);
          const isPrivateRes=rt?.style==="private";
          const hasCapacity=isPrivateRes?(st.slotsLeft??0)>=1:(st.spotsLeft??0)>=res.playerCount;
          const isAvail=!isCurrent&&!userHasHere&&st.available&&hasCapacity;
          return <div key={t.id} className={`slot-card${isCurrent?" added":(!isAvail&&!isCurrent)?" unavail":""}`} onClick={()=>isAvail&&setSelTime(t.startTime)}>
            <div className="slot-time">{fmt12(t.startTime)}</div>
            {isCurrent?<div className="slot-info" style={{color:"var(--muted)"}}>Current</div>
             :userHasHere?<div className="slot-reason">Already booked</div>
             :st.available&&!hasCapacity?<div className="slot-reason">{st.spotsLeft??0} spot{(st.spotsLeft??0)!==1?"s":""} left</div>
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

export default ReservationModifyWizard
