import { createClient } from '@supabase/supabase-js'

// IP allowlist — reuses the same KIOSK_ALLOWED_IP variable.
// No PIN required for structure tablets; IP restriction is the sole gate.
function getIp(req) {
  const fwd = req.headers['x-forwarded-for']
  return (fwd ? fwd.split(',')[0] : req.socket?.remoteAddress) ?? 'unknown'
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  // Same IP allowlist as the kiosk — reuses KIOSK_ALLOWED_IP
  const allowedIp = process.env.KIOSK_ALLOWED_IP
  if (allowedIp) {
    const ip = getIp(req)
    if (ip !== allowedIp) return res.status(403).json({ error: 'Access denied.' })
  }

  const url      = process.env.SUPABASE_URL
  const anon     = process.env.SUPABASE_ANON_KEY
  const email    = process.env.KIOSK_EMAIL     // reuse kiosk credentials
  const password = process.env.KIOSK_PASSWORD

  if (!url || !anon || !email || !password) {
    return res.status(500).json({ error: 'Structure auth not configured on server.' })
  }

  const supabase = createClient(url, anon)
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) return res.status(401).json({ error: error.message })
  res.status(200).json({ session: data.session })
}
