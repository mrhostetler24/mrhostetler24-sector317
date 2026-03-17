import { useState } from "react"
import { supabase } from "./supabase.js"
const LOGO_URI = "/logo.png"

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

export default LoginScreen
