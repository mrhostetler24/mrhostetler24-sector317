import { useState, useEffect } from "react"
import { cleanPh } from "./utils.js"
import { PhoneInput, genDefaultLeaderboardName, validateLbName } from "./ui.jsx"
import { supabase, updateOwnProfile, fetchEmailPreferences, updateEmailPreferences, unlinkSocialAuth } from "./supabase.js"

function AccountPanel({user,users,setUsers,onClose,onDeleteAccount}){
  const [name,setName]=useState(user.name||"");
  const [phone,setPhone]=useState(user.phone||"");
  const [email,setEmail]=useState(user.email||"");
  const [lbName,setLbName]=useState(user.leaderboardName||"");
  const [hideFromLb,setHideFromLb]=useState(user.hideFromLeaderboard??false);
  const [saving,setSaving]=useState(false);
  const [saved,setSaved]=useState(false);
  const [err,setErr]=useState(null);
  const [deleteConfirm,setDeleteConfirm]=useState(false);
  const [deleting,setDeleting]=useState(false);
  const handleDeleteAccount=async()=>{
    setDeleting(true);
    try{
      await unlinkSocialAuth();
      onDeleteAccount?.();
    }catch(e){setErr("Error: "+e.message);setDeleting(false);setDeleteConfirm(false);}
  };
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
        {user.access==="customer"&&<div style={{marginTop:"1.75rem",borderTop:"1px solid var(--danger)",paddingTop:"1.25rem"}}>
          <div style={{fontSize:".74rem",color:"var(--dangerL)",textTransform:"uppercase",letterSpacing:".08em",fontWeight:700,marginBottom:".75rem"}}>Danger Zone</div>
          {!deleteConfirm
            ?<button className="btn btn-s btn-full" style={{color:"var(--dangerL)",borderColor:"var(--danger)"}} onClick={()=>setDeleteConfirm(true)}>Delete Account</button>
            :<div style={{background:"rgba(192,57,43,.08)",border:"1px solid var(--danger)",borderRadius:5,padding:".85rem 1rem"}}>
              <div style={{fontSize:".82rem",color:"var(--txt)",marginBottom:".75rem",lineHeight:1.5}}>
                <strong>Are you sure?</strong> Your game history, reservations, and stats will be preserved, but your login access will be removed. You can reclaim this account by signing in and entering your phone number again.
              </div>
              <div style={{display:"flex",gap:".5rem"}}>
                <button className="btn btn-s" onClick={()=>setDeleteConfirm(false)} disabled={deleting}>Cancel</button>
                <button className="btn btn-s" style={{color:"var(--dangerL)",borderColor:"var(--danger)"}} disabled={deleting} onClick={handleDeleteAccount}>
                  {deleting?"Removing…":"Yes, Remove My Access"}
                </button>
              </div>
            </div>
          }
        </div>}
      </div>
    </div>
  </>);
}

export default AccountPanel
