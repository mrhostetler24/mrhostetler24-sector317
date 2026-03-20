import { useState, useEffect, startTransition } from "react"
import { hasValidWaiver, fmt, fmtMoney, fmt12, fmtTS, todayStr, getTierInfo, TIER_COLORS, TIER_SHINE, getInitials, cleanPh, latestWaiverDate } from "./utils.js"
import { WaiverModal, WaiverViewModal, PlayerPhoneInput, genDefaultLeaderboardName, PlatoonTag } from "./ui.jsx"
import { supabase, fetchFriends, fetchAvailabilityReservations, updateReservation, rescheduleReservation, createGuestUser, syncReservationPlayers, calculateRunScore } from "./supabase.js"
import { vizRenderName, audRenderName } from "./envRender.jsx"
import AccountPanel from "./AccountPanel.jsx"
import ReceiptModal from "./ReceiptModal.jsx"
import PaymentReceiptModal from "./PaymentReceiptModal.jsx"
import BookingWizard from "./BookingWizard.jsx"
import MerchPortal from "./MerchPortal.jsx"
import SocialPortal from "./SocialPortal.jsx"
import ReservationModifyWizard from "./ReservationModifyWizard.jsx"

function CustomerPortal({user,reservations,setReservations,resTypes,sessionTemplates,users,setUsers,waiverDocs,activeWaiverDoc,onBook,onPayCreate,onFinalize,onSignWaiver,autoBook=false,onAutoBookDone,payments=[],setPayments,runs=[],onAlert}){
  const [tab,setTab]=useState("social");
  const [resSub,setResSub]=useState("upcoming");
  const [expandedPastId,setExpandedPastId]=useState(null);
  const [expandedUpcomingId,setExpandedUpcomingId]=useState(null);
  const [expandedLaneId,setExpandedLaneId]=useState(null);
  const [lbPlayerFilter,setLbPlayerFilter]=useState("all");
  const [lbPeriod,setLbPeriod]=useState("alltime");
  const [lbMode,setLbMode]=useState("cum");
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
          rescheduleReservation(id,date,startTime).then(updated=>{
            setReservations(p=>p.map(r=>r.id===id?{...r,date:updated.date,startTime:updated.startTime,rescheduled:true,originalDate:updated.originalDate,originalStartTime:updated.originalStartTime}:r));
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
        {user.canBook
          ?<button className="btn btn-p" style={{flexShrink:0}} onClick={()=>setShowBook(true)}>+ Book Mission</button>
          :<button className="btn btn-s sm-hide" style={{flexShrink:0,opacity:.6,cursor:"default"}} disabled>Booking agent coming soon!</button>
        }
      </div>
      {/* ── Top info row: Leaderboard + Rank combined · Store Credits ── */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:".75rem",marginBottom:"1.5rem"}}>
        {/* Leaderboard + Rank combined card */}
        <div style={{background:"var(--surf)",border:"1px solid var(--bdr)",borderTop:"3px solid var(--acc2)",borderRadius:6,padding:".85rem 1rem",display:"flex",flexDirection:"column",gap:".45rem"}}>
          <div style={{fontFamily:"var(--fd)",fontSize:".82rem",color:"var(--acc2)",letterSpacing:".08em",textTransform:"uppercase"}}>🏆 Leaderboard</div>
          <div style={{display:"flex",alignItems:"center",gap:".4rem",overflow:"visible"}}>
            {careerRuns!==null&&(()=>{
              const{current}=getTierInfo(careerRuns);
              return <div style={{flexShrink:0,padding:"4px",margin:"-4px"}}><img src={`/${current.key}.png`} alt={current.key} style={{height:16,width:"auto",display:"block",objectFit:"contain",...(TIER_SHINE[current.key]?{filter:TIER_SHINE[current.key]}:{})}}/></div>;
            })()}
            {user.platoonTag&&!user.hideFromLeaderboard&&<PlatoonTag tag={user.platoonTag} color={user.platoonBadgeColor} style={{fontSize:".88rem"}}/>}
            <span style={{fontSize:".88rem",color:user.hideFromLeaderboard?"var(--muted)":"var(--txt)",fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
              {user.hideFromLeaderboard?"Hidden":user.leaderboardName||genDefaultLeaderboardName(user.name,user.phone)}
            </span>
            {careerRuns!==null&&(()=>{
              const{current}=getTierInfo(careerRuns);
              return <span style={{fontSize:".88rem",fontFamily:"var(--fd)",letterSpacing:".06em",textTransform:"uppercase",color:TIER_COLORS[current.key],flexShrink:0}}>{current.name}</span>;
            })()}
          </div>
          {careerRuns!==null&&(()=>{
            const{next,sessionsToNext}=getTierInfo(careerRuns);
            return <div style={{fontSize:".72rem",color:"var(--muted)"}}>
              {next?<>{sessionsToNext} session{sessionsToNext!==1?"s":""} to <strong style={{color:TIER_COLORS[next.key]}}>{next.name}</strong></>:"Maximum rank achieved."}
              {" · "}{careerRuns} career run{careerRuns!==1?"s":""}
            </div>;
          })()}
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
        const fmtSec=s=>{if(s==null)return null;const m=Math.floor(s/60),sec=s%60;return`${m}:${String(sec).padStart(2,'0')}`;};
        const VIZ={V:'Standard',C:'Cosmic',R:'Rave',S:'Strobe',CS:'Cosmic+Strobe',B:'Dark'};
        const AUD={C:'Cranked',O:'Off',T:'Tunes'};
        const OPD={easy:'Easy',medium:'Medium',hard:'Hard',elite:'Elite'};
        const TC={1:{name:'Blue',col:'#3b82f6'},2:{name:'Red',col:'#ef4444'}};
        const audCode=rn=>rn.audio||(rn.cranked?'C':'T');
        const ns={fontFamily:'var(--fd)',fontSize:'.67rem',fontWeight:700,lineHeight:1};
        const roleColor=role=>{if(!role)return'var(--muted)';const rl=role.toLowerCase();if(rl.includes('hunt'))return'#c8e03a';if(rl.includes('coyot'))return'#c4a882';return'var(--muted)';};
        const fmtCard=d=>d?new Date(d+'T00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}):'';

        // Inline helpers matching PlatoonPortal pattern
        const TIER_SHINE_RES={apex:'drop-shadow(0 0 3px rgba(205,127,50,.55)) brightness(1.08)',elite:'drop-shadow(0 0 3px rgba(200,210,220,.6)) brightness(1.13)',legend:'drop-shadow(0 0 4px rgba(245,200,66,.65)) brightness(1.1)'};
        const tierClsRes=n=>{if(n>=100)return'legend';if(n>=86)return'elite';if(n>=71)return'apex';if(n>=56)return'enforcer';if(n>=40)return'sentinel';if(n>=28)return'vanguard';if(n>=18)return'striker';if(n>=10)return'operator';if(n>=4)return'initiate';return'recruit';};
        const ResAvatar=({url,hidden,name,sz=18})=>{const ini=name?(name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()):'';return<div style={{width:sz,height:sz,borderRadius:'50%',background:'var(--surf2)',border:'1px solid var(--bdr)',overflow:'hidden',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{url&&!hidden?<img src={url} style={{width:'100%',height:'100%',objectFit:'cover'}} alt=""/>:ini?<span style={{color:'var(--muted)',fontSize:Math.round(sz*.38),lineHeight:1}}>{ini}</span>:<span style={{color:'var(--muted)',fontSize:Math.round(sz*.55)}}>👤</span>}</div>;};
        const ResTierIcon=({totalRuns,sz=15})=>{const cls=tierClsRes(totalRuns??0);const shine=TIER_SHINE_RES[cls];return<img src={`/${cls}.png`} alt={cls} style={{width:sz,height:sz,objectFit:'contain',flexShrink:0,...(shine?{filter:shine}:{})}}/>;};

        // Reusable player chip — avatar + tier + [tag] + name (name highlighted if current user)
        const PChip=({p,small=false})=>{const u=users.find(x=>x.id===p.userId);const isMe=p.userId===user.id;const nm=p.name||u?.leaderboardName||u?.name||'—';const sz=small?18:18;return<div style={{display:'inline-flex',alignItems:'center',gap:'.25rem',whiteSpace:'nowrap'}}><ResAvatar url={u?.avatarUrl} hidden={u?.hideAvatar} name={nm} sz={sz}/><ResTierIcon totalRuns={u?.totalRuns??0} sz={15}/>{u?.platoonTag&&<span style={{fontSize:'.68rem',fontFamily:'var(--fc)',fontWeight:700,color:u.platoonBadgeColor||'#94a3b8'}}>[{u.platoonTag}]</span>}<span style={{fontSize:'.8rem',color:isMe?'var(--accB)':'var(--txt)',fontWeight:isMe?700:400}}>{nm}</span></div>;};

        // Group by date+startTime — same-slot multi-lane reservations collapse into one header
        const groupBySlot=items=>{const map=new Map();items.forEach(r=>{const k=`${r.date}|${r.startTime}`;if(!map.has(k))map.set(k,{key:k,date:r.date,startTime:r.startTime,items:[]});map.get(k).items.push(r);});return[...map.values()];};

        // Run detail panel — identical to prior table expand, now used inside the card
        const RunDetail=({r,rt})=>{
          const resRuns=runs.filter(rn=>rn.reservationId===r.id);
          if(!resRuns.length)return null;
          const myTeam=r.players.find(p=>p.userId===user.id)?.team??null;
          if(rt?.mode==='versus'){
            const grps={};resRuns.forEach(rn=>{const k=rn.runNumber??0;(grps[k]=grps[k]||[]).push(rn);});
            const sortedGrps=Object.entries(grps).sort(([a],[b])=>Number(a)-Number(b));
            const mwNum=r.warWinnerTeam!=null?r.warWinnerTeam:null;
            const iWon=mwNum!=null&&myTeam!=null&&mwNum===Number(myTeam);
            const winType=r.warWinType??null;
            const g1Elapsed=resRuns.find(rn=>rn.runNumber===1&&Number(rn.team)===1)?.elapsedSeconds??null;
            const g2Elapsed=resRuns.find(rn=>rn.runNumber===2&&Number(rn.team)===2)?.elapsedSeconds??null;
            const tbDiff=winType==='TIEBREAK'&&g1Elapsed!=null&&g2Elapsed!=null?Math.abs(g1Elapsed-g2Elapsed):null;
            return<>
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
                  {winType==='SWEEP'&&<span style={{fontSize:'.64rem',color:'var(--muted)',fontWeight:600}}>· Sweep</span>}
                  {winType==='TIEBREAK'&&<span style={{fontSize:'.64rem',color:'var(--muted)',fontWeight:600}}>· Tiebreaker{tbDiff>0?` (${fmtSec(tbDiff)} faster)`:''}</span>}
                  {iWon&&<span style={{fontWeight:700,color:'var(--okB)',marginLeft:'.2rem'}}>— You won!</span>}
                </div>}
              </div>
              {sortedGrps.map(([runNum,grp])=>{
                const teamRuns=[...grp].sort((a,b)=>{if(myTeam==null)return(a.team??0)-(b.team??0);if(Number(a.team)===Number(myTeam))return-1;if(Number(b.team)===Number(myTeam))return 1;return(a.team??0)-(b.team??0);});
                const runWinTeam=grp[0]?.winningTeam!=null?Number(grp[0].winningTeam):null;
                const runTime=fmtSec(grp[0]?.elapsedSeconds);
                const rEnv=grp[0];
                return<div key={runNum} style={{marginBottom:'.6rem',border:'1px solid var(--bdr)',borderRadius:7,overflow:'hidden',background:'var(--surf)'}}>
                  <div style={{background:'var(--bg2)',padding:'.3rem .85rem',fontSize:'.67rem',fontFamily:'var(--fd)',letterSpacing:'.08em',textTransform:'uppercase',color:'var(--muted)',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:'.3rem'}}>
                    <div style={{display:'flex',alignItems:'center',gap:'.5rem',flexWrap:'wrap'}}>
                      <span style={{color:'var(--txt)',fontWeight:700}}>Run {runNum}</span>
                      {rEnv.structure&&<span>Structure: {rEnv.structure}</span>}
                      {rEnv.visual&&<span style={{marginRight:'.4rem'}}>{vizRenderName(rEnv.visual,VIZ[rEnv.visual]||rEnv.visual,ns)}<span style={{color:'var(--muted)'}}> Viz</span></span>}
                      <span style={{marginRight:'.4rem'}}>{audRenderName(audCode(rEnv),AUD[audCode(rEnv)]||'Tunes',ns)}<span style={{color:'var(--muted)'}}> Aud</span></span>
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
                      return<div key={rn.id} style={{flex:1,padding:'.6rem .9rem',borderLeft:isMe?`3px solid ${tc.col}`:'none',borderRight:ti<teamRuns.length-1?'1px solid var(--bdr)':'none',background:won?tc.col+'18':undefined}}>
                        <div style={{display:'flex',alignItems:'center',gap:'.35rem',marginBottom:'.3rem',flexWrap:'wrap'}}>
                          <div style={{width:9,height:9,borderRadius:'50%',background:tc.col,flexShrink:0}}/>
                          <span style={{fontWeight:700,fontSize:'.8rem',color:tc.col}}>{tc.name}</span>
                          {displayRole&&<span style={{fontSize:'.72rem',fontWeight:700,color:rc,textTransform:'capitalize',letterSpacing:'.03em'}}>· {displayRole}</span>}
                        </div>
                        <div style={{fontFamily:'var(--fd)',fontSize:'1.35rem',fontWeight:700,color:won?tc.col:'var(--txt)'}}>{sc}</div>
                        <div style={{display:'flex',gap:'.25rem',flexWrap:'wrap',marginTop:'.25rem'}}>
                          {displayRole==='Hunter'&&rn.objectiveComplete!=null&&<span style={{fontSize:'.64rem',padding:'1px 6px',borderRadius:3,background:rn.objectiveComplete?'rgba(34,197,94,.12)':'rgba(239,68,68,.1)',color:rn.objectiveComplete?'var(--okB)':'var(--dangerL)',border:'1px solid '+(rn.objectiveComplete?'rgba(34,197,94,.3)':'rgba(239,68,68,.3)')}}>{rn.objectiveComplete?'✓ Objective':'✗ Objective'}</span>}
                          {won&&<span style={{fontSize:'.64rem',padding:'1px 6px',borderRadius:3,background:'rgba(34,197,94,.12)',color:'var(--okB)',border:'1px solid rgba(34,197,94,.3)'}}>✓ Won run</span>}
                        </div>
                        {teamPlayers.length>0&&<div style={{marginTop:'.4rem',display:'flex',flexWrap:'wrap',gap:'.15rem .5rem'}}>{teamPlayers.map((p,pi)=>{const pu=users.find(u=>u.id===p.userId);return<span key={pi} style={{fontSize:'.68rem',color:p.userId===user.id?'var(--accB)':'var(--muted)',fontWeight:p.userId===user.id?700:400}}><PlatoonTag tag={pu?.platoonTag} color={pu?.platoonBadgeColor} style={{marginRight:'.2rem'}}/>{p.name||'—'}</span>;})}</div>}
                      </div>;
                    })}
                  </div>
                </div>;
              })}
            </>;
          }
          // Co-op
          return<>{resRuns.map((rn,i)=>{
            const sc=rn.score??calculateRunScore(rn);
            const t=fmtSec(rn.elapsedSeconds);
            return<div key={rn.id} style={{marginBottom:'.6rem',border:'1px solid var(--bdr)',borderRadius:7,overflow:'hidden',background:'var(--surf)'}}>
              <div style={{background:'var(--bg2)',padding:'.3rem .85rem',fontSize:'.67rem',fontFamily:'var(--fd)',letterSpacing:'.08em',textTransform:'uppercase',color:'var(--muted)',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:'.3rem'}}>
                <div style={{display:'flex',alignItems:'center',gap:'.5rem',flexWrap:'wrap'}}>
                  <span style={{color:'var(--txt)',fontWeight:700}}>Run {rn.runNumber??i+1}</span>
                  {rn.structure&&<span>Structure: {rn.structure}</span>}
                  {rn.visual&&<span style={{marginRight:'.4rem'}}>{vizRenderName(rn.visual,VIZ[rn.visual]||rn.visual,ns)}<span style={{color:'var(--muted)'}}> Viz</span></span>}
                  <span style={{marginRight:'.4rem'}}>{audRenderName(audCode(rn),AUD[audCode(rn)]||'Tunes',ns)}<span style={{color:'var(--muted)'}}> Aud</span></span>
                  {rn.liveOpDifficulty&&<span>OP: {OPD[rn.liveOpDifficulty]||rn.liveOpDifficulty}</span>}
                </div>
                {t&&<span>{t}</span>}
              </div>
              <div style={{padding:'.6rem .9rem'}}>
                <div style={{fontFamily:'var(--fd)',fontSize:'1.35rem',fontWeight:700,color:'var(--txt)',marginBottom:'.25rem'}}>{sc}</div>
                <div style={{display:'flex',flexWrap:'wrap',gap:'.25rem',marginBottom:'.4rem'}}>
                  <span style={{fontSize:'.64rem',padding:'1px 6px',borderRadius:3,background:rn.targetsEliminated?'rgba(34,197,94,.12)':'rgba(239,68,68,.1)',color:rn.targetsEliminated?'var(--okB)':'var(--dangerL)',border:'1px solid '+(rn.targetsEliminated?'rgba(34,197,94,.3)':'rgba(239,68,68,.3)')}}>{rn.targetsEliminated?'✓ Targets':'✗ Missed'}</span>
                  <span style={{fontSize:'.64rem',padding:'1px 6px',borderRadius:3,background:rn.objectiveComplete?'rgba(34,197,94,.12)':'rgba(239,68,68,.1)',color:rn.objectiveComplete?'var(--okB)':'var(--dangerL)',border:'1px solid '+(rn.objectiveComplete?'rgba(34,197,94,.3)':'rgba(239,68,68,.3)')}}>{rn.objectiveComplete?'✓ Objective':'✗ Objective'}</span>
                </div>
                {r.players.length>0&&<div style={{display:'flex',flexWrap:'wrap',gap:'.15rem .5rem'}}>{r.players.map((p,pi)=>{const pu=users.find(u=>u.id===p.userId);return<span key={pi} style={{fontSize:'.68rem',color:p.userId===user.id?'var(--accB)':'var(--muted)',fontWeight:p.userId===user.id?700:400}}><PlatoonTag tag={pu?.platoonTag} color={pu?.platoonBadgeColor} style={{marginRight:'.2rem'}}/>{p.name||'—'}</span>;})}</div>}
              </div>
            </div>;
          })}</>;
        };

        // Single reservation card — matches platoon SessionCard layout
        const ResCard=({r,isUpcoming,expandId,togExpand,inGroup})=>{
          const rt=resTypes.find(x=>x.id===r.typeId);
          const resRuns=runs.filter(rn=>rn.reservationId===r.id);
          const openSlots=r.playerCount-(r.players?.length??0);
          const isExp=expandId===r.id;
          const hasRuns=!isUpcoming&&resRuns.length>0;
          const canExp=isUpcoming||hasRuns;
          return<div style={{background:'var(--surf2)',border:'1px solid var(--bdr)',borderRadius:8,marginBottom:inGroup?'.5rem':'.65rem',overflow:'hidden'}}>
            <div style={{display:'flex',alignItems:'flex-start',gap:'.75rem',padding:'.65rem .85rem',borderBottom:isExp?'1px solid var(--bdr)':'none',cursor:canExp?'pointer':'default',userSelect:'none'}} onClick={()=>canExp&&togExpand(r.id)}>
              {!inGroup&&<div style={{textAlign:'center',minWidth:52,flexShrink:0}}>
                <div style={{fontFamily:'var(--fd)',fontSize:'.85rem',color:isUpcoming?'var(--acc)':'var(--txt)',lineHeight:1.2}}>{fmtCard(r.date)}</div>
                {r.startTime&&<div style={{fontSize:'.7rem',color:'var(--muted)',marginTop:'.1rem'}}>{fmt12(r.startTime)}</div>}
              </div>}
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:'flex',alignItems:'center',gap:'.4rem',marginBottom:'.35rem',flexWrap:'wrap'}}>
                  <span style={{fontSize:'.88rem',color:'var(--txt)',fontFamily:'var(--fd)'}}>{rt?.name}</span>
                  <span className={`badge b-${rt?.mode}`}>{rt?.mode}</span>
                  <span className={`badge b-${rt?.style}`}>{rt?.style}</span>
                </div>
                <div style={{display:'flex',flexWrap:'wrap',gap:'.3rem .65rem',alignItems:'center'}}>
                  {(r.players??[]).map((p,i)=><PChip key={i} p={p}/>)}
                  {isUpcoming&&openSlots>0&&<span style={{fontSize:'.75rem',color:'var(--warnL)',fontWeight:600}}>⚑ {openSlots} open</span>}
                </div>
              </div>
              <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:'.3rem',flexShrink:0}}>
                <div style={{display:'flex',alignItems:'center',gap:'.35rem'}}>
                  <span style={{fontSize:'.8rem',color:'var(--accB)',fontWeight:600,whiteSpace:'nowrap'}}>{fmtMoney(r.amount)}</span>
                  <span className={`badge ${r.status==="confirmed"?"b-ok":r.status==="completed"?"b-done":r.status==="no-show"?"b-noshow":"b-cancel"}`}>{r.status}</span>
                </div>
                {canExp&&<span style={{fontSize:'.75rem',color:'var(--muted)'}}>{isExp?'▾':'▸'}</span>}
              </div>
            </div>
            {isExp&&isUpcoming&&<div style={{padding:'.85rem 1rem'}}>
              <div style={{display:'flex',flexWrap:'wrap',gap:'.5rem .65rem',marginBottom:openSlots>0?'.6rem':'.75rem'}}>
                {(r.players??[]).map((p,i)=><div key={i} style={{display:'inline-flex',alignItems:'center',gap:'.35rem',background:'var(--surf)',border:'1px solid var(--bdr)',borderRadius:6,padding:'.3rem .65rem'}}><PChip p={p}/></div>)}
                {Array.from({length:openSlots}).map((_,i)=><div key={'op'+i} style={{display:'inline-flex',alignItems:'center',gap:'.3rem',background:'rgba(251,191,36,.06)',border:'1px dashed rgba(251,191,36,.4)',borderRadius:6,padding:'.3rem .65rem',color:'var(--warnL)',fontSize:'.78rem',fontWeight:600}}>⚑ Open Slot</div>)}
              </div>
              {openSlots>0&&<div style={{fontSize:'.78rem',color:'var(--muted)',marginBottom:'.7rem'}}>{openSlots} unfilled {openSlots===1?'slot':'slots'} — use <strong style={{color:'var(--txt)'}}>Manage Team</strong> to invite your group.</div>}
              <div style={{display:'flex',gap:'.5rem',flexWrap:'wrap'}}>
                {r.status!=="completed"&&r.status!=="no-show"&&<>
                  <button className="btn btn-s btn-sm" onClick={e=>{e.stopPropagation();setEditResId(r.id);}}>Manage Team</button>
                  <button className="btn btn-s btn-sm" onClick={e=>{e.stopPropagation();startTransition(()=>setModifyRes({res:r,mode:'reschedule'}));}}>Reschedule</button>
                  {rt?.style==="open"&&<button className="btn btn-ok btn-sm" onClick={e=>{e.stopPropagation();startTransition(()=>setModifyRes({res:r,mode:'upgrade'}));}}>⬆ Upgrade</button>}
                </>}
              </div>
            </div>}
            {isExp&&hasRuns&&<div style={{padding:'.85rem 1rem'}}><RunDetail r={r} rt={rt}/></div>}
          </div>;
        };

        // Multi-lane timeslot group — matches platoon TimeslotGroup layout
        const SlotGroup=({group,isUpcoming,expandGrpId,togGrp,expandCardId,togCard})=>{
          const isOpen=expandGrpId===group.key;
          const rt=resTypes.find(x=>x.id===group.items[0]?.typeId);
          const allP=[];const seenP=new Set();
          group.items.forEach(r=>(r.players??[]).forEach(p=>{const k=p.userId||p.name;if(!seenP.has(k)){seenP.add(k);allP.push(p);}}));
          const openSlots=group.items.reduce((s,r)=>s+(r.playerCount-(r.players?.length??0)),0);
          return<div style={{background:'var(--surf2)',border:'1px solid var(--bdr)',borderRadius:8,marginBottom:'.65rem',overflow:'hidden'}}>
            <div style={{display:'flex',alignItems:'flex-start',gap:'.75rem',padding:'.65rem .85rem',cursor:'pointer',userSelect:'none',borderBottom:isOpen?'1px solid var(--bdr)':'none'}} onClick={()=>togGrp(group.key)}>
              <div style={{textAlign:'center',minWidth:52,flexShrink:0}}>
                <div style={{fontFamily:'var(--fd)',fontSize:'.85rem',color:isUpcoming?'var(--acc)':'var(--txt)',lineHeight:1.2}}>{fmtCard(group.date)}</div>
                {group.startTime&&<div style={{fontSize:'.7rem',color:'var(--muted)',marginTop:'.1rem'}}>{fmt12(group.startTime)}</div>}
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:'flex',alignItems:'center',gap:'.4rem',marginBottom:'.35rem',flexWrap:'wrap'}}>
                  <span style={{fontSize:'.88rem',color:'var(--txt)',fontFamily:'var(--fd)'}}>{rt?.name}</span>
                  <span style={{fontSize:'.75rem',color:'var(--muted)',fontWeight:400}}>· {group.items.length} lanes</span>
                  {isUpcoming&&openSlots>0&&<span style={{fontSize:'.75rem',color:'var(--warnL)',fontWeight:600}}>⚑ {openSlots} open</span>}
                </div>
                <div style={{display:'flex',flexWrap:'wrap',gap:'.3rem .65rem',alignItems:'center'}}>
                  {allP.map((p,i)=><PChip key={i} p={p}/>)}
                </div>
              </div>
              <span style={{fontSize:'.75rem',color:'var(--muted)',flexShrink:0,paddingTop:'.2rem'}}>{isOpen?'▾':'▸'}</span>
            </div>
            {isOpen&&<div style={{padding:'.65rem .85rem'}}>
              {group.items.map((r,i)=>{const rtl=resTypes.find(x=>x.id===r.typeId);return<div key={r.id}>
                <div style={{fontSize:'.7rem',fontFamily:'var(--fd)',color:'var(--muted)',letterSpacing:'.07em',textTransform:'uppercase',marginBottom:'.3rem',marginTop:i>0?'.75rem':0}}>
                  Lane {i+1}{rtl?.name?` · ${rtl.name}`:''}
                </div>
                <ResCard r={r} isUpcoming={isUpcoming} expandId={expandCardId} togExpand={togCard} inGroup={true}/>
              </div>;})}
            </div>}
          </div>;
        };

        const upGrps=groupBySlot(upcoming);
        const pastGrps=groupBySlot(past);
        const togUp=id=>setExpandedUpcomingId(x=>x===id?null:id);
        const togPast=id=>setExpandedPastId(x=>x===id?null:id);
        const togLane=id=>setExpandedLaneId(x=>x===id?null:id);

        return<>
          <div className="tabs" style={{marginBottom:'1rem',borderBottom:'1px solid var(--bdr)'}}>
            <button className={`tab${resSub==="upcoming"?" on":""}`} onClick={()=>setResSub("upcoming")}>Upcoming ({upcoming.length})</button>
            <button className={`tab${resSub==="past"?" on":""}`} onClick={()=>setResSub("past")}>Past ({past.length})</button>
          </div>
          {resSub==="upcoming"&&<div>
            {upGrps.map(g=>g.items.length===1
              ?<ResCard key={g.key} r={g.items[0]} isUpcoming expandId={expandedUpcomingId} togExpand={togUp}/>
              :<SlotGroup key={g.key} group={g} isUpcoming expandGrpId={expandedUpcomingId} togGrp={togUp} expandCardId={expandedLaneId} togCard={togLane}/>
            )}
            {!upcoming.length&&<div className="empty"><div className="ei">🎯</div><p>No upcoming missions.</p></div>}
          </div>}
          {resSub==="past"&&<div>
            {pastGrps.map(g=>g.items.length===1
              ?<ResCard key={g.key} r={g.items[0]} expandId={expandedPastId} togExpand={togPast}/>
              :<SlotGroup key={g.key} group={g} expandGrpId={expandedPastId} togGrp={togPast} expandCardId={expandedLaneId} togCard={togLane}/>
            )}
            {!past.length&&<div className="empty"><div className="ei">🏁</div><p>No past missions yet.</p></div>}
          </div>}
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
          const sc=Number(r.leaderboard_score??0).toFixed(1);
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
                <div style={{flexShrink:0,padding:"4px",margin:"-4px"}}>
                  <img src={`/${tier.key}.png`} alt={tier.key} style={{height:16,width:"auto",maxWidth:32,display:"block",objectFit:"contain",opacity:.9,...(TIER_SHINE[tier.key]?{filter:TIER_SHINE[tier.key]}:{})}}/>
                </div>
                <div>
                  <div style={{fontFamily:"var(--fc)",fontWeight:700,fontSize:"1rem",color:isMe?"var(--accB)":"var(--txt)"}}>
                    <PlatoonTag tag={r.platoon_tag} color={r.platoon_badge_color} style={{marginRight:'.3em'}}/>
                    {r.player_name??'Unknown'}{isMe&&<span style={{fontSize:".7rem",color:"var(--acc2)",marginLeft:".5rem"}}>← you</span>}
                  </div>
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
            <button className={`btn btn-sm ${lbMode==="cum"?"btn-p":"btn-s"}`} onClick={()=>setLbMode("cum")}>Cumulative</button>
            <button className={`btn btn-sm ${lbMode==="avg"?"btn-p":"btn-s"}`} onClick={()=>setLbMode("avg")}>Avg Top 50</button>
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

export default CustomerPortal
