import { useState, useEffect } from 'react'
import { supabase } from './supabase.js'
import { vizRenderName, audRenderName } from './envRender.jsx'

const VIZ_OPTS = [
  { code: 'V', name: 'Standard', desc: 'Normal lighting' },
  { code: 'C', name: 'Cosmic',   desc: 'UV blacklight'   },
  { code: 'S', name: 'Strobe',   desc: 'Flash pulse'     },
  { code: 'B', name: 'Dark',     desc: 'Lights off'      },
  { code: 'R', name: 'Rave',     desc: 'UV + strobe'     },
]

const AUD_OPTS = [
  { code: 'T', name: 'Tunes',   desc: 'Background music' },
  { code: 'C', name: 'Cranked', desc: 'Distorted audio'  },
  { code: 'O', name: 'Off',     desc: 'Silent'           },
]

const DIFF_OPTS = [
  { value: 'NONE',     label: 'No Return Fire' },
  { value: 'HARMLESS', label: 'Harmless'       },
  { value: 'EASY',     label: 'Easy'           },
  { value: 'MEDIUM',   label: 'Medium'         },
  { value: 'HARD',     label: 'Hard'           },
  { value: 'EXPERT',   label: 'Expert'         },
]

const BLUE = '#4fc3f7'
const RED  = '#ef9a9a'
const BLUE_BG = 'rgba(79,195,247,.12)'
const RED_BG  = 'rgba(239,154,154,.12)'

const fd = 'var(--fd)'

export default function StructurePage({ structure }) {
  const [phase,       setPhase]       = useState('loading') // 'loading'|'ready'|'error'
  const [error,       setError]       = useState(null)
  const [isFullscreen,setIsFullscreen]= useState(!!document.fullscreenElement)
  const [saving,      setSaving]      = useState(false)

  // ── Run context (pushed from scoring table via activate_structure_run) ──
  const [active,        setActive]        = useState(false)
  const [mode,          setMode]          = useState(null)     // 'coop'|'versus'|null
  const [customerNames, setCustomerNames] = useState([])
  const [objectives,    setObjectives]    = useState([])       // [{id, name}]
  const [runNumber,     setRunNumber]     = useState(1)

  // ── Customer selections ──────────────────────────────────
  const [visual,      setVisual]      = useState('V')
  const [audio,       setAudio]       = useState('T')
  const [objectiveId, setObjectiveId] = useState(null)
  const [difficulty,  setDifficulty]  = useState('NONE')

  // ── Fullscreen tracking ──────────────────────────────────
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const enterFullscreen = () => document.documentElement.requestFullscreen?.().catch(() => {})

  // ── Apply a full structures row to local state ───────────
  const applyRow = row => {
    if (row.active    !== undefined) setActive(!!row.active)
    if (row.mode      !== undefined) setMode(row.mode)
    if (row.visual    !== undefined) setVisual(row.visual)
    if (row.audio     !== undefined) setAudio(row.audio)
    if (row.objective_id !== undefined) setObjectiveId(row.objective_id)
    if (row.difficulty   !== undefined) setDifficulty(row.difficulty ?? 'NONE')
    if (row.customer_names !== undefined) setCustomerNames(row.customer_names ?? [])
    if (row.objectives    !== undefined) setObjectives(row.objectives ?? [])
    if (row.active_run_number !== undefined) setRunNumber(row.active_run_number ?? 1)
  }

  // ── Auto-login on mount ──────────────────────────────────
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

        // Load full current state for this structure
        const { data } = await supabase
          .from('structures').select('*').eq('id', structure).maybeSingle()
        if (data) applyRow(data)

        setPhase('ready')
        enterFullscreen()
      } catch (e) {
        setError('Could not connect: ' + e.message)
        setPhase('error')
      }
    })()
  }, [structure]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Realtime — scoring table pushes context, picks up our selections ──
  useEffect(() => {
    if (phase !== 'ready') return
    const ch = supabase.channel(`structure-${structure}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'structures',
        filter: `id=eq.${structure}`,
      }, ({ new: row }) => applyRow(row))
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [phase, structure]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Polling fallback — re-read every 5s in case Realtime drops ──
  useEffect(() => {
    if (phase !== 'ready') return
    const id = setInterval(async () => {
      const { data } = await supabase
        .from('structures').select('*').eq('id', structure).maybeSingle()
      if (data) applyRow(data)
    }, 5000)
    return () => clearInterval(id)
  }, [phase, structure]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Write selection back to structures (picked up by scoring table) ──
  const pick = async (field, value) => {
    const nv = field === 'visual'      ? value : visual
    const na = field === 'audio'       ? value : audio
    const no = field === 'objectiveId' ? value : objectiveId
    const nd = field === 'difficulty'  ? value : difficulty
    if (field === 'visual')      setVisual(value)
    else if (field === 'audio')  setAudio(value)
    else if (field === 'objectiveId') setObjectiveId(value)
    else if (field === 'difficulty')  setDifficulty(value)
    setSaving(true)
    try {
      await supabase.rpc('set_structure_environment', {
        p_structure:    structure,
        p_visual:       nv,
        p_audio:        na,
        p_source:       'tablet',
        p_objective_id: no ?? null,
        p_difficulty:   nd ?? 'NONE',
      })
    } catch (e) {
      console.error('Failed to save structure environment:', e)
    } finally {
      setSaving(false)
    }
  }

  // ── Loading ──────────────────────────────────────────────
  if (phase === 'loading') return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 48, height: 48, border: '3px solid var(--bdr)', borderTop: '3px solid var(--acc)', borderRadius: '50%', animation: 'spin .8s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  // ── Error ────────────────────────────────────────────────
  if (phase === 'error') return (
    <div style={{ minHeight: '100vh', background: '#0e0e0e', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#e44', fontFamily: fd, fontSize: '1.1rem', textAlign: 'center', padding: '2rem' }}>
      {error}
    </div>
  )

  // ── Versus team info derived from run number ─────────────
  const blueLabel = runNumber === 1 ? 'Hunters' : 'Coyotes'
  const redLabel  = runNumber === 1 ? 'Coyotes' : 'Hunters'

  // ── Common card style ────────────────────────────────────
  const card = (active, accent) => ({
    background:   active ? 'var(--surf)' : 'var(--bg2)',
    border:       `2px solid ${active ? accent : 'var(--bdr)'}`,
    borderRadius: 14, cursor: 'pointer',
    transition: 'border-color .15s, transform .1s',
    transform: active ? 'scale(1.05)' : 'scale(1)',
    boxShadow: active ? `0 0 0 1px ${accent}` : 'none',
  })

  return (
    <div
      onClick={!isFullscreen ? enterFullscreen : undefined}
      style={{
        minHeight: '100vh', background: 'var(--bg)', color: 'var(--txt)',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', padding: '2rem',
        userSelect: 'none', cursor: !isFullscreen ? 'pointer' : 'default',
        fontFamily: fd,
      }}
    >
      {/* Fullscreen prompt */}
      {!isFullscreen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0,
          background: 'var(--acc)', color: '#000',
          textAlign: 'center', padding: '.5rem',
          fontWeight: 700, fontSize: '.85rem', letterSpacing: '.08em',
        }}>
          TAP ANYWHERE TO GO FULLSCREEN
        </div>
      )}

      {/* Structure identity */}
      <div style={{ letterSpacing: '.2em', fontSize: '.8rem', color: 'var(--muted)', textTransform: 'uppercase', marginBottom: '.25rem' }}>
        Structure
      </div>
      <div style={{ fontSize: '3rem', fontWeight: 900, letterSpacing: '.15em', color: 'var(--acc)', textTransform: 'uppercase', lineHeight: 1, marginBottom: active ? '1.5rem' : '3rem' }}>
        {structure}
      </div>

      {/* ── STANDBY — scoring table not open ── */}
      {!active && (
        <div style={{ textAlign: 'center', maxWidth: 480 }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--muted)', letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: '.75rem' }}>
            Stand By
          </div>
          <div style={{ fontSize: '.9rem', color: 'var(--muted)', lineHeight: 1.6 }}>
            Your operator will activate this panel when your session is ready.
          </div>
        </div>
      )}

      {/* ── ACTIVE ── */}
      {active && (
        <div style={{ width: '100%', maxWidth: 680 }}>

          {/* Session info */}
          {customerNames.length > 0 && (
            <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
              {mode === 'versus' ? (
                <div style={{ display: 'flex', justifyContent: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '.65rem', color: BLUE, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '.2rem' }}>Blue — {blueLabel}</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--txt)' }}>{customerNames[0] || '—'}</div>
                  </div>
                  <div style={{ fontSize: '1.4rem', color: 'var(--muted)', alignSelf: 'center', fontWeight: 300 }}>vs</div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '.65rem', color: RED, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '.2rem' }}>Red — {redLabel}</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--txt)' }}>{customerNames[1] || customerNames[0] || '—'}</div>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--txt)' }}>
                  {customerNames.join(' · ')}
                </div>
              )}
              <div style={{ fontSize: '.7rem', color: 'var(--muted)', marginTop: '.3rem', letterSpacing: '.06em', textTransform: 'uppercase' }}>
                {mode === 'coop' ? 'Co-Op Mission' : mode === 'versus' ? `Versus · Run ${runNumber}` : ''}
              </div>
            </div>
          )}

          {/* Objective selector */}
          {objectives.length > 0 && (
            <div style={{ marginBottom: '2rem' }}>
              <div style={{ fontSize: '.68rem', letterSpacing: '.12em', color: 'var(--muted)', textTransform: 'uppercase', textAlign: 'center', marginBottom: '.75rem' }}>
                Mission Objective
              </div>
              <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                {objectives.map(obj => {
                  const sel = objectiveId === obj.id
                  return (
                    <button key={obj.id} onClick={() => pick('objectiveId', sel ? null : obj.id)} style={{
                      ...card(sel, 'var(--acc)'),
                      padding: '.7rem 1.1rem', minWidth: 110,
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.2rem',
                    }}>
                      <div style={{ fontSize: '.9rem', fontWeight: 700, color: sel ? 'var(--acc)' : 'var(--txt)' }}>{obj.name}</div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Difficulty slider (coop only) */}
          {mode === 'coop' && (
            <div style={{ marginBottom: '2rem' }}>
              <div style={{ fontSize: '.68rem', letterSpacing: '.12em', color: 'var(--muted)', textTransform: 'uppercase', textAlign: 'center', marginBottom: '.5rem' }}>
                Opponent Difficulty
              </div>
              <div style={{ display: 'flex', gap: '.4rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                {DIFF_OPTS.map(d => {
                  const sel = difficulty === d.value
                  return (
                    <button key={d.value} onClick={() => pick('difficulty', d.value)} style={{
                      ...card(sel, 'var(--acc)'),
                      padding: '.55rem .9rem',
                      fontSize: '.8rem', fontWeight: sel ? 700 : 500,
                      color: sel ? 'var(--acc)' : 'var(--muted)',
                    }}>
                      {d.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Versus team colors display */}
          {mode === 'versus' && (
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', justifyContent: 'center' }}>
              <div style={{ flex: 1, background: BLUE_BG, border: `2px solid ${BLUE}`, borderRadius: 12, padding: '.75rem', textAlign: 'center' }}>
                <div style={{ fontSize: '.65rem', color: BLUE, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '.2rem' }}>Blue Team</div>
                <div style={{ fontSize: '1rem', fontWeight: 700, color: BLUE }}>{blueLabel}</div>
              </div>
              <div style={{ flex: 1, background: RED_BG, border: `2px solid ${RED}`, borderRadius: 12, padding: '.75rem', textAlign: 'center' }}>
                <div style={{ fontSize: '.65rem', color: RED, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '.2rem' }}>Red Team</div>
                <div style={{ fontSize: '1rem', fontWeight: 700, color: RED }}>{redLabel}</div>
              </div>
            </div>
          )}

          {/* Visual mode */}
          <div style={{ marginBottom: '1.75rem' }}>
            <div style={{ fontSize: '.68rem', letterSpacing: '.12em', color: 'var(--muted)', textTransform: 'uppercase', textAlign: 'center', marginBottom: '.75rem' }}>
              Visual Mode
            </div>
            <div style={{ display: 'flex', gap: '.6rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              {VIZ_OPTS.map(opt => {
                const sel = visual === opt.code
                return (
                  <button key={opt.code} onClick={() => pick('visual', opt.code)} style={{
                    ...card(sel, 'var(--acc)'),
                    padding: '.9rem .8rem', minWidth: 90,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.3rem',
                  }}>
                    <div style={{ fontSize: '.95rem', fontWeight: 700 }}>
                      {vizRenderName(opt.code, opt.name, { fontFamily: fd, fontSize: '.95rem', fontWeight: 700 })}
                    </div>
                    <div style={{ fontSize: '.62rem', color: 'var(--muted)' }}>{opt.desc}</div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Audio mode */}
          <div>
            <div style={{ fontSize: '.68rem', letterSpacing: '.12em', color: 'var(--muted)', textTransform: 'uppercase', textAlign: 'center', marginBottom: '.75rem' }}>
              Audio Mode
            </div>
            <div style={{ display: 'flex', gap: '.6rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              {AUD_OPTS.map(opt => {
                const sel = audio === opt.code
                return (
                  <button key={opt.code} onClick={() => pick('audio', opt.code)} style={{
                    ...card(sel, 'var(--acc)'),
                    padding: '.9rem 1.2rem', minWidth: 110,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.3rem',
                  }}>
                    <div style={{ fontSize: '.95rem', fontWeight: 700 }}>
                      {audRenderName(opt.code, opt.name, { fontFamily: fd, fontSize: '.95rem', fontWeight: 700 })}
                    </div>
                    <div style={{ fontSize: '.62rem', color: 'var(--muted)' }}>{opt.desc}</div>
                  </button>
                )
              })}
            </div>
          </div>

          {saving && (
            <div style={{ marginTop: '1.5rem', fontSize: '.68rem', color: 'var(--muted)', letterSpacing: '.06em', textAlign: 'center' }}>
              UPDATING…
            </div>
          )}
        </div>
      )}
    </div>
  )
}
