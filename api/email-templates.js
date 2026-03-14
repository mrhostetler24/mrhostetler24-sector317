// api/email-templates.js
// HTML email template builder for Sector 317.
// Each exported function returns { subject, html } for a given email type.
// All templates use inline styles for maximum email-client compatibility.

const BASE_URL = 'https://www.sector317.com'
const BRAND    = 'Sector 317'
const LOGO_URL = `${BASE_URL}/logo.png`

// ── Colour palette (mirrors app CSS variables exactly) ───────────────────────
const C = {
  bg:       '#1e1f18',   // --bg2
  surface:  '#2e2f27',   // --surf
  border:   '#46473e',   // --bdr
  acc:      '#c8e03a',   // --acc  (lime/yellow-green)
  accDark:  '#9ab02e',   // --acc2
  accB:     '#d4ec46',   // --accB
  txt:      '#e2dfd8',   // --txt  (warm off-white)
  muted:    '#8a8878',   // --muted
  ok:       '#5a8a3a',   // --ok
  okDark:   '#74a84a',   // --okB
  warn:     '#b8960c',   // --warn
  warnL:    '#e6b800',   // --warnL
  danger:   '#c0392b',   // --danger
  white:    '#ffffff',
  offwhite: '#f5f4f0',   // warm off-white body rows
  bodyBg:   '#e9e8e3',   // warm light wrapper background
}

// ── Formatting helpers ───────────────────────────────────────────────────────
function fmtMoney(n) {
  return '$' + Number(n ?? 0).toFixed(2)
}
function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}
function fmtTime(t) {
  if (!t) return '—'
  const [h, m] = t.split(':').map(Number)
  const ap = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${ap}`
}

// ── Unsubscribe URL builder ──────────────────────────────────────────────────
// token is the HMAC generated in send-email.js
export function unsubUrl(userId, category, token) {
  return `${BASE_URL}/api/unsubscribe?uid=${userId}&cat=${category}&token=${token}`
}

// ── Base layout ──────────────────────────────────────────────────────────────
// unsubLink: pass null for transactional emails (no unsubscribe option)
function layout(title, bodyHtml, unsubLink = null) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:${C.bodyBg};font-family:'Barlow','Helvetica Neue',Helvetica,Arial,sans-serif;">

  <!-- Wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bodyBg};padding:28px 0;">
  <tr><td align="center">

    <!-- Card -->
    <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;border-radius:6px;overflow:hidden;box-shadow:0 6px 32px rgba(0,0,0,.28);">

      <!-- Header -->
      <tr>
        <td style="background:${C.bg};padding:28px 32px 24px;text-align:center;border-bottom:3px solid ${C.acc};">
          <img src="${LOGO_URL}" alt="${BRAND}" width="56" height="56"
               style="display:inline-block;border-radius:8px;margin-bottom:12px;"/>
          <div style="font-family:Impact,'Black Ops One','Arial Narrow',sans-serif;font-size:24px;font-weight:700;
                      letter-spacing:.14em;color:${C.accB};text-transform:uppercase;">
            ${BRAND}
          </div>
          <div style="font-size:10px;letter-spacing:.2em;color:${C.muted};
                      text-transform:uppercase;margin-top:5px;">
            Indoor Tactical Simulation Experience
          </div>
        </td>
      </tr>

      <!-- Body -->
      <tr>
        <td style="background:${C.white};padding:36px 32px;">
          ${bodyHtml}
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td style="background:${C.bg};padding:20px 32px;text-align:center;
                   border-top:3px solid ${C.border};">
          <p style="margin:0 0 6px;font-size:12px;color:${C.muted};letter-spacing:.04em;">
            © ${new Date().getFullYear()} ${BRAND} &nbsp;·&nbsp; Noblesville, IN
          </p>
          ${unsubLink ? `
          <p style="margin:4px 0 0;font-size:11px;color:${C.muted};">
            <a href="${unsubLink}" style="color:${C.muted};text-decoration:underline;">
              Unsubscribe from this type of email
            </a>
          </p>` : `
          <p style="margin:4px 0 0;font-size:11px;color:${C.muted};">
            This is a required transactional message. To manage notification preferences,
            visit your <a href="${BASE_URL}/?portal=customer" style="color:${C.muted};text-decoration:underline;">account settings</a>.
          </p>`}
        </td>
      </tr>

    </table>
  </td></tr>
  </table>
</body>
</html>`
}

// ── Shared UI blocks ─────────────────────────────────────────────────────────
function heading(text) {
  return `<h1 style="margin:0 0 20px;font-family:Impact,'Black Ops One','Arial Narrow',sans-serif;font-size:22px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${C.bg};">${text}</h1>`
}
function subheading(text) {
  return `<h2 style="margin:0 0 12px;font-size:13px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${C.muted};">${text}</h2>`
}
function para(text, style = '') {
  return `<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#2a2b24;${style}">${text}</p>`
}
function divider() {
  return `<hr style="border:none;border-top:2px solid ${C.bodyBg};margin:24px 0;"/>`
}
function infoTable(rows) {
  // rows: [{ label, value }]
  return `
  <table cellpadding="0" cellspacing="0" border="0" width="100%"
         style="border:1px solid ${C.border};border-radius:6px;margin:16px 0;overflow:hidden;">
    <tr style="background:${C.bg};">
      <td colspan="2" style="padding:0;height:3px;background:${C.acc};"></td>
    </tr>
    ${rows.map((r, i) => `
    <tr style="background:${i % 2 === 0 ? C.offwhite : C.white};">
      <td style="padding:10px 16px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${C.muted};
                 width:42%;border-bottom:1px solid ${C.bodyBg};">${r.label}</td>
      <td style="padding:10px 16px;font-size:14px;color:#1e1f18;
                 border-bottom:1px solid ${C.bodyBg};">${r.value}</td>
    </tr>`).join('')}
  </table>`
}
function ctaButton(label, url) {
  return `
  <div style="text-align:center;margin:28px 0;">
    <a href="${url}" style="display:inline-block;background:${C.acc};color:${C.bg};
       font-family:Impact,'Arial Narrow',sans-serif;font-weight:700;font-size:15px;
       letter-spacing:.1em;text-transform:uppercase;padding:14px 36px;
       border-radius:4px;text-decoration:none;">${label}</a>
  </div>`
}
function alertBox(text, color = C.accDark) {
  return `
  <div style="background:${C.offwhite};border-left:4px solid ${color};
              border-radius:4px;padding:14px 18px;margin:16px 0;">
    <span style="font-size:14px;color:#2a2b24;line-height:1.6;">${text}</span>
  </div>`
}

// ════════════════════════════════════════════════════════════════════════════
// TEMPLATE FUNCTIONS
// Each receives a `data` object and returns { subject, html }
// ════════════════════════════════════════════════════════════════════════════

// ── booking_confirmation ────────────────────────────────────────────────────
// data: { recipientName, sessionType, date, startTime, playerCount,
//         amountPaid, creditsApplied, cardLast4, refNum, reservationId }
export function tmplBookingConfirmation(data, unsubLink) {
  const subject = `Booking Confirmed — ${fmtDate(data.date)} · ${BRAND}`
  const body = `
    ${heading('Mission Booked — You\'re All Set!')}
    ${para(`Hi ${data.recipientName},`)}
    ${para('Your reservation has been confirmed. Gear up and get ready — here are your mission details:')}
    ${infoTable([
      { label: 'Session',      value: `<strong>${data.sessionType ?? '—'}</strong>` },
      { label: 'Date',         value: fmtDate(data.date) },
      { label: 'Start Time',   value: fmtTime(data.startTime) },
      { label: 'Players',      value: data.playerCount ?? '—' },
      { label: 'Amount Paid',  value: `<strong>${fmtMoney(data.amountPaid)}</strong>` },
      ...(data.creditsApplied > 0 ? [{ label: 'Store Credits Applied', value: fmtMoney(data.creditsApplied) }] : []),
      ...(data.cardLast4 ? [{ label: 'Payment',  value: `Card ending in ${data.cardLast4}` }] : []),
      { label: 'Ref #',        value: `<code style="font-family:monospace;font-size:12px;">${data.refNum}</code>` },
    ])}
    ${alertBox('Please arrive 10–15 minutes early for briefing and equipment setup.')}
    ${ctaButton('View My Reservations', BASE_URL + '/?portal=customer')}
    ${divider()}
    ${para('Questions? Visit us at <a href="' + BASE_URL + '" style="color:' + C.accDark + ';">' + BASE_URL + '</a> or reply to this email.', `font-size:13px;color:${C.muted};`)}
  `
  return { subject, html: layout(subject, body, unsubLink) }
}

// ── booking_reminder ─────────────────────────────────────────────────────────
// data: { recipientName, sessionType, date, startTime, playerCount, reservationId }
export function tmplBookingReminder(data, unsubLink) {
  const subject = `Mission Tomorrow — ${fmtTime(data.startTime)} · ${BRAND}`
  const body = `
    ${heading('Your Mission Is Tomorrow')}
    ${para(`Hi ${data.recipientName},`)}
    ${para('This is a friendly reminder that you have a reservation tomorrow. We\'ll see you on the field!')}
    ${infoTable([
      { label: 'Session',    value: `<strong>${data.sessionType ?? '—'}</strong>` },
      { label: 'Date',       value: fmtDate(data.date) },
      { label: 'Start Time', value: `<strong>${fmtTime(data.startTime)}</strong>` },
      { label: 'Players',    value: data.playerCount ?? '—' },
    ])}
    ${alertBox('Arrive 10–15 minutes early. Bring your group and get ready to move!')}
    ${ctaButton('View Reservation', BASE_URL + '/?portal=customer')}
  `
  return { subject, html: layout(subject, body, unsubLink) }
}

// ── booking_cancellation ─────────────────────────────────────────────────────
// data: { recipientName, sessionType, date, startTime, refNum, reason }
export function tmplBookingCancellation(data, unsubLink) {
  const subject = `Reservation Cancelled — ${fmtDate(data.date)} · ${BRAND}`
  const body = `
    ${heading('Reservation Cancelled')}
    ${para(`Hi ${data.recipientName},`)}
    ${para('Your reservation has been cancelled. Here\'s a summary of what was cancelled:')}
    ${infoTable([
      { label: 'Session',    value: data.sessionType ?? '—' },
      { label: 'Date',       value: fmtDate(data.date) },
      { label: 'Start Time', value: fmtTime(data.startTime) },
      { label: 'Ref #',      value: `<code style="font-family:monospace;font-size:12px;">${data.refNum}</code>` },
      ...(data.reason ? [{ label: 'Reason', value: data.reason }] : []),
    ])}
    ${para('If you have any questions about your cancellation or would like to rebook, visit us below.')}
    ${ctaButton('Book Another Mission', BASE_URL + '/?portal=customer')}
  `
  return { subject, html: layout(subject, body, unsubLink) }
}

// ── match_summary ────────────────────────────────────────────────────────────
// data: { recipientName, sessionType, date, startTime, players: [{name,kills,deaths,accuracy}],
//         teamOutcome, runId }
export function tmplMatchSummary(data, unsubLink) {
  const subject = `Mission Debrief — ${fmtDate(data.date)} · ${BRAND}`
  const playersHtml = (data.players ?? []).length > 0 ? `
    ${subheading('Operative Performance')}
    <table cellpadding="0" cellspacing="0" border="0" width="100%"
           style="border:1px solid ${C.border};border-radius:6px;margin:12px 0;overflow:hidden;font-size:13px;">
      <tr style="background:${C.bg};">
        <th style="padding:9px 14px;text-align:left;color:${C.accB};font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:11px;">Operative</th>
        <th style="padding:9px 14px;text-align:center;color:${C.accB};font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:11px;">Eliminations</th>
        <th style="padding:9px 14px;text-align:center;color:${C.accB};font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:11px;">Casualties</th>
        <th style="padding:9px 14px;text-align:center;color:${C.accB};font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:11px;">Accuracy</th>
      </tr>
      ${(data.players ?? []).map((p, i) => `
      <tr style="background:${i % 2 === 0 ? C.offwhite : C.white};">
        <td style="padding:9px 14px;font-weight:${p.name === data.recipientName ? '700' : '400'};color:#1e1f18;">
          ${p.name}${p.name === data.recipientName ? ' <span style="color:' + C.accDark + ';">▶</span>' : ''}
        </td>
        <td style="padding:9px 14px;text-align:center;color:#1e1f18;">${p.kills ?? '—'}</td>
        <td style="padding:9px 14px;text-align:center;color:#1e1f18;">${p.deaths ?? '—'}</td>
        <td style="padding:9px 14px;text-align:center;color:#1e1f18;">${p.accuracy != null ? p.accuracy + '%' : '—'}</td>
      </tr>`).join('')}
    </table>` : ''

  const body = `
    ${heading('Mission Debrief')}
    ${para(`Hi ${data.recipientName},`)}
    ${para('Your mission is complete. Here\'s a full debrief of today\'s operation:')}
    ${infoTable([
      { label: 'Session',    value: data.sessionType ?? '—' },
      { label: 'Date',       value: fmtDate(data.date) },
      { label: 'Start Time', value: fmtTime(data.startTime) },
      ...(data.teamOutcome ? [{ label: 'Outcome', value: `<strong style="color:${data.teamOutcome === 'Victory' ? C.okDark : C.danger};">${data.teamOutcome}</strong>` }] : []),
    ])}
    ${playersHtml}
    ${ctaButton('View Full Stats', BASE_URL + '/?portal=customer')}
  `
  return { subject, html: layout(subject, body, unsubLink) }
}

// ── friend_request ───────────────────────────────────────────────────────────
// data: { recipientName, senderName, senderLeaderboardName }
export function tmplFriendRequest(data, unsubLink) {
  const displayName = data.senderLeaderboardName || data.senderName
  const subject = `${displayName} wants to connect · ${BRAND}`
  const body = `
    ${heading('New Connection Request')}
    ${para(`Hi ${data.recipientName},`)}
    ${para(`<strong>${displayName}</strong> has sent you a friend request on ${BRAND}. Connect with your fellow operatives to track each other's missions and career stats.`)}
    ${ctaButton('View & Respond', BASE_URL + '/?portal=customer&tab=social&sub=friends')}
    ${divider()}
    ${para('Not interested? You can ignore the request from the Social tab in your portal.', `font-size:13px;color:${C.muted};`)}
  `
  return { subject, html: layout(subject, body, unsubLink) }
}

// ── friend_accepted ──────────────────────────────────────────────────────────
// data: { recipientName, acceptorName, acceptorLeaderboardName }
export function tmplFriendAccepted(data, unsubLink) {
  const displayName = data.acceptorLeaderboardName || data.acceptorName
  const subject = `${displayName} accepted your request · ${BRAND}`
  const body = `
    ${heading('Connection Accepted!')}
    ${para(`Hi ${data.recipientName},`)}
    ${para(`<strong>${displayName}</strong> has accepted your connection request. You can now view each other's stats and match history.`)}
    ${ctaButton('View Friends', BASE_URL + '/?portal=customer&tab=social&sub=friends')}
  `
  return { subject, html: layout(subject, body, unsubLink) }
}

// ── customer_message ─────────────────────────────────────────────────────────
// data: { recipientName, senderName, senderLeaderboardName, message }
export function tmplCustomerMessage(data, unsubLink) {
  const displayName = data.senderLeaderboardName || data.senderName
  const subject = `Message from ${displayName} · ${BRAND}`
  const body = `
    ${heading('You Have a Message')}
    ${para(`Hi ${data.recipientName},`)}
    ${para(`<strong>${displayName}</strong> sent you a message on ${BRAND}:`)}
    <div style="background:${C.offwhite};border-left:4px solid ${C.acc};border-radius:4px;
                padding:16px 20px;margin:16px 0;font-size:15px;color:#111;line-height:1.7;">
      ${data.message ?? ''}
    </div>
    ${ctaButton('Reply in Portal', BASE_URL + '/?portal=customer&tab=social')}
    ${divider()}
    ${para('To block messages from this user, visit the Social tab in your portal.', `font-size:13px;color:${C.muted};`)}
  `
  return { subject, html: layout(subject, body, unsubLink) }
}

// ── merch_purchase ───────────────────────────────────────────────────────────
// data: { recipientName, orderRef, items: [{name, qty, price}], total,
//         creditsApplied, fulfillmentType, shippingAddress, cardLast4 }
export function tmplMerchPurchase(data, unsubLink) {
  const subject = `Order Confirmed #${data.orderRef} · ${BRAND}`
  const isShip = data.fulfillmentType === 'ship'
  const itemsHtml = `
    <table cellpadding="0" cellspacing="0" border="0" width="100%"
           style="border:1px solid ${C.border};border-radius:6px;margin:14px 0;overflow:hidden;font-size:13px;">
      <tr style="background:${C.bg};">
        <th style="padding:9px 14px;text-align:left;color:${C.accB};font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:11px;">Item</th>
        <th style="padding:9px 14px;text-align:center;color:${C.accB};font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:11px;">Qty</th>
        <th style="padding:9px 14px;text-align:right;color:${C.accB};font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:11px;">Price</th>
      </tr>
      ${(data.items ?? []).map((it, i) => `
      <tr style="background:${i % 2 === 0 ? C.offwhite : C.white};">
        <td style="padding:9px 14px;color:#1e1f18;">${it.name}</td>
        <td style="padding:9px 14px;text-align:center;color:#1e1f18;">${it.qty}</td>
        <td style="padding:9px 14px;text-align:right;color:#1e1f18;">${fmtMoney(it.price * it.qty)}</td>
      </tr>`).join('')}
      <tr style="background:${C.surface};">
        <td colspan="2" style="padding:10px 14px;font-weight:700;color:${C.txt};">Total</td>
        <td style="padding:10px 14px;text-align:right;font-weight:700;color:${C.accB};">${fmtMoney(data.total)}</td>
      </tr>
    </table>`
  const body = `
    ${heading('Order Confirmed!')}
    ${para(`Hi ${data.recipientName},`)}
    ${para('Thank you for your purchase! Here\'s a summary of your order:')}
    ${itemsHtml}
    ${infoTable([
      { label: 'Order Ref',    value: `<code style="font-family:monospace;">#${data.orderRef}</code>` },
      { label: 'Fulfillment',  value: isShip ? '📦 Shipping' : '🏠 In-Store Pickup' },
      ...(data.creditsApplied > 0 ? [{ label: 'Credits Applied', value: fmtMoney(data.creditsApplied) }] : []),
      ...(data.cardLast4 ? [{ label: 'Payment', value: `Card ending in ${data.cardLast4}` }] : []),
      ...(isShip && data.shippingAddress?.line1 ? [{
        label: 'Ship To',
        value: [data.shippingAddress.name, data.shippingAddress.line1,
                data.shippingAddress.line2, data.shippingAddress.city + ', ' +
                data.shippingAddress.state + ' ' + data.shippingAddress.zip]
               .filter(Boolean).join('<br/>')
      }] : []),
      ...(!isShip ? [{ label: 'Pickup', value: 'Ready at front desk — bring your order ref #' }] : []),
    ])}
    ${isShip
      ? alertBox('You\'ll receive a shipping update email once your order ships.', C.ok)
      : alertBox('Your items are ready for pickup at the Sector 317 front desk. Show this email or your order ref # when you arrive.', C.ok)}
    ${ctaButton('View Order History', BASE_URL + '/?portal=customer')}
  `
  return { subject, html: layout(subject, body, unsubLink) }
}

// ── merch_shipping_update ────────────────────────────────────────────────────
// data: { recipientName, orderRef, trackingNumber, carrier, estimatedDelivery, trackingUrl }
export function tmplMerchShippingUpdate(data, unsubLink) {
  const subject = `Your Order Has Shipped #${data.orderRef} · ${BRAND}`
  const body = `
    ${heading('Your Order Is On Its Way!')}
    ${para(`Hi ${data.recipientName},`)}
    ${para('Great news — your order has shipped and is on its way to you.')}
    ${infoTable([
      { label: 'Order Ref',  value: `<code style="font-family:monospace;">#${data.orderRef}</code>` },
      ...(data.carrier ? [{ label: 'Carrier', value: data.carrier }] : []),
      ...(data.trackingNumber ? [{ label: 'Tracking #', value: data.trackingUrl
        ? `<a href="${data.trackingUrl}" style="color:${C.accDark};">${data.trackingNumber}</a>`
        : data.trackingNumber }] : []),
      ...(data.estimatedDelivery ? [{ label: 'Est. Delivery', value: fmtDate(data.estimatedDelivery) }] : []),
    ])}
    ${data.trackingUrl ? ctaButton('Track My Package', data.trackingUrl) : ''}
    ${ctaButton('View Order History', BASE_URL + '/?portal=customer')}
  `
  return { subject, html: layout(subject, body, unsubLink) }
}

// ── merch_pickup_ready ───────────────────────────────────────────────────────
// data: { recipientName, orderRef, items: [{name, qty}] }
export function tmplMerchPickupReady(data, unsubLink) {
  const subject = `Your Order Is Ready for Pickup #${data.orderRef} · ${BRAND}`
  const body = `
    ${heading('Your Order Is Ready!')}
    ${para(`Hi ${data.recipientName},`)}
    ${para('Your merchandise order is ready for pickup at the Sector 317 front desk.')}
    ${infoTable([
      { label: 'Order Ref', value: `<code style="font-family:monospace;">#${data.orderRef}</code>` },
      ...(data.items ?? []).map(it => ({ label: it.name, value: `Qty: ${it.qty}` })),
    ])}
    ${alertBox('Show this email or your order ref # when you arrive at the front desk.', C.ok)}
    ${ctaButton('View Order History', BASE_URL + '/?portal=customer')}
  `
  return { subject, html: layout(subject, body, unsubLink) }
}

// ── store_credit_applied ─────────────────────────────────────────────────────
// data: { recipientName, amount, reason, newBalance }
export function tmplStoreCreditApplied(data, unsubLink) {
  const subject = `Store Credit Added — ${fmtMoney(data.amount)} · ${BRAND}`
  const body = `
    ${heading('Store Credit Added to Your Account')}
    ${para(`Hi ${data.recipientName},`)}
    ${para(`<strong>${fmtMoney(data.amount)}</strong> in store credit has been added to your ${BRAND} account.`)}
    ${infoTable([
      { label: 'Credit Added', value: `<strong style="color:${C.okDark};">${fmtMoney(data.amount)}</strong>` },
      { label: 'Reason',       value: data.reason ?? '—' },
      { label: 'New Balance',  value: `<strong>${fmtMoney(data.newBalance)}</strong>` },
    ])}
    ${para('Store credits can be applied at checkout for bookings and merchandise. Your balance will be shown automatically at checkout.')}
    ${ctaButton('Book a Mission', BASE_URL + '/?portal=customer')}
  `
  return { subject, html: layout(subject, body, unsubLink) }
}

// ── newsletter ───────────────────────────────────────────────────────────────
// data: { subject: string, bodyHtml: string }
// bodyHtml is trusted staff-authored content (sanitize upstream if needed)
export function tmplNewsletter(data, unsubLink) {
  const subject = data.subject ?? `News from ${BRAND}`
  const body = `
    ${data.bodyHtml ?? ''}
  `
  return { subject, html: layout(subject, body, unsubLink) }
}

// ── welcome ──────────────────────────────────────────────────────────────────
// data: { recipientName }
// Transactional — no unsubLink
export function tmplWelcome(data) {
  const subject = `Welcome to ${BRAND}`
  const body = `
    ${heading('Welcome, Operative!')}
    ${para(`Hi ${data.recipientName},`)}
    ${para(`Your account has been created at ${BRAND}. You're ready to start booking missions, tracking your stats, and connecting with other operatives.`)}
    ${alertBox('Complete your profile and sign your digital waiver before your first mission.')}
    ${ctaButton('Go to My Portal', BASE_URL + '/?portal=customer')}
    ${divider()}
    ${para('New to Sector 317? Check out our website to learn what to expect on your first visit.', `font-size:13px;color:${C.muted};`)}
  `
  return { subject, html: layout(subject, body, null) }
}

// data: { recipientName }
// Transactional — no unsubLink
export function tmplSocialAuthInvite(data) {
  const subject = `Set up your ${BRAND} account`
  const body = `
    ${heading('Almost there, Operative!')}
    ${para(`Hi ${data.recipientName},`)}
    ${para(`A Sector 317 team member has created an account for you. To access your profile, view your mission history, and earn rewards, sign in with Google or Microsoft.`)}
    ${alertBox('Signing in is quick — just click below and choose your preferred account.')}
    ${ctaButton('Create My Account', BASE_URL + '/?login')}
    ${divider()}
    ${para('Once you sign in, your purchases and mission stats will be automatically linked to your profile.', `font-size:13px;color:${C.muted};`)}
  `
  return { subject, html: layout(subject, body, null) }
}

// ── platoon_invite_received ──────────────────────────────────────────────────
// data: { recipientName, platoonTag, platoonName, inviterName }
export function tmplPlatoonInviteReceived(data, unsubLink) {
  const subject = `You've Been Invited to Join [${data.platoonTag}] · ${BRAND}`
  const body = `
    ${heading('Platoon Invitation')}
    ${para(`Hi ${data.recipientName},`)}
    ${para(`<strong>${data.inviterName}</strong> has invited you to join the <strong>[${data.platoonTag}]</strong> ${data.platoonName} platoon on ${BRAND}.`)}
    ${infoTable([
      { label: 'Platoon',    value: `[${data.platoonTag}] ${data.platoonName}` },
      { label: 'Invited By', value: data.inviterName },
    ])}
    ${alertBox('Log in to your portal and open the Platoon tab to accept or decline this invitation.')}
    ${ctaButton('View Invitation', BASE_URL + '/?portal=customer&sub=platoon')}
  `
  return { subject, html: layout(subject, body, unsubLink) }
}

// ── platoon_request_received ─────────────────────────────────────────────────
// data: { recipientName, applicantName, platoonTag, platoonName, message }
export function tmplPlatoonRequestReceived(data, unsubLink) {
  const subject = `New Enlistment Request for [${data.platoonTag}] · ${BRAND}`
  const body = `
    ${heading('New Join Request')}
    ${para(`Hi ${data.recipientName},`)}
    ${para(`<strong>${data.applicantName}</strong> has requested to join <strong>[${data.platoonTag}]</strong> ${data.platoonName}.`)}
    ${data.message ? infoTable([{ label: 'Message', value: data.message }]) : ''}
    ${alertBox('Log in to your portal and open the Platoon → Members tab to approve or deny this request.')}
    ${ctaButton('Review Request', BASE_URL + '/?portal=customer&sub=platoon&platsub=members')}
  `
  return { subject, html: layout(subject, body, unsubLink) }
}

// ── platoon_request_approved ─────────────────────────────────────────────────
// data: { recipientName, platoonTag, platoonName }
export function tmplPlatoonRequestApproved(data, unsubLink) {
  const subject = `Welcome to [${data.platoonTag}] — Request Approved · ${BRAND}`
  const body = `
    ${heading('Request Approved!')}
    ${para(`Hi ${data.recipientName},`)}
    ${para(`Your request to join <strong>[${data.platoonTag}]</strong> ${data.platoonName} has been approved. You are now a member of the platoon.`)}
    ${alertBox(`Your [${data.platoonTag}] tag is now active and will appear on the leaderboard next to your name.`, C.ok)}
    ${ctaButton('View Your Platoon', BASE_URL + '/?portal=customer&sub=platoon')}
  `
  return { subject, html: layout(subject, body, unsubLink) }
}

// ── platoon_request_denied ───────────────────────────────────────────────────
// data: { recipientName, platoonTag, platoonName }
export function tmplPlatoonRequestDenied(data, unsubLink) {
  const subject = `Enlistment Request Update for [${data.platoonTag}] · ${BRAND}`
  const body = `
    ${heading('Enlistment Update')}
    ${para(`Hi ${data.recipientName},`)}
    ${para(`Your request to join <strong>[${data.platoonTag}]</strong> ${data.platoonName} was not approved at this time.`)}
    ${para('You can browse other platoons or create your own from the Platoon tab in your portal.', `font-size:13px;color:${C.muted};`)}
    ${ctaButton('Explore Platoons', BASE_URL + '/?portal=customer&sub=platoon')}
  `
  return { subject, html: layout(subject, body, unsubLink) }
}

// ── Template dispatch map ────────────────────────────────────────────────────
// Maps email type → { category, buildFn }
// category maps to the email_preferences column name
export const TEMPLATE_MAP = {
  booking_confirmation:   { category: 'bookings',      build: tmplBookingConfirmation },
  booking_reminder:       { category: 'bookings',      build: tmplBookingReminder },
  booking_cancellation:   { category: 'bookings',      build: tmplBookingCancellation },
  match_summary:          { category: 'match_summary', build: tmplMatchSummary },
  friend_request:         { category: 'social',        build: tmplFriendRequest },
  friend_accepted:        { category: 'social',        build: tmplFriendAccepted },
  customer_message:       { category: 'social',        build: tmplCustomerMessage },
  merch_purchase:         { category: 'merchandise',   build: tmplMerchPurchase },
  merch_shipping_update:  { category: 'merchandise',   build: tmplMerchShippingUpdate },
  merch_pickup_ready:     { category: 'merchandise',   build: tmplMerchPickupReady },
  store_credit_applied:   { category: 'bookings',      build: tmplStoreCreditApplied },
  newsletter:             { category: 'marketing',     build: tmplNewsletter },
  welcome:                  { category: null,            build: (d) => tmplWelcome(d) }, // transactional
  social_auth_invite:       { category: null,            build: (d) => tmplSocialAuthInvite(d) }, // transactional
  platoon_invite_received:  { category: 'social',        build: tmplPlatoonInviteReceived },
  platoon_request_received: { category: 'social',        build: tmplPlatoonRequestReceived },
  platoon_request_approved: { category: 'social',        build: tmplPlatoonRequestApproved },
  platoon_request_denied:   { category: 'social',        build: tmplPlatoonRequestDenied },
}
