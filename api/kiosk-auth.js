import { createClient } from '@supabase/supabase-js'

// Module-level rate limiting — persists across warm invocations on the same instance.
// Not perfect across multiple Vercel instances, but combined with the enforced delay
// it makes brute force impractical (10 attempts then 15-min lockout per instance).
const _attempts = new Map() // ip -> { count, lockedUntil }
const MAX_ATTEMPTS  = 10
const LOCKOUT_MS    = 15 * 60 * 1000  // 15 minutes
const FAIL_DELAY_MS = 2000             // 2-second delay on every wrong PIN

function getIp(req) {
  const fwd = req.headers['x-forwarded-for']
  return (fwd ? fwd.split(',')[0] : req.socket?.remoteAddress) ?? 'unknown'
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  // IP allowlist — if KIOSK_ALLOWED_IP is set, reject all other IPs
  const allowedIp = process.env.KIOSK_ALLOWED_IP
  if (allowedIp) {
    const ip = getIp(req)
    if (ip !== allowedIp) return res.status(403).json({ error: 'Access denied.' })
  }

  const url       = process.env.SUPABASE_URL
  const anon      = process.env.SUPABASE_ANON_KEY
  const email     = process.env.KIOSK_EMAIL
  const password  = process.env.KIOSK_PASSWORD
  const unlockPin = process.env.KIOSK_UNLOCK_PIN

  // Validate unlock PIN (server-side only — never sent to client)
  if (unlockPin) {
    const ip  = getIp(req)
    const rec = _attempts.get(ip) ?? { count: 0, lockedUntil: 0 }

    if (Date.now() < rec.lockedUntil) {
      const mins = Math.ceil((rec.lockedUntil - Date.now()) / 60000)
      return res.status(429).json({ error: `Too many attempts. Try again in ${mins} minute${mins !== 1 ? 's' : ''}.` })
    }

    const body = req.body ?? {}
    if (body.pin !== unlockPin) {
      // Enforce delay before responding to slow down scripted attempts
      await new Promise(r => setTimeout(r, FAIL_DELAY_MS))
      rec.count += 1
      rec.lockedUntil = rec.count >= MAX_ATTEMPTS ? Date.now() + LOCKOUT_MS : 0
      _attempts.set(ip, rec)
      const remaining = MAX_ATTEMPTS - rec.count
      const msg = remaining <= 0
        ? 'Too many attempts. Locked for 15 minutes.'
        : `Incorrect PIN. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`
      return res.status(401).json({ error: msg })
    }

    // Correct PIN — clear the counter for this IP
    _attempts.delete(ip)
  }

  if (!url || !anon || !email || !password) {
    return res.status(500).json({ error: 'Kiosk credentials not configured on server.' })
  }

  const supabase = createClient(url, anon)
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) return res.status(401).json({ error: error.message })
  res.status(200).json({ session: data.session })
}
