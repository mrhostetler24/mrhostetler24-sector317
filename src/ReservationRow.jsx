import { useState, useRef, useCallback, useEffect } from "react"
import { hasValidWaiver, fmt, fmtMoney, fmtPhone, fmt12, todayStr, cleanPh, getInitials } from "./utils.js"
import { WaiverModal } from "./ui.jsx"
import { fetchUserByPhone, createGuestUser, fetchRunsForReservation } from "./supabase.js"
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

  useEffect(()=>{
    if(open&&res.status==='completed'&&runs===null&&!runsLoading){
      setRunsLoading(true);
      fetchRunsForReservation(res.id)
        .then(r=>setRuns(r))
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
              const TEAMS=[{num:1,label:'Blue',color:'#2d7dd2'},{num:2,label:'Red',color:'#c0392b'}];
              return(
                <div style={{display:'flex',gap:'1.5rem',flexWrap:'wrap'}}>
                  {TEAMS.map(({num,label,color})=>{
                    const teamRuns=runs.filter(r=>r.team===num);
                    if(!teamRuns.length)return null;
                    const names=res.players.filter(p=>p.team===num).map(p=>p.name.split(' ')[0]).join(', ');
                    return(
                      <div key={num} style={{flex:1,minWidth:180}}>
                        <div style={{fontSize:'.68rem',fontWeight:700,color,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:'.35rem'}}>
                          {label}{names?` — ${names}`:''}
                        </div>
                        <div style={{display:'flex',gap:'.6rem',flexWrap:'wrap'}}>
                          {teamRuns.map(r=><RunCard key={r.id} r={r} label={`Run ${r.runNumber}${r.role?` · ${r.role}`:''}`}/>)}
                        </div>
                      </div>
                    );
                  })}
                </div>
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
