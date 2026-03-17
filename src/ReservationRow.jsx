import { useState, useRef, useCallback, useEffect, Fragment } from "react"
import { hasValidWaiver, fmt, fmtMoney, fmtPhone, fmt12, todayStr, cleanPh, getInitials } from "./utils.js"
import { WaiverModal } from "./ui.jsx"
import { fetchUserByPhone, createGuestUser, fetchRunsForReservation, fetchObjectives } from "./supabase.js"
import ReservationModifyWizard from "./ReservationModifyWizard.jsx"

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
  const [runs,setRuns]=useState(null);
  const [runsLoading,setRunsLoading]=useState(false);
  const [objectives,setObjectives]=useState([]);

  useEffect(()=>{
    if(open&&res.status==='completed'&&runs===null&&!runsLoading){
      setRunsLoading(true);
      Promise.all([fetchRunsForReservation(res.id),fetchObjectives()])
        .then(([r,objs])=>{setRuns(r);setObjectives(objs);})
        .catch(()=>setRuns([]))
        .finally(()=>setRunsLoading(false));
    }
  },[open,res.status,res.id]);
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
        {/* ── Score section for completed reservations ── */}
        {res.status==='completed'&&(
          <div style={{borderTop:'1px solid var(--bdr)',padding:'.6rem 1.25rem',background:'rgba(0,0,0,.12)'}}>
            {runsLoading&&<span style={{fontSize:'.78rem',color:'var(--muted)'}}>Loading scores…</span>}
            {!runsLoading&&runs!==null&&runs.length===0&&<span style={{fontSize:'.78rem',color:'var(--muted)'}}>No runs recorded.</span>}
            {!runsLoading&&runs&&runs.length>0&&(()=>{
              const fmtSec=s=>`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
              const RunCard=({r,label})=>(
                <div style={{background:'var(--bg3)',borderRadius:5,padding:'.4rem .7rem',minWidth:110}}>
                  <div style={{fontSize:'.65rem',color:'var(--muted)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:'.2rem'}}>{label}</div>
                  {r.score!=null&&<div style={{fontSize:'1.05rem',fontWeight:700,color:'var(--accB)',lineHeight:1.1}}>{r.score.toFixed(1)}{r.warBonus>0&&<span style={{fontSize:'.65rem',color:'var(--warnL)',marginLeft:'.3rem'}}>+{r.warBonus.toFixed(1)} war</span>}</div>}
                  <div style={{fontSize:'.68rem',color:'var(--muted)',marginTop:'.15rem',display:'flex',gap:'.35rem',flexWrap:'wrap'}}>
                    <span style={{color:r.objectiveComplete?'var(--okB)':'var(--muted)'}}>{r.objectiveComplete?'✓':'✗'} obj</span>
                    {r.targetsEliminated&&<span style={{color:'var(--okB)'}}>✓ tgts</span>}
                    {r.elapsedSeconds>0&&<span>{fmtSec(r.elapsedSeconds)}</span>}
                  </div>
                </div>
              );
              if(rt?.mode==='coop'){
                return(
                  <div style={{display:'flex',gap:'.75rem',flexWrap:'wrap',alignItems:'flex-start'}}>
                    {runs.map(r=><RunCard key={r.id} r={r} label={`Run ${r.runNumber}`}/>)}
                  </div>
                );
              }
              const runNums=[...new Set(runs.map(r=>r.runNumber))].sort((a,b)=>a-b);
              const blueNames=res.players.filter(p=>p.team===1).map(p=>p.name.split(' ')[0]).join(', ');
              const redNames=res.players.filter(p=>p.team===2).map(p=>p.name.split(' ')[0]).join(', ');
              const winnerTeam=res.warWinnerTeam;
              const winType=res.warWinType;
              const winnerLabel=winnerTeam===1?'Blue':winnerTeam===2?'Red':null;
              const winnerColor=winnerTeam===1?'#2d7dd2':winnerTeam===2?'#c0392b':null;
              let winTypeStr='';
              if(winType==='SWEEP')winTypeStr='Sweep';
              else if(winType==='TIEBREAK'){
                const bh=runs.find(r=>r.team===1&&r.role==='hunter');
                const rh=runs.find(r=>r.team===2&&r.role==='hunter');
                const diff=bh&&rh?Math.abs(bh.elapsedSeconds-rh.elapsedSeconds):null;
                winTypeStr=`Tiebreaker${diff?` · ${fmtSec(diff)} faster`:''}`;
              }
              return(
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:'.82rem',tableLayout:'fixed'}}>
                  <colgroup><col style={{width:'12%'}}/><col style={{width:'44%'}}/><col style={{width:'44%'}}/></colgroup>
                  <thead>
                    <tr style={{borderBottom:'1px solid var(--bdr)'}}>
                      <th style={{padding:'.25rem .4rem',color:'var(--muted)',fontWeight:600,fontSize:'.68rem',textAlign:'left'}}>Run</th>
                      <th style={{padding:'.25rem .4rem',color:'#2d7dd2',fontWeight:700,fontSize:'.72rem',textAlign:'left',textTransform:'uppercase',letterSpacing:'.05em'}}>Blue{blueNames?` — ${blueNames}`:''}</th>
                      <th style={{padding:'.25rem .4rem',color:'#c0392b',fontWeight:700,fontSize:'.72rem',textAlign:'left',textTransform:'uppercase',letterSpacing:'.05em'}}>Red{redNames?` — ${redNames}`:''}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runNums.map(n=>{
                      const blueRun=runs.find(r=>r.runNumber===n&&r.team===1);
                      const redRun=runs.find(r=>r.runNumber===n&&r.team===2);
                      const blueRole=blueRun?.role;
                      const redRole=redRun?.role;
                      const hunterRun=blueRole==='hunter'?blueRun:redRole==='hunter'?redRun:null;
                      const objId=blueRun?.objectiveId??redRun?.objectiveId;
                      const objName=objId?objectives.find(o=>o.id===objId)?.name:null;
                      const objComplete=hunterRun?.objectiveComplete??null;
                      const timeStr=hunterRun?.elapsedSeconds>0?fmtSec(hunterRun.elapsedSeconds):null;
                      const roleParts=[];
                      if(blueRole)roleParts.push(`Blue: ${blueRole}`);
                      if(redRole)roleParts.push(`Red: ${redRole}`);
                      const headerMeta=[roleParts.join(' · '),objName,objComplete!=null?(objComplete?'✓ Complete':'✗ Incomplete'):null,timeStr].filter(Boolean).join('  ·  ');
                      return(
                        <Fragment key={n}>
                          <tr style={{background:'rgba(255,255,255,.03)',borderTop:'1px solid var(--bdr)'}}>
                            <td colSpan={3} style={{padding:'.28rem .4rem .18rem',fontSize:'.7rem',color:'var(--muted)'}}>
                              <span style={{color:'var(--txt)',fontWeight:700,marginRight:'.45rem'}}>Run {n}</span>
                              {headerMeta}
                            </td>
                          </tr>
                          <tr>
                            <td style={{padding:'.15rem .4rem .4rem'}}></td>
                            <td style={{padding:'.15rem .4rem .4rem',color:'#2d7dd2',fontWeight:700,fontSize:'.9rem'}}>
                              {blueRun?.score!=null?blueRun.score.toFixed(1):'—'}
                              {blueRun?.warBonus>0&&<span style={{fontSize:'.65rem',color:'var(--warnL)',marginLeft:'.3rem'}}>+{blueRun.warBonus.toFixed(1)} war</span>}
                            </td>
                            <td style={{padding:'.15rem .4rem .4rem',color:'#c0392b',fontWeight:700,fontSize:'.9rem'}}>
                              {redRun?.score!=null?redRun.score.toFixed(1):'—'}
                              {redRun?.warBonus>0&&<span style={{fontSize:'.65rem',color:'var(--warnL)',marginLeft:'.3rem'}}>+{redRun.warBonus.toFixed(1)} war</span>}
                            </td>
                          </tr>
                        </Fragment>
                      );
                    })}
                    {winnerLabel&&(
                      <tr style={{borderTop:'2px solid var(--bdr)'}}>
                        <td colSpan={3} style={{padding:'.35rem .4rem',fontWeight:700,fontSize:'.78rem'}}>
                          <span style={{color:winnerColor}}>{winnerLabel} wins</span>
                          {winTypeStr&&<span style={{color:'var(--muted)',marginLeft:'.5rem',fontWeight:400}}>— {winTypeStr}</span>}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              );
            })()}
          </div>
        )}
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

export default ReservationRow
