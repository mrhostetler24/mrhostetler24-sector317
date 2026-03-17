import { useState, useEffect } from "react"
import { fetchUserRoles } from "./supabase.js"

function DeactivateStaffModal({userToDeactivate,futureShifts,users,shifts,onConfirm,onCancel}){
  const [choice,setChoice]=useState('open');
  const [reassignTo,setReassignTo]=useState('');
  const [userRoles,setUserRoles]=useState([]);
  const [saving,setSaving]=useState(false);
  useEffect(()=>{fetchUserRoles().then(r=>setUserRoles(r)).catch(()=>{});},[]);
  const activeStaff=users.filter(u=>u.active&&u.id!==userToDeactivate.id&&['staff','manager','admin'].includes(u.access));
  function tmToMin(t){if(!t)return 0;const p=(t+'').split(':').map(Number);return p[0]*60+(p[1]||0);}
  function canFillRole(su,role){if(!role)return true;if(su.role===role)return true;return userRoles.some(r=>r.userId===su.id&&r.role===role);}
  function hasConflict(su,shift){return shifts.some(s=>{if(s.staffId!==su.id||s.id===shift.id||s.date!==shift.date)return false;return tmToMin(s.start)<tmToMin(shift.end)&&tmToMin(s.end)>tmToMin(shift.start);});}
  const target=reassignTo?users.find(u=>u.id===reassignTo):null;
  const assignable=target?futureShifts.filter(s=>canFillRole(target,s.role)&&!hasConflict(target,s)):[];
  const willOpen=choice==='open'?futureShifts.length:futureShifts.length-assignable.length;
  async function handleConfirm(){
    setSaving(true);
    try{
      const updates=futureShifts.map(s=>{
        if(choice==='reassign'&&target&&canFillRole(target,s.role)&&!hasConflict(target,s))
          return{id:s.id,staffId:target.id,open:false};
        return{id:s.id,staffId:null,open:true};
      });
      await onConfirm(updates);
    }finally{setSaving(false);}
  }
  return(
    <div className="mo"><div className="mc" style={{maxWidth:480}}>
      <div className="mt2">Handle Shifts — {userToDeactivate.name}</div>
      <p style={{fontSize:'.88rem',color:'var(--muted)',margin:'0 0 .75rem'}}>{futureShifts.length} upcoming assigned shift{futureShifts.length!==1?'s':''} must be handled before deactivating.</p>
      <div style={{display:'flex',flexDirection:'column',gap:'.5rem',marginBottom:'1rem'}}>
        <label style={{display:'flex',alignItems:'center',gap:'.5rem',cursor:'pointer',fontSize:'.88rem'}}>
          <input type="radio" name="dchoice" checked={choice==='open'} onChange={()=>{setChoice('open');setReassignTo('');}}/>
          Mark all {futureShifts.length} shifts as <strong style={{marginLeft:'.25rem'}}>Open</strong>
        </label>
        <label style={{display:'flex',alignItems:'center',gap:'.5rem',cursor:'pointer',fontSize:'.88rem'}}>
          <input type="radio" name="dchoice" checked={choice==='reassign'} onChange={()=>setChoice('reassign')}/>
          Reassign to another staff member
        </label>
      </div>
      {choice==='reassign'&&<>
        <div className="f"><label>Reassign to</label>
          <select value={reassignTo} onChange={e=>setReassignTo(e.target.value)}>
            <option value="">— select staff —</option>
            {activeStaff.map(u=><option key={u.id} value={u.id}>{u.name}{u.role?' ('+u.role+')':''}</option>)}
          </select>
        </div>
        {target&&<div style={{fontSize:'.8rem',color:'var(--muted)',marginBottom:'.75rem',padding:'.5rem .65rem',background:'var(--bg2)',borderRadius:'var(--r)',border:'1px solid var(--bdr)'}}>
          <strong style={{color:assignable.length?'var(--okB)':'var(--muted)'}}>{assignable.length}</strong> of {futureShifts.length} shifts will be assigned to {target.name}
          {willOpen>0&&<>, <strong style={{color:'var(--warn)'}}>{willOpen}</strong> will remain <strong>Open</strong> (role or time conflict)</>}.
        </div>}
      </>}
      <div className="ma">
        <button className="btn btn-s" onClick={onCancel}>Cancel</button>
        <button className="btn btn-warn" disabled={saving||(choice==='reassign'&&!reassignTo)} onClick={handleConfirm}>{saving?'Applying…':'Confirm & Deactivate'}</button>
      </div>
    </div></div>
  );
}

export default DeactivateStaffModal
