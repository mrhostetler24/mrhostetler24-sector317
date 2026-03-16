import { useState, useEffect } from 'react'
import { supabase } from './supabase.js'
import { vizRenderName, audRenderName } from './envRender.jsx'

const VIZ_OPTS = [
  { code: 'V', name: 'Standard',  desc: 'Normal lighting'  },
  { code: 'C', name: 'Cosmic',    desc: 'UV blacklight'    },
  { code: 'S', name: 'Strobe',    desc: 'Flash pulse'      },
  { code: 'B', name: 'Dark',      desc: 'Lights off'       },
  { code: 'R', name: 'Rave',      desc: 'UV + strobe'      },
]

const AUD_OPTS = [
  { code: 'T', name: 'Tunes',    desc: 'Background music'  },
  { code: 'C', name: 'Cranked',  desc: 'Distorted audio'   },
  { code: 'O', name: 'Off',      desc: 'Silent'            },
]

export default function StructurePage({ structure }) {
  const [phase,        setPhase]        = useState('loading') // 'loading' | 'ready' | 'error'
  const [error,        setError]        = useState(null)
  const [visual,       setVisual]       = useState('V')
  const [audio,        setAudio]        = useState('T')
  const [saving,       setSaving]       = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement)

  // ── Fullscreen tracking ──────────────────────────────────
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const enterFullscreen = () => document.documentElement.requestFullscreen?.().catch(() => {})

  // ── Auto-login on mount (no PIN — IP gate handled server-side) ──
  useEffect(() => {
    ;(async () => {
      try {
        const resp = await fetch('/api/structure-auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
        const json = await resp.json()
        if (!resp.ok) { setError(json.error || 'Authentication failed.'); setPhase('error'); return }

        const { error: sessErr } = await supabase.auth.setSession({
          access_token:  json.session.access_token,
          refresh_token: json.session.refresh_token,
        })
        if (sessErr) { setError(sessErr.message); setPhase('error'); return }

        // Load current state for this structure
        const { data } = await supabase
          .from('structures').select('visual,audio').eq('id', structure).maybeSingle()
        if (data) { setVisual(data.visual); setAudio(data.audio) }

        setPhase('ready')
        enterFullscreen()
      } catch (e) {
        setError('Could not connect: ' + e.message)
        setPhase('error')
      }
    })()
  }, [structure])

  // ── Realtime — scoring table can push changes here too ──
  useEffect(() => {
    if (phase !== 'ready') return
    const channel = supabase.channel(`structure-${structure}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'structures',
        filter: `id=eq.${structure}`,
      }, ({ new: row }) => {
        if (row.visual) setVisual(row.visual)
        if (row.audio)  setAudio(row.audio)
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [phase, structure])

  // ── Selection handler ────────────────────────────────────
  const pick = async (field, value) => {
    const newVisual = field === 'visual' ? value : visual
    const newAudio  = field === 'audio'  ? value : audio
    if (field === 'visual') setVisual(value)
    else                    setAudio(value)
    setSaving(true)
    try {
      const { error: rpcErr } = await supabase.rpc('set_structure_environment', {
        p_structure: structure,
        p_visual:    newVisual,
        p_audio:     newAudio,
        p_source:    'tablet',
      })
      if (rpcErr) throw rpcErr
    } catch (e) {
      console.error('Failed to save structure environment:', e)
    } finally {
      setSaving(false)
    }
  }

  // ── Loading state ────────────────────────────────────────
  if (phase === 'loading') return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 48, height: 48, border: '3px solid var(--bdr)', borderTop: '3px solid var(--acc)', borderRadius: '50%', animation: 'spin .8s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  // ── Error state ──────────────────────────────────────────
  if (phase === 'error') return (
    <div style={{ minHeight: '100vh', background: '#0e0e0e', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#e44', fontFamily: 'var(--fd)', fontSize: '1.1rem', textAlign: 'center', padding: '2rem' }}>
      {error}
    </div>
  )

  // ── Ready ────────────────────────────────────────────────
  return (
    <div
      onClick={!isFullscreen ? enterFullscreen : undefined}
      style={{
        minHeight: '100vh', background: 'var(--bg)', color: 'var(--txt)',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', padding: '2rem',
        userSelect: 'none', cursor: !isFullscreen ? 'pointer' : 'default',
      }}
    >
      {/* Fullscreen prompt */}
      {!isFullscreen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0,
          background: 'var(--acc)', color: '#000',
          textAlign: 'center', padding: '.5rem',
          fontWeight: 700, fontSize: '.85rem', fontFamily: 'var(--fd)',
          letterSpacing: '.08em',
        }}>
          TAP ANYWHERE TO GO FULLSCREEN
        </div>
      )}

      {/* Structure identity */}
      <div style={{ fontFamily: 'var(--fd)', letterSpacing: '.2em', fontSize: '.85rem', color: 'var(--muted)', textTransform: 'uppercase', marginBottom: '.35rem' }}>
        Structure
      </div>
      <div style={{ fontFamily: 'var(--fd)', fontSize: '3.5rem', fontWeight: 900, letterSpacing: '.15em', color: 'var(--acc)', marginBottom: '3rem', textTransform: 'uppercase', lineHeight: 1 }}>
        {structure}
      </div>

      {/* Visual mode */}
      <div style={{ marginBottom: '2.5rem', width: '100%', maxWidth: 640 }}>
        <div style={{ fontFamily: 'var(--fd)', fontSize: '.72rem', letterSpacing: '.14em', color: 'var(--muted)', textTransform: 'uppercase', marginBottom: '1rem', textAlign: 'center' }}>
          Visual Mode
        </div>
        <div style={{ display: 'flex', gap: '.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          {VIZ_OPTS.map(opt => {
            const active = visual === opt.code
            return (
              <button key={opt.code} onClick={() => pick('visual', opt.code)} style={{
                background:   active ? 'var(--surf)' : 'var(--bg2)',
                border:       `2px solid ${active ? 'var(--acc)' : 'var(--bdr)'}`,
                borderRadius: 14, padding: '1.1rem 1rem', minWidth: 100, cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.35rem',
                transition: 'border-color .15s, transform .1s',
                transform: active ? 'scale(1.06)' : 'scale(1)',
                boxShadow: active ? '0 0 0 1px var(--acc)' : 'none',
              }}>
                <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>
                  {vizRenderName(opt.code, opt.name, { fontFamily: 'var(--fd)', fontSize: '1.05rem', fontWeight: 700 })}
                </div>
                <div style={{ fontSize: '.68rem', color: 'var(--muted)', fontFamily: 'var(--fd)' }}>{opt.desc}</div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Audio mode */}
      <div style={{ width: '100%', maxWidth: 640 }}>
        <div style={{ fontFamily: 'var(--fd)', fontSize: '.72rem', letterSpacing: '.14em', color: 'var(--muted)', textTransform: 'uppercase', marginBottom: '1rem', textAlign: 'center' }}>
          Audio Mode
        </div>
        <div style={{ display: 'flex', gap: '.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          {AUD_OPTS.map(opt => {
            const active = audio === opt.code
            return (
              <button key={opt.code} onClick={() => pick('audio', opt.code)} style={{
                background:   active ? 'var(--surf)' : 'var(--bg2)',
                border:       `2px solid ${active ? 'var(--acc)' : 'var(--bdr)'}`,
                borderRadius: 14, padding: '1.1rem 1.5rem', minWidth: 120, cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.35rem',
                transition: 'border-color .15s, transform .1s',
                transform: active ? 'scale(1.06)' : 'scale(1)',
                boxShadow: active ? '0 0 0 1px var(--acc)' : 'none',
              }}>
                <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>
                  {audRenderName(opt.code, opt.name, { fontFamily: 'var(--fd)', fontSize: '1.05rem', fontWeight: 700 })}
                </div>
                <div style={{ fontSize: '.68rem', color: 'var(--muted)', fontFamily: 'var(--fd)' }}>{opt.desc}</div>
              </button>
            )
          })}
        </div>
      </div>

      {saving && (
        <div style={{ marginTop: '1.75rem', fontSize: '.72rem', color: 'var(--muted)', fontFamily: 'var(--fd)', letterSpacing: '.06em' }}>
          UPDATING…
        </div>
      )}
    </div>
  )
}
