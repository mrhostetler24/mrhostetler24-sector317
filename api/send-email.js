// api/send-email.js
// Central email dispatch endpoint for Sector 317.
//
// POST /api/send-email
// Headers: Authorization: Bearer <supabase-access-token>
// Body:    { type, recipientId?, recipientIds?, data }
//
// - Validates the caller's Supabase session (server-side only).
// - Looks up each recipient's email + display name + opt-out prefs.
// - Silently skips opted-out recipients (returns 200 with skipped count).
// - Renders HTML from email-templates.js and sends via Resend.
// - Newsletter type restricted to managers/admins.

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { TEMPLATE_MAP, unsubUrl } from './email-templates.js'

const FROM_ADDRESS = 'Sector 317 <noreply@sector317.com>'
const RESEND_API   = 'https://api.resend.com/emails'

// ── HMAC unsubscribe token (stateless) ──────────────────────────────────────
function makeUnsubToken(userId, category) {
  const secret = process.env.EMAIL_UNSUBSCRIBE_SECRET ?? 'change-me'
  return crypto.createHmac('sha256', secret).update(`${userId}:${category}`).digest('base64url')
}

function verifyUnsubToken(userId, category, token) {
  return token === makeUnsubToken(userId, category)
}

// ── Send one email via Resend ────────────────────────────────────────────────
async function sendViaResend(to, subject, html) {
  const resp = await fetch(RESEND_API, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ from: FROM_ADDRESS, to, subject, html }),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ message: resp.statusText }))
    throw new Error(`Resend error (${resp.status}): ${err.message ?? JSON.stringify(err)}`)
  }
  return resp.json()
}

// ── Rate limiting (per-user, module-level) ───────────────────────────────────
const _rateLimits = new Map()  // userId → { count, resetAt }
const RATE_WINDOW = 60 * 1000  // 1 minute
const RATE_MAX    = 20         // max emails triggered per user per minute

function checkRate(userId) {
  const now = Date.now()
  const rec = _rateLimits.get(userId) ?? { count: 0, resetAt: now + RATE_WINDOW }
  if (now > rec.resetAt) { rec.count = 0; rec.resetAt = now + RATE_WINDOW }
  rec.count += 1
  _rateLimits.set(userId, rec)
  return rec.count <= RATE_MAX
}

// ── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  if (!process.env.RESEND_API_KEY) {
    return res.status(500).json({ error: 'Email service not configured (missing RESEND_API_KEY).' })
  }

  // ── Authenticate caller via Supabase JWT ──────────────────────────────────
  const authHeader = req.headers.authorization ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Missing authorization token.' })

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const { data: { user: authUser }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !authUser) return res.status(401).json({ error: 'Invalid or expired session.' })

  // Fetch the caller's profile (for role check and rate limiting)
  const { data: callerRow } = await supabase
    .from('users').select('id,access').eq('auth_id', authUser.id).maybeSingle()
  if (!callerRow) return res.status(401).json({ error: 'User profile not found.' })

  // ── Parse and validate request body ──────────────────────────────────────
  const body = req.body ?? {}
  const { type, data: templateData = {} } = body

  // Build the list of recipient IDs
  let recipientIds = []
  if (body.recipientId)                                recipientIds = [body.recipientId]
  if (Array.isArray(body.recipientIds))                recipientIds = body.recipientIds
  if (!recipientIds.length || !type) {
    return res.status(400).json({ error: 'Missing required fields: type, recipientId or recipientIds.' })
  }

  const tmpl = TEMPLATE_MAP[type]
  if (!tmpl) return res.status(400).json({ error: `Unknown email type: ${type}` })

  // Newsletter restricted to managers/admins
  if (type === 'newsletter' && !['admin', 'manager'].includes(callerRow.access)) {
    return res.status(403).json({ error: 'Newsletter emails require manager or admin access.' })
  }

  // Rate limit per calling user
  if (!checkRate(callerRow.id)) {
    return res.status(429).json({ error: 'Too many email requests. Try again shortly.' })
  }

  // ── Fetch all recipients in one query ─────────────────────────────────────
  const { data: recipientRows, error: rErr } = await supabase
    .from('users')
    .select('id, name, email, leaderboard_name')
    .in('id', recipientIds)

  if (rErr) return res.status(500).json({ error: rErr.message })

  // ── Fetch opt-out preferences for all recipients ──────────────────────────
  const { data: prefRows } = await supabase
    .from('email_preferences')
    .select('*')
    .in('user_id', recipientIds)

  const prefMap = {}
  ;(prefRows ?? []).forEach(p => { prefMap[p.user_id] = p })

  // ── Send to each eligible recipient ──────────────────────────────────────
  let sent = 0, skipped = 0
  const errors = []

  for (const recipient of (recipientRows ?? [])) {
    if (!recipient.email) { skipped++; continue }

    // Opt-out check (transactional types always go through)
    const category = tmpl.category
    if (category) {
      const prefs = prefMap[recipient.id]
      // Default to opted-in if no prefs row yet
      const isOptedIn = prefs ? (prefs[category] ?? true) : true
      if (!isOptedIn) { skipped++; continue }
    }

    // Build unsubscribe link for opt-outable emails
    const unsubLink = category
      ? unsubUrl(recipient.id, category, makeUnsubToken(recipient.id, category))
      : null

    // Merge recipient name into template data
    const mergedData = {
      ...templateData,
      recipientName: recipient.leaderboard_name || recipient.name || 'Operative',
    }

    try {
      const { subject, html } = tmpl.build(mergedData, unsubLink)
      await sendViaResend(recipient.email, subject, html)
      sent++
    } catch (e) {
      errors.push({ recipientId: recipient.id, error: e.message })
    }
  }

  return res.status(200).json({ sent, skipped, errors: errors.length ? errors : undefined })
}

// Export token helpers so unsubscribe.js can use them
export { makeUnsubToken, verifyUnsubToken }
