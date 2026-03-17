import { fmt12, fmtMoney } from "./utils.js"

function ReceiptModal({res,resTypes,user,onClose}){
  const rt=resTypes.find(x=>x.id===res.typeId);
  const refNum=String(res.id).toUpperCase().replace(/-/g,"").slice(0,12);
  const printReceipt=()=>{
    const w=window.open("","_blank","width=680,height=820");
    w.document.write(`<!DOCTYPE html><html><head><title>Receipt — Sector 317</title><style>
      *{margin:0;padding:0;box-sizing:border-box;}
      body{font-family:'Segoe UI',Arial,sans-serif;background:#fff;color:#111;padding:2.5rem 3rem;}
      .logo{font-family:Arial Black,Arial,sans-serif;font-size:2rem;font-weight:900;letter-spacing:.12em;color:#c8e03a;text-shadow:0 0 12px rgba(200,224,58,.4);margin-bottom:.15rem;}
      .tagline{font-size:.78rem;color:#555;letter-spacing:.1em;text-transform:uppercase;margin-bottom:2rem;}
      h2{font-size:1.1rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;border-bottom:2px solid #c8e03a;padding-bottom:.5rem;margin-bottom:1.25rem;color:#111;}
      .row{display:flex;justify-content:space-between;padding:.5rem 0;border-bottom:1px solid #eee;font-size:.92rem;}
      .row .lbl{color:#555;}
      .row .val{font-weight:600;color:#111;}
      .total-row{display:flex;justify-content:space-between;padding:.75rem 0;margin-top:.5rem;font-size:1.1rem;font-weight:700;border-top:2px solid #111;}
      .status-badge{display:inline-block;background:#c8e03a;color:#111;font-size:.72rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;padding:.2rem .65rem;border-radius:20px;margin-left:.5rem;}
      .footer{margin-top:2.5rem;font-size:.74rem;color:#888;text-align:center;line-height:1.6;}
      .ref{font-size:.72rem;color:#888;font-family:monospace;margin-top:.25rem;}
      @media print{body{padding:1.5rem 2rem;}}
    </style></head><body>
      <div class="logo">SECTOR 317</div>
      <div class="tagline">Indoor Tactical Experience · Noblesville, IN</div>
      <h2>Booking Receipt</h2>
      <div class="row"><span class="lbl">Reference #</span><span class="val" style="font-family:monospace">${refNum}</span></div>
      <div class="row"><span class="lbl">Customer</span><span class="val">${res.customerName||user.name}</span></div>
      <div class="row"><span class="lbl">Session Type</span><span class="val">${rt?.name||"—"}</span></div>
      <div class="row"><span class="lbl">Reservation</span><span class="val">${new Date(res.date+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"})} · ${fmt12(res.startTime)}</span></div>
      <div class="row"><span class="lbl">Players</span><span class="val">${res.playerCount}</span></div>
      <div class="row"><span class="lbl">Status</span><span class="val">${res.status.charAt(0).toUpperCase()+res.status.slice(1)}<span class="status-badge">${res.paid?"PAID":"PENDING"}</span></span></div>
      <div class="total-row"><span>Amount Charged</span><span>${fmtMoney(res.amount)}</span></div>
      <div class="footer">
        Sector 317 · sector317.com · Noblesville, IN<br/>
        Payment processed securely via GoDaddy Payments<br/>
        <span class="ref">Receipt generated ${new Date().toLocaleString("en-US",{dateStyle:"long",timeStyle:"short"})}</span><br/>
        <em>Please retain this receipt for your records. For questions, contact us at sector317.com.</em>
      </div>
      <script>window.onload=()=>{window.print();}<\/script>
    </body></html>`);
    w.document.close();
  };
  return(
    <div className="mo">
      <div className="mc" style={{maxWidth:520}}>
        <div className="mt2" style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:".5rem"}}>
          <span>🧾 Booking Receipt</span>
          <span style={{fontFamily:"monospace",fontSize:".75rem",color:"var(--muted)",fontWeight:400}}>#{refNum}</span>
        </div>
        {/* Business header */}
        <div style={{background:"var(--bg2)",border:"1px solid var(--acc2)",borderRadius:6,padding:".85rem 1rem",marginBottom:"1rem",display:"flex",alignItems:"center",gap:.75+"rem"}}>
          <div style={{flex:1}}>
            <div style={{fontFamily:"var(--fd)",fontSize:"1.1rem",color:"var(--acc)",letterSpacing:".12em",fontWeight:900}}>SECTOR 317</div>
            <div style={{fontSize:".7rem",color:"var(--muted)",letterSpacing:".08em",textTransform:"uppercase"}}>Indoor Tactical Experience · Noblesville, IN</div>
          </div>
          <div style={{fontSize:".72rem",color:"var(--muted)",textAlign:"right"}}>sector317.com</div>
        </div>
        {/* Receipt rows */}
        {[
          ["Reference #", <span style={{fontFamily:"monospace",fontSize:".85rem"}}>{refNum}</span>],
          ["Customer", res.customerName||user.name],
          ["Session Type", rt?.name||"—"],
          ["Reservation", new Date(res.date+"T12:00:00").toLocaleDateString("en-US",{weekday:"short",year:"numeric",month:"short",day:"numeric"})+" · "+fmt12(res.startTime)],
          ["Players", res.playerCount],
          ["Status", <span style={{display:"flex",alignItems:"center",gap:".4rem"}}><span className={`badge ${res.status==="confirmed"?"b-ok":res.status==="completed"?"b-done":res.status==="no-show"?"b-noshow":"b-cancel"}`}>{res.status}</span>{res.paid&&<span style={{fontSize:".68rem",background:"var(--okD)",color:"var(--okB)",padding:".1rem .45rem",borderRadius:20,fontWeight:700,letterSpacing:".06em"}}>PAID</span>}</span>],
        ].map(([lbl,val])=>(
          <div key={lbl} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:".45rem 0",borderBottom:"1px solid var(--bdr)",fontSize:".85rem"}}>
            <span style={{color:"var(--muted)"}}>{lbl}</span>
            <span style={{fontWeight:600,color:"var(--txt)",textAlign:"right"}}>{val}</span>
          </div>
        ))}
        {/* Total */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:".75rem 0",marginTop:".25rem",borderTop:"2px solid var(--bdr)",fontSize:"1.05rem",fontWeight:700}}>
          <span style={{color:"var(--txt)"}}>Amount Charged</span>
          <span style={{color:"var(--acc)",fontFamily:"var(--fd)",fontSize:"1.15rem"}}>{fmtMoney(res.amount)}</span>
        </div>
        {/* Footer note */}
        <div style={{fontSize:".72rem",color:"var(--muted)",marginTop:".5rem",lineHeight:1.5,textAlign:"center"}}>
          Payment processed securely via GoDaddy Payments<br/>
          <em>Retain this receipt for business expense records.</em>
        </div>
        <div className="ma" style={{marginTop:"1.25rem",gap:".75rem"}}>
          <button className="btn btn-s" onClick={onClose}>Close</button>
          <button className="btn btn-p" onClick={printReceipt}>🖨 Print Receipt</button>
        </div>
      </div>
    </div>
  );
}

export default ReceiptModal
