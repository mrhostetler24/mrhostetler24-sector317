// api/kiosk-guest-setup.js
// POST { name, email, phone }
// Auth: Bearer <kiosk session token>
//
// Creates a guest user account from the kiosk, sets their email,
// and sends a social_auth_invite email so they can complete account setup later.

import { createClient } from '@supabase/supabase-js'
import { tmplSocialAuthInvite } from './email-templates.js'

const FROM_ADDRESS = 'Sector 317 <noreply@sector317.com>'
const RESEND_API   = 'https://api.resend.com/emails'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  // ── Verify kiosk session ──────────────────────────────────────────────────
  const token = (req.headers.authorization ?? '').slice(7)
  if (!token) return res.status(401).json({ error: 'Missing authorization token.' })

  const anonClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
  const { data: { user: authUser }, error: authErr } = await anonClient.auth.getUser(token)
  if (authErr || !authUser) return res.status(401).json({ error: 'Invalid or expired session.' })

  const adminClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const { data: callerRow } = await adminClient
    .from('users').select('id,access').eq('auth_id', authUser.id).maybeSingle()
  if (!callerRow || callerRow.access !== 'kiosk') {
    return res.status(403).json({ error: 'Kiosk access required.' })
  }

  // ── Validate body ─────────────────────────────────────────────────────────
  const { name, email, phone } = req.body ?? {}
  const cleanName  = (name  ?? '').trim()
  const cleanEmail = (email ?? '').trim().toLowerCase()
  const cleanPhone = (phone ?? '').replace(/\D/g, '')

  if (!cleanName || !cleanEmail || cleanPhone.length !== 10) {
    return res.status(400).json({ error: 'name, email, and a 10-digit phone are required.' })
  }

  // Basic email format check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ error: 'Invalid email address.' })
  }

  // ── Check for duplicate phone ─────────────────────────────────────────────
  const { data: existing } = await adminClient
    .from('users').select('id').eq('phone', cleanPhone).maybeSingle()
  if (existing) {
    return res.status(409).json({ error: 'A user with this phone number already exists.' })
  }

  // ── Derive leaderboard name (First L.) ───────────────────────────────────
  const parts = cleanName.split(/\s+/)
  const lbName = parts.length >= 2
    ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`
    : cleanName

  // ── Create guest user via SECURITY DEFINER RPC ───────────────────────────
  const { data: rpcData, error: rpcErr } = await adminClient.rpc('create_guest_user', {
    p_name:               cleanName,
    p_phone:              cleanPhone,
    p_created_by_user_id: callerRow.id,
    p_leaderboard_name:   lbName,
  })
  if (rpcErr) return res.status(500).json({ error: rpcErr.message })

  const userRow = Array.isArray(rpcData) ? rpcData[0] : rpcData
  if (!userRow?.id) return res.status(500).json({ error: 'Failed to create user.' })

  // ── Set email (service role bypasses RLS) ─────────────────────────────────
  await adminClient.from('users').update({ email: cleanEmail }).eq('id', userRow.id)

  // ── Send account setup email via Resend ──────────────────────────────────
  if (process.env.RESEND_API_KEY) {
    try {
      const { subject, html } = tmplSocialAuthInvite({ recipientName: parts[0] })
      await fetch(RESEND_API, {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({ from: FROM_ADDRESS, to: cleanEmail, subject, html }),
      })
    } catch (_) {
      // Email failure is non-fatal — account was still created
    }
  }

  return res.status(200).json({
    id:    userRow.id,
    name:  userRow.name ?? cleanName,
    phone: cleanPhone,
    email: cleanEmail,
  })
}
