import { fmt12, fmtMoney } from "./utils.js"

function PaymentReceiptModal({payment,onClose}){
  const s=payment.snapshot||{};
  const printReceipt=()=>{
    const w=window.open("","_blank","width=680,height=820");
    if(!w)return;
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Receipt</title><style>
      body{font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:560px;margin:2rem auto;color:#111;font-size:14px;}
      .logo{font-size:1.5rem;font-weight:900;letter-spacing:.14em;color:#c8e03a;}
      .tagline{font-size:.72rem;color:#666;letter-spacing:.08em;text-transform:uppercase;margin-bottom:1.5rem;}
      .row{display:flex;justify-content:space-between;padding:.4rem 0;border-bottom:1px solid #eee;}
      .lbl{color:#666;}.val{font-weight:600;text-align:right;}
      .total-row{display:flex;justify-content:space-between;font-size:1.1rem;font-weight:700;padding:.75rem 0;border-top:2px solid #111;margin-top:.5rem;}
      .footer{font-size:.7rem;color:#888;margin-top:1.5rem;line-height:1.6;text-align:center;}
      .ref{font-family:monospace;}
      @media print{body{padding:1.5rem 2rem;}}
    </style></head><body>
      <div class="logo">SECTOR 317</div>
      <div class="tagline">Indoor Tactical Experience · Noblesville, IN</div>
      <h2>Booking Receipt</h2>
      <div class="row"><span class="lbl">Reference #</span><span class="val" style="font-family:monospace">${s.refNum}</span></div>
      <div class="row"><span class="lbl">Customer</span><span class="val">${s.customerName||'—'}</span></div>
      <div class="row"><span class="lbl">Session Type</span><span class="val">${s.sessionType||'—'}</span></div>
      <div class="row"><span class="lbl">Reservation</span><span class="val">${s.date?new Date(s.date+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"})+(s.startTime?' · '+fmt12(s.startTime):''):'—'}</span></div>
      <div class="row"><span class="lbl">Players</span><span class="val">${s.playerCount}</span></div>
      <div class="row"><span class="lbl">Purchased</span><span class="val">${payment.createdAt?new Date(payment.createdAt).toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})+' · '+new Date(payment.createdAt).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:true}):'—'}</span></div>
      ${s.cardLast4?`<div class="row"><span class="lbl">Card</span><span class="val">•••• •••• •••• ${s.cardLast4}${s.cardExpiry?' · Exp '+s.cardExpiry:''}</span></div><div class="row"><span class="lbl">Cardholder</span><span class="val">${s.cardHolder||'—'}</span></div>`:''}
      <div class="row"><span class="lbl">Status</span><span class="val">${payment.status.toUpperCase()}</span></div>
      <div class="total-row"><span>Amount Charged</span><span>${fmtMoney(payment.amount)}</span></div>
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
    <div className="mo"><div className="mc" style={{maxWidth:520}}>
      <div className="mt2" style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:".5rem"}}>
        <span>🧾 Booking Receipt</span>
        <span style={{fontFamily:"monospace",fontSize:".75rem",color:"var(--muted)",fontWeight:400}}>#{s.refNum}</span>
      </div>
      <div style={{background:"var(--bg2)",border:"1px solid var(--acc2)",borderRadius:6,padding:".85rem 1rem",marginBottom:"1rem",display:"flex",alignItems:"center",gap:.75+"rem"}}>
        <div style={{flex:1}}>
          <div style={{fontFamily:"var(--fd)",fontSize:"1.1rem",color:"var(--acc)",letterSpacing:".12em",fontWeight:900}}>SECTOR 317</div>
          <div style={{fontSize:".7rem",color:"var(--muted)",letterSpacing:".08em",textTransform:"uppercase"}}>Indoor Tactical Experience · Noblesville, IN</div>
        </div>
        <div style={{fontSize:".72rem",color:"var(--muted)",textAlign:"right"}}>sector317.com</div>
      </div>
      {[
        ["Reference #",<span style={{fontFamily:"monospace",fontSize:".85rem"}}>{s.refNum}</span>],
        ["Customer",s.customerName||"—"],
        ["Session Type",s.sessionType||"—"],
        ["Reservation",s.date?(new Date(s.date+"T12:00:00").toLocaleDateString("en-US",{weekday:"short",year:"numeric",month:"short",day:"numeric"})+(s.startTime?" · "+fmt12(s.startTime):"")):"—"],
        ["Players",s.playerCount],
        ["Purchased",payment.createdAt?(new Date(payment.createdAt).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})+" · "+new Date(payment.createdAt).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:true})):"—"],
        ...(s.cardLast4?[["Card","•••• •••• •••• "+s.cardLast4+(s.cardExpiry?" · Exp "+s.cardExpiry:"")],["Cardholder",s.cardHolder||"—"]]:[] ),
        ["Status",<span className="badge b-ok" style={{textTransform:"uppercase"}}>{payment.status}</span>],
      ].map(([lbl,val])=>(
        <div key={lbl} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:".45rem 0",borderBottom:"1px solid var(--bdr)",fontSize:".85rem"}}>
          <span style={{color:"var(--muted)"}}>{lbl}</span>
          <span style={{fontWeight:600,color:"var(--txt)",textAlign:"right"}}>{val}</span>
        </div>
      ))}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:".75rem 0",marginTop:".25rem",borderTop:"2px solid var(--bdr)",fontSize:"1.05rem",fontWeight:700}}>
        <span style={{color:"var(--txt)"}}>Amount Charged</span>
        <span style={{color:"var(--acc)",fontFamily:"var(--fd)",fontSize:"1.15rem"}}>{fmtMoney(payment.amount)}</span>
      </div>
      <div style={{fontSize:".72rem",color:"var(--muted)",marginTop:".5rem",lineHeight:1.5,textAlign:"center"}}>
        Payment processed securely via GoDaddy Payments<br/>
        <em>Retain this receipt for business expense records.</em>
      </div>
      <div className="ma" style={{marginTop:"1.25rem",gap:".75rem"}}>
        <button className="btn btn-s" onClick={onClose}>Close</button>
        <button className="btn btn-p" onClick={printReceipt}>🖨 Print Receipt</button>
      </div>
    </div></div>
  );
}

export default PaymentReceiptModal
