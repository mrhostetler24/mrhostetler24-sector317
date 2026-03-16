import { useState, useEffect } from 'react'
import { supabase } from './supabase.js'
import { vizRenderName, audRenderName } from './envRender.jsx'

const VIZ_OPTS = [
  { code: 'V', name: 'Standard', desc: 'Normal lighting'  },
  { code: 'C', name: 'Cosmic',   desc: 'UV blacklight'    },
  { code: 'S', name: 'Strobe',   desc: 'Flash pulse'      },
  { code: 'B', name: 'Dark',     desc: 'Lights off'       },
  { code: 'R', name: 'Rave',     desc: 'UV + strobe'      },
]

const AUD_OPTS = [
  { code: 'T', name: 'Tunes',   desc: 'Background music'  },
  { code: 'C', name: 'Cranked', desc: 'Distorted audio'   },
  { code: 'O', name: 'Off',     desc: 'Silent'            },
]

const DIFF_OPTS = [
  { value: 'NONE',     label: 'No Return Fire', desc: 'Role players will not engage or interfere.'    },
  { value: 'HARMLESS', label: 'Harmless',        desc: 'Light return fire with zero tactical skill.'  },
  { value: 'EASY',     label: 'Easy',            desc: 'Light return fire with basic tactical skill.' },
  { value: 'MEDIUM',   label: 'Medium',          desc: 'Return fire with basic tactical skill.'       },
  { value: 'HARD',     label: 'Hard',            desc: 'Return fire with high tactical skill.'        },
  { value: 'EXPERT',   label: 'Expert',          desc: 'Give me your best shot!'                      },
]

const BLUE    = '#4fc3f7'
const RED     = '#ef9a9a'
const BLUE_BG = 'rgba(79,195,247,.12)'
const RED_BG  = 'rgba(239,154,154,.12)'
const fd      = 'var(--fd)'

export default function StructurePage({ structure }) {
  const [phase,        setPhase]        = useState('loading')
  const [error,        setError]        = useState(null)
  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement)
  const [saving,       setSaving]       = useState(false)

  const [active,        setActive]        = useState(false)
  const [mode,          setMode]          = useState(null)
  const [customerNames, setCustomerNames] = useState([])
  const [objectives,    setObjectives]    = useState([])
  const [runNumber,     setRunNumber]     = useState(1)

  const [visual,      setVisual]      = useState('V')
  const [audio,       setAudio]       = useState('T')
  const [objectiveId, setObjectiveId] = useState(null)
  const [difficulty,  setDifficulty]  = useState('NONE')

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const enterFullscreen = () => document.documentElement.requestFullscreen?.().catch(() => {})

  const applyRow = row => {
    if (row.active            !== undefined) setActive(!!row.active)
    if (row.mode              !== undefined) setMode(row.mode)
    if (row.visual            != null)       setVisual(row.visual)
    if (row.audio             != null)       setAudio(row.audio)
    if (row.objective_id      !== undefined) setObjectiveId(row.objective_id)
    if (row.difficulty        != null)       setDifficulty(row.difficulty)
    if (row.customer_names    !== undefined) setCustomerNames(row.customer_names ?? [])
    if (row.objectives        !== undefined) setObjectives(row.objectives ?? [])
    if (row.active_run_number !== undefined) setRunNumber(row.active_run_number ?? 1)
  }

  useEffect(() => {
    ;(async () => {
      try {
        const resp = await fetch('/api/structure-auth', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
        })
        const json = await resp.json()
        if (!resp.ok) { setError(json.error || 'Authentication failed.'); setPhase('error'); return }
        const { error: sessErr } = await supabase.auth.setSession({
          access_token: json.session.access_token, refresh_token: json.session.refresh_token,
        })
        if (sessErr) { setError(sessErr.message); setPhase('error'); return }
        const { data } = await supabase.from('structures').select('*').eq('id', structure).maybeSingle()
        if (data) applyRow(data)
        setPhase('ready')
        enterFullscreen()
      } catch (e) {
        setError('Could not connect: ' + e.message); setPhase('error')
      }
    })()
  }, [structure]) // eslint-disable-line react-hooks/exhaustive-deps

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

  useEffect(() => {
    if (phase !== 'ready') return
    const id = setInterval(async () => {
      const { data } = await supabase.from('structures').select('*').eq('id', structure).maybeSingle()
      if (data) applyRow(data)
    }, 5000)
    return () => clearInterval(id)
  }, [phase, structure]) // eslint-disable-line react-hooks/exhaustive-deps

  const pick = async (field, value) => {
    const nv = field === 'visual'      ? value : visual
    const na = field === 'audio'       ? value : audio
    const no = field === 'objectiveId' ? value : objectiveId
    const nd = field === 'difficulty'  ? value : difficulty
    if      (field === 'visual')      setVisual(value)
    else if (field === 'audio')       setAudio(value)
    else if (field === 'objectiveId') setObjectiveId(value)
    else if (field === 'difficulty')  setDifficulty(value)
    setSaving(true)
    try {
      await supabase.rpc('set_structure_environment', {
        p_structure: structure, p_visual: nv, p_audio: na,
        p_source: 'tablet', p_objective_id: no ?? null, p_difficulty: nd ?? 'NONE',
      })
    } catch (e) { console.error('Failed to save structure environment:', e) }
    finally { setSaving(false) }
  }

  // ── Loading ──────────────────────────────────────────────
  if (phase === 'loading') return (
    <div style={{ height: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: '4vw', height: '4vw', border: '3px solid var(--bdr)', borderTop: '3px solid var(--acc)', borderRadius: '50%', animation: 'spin .8s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  // ── Error ────────────────────────────────────────────────
  if (phase === 'error') return (
    <div style={{ height: '100vh', background: '#0e0e0e', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#e44', fontFamily: fd, fontSize: 'clamp(1rem,2vw,1.4rem)', textAlign: 'center', padding: '3vw' }}>
      {error}
    </div>
  )

  const blueLabel = runNumber === 1 ? 'Hunters' : 'Coyotes'
  const redLabel  = runNumber === 1 ? 'Coyotes' : 'Hunters'
  const selObj    = objectives.find(o => o.id === objectiveId)
  const selDiff   = DIFF_OPTS.find(d => d.value === difficulty) ?? DIFF_OPTS[0]

  // Button styles — no fixed px, everything flex-relative
  const envBtn = sel => ({
    flex: 1,
    background:  sel ? 'var(--surf)' : 'var(--bg2)',
    border:      `2px solid ${sel ? 'var(--acc)' : 'var(--bdr)'}`,
    borderRadius: '1vw',
    cursor: 'pointer',
    boxShadow:   sel ? '0 0 0 1px var(--acc)' : 'none',
    transition:  'border-color .15s',
    touchAction: 'manipulation',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: '.4vh', padding: '0 .5vw',
  })

  const secLabel = {
    fontSize: 'clamp(.55rem,.8vw,.8rem)', letterSpacing: '.12em',
    color: 'var(--muted)', textTransform: 'uppercase', textAlign: 'center',
    marginBottom: '.4vh', flexShrink: 0,
  }

  return (
    <div
      onClick={!isFullscreen ? enterFullscreen : undefined}
      style={{
        height: '100vh', width: '100vw', overflow: 'hidden',
        background: 'var(--bg)', color: 'var(--txt)',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '1.5vh 2.5vw', boxSizing: 'border-box',
        userSelect: 'none', cursor: !isFullscreen ? 'pointer' : 'default',
        fontFamily: fd,
      }}
    >
      {/* Fullscreen prompt */}
      {!isFullscreen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0,
          background: 'var(--acc)', color: '#000', textAlign: 'center',
          padding: '.5vh', fontWeight: 700,
          fontSize: 'clamp(.7rem,1vw,.9rem)', letterSpacing: '.08em',
        }}>
          TAP ANYWHERE TO GO FULLSCREEN
        </div>
      )}

      {/* Structure identity */}
      <div style={{ flexShrink: 0, textAlign: 'center', marginBottom: '.5vh' }}>
        <div style={{ fontSize: 'clamp(.5rem,.8vw,.75rem)', color: 'var(--muted)', letterSpacing: '.2em', textTransform: 'uppercase' }}>
          Structure
        </div>
        <div style={{ fontFamily: "'Black Ops One', var(--fd)", fontSize: 'clamp(2rem,5vw,5.5rem)', letterSpacing: '.1em', color: 'var(--acc)', textTransform: 'uppercase', lineHeight: 1 }}>
          {structure}
        </div>
      </div>

      {/* ── STANDBY ── */}
      {!active && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
          <div style={{ fontSize: 'clamp(1.5rem,3.5vw,3.5rem)', fontWeight: 700, color: 'var(--muted)', letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: '1vh' }}>
            Stand By
          </div>
          <div style={{ fontSize: 'clamp(.8rem,1.5vw,1.4rem)', color: 'var(--muted)', lineHeight: 1.6 }}>
            Your operator will activate this panel when your session is ready.
          </div>
        </div>
      )}

      {/* ── ACTIVE ── */}
      {active && (
        <div style={{ flex: 1, minHeight: 0, width: '100%', display: 'flex', flexDirection: 'column', gap: '1vh' }}>

          {/* Session names */}
          {customerNames.length > 0 && (
            <div style={{ flexShrink: 0, textAlign: 'center' }}>
              {mode === 'versus' ? (
                <div style={{ display: 'flex', gap: '2vw', alignItems: 'stretch' }}>
                  <div style={{ flex: 1, background: BLUE_BG, border: `2px solid ${BLUE}`, borderRadius: '1vw', padding: '.6vh 1.5vw', textAlign: 'center' }}>
                    <div style={{ fontSize: 'clamp(.55rem,.75vw,.75rem)', color: BLUE, letterSpacing: '.1em', textTransform: 'uppercase' }}>Blue — {blueLabel}</div>
                    <div style={{ fontSize: 'clamp(1rem,2vw,2rem)', fontWeight: 700, color: 'var(--txt)' }}>{customerNames[0] || '—'}</div>
                  </div>
                  <div style={{ fontSize: 'clamp(1rem,2vw,2rem)', color: 'var(--muted)', alignSelf: 'center', fontWeight: 300 }}>vs</div>
                  <div style={{ flex: 1, background: RED_BG, border: `2px solid ${RED}`, borderRadius: '1vw', padding: '.6vh 1.5vw', textAlign: 'center' }}>
                    <div style={{ fontSize: 'clamp(.55rem,.75vw,.75rem)', color: RED, letterSpacing: '.1em', textTransform: 'uppercase' }}>Red — {redLabel}</div>
                    <div style={{ fontSize: 'clamp(1rem,2vw,2rem)', fontWeight: 700, color: 'var(--txt)' }}>{customerNames[1] || customerNames[0] || '—'}</div>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 'clamp(1rem,2vw,2rem)', fontWeight: 700, color: 'var(--txt)' }}>
                  {customerNames.join(' · ')}
                </div>
              )}
              <div style={{ fontSize: 'clamp(.5rem,.75vw,.72rem)', color: 'var(--muted)', marginTop: '.2vh', letterSpacing: '.06em', textTransform: 'uppercase' }}>
                {mode === 'coop' ? 'Co-Op Mission' : mode === 'versus' ? `Versus · Run ${runNumber}` : ''}
              </div>
            </div>
          )}

          {/* Mission Objective */}
          {objectives.length > 0 && (
            <div style={{ flexShrink: 0 }}>
              <div style={secLabel}>Mission Objective</div>
              {/* Pill row */}
              <div style={{ display: 'flex', gap: '.75vw', justifyContent: 'center', flexWrap: 'nowrap', marginBottom: '.75vh' }}>
                {objectives.map(obj => {
                  const sel = objectiveId === obj.id
                  return (
                    <button key={obj.id} onClick={() => pick('objectiveId', sel ? null : obj.id)} style={{
                      padding: '.6vh 1.5vw',
                      borderRadius: '.7vw',
                      border: `2px solid ${sel ? 'var(--acc)' : 'var(--bdr)'}`,
                      background: sel ? 'var(--surf)' : 'var(--bg2)',
                      color: sel ? 'var(--acc)' : 'var(--txt)',
                      fontSize: 'clamp(.8rem,1.2vw,1.15rem)', fontWeight: sel ? 700 : 500,
                      cursor: 'pointer', letterSpacing: '.04em',
                      boxShadow: sel ? '0 0 0 1px var(--acc)' : 'none',
                      transition: 'border-color .15s', touchAction: 'manipulation',
                      whiteSpace: 'nowrap',
                    }}>
                      {obj.name}
                    </button>
                  )
                })}
              </div>
              {/* Selected display */}
              <div style={{ textAlign: 'center', minHeight: '4vh' }}>
                {selObj ? (
                  <>
                    <div style={{ fontSize: 'clamp(1.1rem,2.5vw,2.5rem)', fontWeight: 800, color: 'var(--acc)', letterSpacing: '.04em', lineHeight: 1.1 }}>
                      {selObj.name}
                    </div>
                    {selObj.description && (
                      <div style={{ fontSize: 'clamp(.7rem,1.1vw,1.1rem)', color: 'var(--muted)', marginTop: '.2vh', lineHeight: 1.4 }}>
                        {selObj.description}
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ fontSize: 'clamp(.7rem,1vw,1rem)', color: 'var(--muted)', fontStyle: 'italic', paddingTop: '.5vh' }}>
                    Select a mission objective above
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Opponent Difficulty — coop only */}
          {mode === 'coop' && (
            <div style={{ flexShrink: 0, background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: '1vw', padding: '.75vh 2vw' }}>
              <div style={secLabel}>Opponent Difficulty</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '2vw' }}>
                <div style={{ flexShrink: 0, minWidth: '12vw', textAlign: 'right' }}>
                  <div style={{ fontSize: 'clamp(.9rem,2vw,2rem)', fontWeight: 800, color: 'var(--acc)', textTransform: 'uppercase', letterSpacing: '.05em', lineHeight: 1 }}>
                    {selDiff.label}
                  </div>
                  <div style={{ fontSize: 'clamp(.55rem,.85vw,.85rem)', color: 'var(--muted)', fontStyle: 'italic', marginTop: '.2vh', lineHeight: 1.3 }}>
                    {selDiff.desc}
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <input
                    type="range" min={0} max={DIFF_OPTS.length - 1}
                    value={DIFF_OPTS.findIndex(d => d.value === difficulty)}
                    onChange={e => pick('difficulty', DIFF_OPTS[+e.target.value].value)}
                    style={{ width: '100%', accentColor: 'var(--acc)', cursor: 'pointer', margin: '.2vh 0', height: '2vh', touchAction: 'manipulation' }}
                  />
                  <div style={{ position: 'relative', height: '1.5vh', marginTop: '.25vh' }}>
                    {DIFF_OPTS.map((d, i) => {
                      const pct = i / (DIFF_OPTS.length - 1) * 100
                      const xform = i === 0 ? 'none' : i === DIFF_OPTS.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)'
                      return (
                        <span key={d.value} style={{ position: 'absolute', left: `${pct}%`, transform: xform, fontSize: 'clamp(.45rem,.7vw,.7rem)', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                          {d.label}
                        </span>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Env buttons — fill remaining vertical space */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '1vh' }}>

            {/* Visual mode */}
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={secLabel}>Visual Mode</div>
              <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: '1vw' }}>
                {VIZ_OPTS.map(opt => {
                  const sel = visual === opt.code
                  return (
                    <button key={opt.code} onClick={() => pick('visual', opt.code)} style={envBtn(sel)}>
                      <div style={{ fontSize: 'clamp(.85rem,1.3vw,1.3rem)', fontWeight: 700 }}>
                        {vizRenderName(opt.code, opt.name, { fontFamily: fd, fontSize: 'clamp(.85rem,1.3vw,1.3rem)', fontWeight: 700 })}
                      </div>
                      <div style={{ fontSize: 'clamp(.55rem,.8vw,.8rem)', color: 'var(--muted)' }}>{opt.desc}</div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Audio mode */}
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={secLabel}>Audio Mode</div>
              <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: '1vw' }}>
                {AUD_OPTS.map(opt => {
                  const sel = audio === opt.code
                  return (
                    <button key={opt.code} onClick={() => pick('audio', opt.code)} style={envBtn(sel)}>
                      <div style={{ fontSize: 'clamp(.85rem,1.3vw,1.3rem)', fontWeight: 700 }}>
                        {audRenderName(opt.code, opt.name, { fontFamily: fd, fontSize: 'clamp(.85rem,1.3vw,1.3rem)', fontWeight: 700 })}
                      </div>
                      <div style={{ fontSize: 'clamp(.55rem,.8vw,.8rem)', color: 'var(--muted)' }}>{opt.desc}</div>
                    </button>
                  )
                })}
              </div>
            </div>

          </div>

          {saving && (
            <div style={{ flexShrink: 0, fontSize: 'clamp(.55rem,.8vw,.8rem)', color: 'var(--muted)', letterSpacing: '.06em', textAlign: 'center' }}>
              UPDATING…
            </div>
          )}

        </div>
      )}
    </div>
  )
}
