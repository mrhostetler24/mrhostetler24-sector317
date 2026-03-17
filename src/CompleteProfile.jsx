import { useState } from "react"
import { cleanPh } from "./utils.js"
import { PhoneInput, genDefaultLeaderboardName } from "./ui.jsx"
const LOGO_URI = "/logo.png"

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

export default CompleteProfile
