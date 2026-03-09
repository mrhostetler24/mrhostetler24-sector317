// api/email-templates.js
// HTML email template builder for Sector 317.
// Each exported function returns { subject, html } for a given email type.
// All templates use inline styles for maximum email-client compatibility.

const BASE_URL = 'https://www.sector317.com'
const BRAND    = 'Sector 317'
const LOGO_URL = `${BASE_URL}/logo.png`

// ── Colour palette (matches app theme where safe for email) ──────────────────
const C = {
  bg:       '#0d1117',
  surface:  '#161b22',
  border:   '#30363d',
  acc:      '#00e5ff',
  accDark:  '#0099aa',
  txt:      '#e6edf3',
  muted:    '#8b949e',
  ok:       '#3fb950',
  okDark:   '#2d8f3c',
  warn:     '#d29922',
  white:    '#ffffff',
  offwhite: '#f6f8fa',
  bodyBg:   '#f0f2f5',
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
<body style="margin:0;padding:0;background:${C.bodyBg};font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">

  <!-- Wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bodyBg};padding:24px 0;">
  <tr><td align="center">

    <!-- Card -->
    <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;border-radius:8px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.18);">

      <!-- Header -->
      <tr>
        <td style="background:${C.bg};padding:28px 32px;text-align:center;border-bottom:3px solid ${C.acc};">
          <img src="${LOGO_URL}" alt="${BRAND}" width="52" height="52"
               style="display:inline-block;border-radius:8px;margin-bottom:10px;"/>
          <div style="font-family:monospace;font-size:22px;font-weight:700;
                      letter-spacing:.12em;color:${C.acc};text-transform:uppercase;">
            ${BRAND}
          </div>
          <div style="font-size:11px;letter-spacing:.18em;color:${C.muted};
                      text-transform:uppercase;margin-top:3px;">
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
        <td style="background:${C.surface};padding:20px 32px;text-align:center;
                   border-top:1px solid ${C.border};">
          <p style="margin:0 0 6px;font-size:12px;color:${C.muted};">
            © ${new Date().getFullYear()} ${BRAND} &nbsp;·&nbsp; Indianapolis, IN
          </p>
          ${unsubLink ? `
          <p style="margin:4px 0 0;font-size:11px;color:${C.muted};">
            <a href="${unsubLink}" style="color:${C.muted};text-decoration:underline;">
              Unsubscribe from this type of email
            </a>
          </p>` : `
          <p style="margin:4px 0 0;font-size:11px;color:${C.muted};">
            This is a required transactional message. To manage your notification preferences,
            visit your account settings at <a href="${BASE_URL}" style="color:${C.muted};">${BASE_URL}</a>.
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
  return `<h1 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#111;">${text}</h1>`
}
function subheading(text) {
  return `<h2 style="margin:0 0 12px;font-size:15px;font-weight:600;color:#333;">${text}</h2>`
}
function para(text, style = '') {
  return `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#333;${style}">${text}</p>`
}
function divider() {
  return `<hr style="border:none;border-top:1px solid #e4e8ec;margin:24px 0;"/>`
}
function infoTable(rows) {
  // rows: [{ label, value }]
  return `
  <table cellpadding="0" cellspacing="0" border="0" width="100%"
         style="border:1px solid #e4e8ec;border-radius:6px;margin:16px 0;overflow:hidden;">
    ${rows.map((r, i) => `
    <tr style="background:${i % 2 === 0 ? C.offwhite : C.white};">
      <td style="padding:10px 16px;font-size:13px;font-weight:600;color:#555;
                 width:42%;border-bottom:1px solid #e4e8ec;">${r.label}</td>
      <td style="padding:10px 16px;font-size:13px;color:#111;
                 border-bottom:1px solid #e4e8ec;">${r.value}</td>
    </tr>`).join('')}
  </table>`
}
function ctaButton(label, url) {
  return `
  <div style="text-align:center;margin:28px 0;">
    <a href="${url}" style="display:inline-block;background:${C.acc};color:#000;
       font-weight:700;font-size:15px;letter-spacing:.06em;padding:13px 32px;
       border-radius:6px;text-decoration:none;">${label}</a>
  </div>`
}
function alertBox(text, color = C.ok) {
  return `
  <div style="background:${color}18;border-left:4px solid ${color};
              border-radius:4px;padding:14px 18px;margin:16px 0;">
    <span style="font-size:14px;color:#111;">${text}</span>
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
    ${para('Questions? Visit us at <a href="' + BASE_URL + '" style="color:' + C.accDark + ';">' + BASE_URL + '</a> or reply to this email.', 'font-size:13px;color:#666;')}
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
           style="border:1px solid #e4e8ec;border-radius:6px;margin:12px 0;overflow:hidden;font-size:13px;">
      <tr style="background:${C.bg};">
        <th style="padding:9px 14px;text-align:left;color:${C.acc};font-weight:600;letter-spacing:.06em;">Operative</th>
        <th style="padding:9px 14px;text-align:center;color:${C.acc};font-weight:600;">Eliminations</th>
        <th style="padding:9px 14px;text-align:center;color:${C.acc};font-weight:600;">Casualties</th>
        <th style="padding:9px 14px;text-align:center;color:${C.acc};font-weight:600;">Accuracy</th>
      </tr>
      ${(data.players ?? []).map((p, i) => `
      <tr style="background:${i % 2 === 0 ? C.offwhite : C.white};">
        <td style="padding:9px 14px;font-weight:${p.name === data.recipientName ? '700' : '400'};color:#111;">
          ${p.name}${p.name === data.recipientName ? ' <span style="color:' + C.accDark + ';">▶</span>' : ''}
        </td>
        <td style="padding:9px 14px;text-align:center;color:#111;">${p.kills ?? '—'}</td>
        <td style="padding:9px 14px;text-align:center;color:#111;">${p.deaths ?? '—'}</td>
        <td style="padding:9px 14px;text-align:center;color:#111;">${p.accuracy != null ? p.accuracy + '%' : '—'}</td>
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
      ...(data.teamOutcome ? [{ label: 'Outcome', value: `<strong style="color:${data.teamOutcome === 'Victory' ? C.ok : '#d73a49'};">${data.teamOutcome}</strong>` }] : []),
    ])}
    ${playersHtml}
    ${ctaButton('View Full Stats', BASE_URL + '/?portal=customer&tab=social')}
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
    ${para('Not interested? You can ignore the request from the Social tab in your portal.', 'font-size:13px;color:#666;')}
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
    ${para('To block messages from this user, visit the Social tab in your portal.', 'font-size:13px;color:#666;')}
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
           style="border:1px solid #e4e8ec;border-radius:6px;margin:14px 0;overflow:hidden;font-size:13px;">
      <tr style="background:${C.bg};">
        <th style="padding:9px 14px;text-align:left;color:${C.acc};font-weight:600;">Item</th>
        <th style="padding:9px 14px;text-align:center;color:${C.acc};font-weight:600;">Qty</th>
        <th style="padding:9px 14px;text-align:right;color:${C.acc};font-weight:600;">Price</th>
      </tr>
      ${(data.items ?? []).map((it, i) => `
      <tr style="background:${i % 2 === 0 ? C.offwhite : C.white};">
        <td style="padding:9px 14px;color:#111;">${it.name}</td>
        <td style="padding:9px 14px;text-align:center;color:#111;">${it.qty}</td>
        <td style="padding:9px 14px;text-align:right;color:#111;">${fmtMoney(it.price * it.qty)}</td>
      </tr>`).join('')}
      <tr style="background:${C.surface};">
        <td colspan="2" style="padding:10px 14px;font-weight:700;color:#111;">Total</td>
        <td style="padding:10px 14px;text-align:right;font-weight:700;color:#111;">${fmtMoney(data.total)}</td>
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
      { label: 'Credit Added', value: `<strong style="color:${C.ok};">${fmtMoney(data.amount)}</strong>` },
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
    ${alertBox('Complete your profile and sign your digital waiver before your first mission.', C.acc)}
    ${ctaButton('Go to My Portal', BASE_URL + '/?portal=customer')}
    ${divider()}
    ${para('New to Sector 317? Check out our website to learn what to expect on your first visit.', 'font-size:13px;color:#666;')}
  `
  return { subject, html: layout(subject, body, null) }
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
  welcome:                { category: null,            build: (d) => tmplWelcome(d) }, // transactional
}
