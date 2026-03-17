import { useState } from "react"

function MergeAccountsModal({users,targetUser,reservations,onMerge,onClose}){
  const [query,setQuery]=useState("");
  const [selected,setSelected]=useState(null);
  const [saving,setSaving]=useState(false);
  const [err,setErr]=useState(null);
  const q=query.trim().toLowerCase();
  const options=users.filter(u=>
    u.id!==targetUser.id &&
    u.active!==false &&
    !u.name?.includes("[merged]") &&
    (q===""||u.name?.toLowerCase().includes(q)||u.phone?.includes(q))
  );
  const bookingCount=uid=>reservations.filter(r=>r.userId===uid).length;
  return(
    <div className="mo"><div className="mc">
      <div className="mt2">Merge Accounts</div>
      <div style={{background:"var(--surf2)",border:"1px solid var(--bdr)",borderRadius:5,padding:".65rem .9rem",marginBottom:"1rem",fontSize:".83rem"}}>
        Keeping: <strong style={{color:"var(--accB)"}}>{targetUser.name}</strong>
        {targetUser.authProvider&&<span style={{marginLeft:".5rem",color:"var(--muted)"}}>{targetUser.authProvider}</span>}
      </div>
      {!selected&&<>
        <div style={{fontSize:".78rem",color:"var(--muted)",marginBottom:".6rem"}}>Select the account to absorb. Its bookings, player records, and payments will move to <strong>{targetUser.name}</strong>, then it will be deactivated.</div>
        <div className="f"><label>Search by name or phone</label><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Type to filter…" autoFocus/></div>
        <div style={{maxHeight:220,overflowY:"auto",border:"1px solid var(--bdr)",borderRadius:5}}>
          {options.length===0&&<div style={{padding:"1rem",textAlign:"center",color:"var(--muted)",fontSize:".8rem"}}>No matching users</div>}
          {options.map(u=>(
            <div key={u.id} onClick={()=>setSelected(u)} style={{padding:".55rem .85rem",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:"1px solid var(--bdr)",background:"transparent"}} onMouseEnter={e=>e.currentTarget.style.background="var(--surf2)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <div>
                <div style={{fontWeight:600,fontSize:".88rem"}}>{u.name}</div>
                <div style={{fontSize:".75rem",color:"var(--muted)",fontFamily:"monospace"}}>{u.phone?`(${u.phone.slice(0,3)}) ${u.phone.slice(3,6)}-${u.phone.slice(6)}`:"—"}</div>
              </div>
              <div style={{display:"flex",gap:".4rem",alignItems:"center"}}>
                {u.authProvider&&<span style={{fontSize:".7rem",background:"var(--acc2)",color:"var(--accB)",padding:"2px 6px",borderRadius:99}}>{u.authProvider}</span>}
                <span style={{fontSize:".75rem",color:"var(--muted)"}}>{bookingCount(u.id)} booking{bookingCount(u.id)!==1?"s":""}</span>
              </div>
            </div>
          ))}
        </div>
      </>}
      {selected&&<>
        <div style={{background:"rgba(184,150,12,.06)",border:"1px solid var(--warn)",borderRadius:5,padding:".75rem .9rem",marginBottom:".75rem"}}>
          <div style={{fontWeight:600,marginBottom:".3rem"}}>Merge <span style={{color:"var(--warnL)"}}>{selected.name}</span> → <span style={{color:"var(--accB)"}}>{targetUser.name}</span>?</div>
          <div style={{fontSize:".8rem",color:"var(--muted)"}}>All of {selected.name}'s bookings ({bookingCount(selected.id)}), player records, and payments will transfer to {targetUser.name}.</div>
          <div style={{fontSize:".8rem",color:"var(--warnL)",marginTop:".3rem"}}>⚠ {selected.name}'s account will be deactivated and cannot be undone.</div>
        </div>
        {err&&<div style={{color:"var(--err)",fontSize:".8rem",marginBottom:".5rem"}}>{err}</div>}
      </>}
      <div className="ma">
        {selected?<>
          <button className="btn btn-s" onClick={()=>{setSelected(null);setErr(null);}}>← Back</button>
          <button className="btn btn-p" style={{background:"var(--err)",borderColor:"var(--err)"}} disabled={saving} onClick={async()=>{setSaving(true);setErr(null);try{await onMerge(targetUser.id,selected.id);}catch(e){setErr(e.message);setSaving(false);}}}>
            {saving?"Merging…":"Confirm Merge"}
          </button>
        </>:<>
          <button className="btn btn-s" onClick={onClose}>Cancel</button>
        </>}
      </div>
    </div></div>
  );
}

export default MergeAccountsModal
