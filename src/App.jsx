import { useState, useEffect, useRef } from "react"
import "./app.css"
import { sortTemplates, ACCESS_LEVELS } from "./utils.js"
import { AuthBadge, Toast, genDefaultLeaderboardName } from "./ui.jsx"
import { emailWelcome } from "./emails.js"
import LandingPage from "./LandingPage.jsx"
import OpsView from "./OpsView.jsx"
import KioskPage from "./KioskPage.jsx"
import StructurePage from "./StructurePage.jsx"
import {
  supabase, fetchWaiverDocs, fetchResTypes, fetchSessionTemplates, fetchStaffRoles,
  fetchAllUsers, fetchReservations, fetchShifts, fetchPayments,
  fetchRunsForReservations, fetchUserAuthDates, fetchUserByPhone,
  updateUser, linkOAuthUser, linkAuthToGuest,
  createUser, createGuestUser, signWaiver, addPlayerToReservation,
  createReservation, createPayment, deductUserCredits
} from "./supabase.js"
import AccountPanel from "./AccountPanel.jsx"
import CompleteProfile from "./CompleteProfile.jsx"
import LoginScreen from "./LoginScreen.jsx"
import CustomerPortal from "./CustomerPortal.jsx"
import AdminPortal from "./AdminPortal.jsx"
const LOGO_URI = "/logo.png"
const APP_VERSION = __GIT_HASH__

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
  const [refreshing,setRefreshing]=useState(false);
  const refreshOpsData=async()=>{
    if(refreshing)return;
    setRefreshing(true);
    try{
      const[u,res]=await Promise.all([fetchAllUsers(),fetchReservations()]);
      setUsers(u);setReservations(res);
      fetchRunsForReservations(res.map(r=>r.id)).then(setRuns).catch(()=>{});
    }catch(e){console.error('Refresh failed:',e);}
    setRefreshing(false);
  };
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
        // If the existing account already has a different auth identity, block the merge —
        // this phone belongs to someone else and we must not let a new OAuth user claim it.
        if(existing.authId&&existing.authId!==pendingUser.authId){
          throw new Error('This phone number is already linked to another account. Please use a different number or reach out to a Sector 317 team member.');
        }
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

  const handleDeleteAccount=async()=>{
    await supabase.auth.signOut();
    setCurrentUser(null);setPendingUser(null);setShowNavAccount(false);setShowLanding(true);
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

  const handleSetUsers=(updater)=>setUsers(updater);

  const handleSetReservations=(updater)=>setReservations(updater);

  const handleSetShifts=async(updater)=>{
    const next=typeof updater==="function"?updater(shifts):updater;
    setShifts(next);
  };

  const handleAlert=msg=>{setToastAlert(msg);setTimeout(()=>setToastAlert(null),5000);};
  const liveUser=users.find(u=>u.id===currentUser?.id)||currentUser;
  const portal=!liveUser?null:liveUser.access==="customer"?"customer":"admin";
  const [viewAs,setViewAs]=useState(null); // null | "manager" | "staff" | "customer"
  const [viewAsOpen,setViewAsOpen]=useState(false);
  const [navMenuOpen,setNavMenuOpen]=useState(false);
  const [staffNavTarget,setStaffNavTarget]=useState(null);
  const isAdminOrManager=liveUser&&(liveUser.access==="admin"||liveUser.access==="manager");
  const canViewAs=liveUser&&(isAdminOrManager||liveUser.access==="staff");
  const effectivePortal=viewAs?(viewAs==="customer"?"customer":"admin"):portal;
  const effectiveUser=viewAs?{...liveUser,access:viewAs}:liveUser;
  const [showNavAccount,setShowNavAccount]=useState(false);
  const [showBackTop,setShowBackTop]=useState(false);
  useEffect(()=>{
    const handler=()=>{
      const el=document.querySelector('.content');
      if(el)setShowBackTop(el.scrollTop>300);
    };
    const el=document.querySelector('.content');
    el?.addEventListener('scroll',handler,{passive:true});
    return()=>el?.removeEventListener('scroll',handler);
  },[liveUser]);

  if(window.location.pathname==='/kiosk') return <><KioskPage/></>
  if(window.location.pathname==='/alpha') return <><StructurePage structure="Alpha"/></>
  if(window.location.pathname==='/bravo') return <><StructurePage structure="Bravo"/></>;

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
            <button onClick={refreshOpsData} title="Refresh data" style={{background:'none',border:'none',padding:'0 .3rem',cursor:'pointer',color:'rgba(255,255,255,.18)',fontSize:'2.4rem',lineHeight:1,display:'flex',alignItems:'center',transition:'color .2s',...(refreshing?{color:'rgba(255,255,255,.5)',animation:'spin .8s linear infinite'}:{})}} onMouseEnter={e=>e.currentTarget.style.color='rgba(255,255,255,.45)'} onMouseLeave={e=>!refreshing&&(e.currentTarget.style.color='rgba(255,255,255,.18)')}>↻</button>
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
      {showNavAccount&&liveUser&&<AccountPanel user={liveUser} users={users} setUsers={handleSetUsers} onClose={()=>setShowNavAccount(false)} onDeleteAccount={handleDeleteAccount}/>}
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
            <div style={{padding:".75rem 1rem .5rem",fontWeight:700,fontSize:".95rem",color:"var(--txt)",wordBreak:"break-word"}}>{liveUser.name}</div>
            <div className="nav-mobile-row" style={{justifyContent:"space-between"}}>
              {liveUser.authProvider?<AuthBadge provider={liveUser.authProvider}/>:<span/>}
              <span style={{fontSize:".75rem",color:"var(--muted)",cursor:"pointer"}} onClick={()=>{setShowNavAccount(true);setNavMenuOpen(false);}}>⚙ Account</span>
            </div>
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
        {effectivePortal==="admin"&&<AdminPortal user={effectiveUser} reservations={reservations} setReservations={handleSetReservations} resTypes={resTypes} setResTypes={handleSetResTypes} sessionTemplates={sessionTemplates} setSessionTemplates={handleSetSessionTemplates} waiverDocs={waiverDocs} setWaiverDocs={handleSetWaiverDocs} activeWaiverDoc={activeWaiver} users={users} setUsers={handleSetUsers} shifts={shifts} setShifts={handleSetShifts} payments={payments} setPayments={setPayments} onAlert={handleAlert} userAuthDates={userAuthDates} runs={runs} staffRoles={staffRoles} navTarget={staffNavTarget} onNavConsumed={()=>setStaffNavTarget(null)}/>}
      </div>
    </div>
  </>);
}
