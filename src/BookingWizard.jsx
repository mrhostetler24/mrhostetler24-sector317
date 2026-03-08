import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { get60Dates, getSessionsForDate, dateHasAvailability, getSlotStatus, openPlayCapacity, fmt12, fmt, addDaysStr, todayStr, laneCapacity } from './utils.js';
import { PlayerPhoneInput, DateNav } from './ui.jsx';

function BookingWizard({resTypes,sessionTemplates,reservations,allReservations,currentUser,users,activeWaiverDoc,onBook,onPayCreate,onFinalize,onClose}){
  const _allRes=allReservations??reservations;
  const [step,setStep]=useState(1);
  const [selMode,setSelMode]=useState(null);
  const [selStyle,setSelStyle]=useState(null);
  const [selDate,setSelDate]=useState(null);
  const [selSlots,setSelSlots]=useState([]);
  const [addingMore,setAddingMore]=useState(false);
  const [secondLanePrompt,setSecondLanePrompt]=useState(null); // {startTime} when offer is pending
  const [playerCount,setPlayerCount]=useState(1);
  const [playerInputs,setPlayerInputs]=useState([]);
  const [bookingForOther,setBookingForOther]=useState(false);
  const [player1Input,setPlayer1Input]=useState({phone:"",userId:null,name:"",status:"idle"});
  const [paymentSuccess,setPaymentSuccess]=useState(false);
  const [paying,setPaying]=useState(false);
  const [payError,setPayError]=useState(null);
  const [cardNumber,setCardNumber]=useState('');
  const [cardExpiry,setCardExpiry]=useState('');
  const [nameOnCard,setNameOnCard]=useState('');
  // For multi-slot bookings: track which slots each player is assigned to
  // slotAssignments[playerIndex] = Set of startTime strings
  const [slotAssignments,setSlotAssignments]=useState({});
  const [pendingResIds,setPendingResIds]=useState(null); // [{startTime,laneIdx,resId}] set after Pay
  const bookable=resTypes.filter(rt=>rt.active&&rt.availableForBooking);
  const selType=bookable.find(rt=>rt.mode===selMode&&rt.style===selStyle);
  const allDates=get60Dates(sessionTemplates);
  const availMap=useMemo(()=>{if(!selType)return{};const m={};allDates.forEach(d=>{m[d]=dateHasAvailability(d,selType.id,_allRes,resTypes,sessionTemplates);});return m;},[selType,_allRes,resTypes,sessionTemplates]);
  const slotsForDate=selDate?getSessionsForDate(selDate,sessionTemplates):[];
  const slotStatuses=useMemo(()=>slotsForDate.map(t=>({tmpl:t,status:selType?getSlotStatus(selDate,t.startTime,selType.id,_allRes,resTypes,sessionTemplates):{available:false},added:selSlots.some(s=>s.startTime===t.startTime)})),[selDate,selType,_allRes,resTypes,sessionTemplates,selSlots,slotsForDate]);
  const isPrivate=selStyle==="private";
  const isVersusOpen=selMode==="versus"&&selStyle==="open";
  // For open versus: max is 12 minus already-booked players in the target lane (computed from first selected slot)
  const firstSlotStatus=useMemo(()=>selSlots.length>0&&selType?getSlotStatus(selDate,selSlots[0].startTime,selType.id,reservations,resTypes,sessionTemplates):null,[selSlots,selType,selDate,reservations,resTypes,sessionTemplates]);
  const openMaxFromLane=firstSlotStatus?.spotsLeft??laneCapacity(selMode||"coop");
  const spotsLocked=isVersusOpen&&openMaxFromLane>0&&openMaxFromLane<4;
  const minP=isVersusOpen?(spotsLocked?openMaxFromLane:4):1;
  // For private: capacity scales with lanes booked at the same startTime
  const lanesBooked=isPrivate&&selSlots.length>0
    ? Math.max(1, selSlots.filter(s=>s.startTime===selSlots[0]?.startTime).length)
    : 1;
  const perLaneCap=selMode==="versus"?12:6;
  const maxP=isPrivate?perLaneCap*lanesBooked:Math.min(perLaneCap,openMaxFromLane);
  const effPlayerCount=isPrivate?maxP:playerCount;
  const pricePerSlot=selType?selType.pricingMode==="flat"?selType.price:selType.price*effPlayerCount:0;
  const total=pricePerSlot*selSlots.length;
  useEffect(()=>{ setPlayerInputs(Array.from({length:Math.max(0,effPlayerCount-1)},(_,i)=>playerInputs[i]||{phone:"",userId:null,name:"",status:"idle"})); },[effPlayerCount]);
  useEffect(()=>{ if(!isPrivate) setPlayerCount(p=>Math.max(minP,Math.min(p,maxP))); },[maxP,minP]);
  const addSlot=st=>{
    setSelSlots(p=>{
      const existing=p.filter(s=>s.startTime===st).length;
      if(isPrivate&&existing>=2) return p;
      if(!isPrivate&&existing>=1) return p;
      return [...p,{startTime:st}];
    });
    setAddingMore(false);
    if(isPrivate){
      const alreadyTwo=selSlots.filter(s=>s.startTime===st).length>=1;
      if(!alreadyTwo){
        const status=getSlotStatus(selDate,st,selType?.id,reservations,resTypes,sessionTemplates);
        const freeLanesAfter=(status.lanes||[]).filter(l=>l.type===null).length;
        if(freeLanesAfter>1) setSecondLanePrompt(st);
        else setSecondLanePrompt(null);
      }
    }
  };
  // private skips step 5 (player count)
  const steps=isPrivate?["Mode","Type","Date","Time","Payment","Players"]:["Mode","Type","Date","Time","Payment","Players"];
  const canNext=[true,!!selMode,!!selStyle,!!selDate,selSlots.length>0,paymentSuccess,true];
  const isStaffBooker=['staff','manager','admin'].includes(currentUser.access);
  if(!currentUser.authProvider)return(
    <div className="mo"><div className="mc"><div className="mt2">Social Sign-In Required</div>
      <p style={{color:"var(--muted)",marginBottom:"1rem",fontSize:".88rem"}}>To complete a reservation and process payment, you must sign in with a verified social account (Google, Microsoft, or Apple).</p>
      <p style={{color:"var(--muted)",marginBottom:"1.25rem",fontSize:".84rem"}}>This confirms your identity and secures your payment method. Sign out and use a social provider to continue.</p>
      <div style={{display:"flex",flexDirection:"column",gap:".5rem",marginBottom:"1.25rem"}}>
        {[{id:"google",label:"Link Google Account",color:"#4285F4"},{id:"microsoft",label:"Link Microsoft Account",color:"#00A4EF"},{id:"apple",label:"Link Apple Account",color:"var(--txt)"}].map(p=>(
          <button key={p.id} className="btn btn-s btn-full" style={{textTransform:"none",letterSpacing:".02em"}} onClick={()=>onClose()}>🔗 {p.label}</button>
        ))}
      </div>
      <div className="ma"><button className="btn btn-s" onClick={onClose}>Cancel</button></div>
    </div></div>
  );
  if(!hasValidWaiver(currentUser,activeWaiverDoc))return(
    <div className="mo"><div className="mc"><div className="mt2">Waiver Required</div>
      <p style={{color:"var(--muted)",marginBottom:"1.25rem",fontSize:".88rem"}}>You must have a current signed waiver before booking. Please sign your waiver from the main portal.</p>
      <div className="ma"><button className="btn btn-p" onClick={onClose}>OK — I'll Sign First</button></div>
    </div></div>
  );
  return(
    <div className="mo"><div className="mc" style={{maxWidth:660}}>
      <div style={{display:"flex",alignItems:"center",gap:".5rem",marginBottom:"1.1rem"}}>
        <div style={{flex:1,display:"flex",gap:".25rem"}}>{steps.map((s,i)=><div key={s} style={{flex:1,height:3,borderRadius:2,background:i<step?"var(--acc)":"var(--bdr)",transition:"background .3s"}}/>)}</div>
        <button className="btn btn-s btn-sm" style={{padding:".25rem .6rem",lineHeight:1,flexShrink:0}} onClick={onClose} title="Close">✕</button>
      </div>
      <div className="mt2">{steps[step-1]}</div>
      {step===1&&<div className="mode-grid">{["coop","versus"].map(m=>{const has=bookable.some(rt=>rt.mode===m);return <div key={m} className={`mode-card${selMode===m?" sel":""}${!has?" disabled":""}`} onClick={()=>{if(has){setSelMode(m);if(m==="versus")setPlayerCount(p=>Math.max(4,p));}}}><div className="mode-icon">{m==="coop"
  ?<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHsAAACACAYAAAArkhalAAADM0lEQVR4nO3cW47jIBBAUTKahWQZUfavKMvITjJfSMhjOzzqBb7ns9sd4yoKA447JQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJnTzboCG9+f5Hf2Mx/21XGyWuiCJJG+tlPRlLkQj0aUVkj79BaSkn+hSb9K3bfToPH+tT1jKAei58Pfn+fUIWEubLTthDdfKPgrGXiD3jn3cXzfvgNa2tfZvNblV9llAvBPYYqa2/vFuQK8IVT3Kuv0uyZ49SbOasrJ7qvpxf90iLp8sO775Pdu6qnOC8+y9TPjVRhi3pUuvlqouE332e8n29bIYdUwr2yOQLbP+svJXrHrXTZVWLb2/575eHr9i0s0maFJBq/kciWXZyO7eyPk0TVXZNSTX39uEz17lJpVtFSStjZb35/ndm81rnEfrs1NaqLItdtRmr3T1ypYOyF5lWW+WaN7PNTuQepAskq1xnloaVa7VeadLdlTSSddIuOowfpVEp2S/VOsx5YOQqMpZu8RnSbSppJbsK1X1ltdXpn6hshVFS7hKsq9c1ZnE0z2ptmQqyY7Wo730Duda8VMbxldPuNb1acZtmSc6Hmq3aFuOk2nZPpMJWtTvf0mova6z46ziYzobXy3htSPW2XGWMTFfeq1W5S2TsO1x1nFwW2fvJT3/LEpnkGxLhBf7QgQ1i/i8eLZJ2JkwO2hloCT3mCVEaceoEMk+qohtwj2G+ZZJWPRO4Z7s2qGvHNotvg9WGpmEReKe7F9yZ8hJLn8uUU2ak7BoXJMtNaEZSZb0MB15OA9f2Sn1v8LTQjpBR8tKyXO0CvlvNrKe5UxZWS3D6kpLrCNhK7s1WOU9ved+vsok7Ixrsn8FbbTSNO6f0SdhZ9wr+2jbtPZvR89VkpqERa38MK//9AZI454+8ipR1ESnFGxvfOvXo8GRYf4s4TWfHTmpR9yH8TOeb0zOmMxfQic7pf/vsy3r1d7heNWOED7ZWeumhERCIrwxKinMBE2DxCRr5uRuTVPZe46qvWU/3furQpaWvbCU2v7/2RVMXdm/XDWpl7Z9Fg4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACbyD58mQREvKhY+AAAAAElFTkSuQmCC" alt="co-op" style={{width:48,height:48,objectFit:"contain",display:"block",filter:"drop-shadow(0 0 8px rgba(200,224,58,.3))"}} />
  :<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAH8AAAB8CAYAAABAKW+9AAADDElEQVR4nO3cYU6EMBCG4W89icfYeP8Yj+FN9BcJixSmFdqZ6fv8MkaE7Tdd2llUAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAZx6jL8Di6/vjp+W45/tn0+vrfb5R3kZfAMZJHX7LDG6d9RGlDl+qC3Om4KUJwpdsoc4WvDRJ+NJxuDMGL00UvrQf8qzBS5OFj1cpwq/ZX69nes2sj7aHt0gRvlQfzuzBS0nCX4K0hPR8/3y0BJ9xbZAifMlWAAT/Kk340nEBEPxfqcKX9gug9p49Q/BSwvCl1wKoDXKW4KUgH+kuagPpFXzU3UComd8yyARfFip8yT7YNQu8GYOXAoYvnQ86wduEDF8qD35NKDMHLwVb8JVst3eWMFuCzxL6IuzMX1uHQvB2qV4QwddJMfMlgm+RJvwzrcF/fX/8ZO32pajqs3Cu6vRlexcIP/N7BV/zO6IIHX7P4K3njCRs+HcFv/265dxRhLyH3RH8+metx0dfA4Sd+SW1Xb69zwFqngmMLFz4R6Fe2d61FED0t/9Q4fcKfnu+rAUQJvyrg99+fXbejAUQIvw7gj/6Xun82QrA/YLmiuCtC7crdhGRFokuLvSojVoa6Lu2Y/8tgKNr91YYLt/2r9rHtwy2tcGToRHkMnypPMg9GjCtBWDdPnoxPHxLH30Z1J6dt9oCiPjHHi7uQTVhjlhsWc8ZrR08fOZbtG7jrlKzHYzERfj/3Wv3mFFH5x1dnK1chC+1F0DPQd07b9TgJSf3/LVIgxnpWve4mfnLg5JR7q/W4D0/AOoi/O1/yPJeADXB1xzT2/DwSw9Kei2AluBrju1paPhnDR7P98uSs78Q9lQAw2d+ybZzFoH1mr0UwJCBbemE7R0zqjCs1+K94+dm8BajB+Rqnl+rq7f90YNxB8+vqVv46/3uqBbtKGet4VFrgO4zf6+Zkzn4xVlreEQBdBl0yyNPs/GwgL195nvZ1nji5Umf28O/4r9mZeNlTLrc80vPus2MMQEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHDuFxBRn2mAtQ4hAAAAAElFTkSuQmCC" alt="versus" style={{width:48,height:48,objectFit:"contain",display:"block",filter:"drop-shadow(0 0 8px rgba(200,224,58,.3))"}} />
}</div><div className="mode-name">{m==="coop"?"Co-Op":"Versus"}</div><div className="mode-desc">{m==="coop"?"Team vs objective — lead a 6 person team against static and live targets as you navigate each structure with one shared goal — completing the mission. But hurry, the clock is ticking!":"Team vs Team — One team stages inside, the other attempts to breach and clear. After round one, teams flip. Whoever can clear the structure the fastest is crowned the victor. Minimum of 4 players per reservation."}</div></div>;})} </div>}
      {step===2&&<div className="mode-grid">{["open","private"].map(sty=>{const rt=bookable.find(x=>x.mode===selMode&&x.style===sty);if(!rt)return <div key={sty} className="mode-card disabled"><div className="mode-icon">{sty==="open"
  ?<svg width="42" height="42" viewBox="0 0 42 42" fill="none">
                  <circle cx="13" cy="10" r="4.5" fill="#c8e03a" opacity=".9"/>
                  <circle cx="29" cy="10" r="4.5" fill="#9ab02e" opacity=".9"/>
                  <path d="M5 32c0-5 3.5-8 8-8h1" stroke="#c8e03a" strokeWidth="2.5" strokeLinecap="round"/>
                  <rect x="8" y="22" width="10" height="9" rx="2" fill="#c8e03a" opacity=".2" stroke="#c8e03a" strokeWidth="1.5"/>
                  <path d="M37 32c0-5-3.5-8-8-8h-1" stroke="#9ab02e" strokeWidth="2.5" strokeLinecap="round"/>
                  <rect x="24" y="22" width="10" height="9" rx="2" fill="#9ab02e" opacity=".15" stroke="#9ab02e" strokeWidth="1.5"/>
                  <circle cx="21" cy="21" r="5" fill="#c8e03a" opacity=".1"/>
                  <path d="M21 18v6M18 21h6" stroke="#c8e03a" strokeWidth="2" strokeLinecap="round"/>
                </svg>
  :<svg width="42" height="42" viewBox="0 0 42 42" fill="none">
                  <path d="M21 4L36 10V22C36 30 21 38 21 38C21 38 6 30 6 22V10L21 4Z" fill="#c8e03a" opacity=".12" stroke="#c8e03a" strokeWidth="2.2" strokeLinejoin="round"/>
                  <path d="M21 9L31 14V22C31 27 21 33 21 33C21 33 11 27 11 22V14L21 9Z" stroke="#9ab02e" strokeWidth="1.5" strokeLinejoin="round" opacity=".5"/>
                  <rect x="16" y="20" width="10" height="8" rx="1.5" fill="#c8e03a" opacity=".3" stroke="#c8e03a" strokeWidth="1.5"/>
                  <path d="M17.5 20v-2.5a3.5 3.5 0 017 0V20" stroke="#c8e03a" strokeWidth="1.8" strokeLinecap="round"/>
                  <circle cx="21" cy="24" r="1.5" fill="#c8e03a"/>
                </svg>
}</div><div className="mode-name">{sty==="open"?"Open Play":"Private Team"}</div><div style={{fontSize:".72rem",color:"var(--dangerL)",marginTop:".5rem"}}>Unavailable</div></div>;return <div key={sty} className={`mode-card${selStyle===sty?" sel":""}`} onClick={()=>setSelStyle(sty)}><div className="mode-icon">{sty==="open"
  ?<svg width="42" height="42" viewBox="0 0 42 42" fill="none">
                  <circle cx="13" cy="10" r="4.5" fill="#c8e03a" opacity=".9"/>
                  <circle cx="29" cy="10" r="4.5" fill="#9ab02e" opacity=".9"/>
                  <path d="M5 32c0-5 3.5-8 8-8h1" stroke="#c8e03a" strokeWidth="2.5" strokeLinecap="round"/>
                  <rect x="8" y="22" width="10" height="9" rx="2" fill="#c8e03a" opacity=".2" stroke="#c8e03a" strokeWidth="1.5"/>
                  <path d="M37 32c0-5-3.5-8-8-8h-1" stroke="#9ab02e" strokeWidth="2.5" strokeLinecap="round"/>
                  <rect x="24" y="22" width="10" height="9" rx="2" fill="#9ab02e" opacity=".15" stroke="#9ab02e" strokeWidth="1.5"/>
                  <circle cx="21" cy="21" r="5" fill="#c8e03a" opacity=".1"/>
                  <path d="M21 18v6M18 21h6" stroke="#c8e03a" strokeWidth="2" strokeLinecap="round"/>
                </svg>
  :<svg width="42" height="42" viewBox="0 0 42 42" fill="none">
                  <path d="M21 4L36 10V22C36 30 21 38 21 38C21 38 6 30 6 22V10L21 4Z" fill="#c8e03a" opacity=".12" stroke="#c8e03a" strokeWidth="2.2" strokeLinejoin="round"/>
                  <path d="M21 9L31 14V22C31 27 21 33 21 33C21 33 11 27 11 22V14L21 9Z" stroke="#9ab02e" strokeWidth="1.5" strokeLinejoin="round" opacity=".5"/>
                  <rect x="16" y="20" width="10" height="8" rx="1.5" fill="#c8e03a" opacity=".3" stroke="#c8e03a" strokeWidth="1.5"/>
                  <path d="M17.5 20v-2.5a3.5 3.5 0 017 0V20" stroke="#c8e03a" strokeWidth="1.8" strokeLinecap="round"/>
                  <circle cx="21" cy="24" r="1.5" fill="#c8e03a"/>
                </svg>
}</div><div className="mode-name">{sty==="open"?"Open Play":"Private Team"}</div><div className="mode-desc">{rt.description}{selMode==="versus"&&sty==="open"&&<div style={{marginTop:".5rem",fontSize:".74rem",color:"var(--warn)",fontWeight:600}}>⚠ Minimum 4 players per reservation for Versus open play.</div>}</div><div className="mode-price">{rt.pricingMode==="flat"?`${fmtMoney(rt.price)} flat`:`${fmtMoney(rt.price)}/player`}</div></div>;})} </div>}
      {step===3&&<>
        <p style={{fontSize:".85rem",color:"var(--muted)",marginBottom:".75rem"}}>Choose a date.</p>
        <div className="date-grid-hdr">{["Su","Mo","Tu","We","Th","Fr","Sa"].map(d=><div key={d} style={{textAlign:"center",fontSize:".62rem",color:"var(--muted)",padding:".2rem",textTransform:"uppercase"}}>{d}</div>)}</div>
        {(()=>{const grouped={};allDates.slice(0,42).forEach(d=>{const mo=new Date(d+"T12:00:00").toLocaleDateString("en-US",{month:"long",year:"numeric"});(grouped[mo]=grouped[mo]||[]).push(d);});return Object.entries(grouped).map(([mo,dates])=>{const offset=new Date(dates[0]+"T12:00:00").getDay();return <div key={mo}><div className="cal-month">{mo}</div><div className="date-grid">{Array.from({length:offset}).map((_,i)=><div key={i}/>)}{dates.map(d=>{const dt=new Date(d+"T12:00:00");return <div key={d} className={`date-cell${selDate===d?" sel":""}${!availMap[d]?" na":""}`} onClick={()=>availMap[d]&&setSelDate(d)}><div className="dc-day">{dt.toLocaleDateString("en-US",{weekday:"short"})}</div><div className="dc-num">{dt.getDate()}</div></div>;})}</div></div>;});})()}
      </>}
      {step===4&&(()=>{
        // Unique startTimes selected (deduplicated for display)
        const uniqueTimes=[...new Set(selSlots.map(s=>s.startTime))];
        // Current secondLanePrompt lane count for the prompted slot
        const promptLaneCount=secondLanePrompt?selSlots.filter(s=>s.startTime===secondLanePrompt).length:0;
        const maxCombined=selMode==="coop"?12:24;
        return <>
          <p style={{fontSize:".85rem",color:"var(--muted)",marginBottom:".65rem"}}>Pick time slots for <strong style={{color:"var(--txt)"}}>{selDate?fmt(selDate):"—"}</strong></p>
          {/* ── SECOND LANE PROMPT — stays at top so it never scrolls off ── */}
          {secondLanePrompt&&isPrivate&&promptLaneCount<2&&<div style={{background:"rgba(200,224,58,.06)",border:"1px solid rgba(200,224,58,.35)",borderRadius:6,padding:".85rem 1rem",marginBottom:".75rem"}}>
            <div style={{fontFamily:"var(--fd)",fontSize:".78rem",letterSpacing:".08em",color:"var(--acc)",marginBottom:".3rem"}}>SECOND LANE AVAILABLE</div>
            <div style={{fontSize:".84rem",color:"var(--txt)",marginBottom:".25rem"}}>Both lanes are open at <strong>{fmt12(secondLanePrompt)}</strong> — add the second lane if you have more than {selMode==="versus"?"12":"6"} players!</div>
            <div style={{fontSize:".72rem",color:"var(--muted)",marginBottom:".6rem"}}>+{fmtMoney(pricePerSlot)} · Accommodates up to {maxCombined} players across both lanes</div>
            <div style={{display:"flex",gap:".5rem",flexWrap:"wrap"}}>
              <button className="btn btn-p btn-sm" onClick={()=>setSelSlots(p=>[...p,{startTime:secondLanePrompt}])}>+ Add Second Lane</button>
              <button className="btn btn-s btn-sm" onClick={()=>setSecondLanePrompt(null)}>No thanks</button>
            </div>
          </div>}
          {/* ── SELECTED SLOTS CHIPS ── */}
          {uniqueTimes.length>0&&<div style={{marginBottom:".6rem",display:"flex",flexWrap:"wrap",gap:".4rem"}}>
            {uniqueTimes.map(st=>{
              const count=selSlots.filter(s=>s.startTime===st).length;
              return <div className="session-block" key={st} style={{display:"inline-flex",alignItems:"center",gap:".5rem"}}>
                <strong>{fmt12(st)}</strong>
                {count>1&&<span style={{fontSize:".72rem",color:"var(--acc)",fontFamily:"var(--fd)",letterSpacing:".06em"}}>×2 LANES</span>}
                <button className="chip-remove" style={{marginLeft:".25rem"}} onClick={()=>{
                  if(count>1){setSelSlots(p=>{const idx=p.findLastIndex?.(s=>s.startTime===st)??p.map(s=>s.startTime).lastIndexOf(st);return p.filter((_,i)=>i!==idx);});}
                  else{setSelSlots(p=>p.filter(x=>x.startTime!==st));}
                  if(secondLanePrompt===st) setSecondLanePrompt(null);
                }}>✕</button>
              </div>;
            })}
          </div>}
          {/* ── SLOT PICKER (shown when no slots yet, or adding more) ── */}
          {(selSlots.length===0||addingMore)&&<>
            <div className="slot-grid">{slotStatuses.map(({tmpl,status,added})=>{
              const laneInfo=status.lanes||[];
              return <div key={tmpl.id} className={`slot-card${added?" added":!status.available?" unavail":""}`} onClick={()=>!added&&status.available&&addSlot(tmpl.startTime)}>
                <div className="slot-time">{fmt12(tmpl.startTime)}</div>
                {added?<div className="slot-info" style={{color:"var(--okB)"}}>✓ Added</div>:status.available?<>
                  <div className="slot-info" style={{color:"var(--okB)",fontSize:".72rem"}}>{(()=>{if(selType?.style==="private"){const total=(status.lanes||[]).length;const free=status.slotsLeft??total;return free<total?`${free} lane${free!==1?"s":""} free`:"Available";}else{const cap=laneCapacity(selMode||"coop");const spots=status.spotsLeft??cap;return spots<cap?`${spots} spot${spots!==1?"s":""} left`:"Available";}})()}</div>
                  {laneInfo.length>0&&<div style={{marginTop:".35rem",display:"flex",flexDirection:"column",gap:"2px"}}>
                    {laneInfo.map(l=><div key={l.laneNum} style={{fontSize:".6rem",fontFamily:"var(--fd)",letterSpacing:".04em",display:"flex",justifyContent:"space-between",color:l.type===null?"rgba(200,224,58,.4)":l.type==="private"?"var(--dangerL)":l.mode===selType?.mode?"var(--okB)":"var(--warn)"}}>
                      <span>Lane {l.laneNum}</span>
                      <span>{l.type===null?"Free":l.type==="private"?"Private":l.mode==="coop"?`Co-Op ${l.playerCount}/6`:`Versus ${l.playerCount}/12`}</span>
                    </div>)}
                  </div>}
                </>:<div className="slot-reason">{status.reason}</div>}
              </div>;
            })}</div>
          </>}
          {/* ── ADDITIONAL TIME SLOTS — always shown when slots are selected, independent of second-lane prompt ── */}
          {selSlots.length>0&&!addingMore&&(()=>{
            const addedTimes=new Set(selSlots.map(s=>s.startTime));
            const adjAvail=slotsForDate.filter(t=>!addedTimes.has(t.startTime)).map(t=>({tmpl:t,st:getSlotStatus(selDate,t.startTime,selType?.id,reservations,resTypes,sessionTemplates)})).filter(({st})=>st.available);
            if(!adjAvail.length) return null;
            return <div style={{background:"rgba(200,224,58,.04)",border:"1px solid rgba(200,224,58,.15)",borderRadius:6,padding:".65rem .85rem",marginTop:".5rem"}}>
              <div style={{fontFamily:"var(--fd)",fontSize:".72rem",letterSpacing:".08em",color:"var(--muted)",marginBottom:".45rem"}}>ADDITIONAL TIME IN STRUCTURE</div>
              <div style={{display:"flex",gap:".4rem",flexWrap:"wrap"}}>
                {adjAvail.map(({tmpl:t,st:tst})=>{
                  const adjHasTwoLanes=isPrivate&&(tst.lanes||[]).filter(l=>l.type===null).length>1;
                  return <button key={t.startTime} className="btn btn-s btn-sm" onClick={()=>{
                    addSlot(t.startTime);
                    if(adjHasTwoLanes) setSecondLanePrompt(t.startTime);
                  }}>+ {fmt12(t.startTime)}</button>;
                })}
              </div>
              <div style={{fontSize:".7rem",color:"var(--muted)",marginTop:".4rem"}}>Add additional timeslot for extended time in structure</div>
            </div>;
          })()}
        </>;
      })()}
      {step===5&&!isPrivate&&<>
        <p style={{fontSize:".85rem",color:"var(--muted)",marginBottom:".75rem"}}>Players{selType?.pricingMode==="per_person"&&<span style={{color:"var(--accB)",marginLeft:".5rem"}}>{fmtMoney(selType.price)}/player</span>}</p>
        <div className="f"><label>Number of Players {spotsLocked?<span style={{fontSize:".78rem",color:"var(--dangerL)",fontWeight:600}}>({openMaxFromLane} spot{openMaxFromLane!==1?"s":""} left — fixed)</span>:isVersusOpen?<span style={{fontSize:".78rem",color:"var(--warn)",fontWeight:600}}>(min 4, max {maxP})</span>:<span style={{fontSize:".78rem",color:"var(--muted)"}}>max {maxP}</span>}</label>{spotsLocked?<div style={{fontSize:"1.1rem",fontWeight:700,color:"var(--accB)",padding:".35rem 0"}}>{openMaxFromLane} player{openMaxFromLane!==1?"s":""}</div>:<div style={{display:"flex",alignItems:"center",gap:"1rem"}}><span style={{fontSize:"2rem",fontWeight:800,color:"var(--txt)",minWidth:36,textAlign:"center",lineHeight:1,flexShrink:0}}>{playerCount}</span><div style={{flex:1,display:"flex",flexDirection:"column",gap:".25rem"}}><input type="range" min={minP} max={maxP} value={playerCount} onChange={e=>setPlayerCount(+e.target.value)} style={{width:"100%",accentColor:"var(--acc)",cursor:"pointer"}}/><div style={{display:"flex",justifyContent:"space-between",fontSize:".7rem",color:"var(--muted)"}}><span>{minP}</span><span style={{color:maxP<(selMode==="versus"?12:6)?"var(--warn)":"var(--muted)",fontWeight:600}}>{maxP} max</span></div></div></div>}{spotsLocked?<div style={{fontSize:".74rem",color:"var(--warn)",marginTop:".3rem"}}>⚠ This lane only has {openMaxFromLane} spot{openMaxFromLane!==1?"s":""} remaining — booking qty is fixed.</div>:!isVersusOpen&&!isPrivate&&openMaxFromLane<perLaneCap&&selSlots.length>0?<div style={{fontSize:".74rem",color:"var(--warn)",marginTop:".3rem"}}>⚠ This lane already has {perLaneCap-openMaxFromLane} of {perLaneCap} players — max {openMaxFromLane} spot{openMaxFromLane!==1?"s":""} remaining.</div>:isVersusOpen&&playerCount<4&&<div style={{fontSize:".74rem",color:"var(--dangerL)",marginTop:".3rem"}}>⚠ Versus open play requires a minimum of 4 players.</div>}</div>
        <div className="pay-sum"><div className="pay-row"><span>{selType?.name}</span><span>{selType?.pricingMode==="flat"?"Flat":"Per Player"}</span></div><div className="pay-row"><span>Sessions × {selSlots.length}</span>{selType?.pricingMode==="per_person"&&<span>Players × {playerCount}</span>}</div><div className="pay-row tot"><span>Total</span><span>{fmtMoney(total)}</span></div></div>
        {!paymentSuccess&&<>
          <div className="gd-badge"><span style={{color:"var(--okB)"}}>🔒</span><div><strong style={{color:"var(--txt)"}}>Secured by GoDaddy Payments</strong></div></div>
          <div className="g2"><div className="f"><label>Card Number</label><input placeholder="•••• •••• •••• ••••" value={cardNumber} onChange={e=>setCardNumber(e.target.value)}/></div><div className="f"><label>Expiry (MM/YY)</label><input placeholder="MM / YY" value={cardExpiry} onChange={e=>setCardExpiry(e.target.value)}/></div></div>
          <div className="g2"><div className="f"><label>Name on Card</label><input placeholder="Full name" value={nameOnCard} onChange={e=>setNameOnCard(e.target.value)}/></div><div className="f"><label>CVV</label><input placeholder="•••"/></div></div>
          {payError&&<div style={{background:"rgba(192,57,43,.1)",border:"1px solid var(--danger)",borderRadius:5,padding:".6rem .85rem",fontSize:".8rem",color:"var(--dangerL)",marginTop:".5rem"}}>⚠ Payment failed: {payError}</div>}
        </>}
        {paymentSuccess&&<div style={{background:"rgba(100,200,100,.1)",border:"1px solid rgba(100,200,100,.35)",borderRadius:6,padding:".85rem 1rem",marginTop:".5rem",display:"flex",alignItems:"center",gap:".75rem"}}>
          <span style={{fontSize:"1.4rem"}}>✅</span>
          <div><div style={{fontFamily:"var(--fd)",fontSize:".82rem",color:"var(--okB)",letterSpacing:".06em",marginBottom:".15rem"}}>PAYMENT SUCCESSFUL</div>
          <div style={{fontSize:".78rem",color:"var(--muted)"}}>Your reservation is confirmed. Add your group members on the next screen to speed up check-in.</div></div>
        </div>}
      </>}
      {step===6&&!isPrivate&&<>
        <p style={{fontSize:".82rem",color:"var(--muted)",marginBottom:".75rem"}}>Add your group's phone numbers to speed up check-in. You can also do this later from your reservations.</p>
        {(()=>{
          const uniqueSlotTimes=[...new Set(selSlots.map(s=>s.startTime))].sort();
          const multiSlot=uniqueSlotTimes.length>1;
          // Only show slot checkboxes if player counts differ across slots (mismatch)
          // For open-play non-private, playerCount is fixed so no mismatch — never show checkboxes
          const showSlotBoxes=false;
          const allPlayerInputs=[
            bookingForOther
              ?player1Input
              :{phone:currentUser.phone||"",userId:currentUser.id,name:currentUser.name,status:"found"},
            ...playerInputs
          ];
          return <>
            {multiSlot&&<div style={{fontSize:".8rem",color:"var(--muted)",marginBottom:".75rem",background:"var(--surf2)",border:"1px solid var(--bdr)",borderRadius:5,padding:".6rem .85rem"}}>
              All players will be assigned to all <strong style={{color:"var(--txt)"}}>{uniqueSlotTimes.length} time slots</strong>. If a player is only attending one slot, update each time slot or lane by clicking <strong style={{color:"var(--txt)"}}>Manage Team</strong> from your reservations.
            </div>}
            <div className="player-inputs">
              {/* Player 1 — booker */}
              {!bookingForOther
                ? <div className="pi-row" style={{background:"rgba(200,224,58,.04)",border:"1px solid rgba(200,224,58,.15)",borderRadius:4,padding:".6rem 1rem",marginBottom:".5rem"}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:".5rem"}}>
                      <div>
                        <div style={{fontSize:".68rem",fontFamily:"var(--fd)",letterSpacing:".1em",color:"var(--acc)",marginBottom:".2rem"}}>PLAYER 1 — YOU</div>
                        <div style={{display:"flex",alignItems:"center",gap:".5rem"}}>
                          <span style={{background:"var(--acc2)",color:"var(--bg2)",borderRadius:"50%",width:24,height:24,display:"inline-flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:".72rem",flexShrink:0}}>{getInitials(currentUser.name)}</span>
                          <strong style={{fontSize:".88rem"}}>{currentUser.name}</strong>
                        </div>
                      </div>
                      <label style={{display:"flex",alignItems:"center",gap:".4rem",fontSize:".78rem",color:"var(--muted)",cursor:"pointer"}}>
                        <input type="checkbox" checked={bookingForOther} onChange={e=>{setBookingForOther(e.target.checked);setPlayer1Input({phone:"",userId:null,name:"",status:"idle"});}} style={{accentColor:"var(--acc)"}}/>
                        Booking for someone else
                      </label>
                    </div>
                  </div>
                : <div style={{marginBottom:".5rem"}}>
                    <PlayerPhoneInput index={null} label="Player 1" value={player1Input} users={users} bookerUserId={null} activeWaiverDoc={activeWaiverDoc} onChange={setPlayer1Input} showFullName={true}/>
                    <label style={{display:"flex",alignItems:"center",gap:".4rem",fontSize:".78rem",color:"var(--muted)",cursor:"pointer",marginTop:".35rem"}}>
                      <input type="checkbox" checked={bookingForOther} onChange={e=>setBookingForOther(e.target.checked)} style={{accentColor:"var(--acc)"}}/>
                      Booking for someone else
                    </label>
                  </div>
              }
              {/* Additional players */}
              {playerInputs.map((pi,i)=>{
                const currentUserIds=[
                  bookingForOther?player1Input.userId:currentUser.id,
                  ...playerInputs.filter((_,j)=>j!==i).map(p=>p.userId)
                ].filter(Boolean);
                return <div key={i} style={{display:"flex",alignItems:"flex-start",gap:".5rem"}}>
                  <div style={{flex:1}}>
                    <PlayerPhoneInput index={i} value={pi} users={users} bookerUserId={currentUser.id} activeWaiverDoc={activeWaiverDoc} existingUserIds={currentUserIds} onChange={v=>setPlayerInputs(p=>{const n=[...p];n[i]=v;return n;})}/>
                  </div>
                  {(pi.name||pi.phone)&&<button className="btn btn-d btn-sm" style={{marginTop:"1.6rem",flexShrink:0}} onClick={()=>setPlayerInputs(p=>{const n=[...p];n[i]={phone:"",userId:null,name:"",status:"idle"};return n;})} title="Clear player">✕</button>}
                </div>;
              })}
            </div>
            {playerInputs.length<playerCount-1&&<button className="btn btn-s btn-sm" style={{marginBottom:".75rem"}} onClick={()=>setPlayerInputs(p=>[...p,{phone:"",userId:null,name:"",status:"idle"}])}>+ Add Player Slot</button>}
          </>;
        })()}
      </>}
      {step===5&&isPrivate&&<>
        <div className="pay-sum"><div className="pay-row"><span>{selType?.name}</span><span>Private ({lanesBooked>1?`${lanesBooked} lanes · `:""}max {maxP} players) — Flat</span></div><div className="pay-row"><span>Sessions × {selSlots.length}</span></div><div className="pay-row tot"><span>Total</span><span>{fmtMoney(total)}</span></div></div>
        {!paymentSuccess&&<>
          <div className="gd-badge"><span style={{color:"var(--okB)"}}>🔒</span><div><strong style={{color:"var(--txt)"}}>Secured by GoDaddy Payments</strong></div></div>
          <div className="g2"><div className="f"><label>Card Number</label><input placeholder="•••• •••• •••• ••••" value={cardNumber} onChange={e=>setCardNumber(e.target.value)}/></div><div className="f"><label>Expiry (MM/YY)</label><input placeholder="MM / YY" value={cardExpiry} onChange={e=>setCardExpiry(e.target.value)}/></div></div>
          <div className="g2"><div className="f"><label>Name on Card</label><input placeholder="Full name" value={nameOnCard} onChange={e=>setNameOnCard(e.target.value)}/></div><div className="f"><label>CVV</label><input placeholder="•••"/></div></div>
          {payError&&<div style={{background:"rgba(192,57,43,.1)",border:"1px solid var(--danger)",borderRadius:5,padding:".6rem .85rem",fontSize:".8rem",color:"var(--dangerL)",marginTop:".5rem"}}>⚠ Payment failed: {payError}</div>}
        </>}
        {paymentSuccess&&<div style={{background:"rgba(100,200,100,.1)",border:"1px solid rgba(100,200,100,.35)",borderRadius:6,padding:".85rem 1rem",marginTop:".5rem",display:"flex",alignItems:"center",gap:".75rem"}}>
          <span style={{fontSize:"1.4rem"}}>✅</span>
          <div><div style={{fontFamily:"var(--fd)",fontSize:".82rem",color:"var(--okB)",letterSpacing:".06em",marginBottom:".15rem"}}>PAYMENT SUCCESSFUL</div>
          <div style={{fontSize:".78rem",color:"var(--muted)"}}>Your reservation is confirmed. Add your group members on the next screen to speed up check-in.</div></div>
        </div>}
      </>}
      {step===6&&isPrivate&&<>
        <p style={{fontSize:".82rem",color:"var(--muted)",marginBottom:".75rem"}}>Add your group's phone numbers to speed up check-in. You can also do this later from your reservations.</p>
        {(()=>{
          const uniqueSlotTimes=[...new Set(selSlots.map(s=>s.startTime))].sort();
          const multiSlot=uniqueSlotTimes.length>1;
          const isDualLane=lanesBooked>1;
          const capPerLane=perLaneCap;
          // Detect player count mismatch across slots — only show checkboxes if counts differ
          // For private, playerCount is fixed so no mismatch; checkboxes never needed
          const showSlotBoxes=false;
          // For dual-lane, split player inputs into two lane buckets
          // Lane 1 = first perLaneCap slots, Lane 2 = next perLaneCap slots
          // Player list = [booker, ...playerInputs]. We show them in lane groups.
          const allInputs=[
            {key:"p1",isBooker:!bookingForOther,input:bookingForOther?player1Input:{phone:currentUser.phone||"",userId:currentUser.id,name:currentUser.name,status:"found"}},
            ...playerInputs.map((pi,i)=>({key:`p${i+2}`,isBooker:false,input:pi,idx:i}))
          ];
          const lane1Inputs=isDualLane?allInputs.slice(0,capPerLane):allInputs;
          const lane2Inputs=isDualLane?allInputs.slice(capPerLane):[];
          const isVersus=selMode==="versus";
          const teamSize=isVersus?Math.floor(capPerLane/2):capPerLane;

          const renderPlayerRow=(entry,showRemove)=>{
            const {key,isBooker,input,idx}=entry;
            if(isBooker&&!bookingForOther){
              return <div key={key} className="pi-row" style={{background:"rgba(200,224,58,.04)",border:"1px solid rgba(200,224,58,.15)",borderRadius:4,padding:".6rem 1rem",marginBottom:".5rem"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:".5rem"}}>
                  <div>
                    <div style={{fontSize:".68rem",fontFamily:"var(--fd)",letterSpacing:".1em",color:"var(--acc)",marginBottom:".2rem"}}>PLAYER 1 — YOU</div>
                    <div style={{display:"flex",alignItems:"center",gap:".5rem"}}>
                      <span style={{background:"var(--acc2)",color:"var(--bg2)",borderRadius:"50%",width:24,height:24,display:"inline-flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:".72rem",flexShrink:0}}>{getInitials(currentUser.name)}</span>
                      <strong style={{fontSize:".88rem"}}>{currentUser.name}</strong>
                    </div>
                  </div>
                  <label style={{display:"flex",alignItems:"center",gap:".4rem",fontSize:".78rem",color:"var(--muted)",cursor:"pointer"}}>
                    <input type="checkbox" checked={bookingForOther} onChange={e=>{setBookingForOther(e.target.checked);setPlayer1Input({phone:"",userId:null,name:"",status:"idle"});}} style={{accentColor:"var(--acc)"}}/>
                    I'm not playing — booking for my group
                  </label>
                </div>
              </div>;
            }
            if(isBooker&&bookingForOther){
              return <div key={key} style={{marginBottom:".5rem"}}>
                <PlayerPhoneInput index={null} label="Player 1" value={player1Input} users={users} bookerUserId={null} activeWaiverDoc={activeWaiverDoc} onChange={setPlayer1Input} showFullName={true}/>
                <label style={{display:"flex",alignItems:"center",gap:".4rem",fontSize:".78rem",color:"var(--muted)",cursor:"pointer",marginTop:".35rem"}}>
                  <input type="checkbox" checked={bookingForOther} onChange={e=>setBookingForOther(e.target.checked)} style={{accentColor:"var(--acc)"}}/>
                  I'm not playing — booking for my group
                </label>
              </div>;
            }
            const currentUserIds=[
              bookingForOther?player1Input.userId:currentUser.id,
              ...playerInputs.filter((_,j)=>j!==idx).map(p=>p.userId)
            ].filter(Boolean);
            return <div key={key} style={{display:"flex",alignItems:"flex-start",gap:".5rem",marginBottom:".25rem"}}>
              <div style={{flex:1}}>
                <PlayerPhoneInput index={idx} value={input} users={users} bookerUserId={currentUser.id} activeWaiverDoc={activeWaiverDoc} existingUserIds={currentUserIds} onChange={v=>setPlayerInputs(p=>{const n=[...p];n[idx]=v;return n;})}/>
              </div>
              {showRemove&&(input.name||input.phone)&&<button className="btn btn-d btn-sm" style={{marginTop:"1.6rem",flexShrink:0}} onClick={()=>setPlayerInputs(p=>{const n=[...p];n[idx]={phone:"",userId:null,name:"",status:"idle"};return n;})} title="Clear player">✕</button>}
            </div>;
          };

          return <>
            {multiSlot&&<div style={{fontSize:".8rem",color:"var(--muted)",marginBottom:".75rem",background:"var(--surf2)",border:"1px solid var(--bdr)",borderRadius:5,padding:".6rem .85rem"}}>
              All players will be assigned to all <strong style={{color:"var(--txt)"}}>{uniqueSlotTimes.length} time slots</strong>. If a player is only attending one slot, update each time slot or lane by clicking <strong style={{color:"var(--txt)"}}>Manage Team</strong> from your reservations.
            </div>}
            {(isVersus&&isDualLane)?<>
              {/* Versus private dual-lane: Lane 1 → Team 1 + Team 2, Lane 2 → Team 1 + Team 2 */}
              {[{label:"LANE 1",inputs:lane1Inputs},{label:"LANE 2",inputs:lane2Inputs}].map(({label,inputs},li)=>(
                <div key={label} style={{background:"var(--surf2)",border:"1px solid var(--bdr)",borderRadius:6,padding:".65rem 1rem",marginBottom:"1rem"}}>
                  <div style={{fontFamily:"var(--fd)",fontSize:".72rem",color:"var(--acc)",letterSpacing:".1em",marginBottom:".75rem"}}>🏠 {label}</div>
                  {/* Team 1 — Hunters */}
                  <div style={{border:"1px solid rgba(200,224,58,.25)",borderRadius:4,padding:".5rem .75rem",marginBottom:".65rem"}}>
                    <div style={{fontFamily:"var(--fd)",fontSize:".68rem",color:"var(--acc)",letterSpacing:".08em",marginBottom:".5rem"}}>🏹 TEAM 1 — HUNTERS — UP TO {teamSize} PLAYERS</div>
                    <div className="player-inputs">{inputs.slice(0,teamSize).map(e=>renderPlayerRow(e,li===0?!e.isBooker:true))}</div>
                  </div>
                  {/* Team 2 — Coyotes */}
                  <div style={{border:"1px solid rgba(120,120,120,.2)",borderRadius:4,padding:".5rem .75rem"}}>
                    <div style={{fontFamily:"var(--fd)",fontSize:".68rem",color:"var(--muted)",letterSpacing:".08em",marginBottom:".5rem"}}>🐺 TEAM 2 — COYOTES — UP TO {teamSize} PLAYERS</div>
                    <div className="player-inputs">{inputs.slice(teamSize).map(e=>renderPlayerRow(e,true))}</div>
                    {li===1&&playerInputs.length<maxP-1&&<button className="btn btn-s btn-sm" style={{marginTop:".5rem"}} onClick={()=>setPlayerInputs(p=>[...p,{phone:"",userId:null,name:"",status:"idle"}])}>+ Add Player Slot</button>}
                  </div>
                </div>
              ))}
            </>:(isVersus&&!isDualLane)?<>
              {/* Versus private single-lane: Team 1 + Team 2 */}
              <div style={{border:"1px solid rgba(200,224,58,.25)",borderRadius:4,padding:".5rem .75rem",marginBottom:".65rem"}}>
                <div style={{fontFamily:"var(--fd)",fontSize:".68rem",color:"var(--acc)",letterSpacing:".08em",marginBottom:".5rem"}}>🏹 TEAM 1 — HUNTERS — UP TO {teamSize} PLAYERS</div>
                <div className="player-inputs">{allInputs.slice(0,teamSize).map(e=>renderPlayerRow(e,!e.isBooker))}</div>
              </div>
              <div style={{border:"1px solid rgba(120,120,120,.2)",borderRadius:4,padding:".5rem .75rem",marginBottom:".75rem"}}>
                <div style={{fontFamily:"var(--fd)",fontSize:".68rem",color:"var(--muted)",letterSpacing:".08em",marginBottom:".5rem"}}>🐺 TEAM 2 — COYOTES — UP TO {teamSize} PLAYERS</div>
                <div className="player-inputs">{allInputs.slice(teamSize).map(e=>renderPlayerRow(e,true))}</div>
                {playerInputs.length<maxP-1&&<button className="btn btn-s btn-sm" style={{marginBottom:".75rem"}} onClick={()=>setPlayerInputs(p=>[...p,{phone:"",userId:null,name:"",status:"idle"}])}>+ Add Player Slot</button>}
              </div>
            </>:isDualLane?<>
              {/* Coop dual-lane */}
              <div style={{background:"var(--surf2)",border:"1px solid var(--bdr)",borderRadius:6,padding:".65rem 1rem",marginBottom:"1rem"}}>
                <div style={{fontFamily:"var(--fd)",fontSize:".72rem",color:"var(--acc)",letterSpacing:".1em",marginBottom:".65rem"}}>🏠 LANE 1 — UP TO {capPerLane} PLAYERS</div>
                <div className="player-inputs">{lane1Inputs.map(e=>renderPlayerRow(e,!e.isBooker))}</div>
              </div>
              <div style={{background:"var(--surf2)",border:"1px solid var(--bdr)",borderRadius:6,padding:".65rem 1rem",marginBottom:".75rem"}}>
                <div style={{fontFamily:"var(--fd)",fontSize:".72rem",color:"var(--acc)",letterSpacing:".1em",marginBottom:".65rem"}}>🏠 LANE 2 — UP TO {capPerLane} PLAYERS</div>
                <div className="player-inputs">{lane2Inputs.map(e=>renderPlayerRow(e,true))}</div>
                {playerInputs.length<maxP-1&&<button className="btn btn-s btn-sm" style={{marginTop:".5rem"}} onClick={()=>setPlayerInputs(p=>[...p,{phone:"",userId:null,name:"",status:"idle"}])}>+ Add Player Slot</button>}
              </div>
            </>:<>
              {/* Coop single-lane */}
              <div className="player-inputs">{lane1Inputs.map(e=>renderPlayerRow(e,!e.isBooker))}</div>
              {playerInputs.length<maxP-1&&<button className="btn btn-s btn-sm" style={{marginBottom:".75rem"}} onClick={()=>setPlayerInputs(p=>[...p,{phone:"",userId:null,name:"",status:"idle"}])}>+ Add Player Slot</button>}
            </>}
          </>;
        })()}
      </>}
      <div className="ma">
        {step!==6&&<button className="btn btn-s" onClick={()=>{if(step===1)return onClose();if(step===4){setSelSlots([]);setSecondLanePrompt(null);}if(step===5){setPaymentSuccess(false);setPayError(null);}setStep(s=>s-1);}}>{step===1?"Cancel":"← Back"}</button>}
        {step===6&&<button className="btn btn-s" onClick={()=>{const w=window.open("","_blank","width=680,height=820");if(!w)return;w.document.write(`<!DOCTYPE html><html><head><title>Receipt — Sector 317</title><style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:'Segoe UI',Arial,sans-serif;background:#fff;color:#111;padding:2.5rem 3rem;}.logo{font-family:Arial Black,Arial,sans-serif;font-size:2rem;font-weight:900;letter-spacing:.12em;color:#c8e03a;margin-bottom:.15rem;}.tagline{font-size:.78rem;color:#555;letter-spacing:.1em;text-transform:uppercase;margin-bottom:2rem;}h2{font-size:1.1rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;border-bottom:2px solid #c8e03a;padding-bottom:.5rem;margin-bottom:1.25rem;}.row{display:flex;justify-content:space-between;padding:.5rem 0;border-bottom:1px solid #eee;font-size:.92rem;}.row .lbl{color:#555;}.row .val{font-weight:600;}.total-row{display:flex;justify-content:space-between;padding:.75rem 0;margin-top:.5rem;font-size:1.1rem;font-weight:700;border-top:2px solid #111;}.footer{margin-top:2.5rem;font-size:.74rem;color:#888;text-align:center;line-height:1.6;}.ref{font-family:monospace;}.no-print{text-align:center;margin-bottom:1.5rem;display:flex;gap:.75rem;justify-content:center;}button{padding:.55rem 1.4rem;border-radius:5px;font-size:.88rem;font-weight:600;cursor:pointer;border:2px solid #111;}button.print-btn{background:#c8e03a;color:#111;border-color:#c8e03a;}button.close-btn{background:#fff;color:#111;}@media print{.no-print{display:none;}}</style></head><body><div class="no-print"><button class="print-btn" onclick="window.print()">🖨 Print Receipt</button><button class="close-btn" onclick="window.close()">✕ Close</button></div><div class="logo">SECTOR 317</div><div class="tagline">Indoor Tactical Experience · Noblesville, IN</div><h2>Booking Receipt</h2><div class="row"><span class="lbl">Customer</span><span class="val">${currentUser.name}</span></div><div class="row"><span class="lbl">Session Type</span><span class="val">${selType?.name||"—"}</span></div><div class="row"><span class="lbl">Date</span><span class="val">${selDate?new Date(selDate+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"}):"—"}</span></div><div class="row"><span class="lbl">Time(s)</span><span class="val">${[...new Set(selSlots.map(s=>s.startTime))].sort().map(st=>fmt12(st)).join(", ")}</span></div><div class="row"><span class="lbl">Players</span><span class="val">${effPlayerCount}</span></div><div class="row"><span class="lbl">Status</span><span class="val">Confirmed ✔</span></div><div class="total-row"><span>Amount Charged</span><span>${fmtMoney(total)}</span></div><div class="footer">Sector 317 · sector317.com · Indianapolis, IN<br/>Payment processed securely via GoDaddy Payments<br/><span class="ref">Receipt generated ${new Date().toLocaleString("en-US",{dateStyle:"long",timeStyle:"short"})}</span><br/><em>Please retain this receipt for your records.</em></div></body></html>`);w.document.close();}}>🖨 Print Receipt</button>}
        {step<steps.length
          ?<>{!paymentSuccess&&step===5
              ?<button className="btn btn-p" disabled={paying} onClick={async()=>{setPaying(true);setPayError(null);try{
                // ── Step 1: process payment (simulated). Replace this block with real processor call.
                // Throw here on decline — nothing will be written to the DB.
                await new Promise(res=>setTimeout(res,1200));
                // e.g. real: const txn = await processGoDaddyPayment(cardToken, total); if(!txn.ok) throw new Error(txn.declineReason);
                // ── Step 2: payment confirmed — create reservation(s) + payment record
                const pgId=crypto.randomUUID();const bks=[];const isD=lanesBooked>1;if(isD){const uTimes=[...new Set(selSlots.map(s=>s.startTime))].sort();uTimes.forEach(st=>{selSlots.filter(s=>s.startTime===st).forEach((sl,i)=>bks.push({typeId:selType.id,date:selDate,startTime:sl.startTime,playerCount:perLaneCap,amount:pricePerSlot,laneIdx:i}));});}else{selSlots.forEach(s=>bks.push({typeId:selType.id,date:selDate,startTime:s.startTime,playerCount:effPlayerCount,amount:pricePerSlot,laneIdx:0}));}const rawDigits=cardNumber.replace(/\D/g,'');const cardLast4=rawDigits.length>=4?rawDigits.slice(-4):null;const ids=await onPayCreate({bookings:bks,userId:currentUser.id,customerName:currentUser.name,paymentGroupId:pgId,totalTransactionAmount:total,totalPlayerCount:effPlayerCount,cardLast4,cardExpiry:cardExpiry.trim()||null,cardHolder:nameOnCard.trim()||currentUser.name});setPendingResIds(ids);setPaymentSuccess(true);setStep(s=>s+1);}catch(e){setPayError(e.message||"Payment declined. Please check your card details and try again.");}finally{setPaying(false);}}}>{paying?"Processing…":`Pay ${fmtMoney(total)} & Confirm Reservation →`}</button>
              :<button className="btn btn-p" disabled={!canNext[step]} onClick={()=>setStep(s=>s+1)}>Continue →</button>
            }</>
          :<button className="btn btn-p" onClick={async()=>{
            const p1=bookingForOther
              ?{userId:player1Input.userId??null,name:player1Input.name||(player1Input.status==="found"?users.find(u=>u.id===player1Input.userId)?.name:"")}
              :{userId:currentUser.id,name:currentUser.name};
            const isDualLane=lanesBooked>1;
            const capPerLane=perLaneCap;
            const resolveInput=pi=>({userId:pi.userId??null,name:pi.name||(pi.userId?users.find(u=>u.id===pi.userId)?.name||"":"")});
            const totalPlayerCount=effPlayerCount;
            if(pendingResIds?.length>0){
              // Reservations already created at payment — just add players
              const playerItems=[];
              if(isDualLane){
                const lane1Players=[p1,...playerInputs.slice(0,capPerLane-1).filter(p=>p.phone||p.name).map(resolveInput)];
                const lane2Players=playerInputs.slice(capPerLane-1).filter(p=>p.phone||p.name).map(resolveInput);
                const uTimes=[...new Set(selSlots.map(s=>s.startTime))].sort();
                uTimes.forEach(st=>{
                  const r0=pendingResIds.find(r=>r.startTime===st&&r.laneIdx===0);
                  const r1=pendingResIds.find(r=>r.startTime===st&&r.laneIdx===1);
                  if(r0) playerItems.push({resId:r0.resId,players:lane1Players});
                  if(r1&&lane2Players.length) playerItems.push({resId:r1.resId,players:lane2Players});
                });
              }else{
                const allPlayers=[p1,...playerInputs.filter(p=>p.phone||p.name).map(resolveInput)];
                const uTimes=[...new Set(selSlots.map(s=>s.startTime))].sort();
                uTimes.forEach(st=>{
                  const r=pendingResIds.find(x=>x.startTime===st&&x.laneIdx===0);
                  if(r) playerItems.push({resId:r.resId,players:allPlayers});
                });
              }
              await onFinalize(playerItems);
              onClose();
            }else{
              // Fallback: create reservations now (should not normally reach here)
              const paymentGroupId=crypto.randomUUID();
              if(isDualLane){
                const lane1Players=[p1,...playerInputs.slice(0,capPerLane-1).filter(p=>p.phone||p.name).map(resolveInput)];
                const lane2Players=playerInputs.slice(capPerLane-1).filter(p=>p.phone||p.name).map(resolveInput);
                const uTimes=[...new Set(selSlots.map(s=>s.startTime))].sort();
                uTimes.forEach(st=>{
                  const slotsAtTime=selSlots.filter(s=>s.startTime===st);
                  const sl1=slotsAtTime[0];const sl2=slotsAtTime[1];
                  if(sl1) onBook({typeId:selType.id,date:selDate,startTime:sl1.startTime,playerCount:capPerLane,amount:pricePerSlot,userId:currentUser.id,customerName:currentUser.name,player1:lane1Players[0]||p1,bookingForOther:false,extraPlayers:lane1Players.slice(1),paymentGroupId,totalTransactionAmount:total,totalPlayerCount});
                  if(sl2&&lane2Players.length>0) onBook({typeId:selType.id,date:selDate,startTime:sl2.startTime,playerCount:capPerLane,amount:pricePerSlot,userId:currentUser.id,customerName:currentUser.name,player1:lane2Players[0],bookingForOther:false,extraPlayers:lane2Players.slice(1),paymentGroupId,totalTransactionAmount:total,totalPlayerCount});
                  else if(sl2) onBook({typeId:selType.id,date:selDate,startTime:sl2.startTime,playerCount:capPerLane,amount:pricePerSlot,userId:currentUser.id,customerName:currentUser.name,player1:{userId:null,name:""},bookingForOther:false,extraPlayers:[],paymentGroupId,totalTransactionAmount:total,totalPlayerCount});
                });
              }else{
                const allPlayers=[p1,...playerInputs.filter(p=>p.phone||p.name).map(resolveInput)];
                selSlots.forEach(s=>{onBook({typeId:selType.id,date:selDate,startTime:s.startTime,playerCount:effPlayerCount,amount:pricePerSlot,userId:currentUser.id,customerName:currentUser.name,player1:p1,bookingForOther,extraPlayers:allPlayers.slice(1),paymentGroupId,totalTransactionAmount:total,totalPlayerCount});});
              }
            }
          }}>Set Team →</button>}
      </div>
    </div></div>
  );
}

export default BookingWizard;
