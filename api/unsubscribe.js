// api/unsubscribe.js
// One-click unsubscribe endpoint.
// GET /api/unsubscribe?uid=USER_ID&cat=CATEGORY&token=HMAC_TOKEN
//
// Validates the HMAC token, then sets the corresponding email_preferences
// column to false for that user. Returns a plain HTML confirmation page.

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const BRAND    = 'Sector 317'
const BASE_URL = 'https://www.sector317.com'

const VALID_CATEGORIES = ['bookings', 'match_summary', 'social', 'merchandise', 'marketing']

const CATEGORY_LABELS = {
  bookings:      'Booking Confirmations & Reminders',
  match_summary: 'Post-Match Summaries',
  social:        'Social Notifications (friend requests, messages)',
  merchandise:   'Merchandise & Order Updates',
  marketing:     'Newsletter & Promotions',
}

function verifyToken(userId, category, token) {
  const secret = process.env.EMAIL_UNSUBSCRIBE_SECRET ?? 'change-me'
  const expected = crypto.createHmac('sha256', secret).update(`${userId}:${category}`).digest('base64url')
  return token === expected
}

function htmlPage(title, message, isError = false) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${title} · ${BRAND}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
           background: #0d1117; color: #e6edf3; min-height: 100vh;
           display: flex; align-items: center; justify-content: center; padding: 24px; }
    .card { background: #161b22; border: 1px solid #30363d;
            border-top: 3px solid ${isError ? '#d73a49' : '#00e5ff'};
            border-radius: 10px; max-width: 480px; width: 100%; padding: 40px 36px; text-align: center; }
    .icon { font-size: 40px; margin-bottom: 18px; }
    h1 { font-size: 22px; font-weight: 700; margin-bottom: 14px;
         color: ${isError ? '#d73a49' : '#00e5ff'}; letter-spacing: .05em; }
    p  { font-size: 15px; line-height: 1.65; color: #8b949e; margin-bottom: 12px; }
    a  { color: #00e5ff; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .brand { font-family: monospace; font-weight: 700; letter-spacing: .12em;
             font-size: 13px; color: #8b949e; margin-top: 28px; text-transform: uppercase; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${isError ? '⚠️' : '✅'}</div>
    <h1>${title}</h1>
    ${message}
    <div class="brand">${BRAND}</div>
  </div>
</body>
</html>`
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const { uid, cat, token } = req.query ?? {}

  if (!uid || !cat || !token) {
    const html = htmlPage('Invalid Link', '<p>This unsubscribe link is missing required parameters. Please use the link from your email.</p>', true)
    return res.status(400).setHeader('Content-Type', 'text/html').send(html)
  }

  if (!VALID_CATEGORIES.includes(cat)) {
    const html = htmlPage('Unknown Category', '<p>This unsubscribe link references an unknown email category.</p>', true)
    return res.status(400).setHeader('Content-Type', 'text/html').send(html)
  }

  if (!verifyToken(uid, cat, token)) {
    const html = htmlPage('Invalid Token', '<p>This unsubscribe link is invalid or has expired. Please use the exact link from your email.</p>', true)
    return res.status(403).setHeader('Content-Type', 'text/html').send(html)
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  // Upsert the preference row with this category set to false
  const update = { user_id: uid, [cat]: false, updated_at: new Date().toISOString() }
  const { error } = await supabase
    .from('email_preferences')
    .upsert(update, { onConflict: 'user_id' })

  if (error) {
    const html = htmlPage('Something Went Wrong', `<p>We couldn't update your preferences right now. Please try again later or manage your settings in your <a href="${BASE_URL}/?portal=customer">account portal</a>.</p>`, true)
    return res.status(500).setHeader('Content-Type', 'text/html').send(html)
  }

  const label = CATEGORY_LABELS[cat] ?? cat
  const html = htmlPage('Unsubscribed', `
    <p>You have been unsubscribed from <strong style="color:#e6edf3;">${label}</strong> emails from ${BRAND}.</p>
    <p>You can re-enable this (and manage all notification preferences) at any time in your <a href="${BASE_URL}/?portal=customer">account portal</a> under Email Notifications.</p>
  `)
  return res.status(200).setHeader('Content-Type', 'text/html').send(html)
}
