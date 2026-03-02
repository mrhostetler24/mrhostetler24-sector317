import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const url  = process.env.SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY
  const email    = process.env.KIOSK_EMAIL
  const password = process.env.KIOSK_PASSWORD

  if (!url || !anon || !email || !password) {
    return res.status(500).json({ error: 'Kiosk credentials not configured on server.' })
  }

  const supabase = createClient(url, anon)
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) return res.status(401).json({ error: error.message })
  res.status(200).json({ session: data.session })
}
