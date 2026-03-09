/**
 * Central payment gateway — one place to swap in GoDaddy API calls.
 *
 * All checkout screens call processPayment() before writing anything to the DB.
 * If it throws, nothing is written. When GoDaddy Payments subscription is active,
 * replace the placeholder block below and all screens integrate automatically.
 *
 * mode: 'card_not_present'  BookingWizard, MerchStorefront (online / customer portal)
 *       'card_present'       OpsView walk-in, MerchStaffSales (physical terminal)
 *
 * card (card_not_present): { number, expiry, cvv, name }
 * card (card_present):     { last4, expiry, holder }  — manual capture from terminal receipt
 *
 * @returns {Promise<{ok:boolean, transactionId:string|null, last4:string|null, expiry:string|null, holder:string|null}>}
 */
export async function processPayment({ amount, mode = 'card_not_present', card = {} }) {
  if (amount <= 0) return { ok: true, transactionId: null, last4: null, expiry: null, holder: null }

  // ── TODO: GoDaddy integration ─────────────────────────────────────────────
  // Uncomment and fill in when GoDaddy Payments subscription is active.
  //
  // Card-present (push payment request to GoDaddy Smart Terminal):
  // if (mode === 'card_present') {
  //   const res = await fetch('/api/godaddy-terminal', {
  //     method: 'POST', headers: { 'Content-Type': 'application/json' },
  //     body: JSON.stringify({ amount }),
  //   })
  //   const data = await res.json()
  //   if (!data.ok) throw new Error(data.declineReason ?? 'Terminal declined')
  //   return { ok: true, transactionId: data.transactionId, last4: data.last4, expiry: data.expiry, holder: data.cardHolder }
  // }
  //
  // Card-not-present (charge via GoDaddy Payments API):
  // const res = await fetch('/api/godaddy-charge', {
  //   method: 'POST', headers: { 'Content-Type': 'application/json' },
  //   body: JSON.stringify({ amount, card }),
  // })
  // const data = await res.json()
  // if (!data.ok) throw new Error(data.declineReason ?? 'Payment declined')
  // return { ok: true, transactionId: data.transactionId, last4: data.last4, expiry: data.expiry, holder: data.cardHolder }
  // ─────────────────────────────────────────────────────────────────────────

  // ── Placeholder — remove when GoDaddy is configured ──────────────────────
  await new Promise(res => setTimeout(res, mode === 'card_not_present' ? 1200 : 400))
  const rawNum = (card.number ?? '').replace(/\s/g, '')
  return {
    ok: true,
    transactionId: null,
    last4: rawNum.length >= 4 ? rawNum.slice(-4) : (card.last4 ?? null),
    expiry: card.expiry ?? null,
    holder: card.name ?? card.holder ?? null,
  }
}
