import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { hasValidWaiver, latestWaiverEntry, fmtTS, cleanPh, fmt12, addDaysStr, getInitials } from './utils.js';
import { fetchUserByPhone } from './supabase.js';

// ── AuthBadge ─────────────────────────────────────────────────────
export function AuthBadge({provider}){
  if(!provider)return <span style={{fontSize:".72rem",color:"var(--muted)",fontStyle:"italic"}}>Phone only</span>;
  const icons={google:<svg viewBox="0 0 24 24" width="12" height="12" style={{flexShrink:0}}><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>,microsoft:<svg viewBox="0 0 12 12" width="12" height="12" style={{flexShrink:0}}><rect x="0" y="0" width="5.5" height="5.5" fill="#F25022"/><rect x="6.5" y="0" width="5.5" height="5.5" fill="#7FBA00"/><rect x="0" y="6.5" width="5.5" height="5.5" fill="#00A4EF"/><rect x="6.5" y="6.5" width="5.5" height="5.5" fill="#FFB900"/></svg>,apple:<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" style={{flexShrink:0,color:"var(--txt)"}}><path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.7 9.05 7.4c1.42.07 2.4.78 3.22.8 1.23-.24 2.4-1 3.72-.84 1.55.2 2.73.93 3.5 2.3-3.29 2.04-2.53 6.47.51 7.68-.65 1.6-1.48 3.2-2.95 4.94zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>};
  return <span style={{display:"inline-flex",alignItems:"center",gap:".3rem",background:"var(--surf2)",border:"1px solid var(--bdr)",borderRadius:12,padding:".1rem .45rem",fontSize:".68rem",fontWeight:600,color:"var(--txt)"}}>{icons[provider]}{provider.charAt(0).toUpperCase()+provider.slice(1)}</span>;
}

// ── Toast ─────────────────────────────────────────────────────────
export function Toast({msg,variant="",onClose}){
  useEffect(()=>{const t=setTimeout(onClose,4500);return()=>clearTimeout(t);},[]);
  return <div className={`toast${variant?" toast-"+variant:""}`}>{variant==="alert"?"⚠ ":"✓ "}{msg}</div>;
}

// ── Toggle ────────────────────────────────────────────────────────
export function Toggle({on,onChange}){
  return <label className="toggle-switch" onClick={()=>onChange(!on)}><div className={`toggle-track${on?" on":""}`}><div className="toggle-knob"/></div></label>;
}

// ── WaiverTooltip ─────────────────────────────────────────────────
export function WaiverTooltip({user,waiverDocs,activeWaiverDoc,readOnly=false,onResign}){
  const [open,setOpen]=useState(false);
  const [tipPos,setTipPos]=useState(null);
  const wrapRef=useRef(null);
  useEffect(()=>{
    if(!open)return;
    const handler=(e)=>{if(wrapRef.current&&!wrapRef.current.contains(e.target))setOpen(false);};
    document.addEventListener('mousedown',handler);
    return()=>document.removeEventListener('mousedown',handler);
  },[open]);
  const valid=hasValidWaiver(user,activeWaiverDoc);
  const entry=latestWaiverEntry(user);
  const doc=waiverDocs?.find(d=>d.id===entry?.waiverDocId);
  const needsNew=entry&&activeWaiverDoc&&entry.waiverDocId!==activeWaiverDoc.id;
  const expired=!valid&&!!entry&&!needsNew;
  if(!user)return <span style={{fontSize:".75rem",color:"var(--muted)"}}>—</span>;
  const label=valid?"✓ Valid":needsNew?"↻ New Version":expired?"⚠ Expired":"✗ None";
  const color=valid?"var(--okB)":needsNew||expired?"var(--warnL)":"var(--dangerL)";
  const handleClick=()=>{
    if(!open&&wrapRef.current){
      const rect=wrapRef.current.getBoundingClientRect();
      const above=rect.top>window.innerHeight/2;
      setTipPos({left:rect.left+rect.width/2,above,...(above?{bottom:window.innerHeight-rect.top+6}:{top:rect.bottom+6})});
    }
    setOpen(o=>!o);
  };
  return(
    <div className="waiver-tooltip-wrap" ref={wrapRef}>
      <span style={{fontSize:".75rem",cursor:"pointer",color,textDecoration:"underline dotted",textUnderlineOffset:"2px"}} onClick={handleClick}>{label}</span>
      {open&&tipPos&&<div className={`waiver-tip${tipPos.above?"":" below"}`} style={{position:'fixed',zIndex:9999,left:tipPos.left,...(tipPos.above?{bottom:tipPos.bottom,top:'auto'}:{top:tipPos.top,bottom:'auto'})}}>
        <div style={{fontWeight:700,marginBottom:".35rem",color}}>{valid?"Valid":needsNew?"New Version Required":expired?"Expired":"None on File"}</div>
        {entry&&<div style={{color:"var(--muted)",fontSize:".72rem",marginBottom:".15rem"}}>Signed: {fmtTS(entry.signedAt)}</div>}
        {entry?.signedName&&<div style={{color:"var(--muted)",fontSize:".72rem",marginBottom:".15rem"}}>Name: {entry.signedName}</div>}
        {doc&&<div style={{color:"var(--muted)",fontSize:".72rem",marginBottom:".5rem"}}>Doc: {doc.name} v{doc.version}</div>}
        {!readOnly&&!valid&&<button className="btn btn-warn btn-sm" style={{marginTop:".25rem"}} onClick={()=>{setOpen(false);onResign?.();}}>Sign Waiver</button>}
        <button className="btn btn-s btn-sm" style={{marginLeft:".4rem",marginTop:".25rem"}} onClick={()=>setOpen(false)}>Close</button>
      </div>}
    </div>
  );
}

// ── RunsCell ──────────────────────────────────────────────────────
export function RunsCell({runs,reservations,resTypes,userId}){
  const [pos,setPos]=useState(null);
  const ref=useRef(null);
  const bd=useMemo(()=>{
    const resIds=new Set(reservations.filter(r=>r.userId===userId||r.players?.some(p=>p.userId===userId)).map(r=>r.id));
    const out={coopPri:0,coopOpen:0,vsPri:0,vsOpen:0};
    runs.filter(r=>resIds.has(r.reservationId)).forEach(run=>{
      const res=reservations.find(r=>r.id===run.reservationId);
      const rt=res?resTypes.find(t=>t.id===res.typeId):null;
      if(rt?.mode==='coop'&&rt?.style==='private')out.coopPri++;
      else if(rt?.mode==='coop')out.coopOpen++;
      else if(rt?.mode==='versus'&&rt?.style==='private')out.vsPri++;
      else out.vsOpen++;
    });
    return out;
  },[runs,reservations,resTypes,userId]);
  const total=bd.coopPri+bd.coopOpen+bd.vsPri+bd.vsOpen;
  if(total===0)return<span style={{color:'var(--muted)'}}>—</span>;
  const multi=Object.values(bd).filter(v=>v>0).length>1;
  const handleEnter=()=>{
    if(!ref.current)return;
    const rect=ref.current.getBoundingClientRect();
    const above=rect.top>window.innerHeight/2;
    setPos({left:rect.left+rect.width/2,above,...(above?{bottom:window.innerHeight-rect.top+6}:{top:rect.bottom+6})});
  };
  return(
    <span ref={ref} style={{fontFamily:'var(--fd)',cursor:multi?'default':'',borderBottom:multi?'1px dotted var(--muted)':''}}
      onMouseEnter={multi?handleEnter:undefined} onMouseLeave={()=>setPos(null)}>
      {total}
      {pos&&<div style={{position:'fixed',zIndex:9999,left:pos.left,transform:'translateX(-50%)',background:'var(--surf2)',border:'1px solid var(--bdr)',borderRadius:6,padding:'.5rem .8rem',fontSize:'.72rem',color:'var(--txt)',boxShadow:'0 4px 16px rgba(0,0,0,.4)',whiteSpace:'nowrap',...(pos.above?{bottom:pos.bottom,top:'auto'}:{top:pos.top,bottom:'auto'})}}>
        <div style={{fontFamily:'var(--fd)',fontSize:'.63rem',letterSpacing:'.08em',color:'var(--muted)',textTransform:'uppercase',marginBottom:'.3rem'}}>Run Breakdown</div>
        {bd.coopPri>0&&<div>Co-op Private: <strong>{bd.coopPri}</strong></div>}
        {bd.coopOpen>0&&<div>Co-op Open Play: <strong>{bd.coopOpen}</strong></div>}
        {bd.vsPri>0&&<div>Versus Private: <strong>{bd.vsPri}</strong></div>}
        {bd.vsOpen>0&&<div>Versus Open Play: <strong>{bd.vsOpen}</strong></div>}
      </div>}
    </span>
  );
}

// ── WaiverModal ───────────────────────────────────────────────────
export function WaiverModal({playerName,waiverDoc,onClose,onSign}){
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

// ── WaiverViewModal ───────────────────────────────────────────────
export function WaiverViewModal({user,waiverDocs,activeWaiverDoc,onClose}){
  const entry=latestWaiverEntry(user);
  const doc=waiverDocs?.find(d=>d.id===entry?.waiverDocId)||activeWaiverDoc;
  const valid=hasValidWaiver(user,activeWaiverDoc);
  return(
    <div className="mo"><div className="mc" style={{maxWidth:600}}>
      <div className="mt2">Your Waiver Details</div>
      <div style={{background:"var(--bg2)",border:"1px solid var(--bdr)",borderRadius:5,padding:".9rem",marginBottom:"1rem",fontSize:".84rem"}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:".3rem"}}><span style={{color:"var(--muted)"}}>Status</span><span style={{color:valid?"var(--okB)":"var(--dangerL)",fontWeight:700}}>{valid?"✓ Valid":"✗ Not Current"}</span></div>
        {entry&&<><div style={{display:"flex",justifyContent:"space-between",marginBottom:".3rem"}}><span style={{color:"var(--muted)"}}>Signed On</span><span>{fmtTS(entry.signedAt)}</span></div>
        {entry.signedName&&<div style={{display:"flex",justifyContent:"space-between",marginBottom:".3rem"}}><span style={{color:"var(--muted)"}}>Name on File</span><span>{entry.signedName}</span></div>}</>}
        {doc&&<div style={{display:"flex",justifyContent:"space-between"}}><span style={{color:"var(--muted)"}}>Document</span><span>{doc.name} v{doc.version}</span></div>}
      </div>
      {doc&&<div className="wvr-scroll" style={{height:220}}><span className="wvr-title">{doc.name}</span>{doc.body}</div>}
      <div className="ma"><button className="btn btn-p" onClick={onClose}>Close</button></div>
    </div></div>
  );
}

// ── PhoneInput ────────────────────────────────────────────────────
const NAME_SUFFIXES=new Set(['jr','jr.','sr','sr.','ii','iii','iv','v','vi','esq','esq.']);
export { getInitials }; // re-export from utils for any direct consumer

function fmtPhoneMask(raw){const d=cleanPh(raw);if(d.length<=3)return d;if(d.length<=6)return`(${d.slice(0,3)}) ${d.slice(3)}`;return`(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6,10)}`;}

export function PhoneInput({value,onChange,placeholder="(555) 555-5555",disabled=false,autoFocus=false,onEnter}){
  const [display,setDisplay]=useState(value?fmtPhoneMask(value):"");
  useEffect(()=>{setDisplay(value?fmtPhoneMask(value):"");},[value]);
  const handleChange=e=>{const raw=cleanPh(e.target.value);setDisplay(fmtPhoneMask(raw));onChange(raw);};
  return(
    <div className="phone-wrap" style={{opacity:disabled?.5:1}}>
      <span className="phone-prefix">+1</span>
      <input type="tel" value={display} onChange={handleChange} placeholder={placeholder}
        disabled={disabled} autoFocus={autoFocus} onKeyDown={e=>e.key==="Enter"&&onEnter?.()} maxLength={14}/>
    </div>
  );
}

// ── PlayerPhoneInput ──────────────────────────────────────────────
export function genDefaultLeaderboardName(name,phone){
  const initials=getInitials(name);
  const last4=phone?cleanPh(phone).slice(-4):"0000";
  return`${initials}-${last4}`;
}

const BLOCKED=["fuck","shit","ass","bitch","cunt","dick","cock","pussy","nigger","nigga","faggot","fag","whore","slut","bastard","piss","twat","wank","spic","chink","kike","wetback","retard","rape","nazi","porn","pron","sex","nude","naked","cum","jizz","tits","boob","penis","vagina","anus","dildo","boner","horny","milf","hentai","tranny","homo","dyke"];
function normLeet(s){return s.toLowerCase().replace(/3/g,"e").replace(/0/g,"o").replace(/@/g,"a").replace(/1/g,"i").replace(/\$/g,"s").replace(/5/g,"s").replace(/!/g,"i").replace(/\+/g,"t");}
function hasProfanity(s){if(!s)return false;const n=normLeet(s.replace(/[^a-zA-Z0-9@$!+]/g,""));return BLOCKED.some(w=>n.includes(w));}
export function validateLbName(val,allUsers,currentUserId){
  if(!val||!val.trim())return null;
  const t=val.trim();
  if(t.length<2)return"Must be at least 2 characters";
  if(t.length>24)return"Max 24 characters";
  if(!/^[a-zA-Z0-9 _\-\.]+$/.test(t))return"Letters, numbers, spaces, _ - . only";
  if(hasProfanity(t))return"That name isn't allowed — please choose another";
  const taken=allUsers.some(u=>u.id!==currentUserId&&u.leaderboardName?.toLowerCase()===t.toLowerCase());
  if(taken)return"That leaderboard name is already taken — choose a different one and try again";
  return null;
}

export function PlayerPhoneInput({index,value,onChange,users,bookerUserId,showFullName=false,label=null,activeWaiverDoc=null,existingUserIds=[]}){
  const {phone="",userId=null,name="",status="idle"}=value;
  const clean=cleanPh(phone);
  const [searching,setSearching]=useState(false);
  const lookup=useCallback(async()=>{
    if(clean.length<10)return;
    setSearching(true);
    try{
      const dbUser=await fetchUserByPhone(clean);
      if(dbUser){onChange({phone:clean,userId:dbUser.id,name:dbUser.name,status:"found"});}
      else{onChange({phone:clean,userId:null,name:name||"",status:"notfound"});}
    }finally{setSearching(false);}
  },[clean]);
  const foundUser=status==="found"?users.find(u=>u.id===userId):null;
  const displayLabel=label||(index!=null?`Player ${index+2}`:"Player");
  return(
    <div className="pi-row">
      <div className="pi-label">{displayLabel}</div>
      <div style={{display:"flex",gap:".5rem",alignItems:"flex-end",flexWrap:"wrap"}}>
        <div className="f" style={{marginBottom:0,flex:1,minWidth:200}}>
          <label>Cell Number</label>
          <div className="phone-wrap">
            <span className="phone-prefix">+1</span>
            <input type="tel" maxLength={10} value={phone}
              onChange={e=>{onChange({phone:cleanPh(e.target.value),userId:null,name:"",status:"idle"});}}
              onKeyDown={e=>e.key==="Enter"&&lookup()}
              placeholder="Enter phone number with area code"/>
          </div>
        </div>
        {(status==="notfound"||status==="named")&&(
          <div className="f" style={{marginBottom:0,flex:1,minWidth:150}}>
            <label>Full Name <span style={{color:"var(--danger)"}}>*</span></label>
            <input value={name}
              onChange={e=>onChange({...value,name:e.target.value,status:e.target.value.trim()?"named":"notfound"})}
              onKeyDown={e=>e.key==="Enter"&&name.trim()&&onChange({...value,name:name.trim(),status:"named"})}
              placeholder="First Last"/>
          </div>
        )}
        {status==="idle"&&<button className="btn btn-s btn-sm" style={{marginBottom:2}} disabled={clean.length<10||searching} onClick={lookup}>{searching?"…":"Search →"}</button>}
        {status==="notfound"&&name.trim()&&(
          <button className="btn btn-ok btn-sm" style={{marginBottom:2}} onClick={()=>onChange({...value,name:name.trim(),status:"named"})}>✓ Confirm</button>
        )}
      </div>
      {status==="found"&&(foundUser||userId)&&(()=>{
        const isDup=existingUserIds.includes(userId);
        const waiverOk=foundUser&&activeWaiverDoc?hasValidWaiver(foundUser,activeWaiverDoc):null;
        return <div className="pi-found" style={{display:"flex",alignItems:"center",gap:".4rem",flexWrap:"wrap"}}>
          {isDup
            ? <span style={{color:"var(--dangerL)",fontWeight:600,fontSize:".78rem"}}>⚠ This player is already on the roster</span>
            : <>
                <span style={{background:"var(--acc2)",color:"var(--bg2)",borderRadius:"50%",width:24,height:24,display:"inline-flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:".72rem",flexShrink:0}}>{getInitials(foundUser?.name||name)}</span>
                {showFullName
                  ? <span>✓ <strong style={{color:"var(--txt)"}}>{foundUser?.name||name}</strong></span>
                  : <span style={{color:"var(--okB)"}}>✓ Player found{foundUser?.authProvider&&<span style={{marginLeft:".35rem",fontSize:".68rem",color:"var(--muted)"}}>({foundUser.authProvider})</span>}</span>}
                {waiverOk===true&&<span style={{fontSize:".68rem",background:"rgba(100,200,100,.12)",color:"var(--okB)",border:"1px solid rgba(100,200,100,.3)",borderRadius:3,padding:"1px 5px"}}>✓ Waiver signed</span>}
                {waiverOk===false&&<span style={{fontSize:".68rem",background:"rgba(192,57,43,.1)",color:"var(--dangerL)",border:"1px solid rgba(192,57,43,.3)",borderRadius:3,padding:"1px 5px"}}>⚠ No waiver</span>}
              </>}
        </div>;
      })()}
      {status==="named"&&(
        <div className="pi-found" style={{display:"flex",alignItems:"center",gap:".4rem"}}>
          <span style={{background:"var(--surf2)",color:"var(--acc)",border:"1px solid var(--acc2)",borderRadius:"50%",width:24,height:24,display:"inline-flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:".72rem",flexShrink:0}}>{getInitials(name)}</span>
          <span style={{color:"var(--accB)"}}>✓ <strong>{name}</strong></span>
          <span style={{fontSize:".68rem",color:"var(--muted)"}}>— new guest, account will be prepped</span>
        </div>
      )}
      {status==="notfound"&&clean.length===10&&!name.trim()&&<div className="pi-notfound">⚠ Nothing found — add their name and we'll prep their account</div>}
    </div>
  );
}

// ── DateNav ───────────────────────────────────────────────────────
export function DateNav({selected,today,onChange}){
  const offs=[-3,-2,-1,0,1,2,3],ops=[0.25,0.5,0.75,1,0.75,0.5,0.25];
  const dns=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  function fmtS(d){const[,m,dy]=d.split('-');return parseInt(m)+'/'+parseInt(dy);}
  function dn(d){return dns[new Date(d+'T00:00:00').getDay()];}
  return(
    <div style={{display:'flex',alignItems:'center',gap:'.25rem',marginBottom:'.75rem',overflowX:'auto',flexWrap:'nowrap'}}>
      {selected!==today&&<button className="btn btn-s btn-sm" style={{flexShrink:0,marginRight:'.25rem'}} onClick={()=>onChange(today)}>Today</button>}
      {offs.map((offset,i)=>{
        const d=addDaysStr(selected,offset);
        const isSel=offset===0;
        return <button key={offset} onClick={()=>onChange(d)} style={{flexShrink:0,minWidth:44,textAlign:'center',padding:'.3rem .35rem',background:isSel?'var(--acc)':'transparent',border:isSel?'1px solid var(--acc)':'1px solid transparent',borderRadius:'var(--r)',cursor:'pointer',opacity:ops[i],color:isSel?'var(--bg)':'var(--txt)',fontWeight:isSel?700:400,lineHeight:1.2}}>
          <div style={{fontSize:'.65rem'}}>{dn(d)}</div>
          <div style={{fontSize:'.78rem'}}>{fmtS(d)}</div>
        </button>;
      })}
      <input type="date" value={selected} onChange={e=>onChange(e.target.value)} style={{marginLeft:'auto',flexShrink:0,background:'var(--bg2)',border:'1px solid var(--bdr)',borderRadius:'var(--r)',color:'var(--txt)',padding:'.25rem .4rem',fontSize:'.8rem'}}/>
    </div>
  );
}
