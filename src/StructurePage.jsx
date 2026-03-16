import { useState, useEffect } from 'react'
import { supabase } from './supabase.js'
import { vizRenderName, audRenderName } from './envRender.jsx'
import { getTierInfo, TIER_COLORS, TIER_SHINE } from './utils.js'

const VIZ_OPTS = [
  { code: 'V', name: 'Standard', desc: '6000K House Lighting' },
  { code: 'C', name: 'Cosmic',   desc: 'UV Blacklighting'     },
  { code: 'S', name: 'Strobe',   desc: 'Flash Pulse'          },
  { code: 'B', name: 'Dark',     desc: 'Lights Off'           },
  { code: 'R', name: 'Rave',     desc: 'Party Lighting'       },
]

const AUD_OPTS = [
  { code: 'T', name: 'Tunes',   desc: 'Background Music' },
  { code: 'C', name: 'Cranked', desc: 'Loud Music'       },
  { code: 'O', name: 'Off',     desc: 'Silent'           },
]

const DIFF_OPTS = [
  { value: 'NONE',     label: 'No Return Fire', desc: 'Role players will not engage.'                },
  { value: 'HARMLESS', label: 'Harmless',        desc: 'Light return fire with zero tactical skill.'  },
  { value: 'EASY',     label: 'Easy',            desc: 'Light return fire with basic tactical skill.' },
  { value: 'MEDIUM',   label: 'Medium',          desc: 'Return fire with basic tactical skill.'       },
  { value: 'HARD',     label: 'Hard',            desc: 'Return fire with high tactical skill.'        },
  { value: 'EXPERT',   label: 'Expert',          desc: 'Everything you can handle!'                   },
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
  const [players,     setPlayers]     = useState([])

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
    if (row.players           !== undefined) setPlayers(row.players ?? [])
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

  // Env option — selected item grows to 2× width via flex
  const envOpt = sel => ({
    flex: sel ? 2.5 : 1,
    background: 'none', border: 'none',
    cursor: 'pointer', touchAction: 'manipulation',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: '.2vh', padding: '0 .25vw',
    transition: 'flex .25s ease',
    overflow: 'hidden',
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
        padding: '3.5vh 3vw 1.5vh', boxSizing: 'border-box',
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
        <div style={{ flex: 1, minHeight: 0, width: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: '1.2vh' }}>

          {/* Session mode label */}
          <div style={{ flexShrink: 0, textAlign: 'center', marginBottom: '.2vh' }}>
            <div style={{ fontSize: 'clamp(.5rem,.75vw,.72rem)', color: 'var(--muted)', letterSpacing: '.06em', textTransform: 'uppercase' }}>
              {mode === 'coop' ? 'Co-Op Mission' : mode === 'versus' ? `Versus · Run ${runNumber}` : ''}
            </div>
          </div>

          {/* Team / player list */}
          {mode === 'versus' ? (
            <div style={{ flexShrink: 0, display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '1.5vw', alignItems: 'stretch' }}>
              {[{label:blueLabel,color:BLUE,team:1},{label:redLabel,color:RED,team:2}].map(({label,color,team},ti)=>{
                const tp = players.filter(p=>p.team===team)
                return (
                  <div key={team} style={{
                    minWidth: 'clamp(200px, 28vw, 420px)',
                    background: `linear-gradient(150deg, ${color}1E 0%, ${color}0A 45%, rgba(0,0,0,0) 100%)`,
                    border: `1.5px solid ${color}99`,
                    borderRadius: '1.2vw',
                    padding: '.6vh 1.3vw .7vh',
                    overflow: 'hidden',
                    boxShadow: `0 0 22px ${color}2A, inset 0 0 40px ${color}0A`,
                    position: 'relative',
                  }}>
                    {/* corner accent */}
                    <div style={{ position:'absolute', top:0, [ti===0?'right':'left']:0, width:'28%', height:'2px', background:`linear-gradient(${ti===0?'to left':'to right'}, transparent, ${color}88)` }}/>
                    <div style={{ display:'flex', alignItems:'baseline', justifyContent:'center', gap:'.6vw', marginBottom:'.5vh' }}>
                      <div style={{ fontSize:'clamp(1.1rem,2vw,2rem)', color, letterSpacing:'.18em', textTransform:'uppercase', fontWeight:900, textShadow:`0 0 14px ${color}88, 0 0 28px ${color}44`, lineHeight:1 }}>
                        {label}
                      </div>
                      <div style={{ fontSize:'clamp(.55rem,.85vw,.85rem)', color:`${color}99`, letterSpacing:'.08em', fontWeight:600, fontFamily:'var(--fd)' }}>
                        {tp.length}P
                      </div>
                    </div>
                    <div style={{ overflow:'hidden', maxHeight:'calc(6 * 2.8vh)' }}>
                      {tp.length === 0
                        ? <div style={{ fontSize:'clamp(.65rem,.9vw,.9rem)', color:'var(--muted)', fontStyle:'italic', padding:'.3vh 0' }}>—</div>
                        : tp.map((p,i) => (
                          <div key={p.id} style={{
                            display:'flex', alignItems:'center', gap:'.55vw',
                            padding:'.28vh .4vw',
                            borderRadius:'.3vw',
                            background: i%2===0 ? `${color}08` : 'transparent',
                            borderLeft:`2px solid ${color}55`,
                            marginBottom:'.1vh',
                          }}>
                            <img src={`/${p.tierKey}.png`} alt={p.tierKey} style={{ height:'clamp(14px,1.8vw,18px)', width:'clamp(14px,1.8vw,18px)', objectFit:'contain', flexShrink:0, ...(TIER_SHINE[p.tierKey]?{filter:TIER_SHINE[p.tierKey]}:{}) }} />
                            {p.platoonTag && <span style={{ fontSize:'clamp(.72rem,1.05vw,1.05rem)', color:p.platoonBadgeColor||color, flexShrink:0, letterSpacing:'.04em', fontWeight:700, opacity:.9 }}>[{p.platoonTag}]</span>}
                            <span style={{ flex:1, minWidth:0, fontSize:'clamp(.72rem,1.05vw,1.05rem)', fontWeight:400, color:'rgba(255,255,255,.78)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                              {p.leaderboardName || p.name}
                              {p.leaderboardName && p.leaderboardName !== p.name && <span style={{ color:'rgba(255,255,255,.35)', fontWeight:400, marginLeft:'.3vw', fontSize:'clamp(.5rem,.78vw,.8rem)' }}>({p.name})</span>}
                            </span>
                          </div>
                        ))
                      }
                    </div>
                  </div>
                )
              }).reduce((acc,el,i)=>i===0?[el]:[...acc,
                <div key="vs" style={{ display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, width:'2.8vw' }}>
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'.3vh' }}>
                    <div style={{ width:1, flex:1, background:'linear-gradient(to bottom, transparent, rgba(255,255,255,.12), transparent)', minHeight:'3vh' }}/>
                    <span style={{ fontSize:'clamp(.7rem,1.4vw,1.4rem)', fontWeight:900, color:'rgba(255,255,255,.18)', letterSpacing:'.12em', fontFamily:'var(--fd)' }}>VS</span>
                    <div style={{ width:1, flex:1, background:'linear-gradient(to bottom, transparent, rgba(255,255,255,.12), transparent)', minHeight:'3vh' }}/>
                  </div>
                </div>,
                el
              ],[])}</div>
          ) : players.length > 0 ? (
            <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
              <div style={{
                minWidth: 'clamp(220px, 36vw, 480px)',
                background: 'linear-gradient(150deg, var(--acc-rgb, 255 165 0 / .12) 0%, rgba(0,0,0,0) 100%)',
                background: 'linear-gradient(150deg, color-mix(in srgb, var(--acc) 12%, transparent) 0%, transparent 100%)',
                border: '1.5px solid color-mix(in srgb, var(--acc) 60%, transparent)',
                borderRadius: '1.2vw',
                padding: '.6vh 1.3vw .7vh',
                overflow: 'hidden',
                boxShadow: '0 0 22px color-mix(in srgb, var(--acc) 16%, transparent), inset 0 0 40px color-mix(in srgb, var(--acc) 6%, transparent)',
                position: 'relative',
              }}>
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: 'linear-gradient(to right, transparent, color-mix(in srgb, var(--acc) 55%, transparent), transparent)' }} />
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: '.6vw', marginBottom: '.5vh' }}>
                  <div style={{ fontSize: 'clamp(.9rem,1.5vw,1.5rem)', color: 'var(--acc)', letterSpacing: '.18em', textTransform: 'uppercase', fontWeight: 900, textShadow: '0 0 14px color-mix(in srgb, var(--acc) 55%, transparent)', lineHeight: 1 }}>
                    Hunters
                  </div>
                  <div style={{ fontSize: 'clamp(.55rem,.85vw,.85rem)', color: 'color-mix(in srgb, var(--acc) 60%, transparent)', letterSpacing: '.08em', fontWeight: 600, fontFamily: 'var(--fd)' }}>
                    {players.length}P
                  </div>
                </div>
                <div style={{ overflow: 'hidden', maxHeight: 'calc(6 * 2.8vh)' }}>
                  {players.map((p, i) => (
                    <div key={p.id} style={{
                      display: 'flex', alignItems: 'center', gap: '.55vw',
                      padding: '.28vh .4vw',
                      borderRadius: '.3vw',
                      background: i % 2 === 0 ? 'color-mix(in srgb, var(--acc) 5%, transparent)' : 'transparent',
                      borderLeft: '2px solid color-mix(in srgb, var(--acc) 33%, transparent)',
                      marginBottom: '.1vh',
                    }}>
                      <img src={`/${p.tierKey}.png`} alt={p.tierKey} style={{ height: 'clamp(14px,1.8vw,18px)', width: 'clamp(14px,1.8vw,18px)', objectFit: 'contain', flexShrink: 0, ...(TIER_SHINE[p.tierKey] ? { filter: TIER_SHINE[p.tierKey] } : {}) }} />
                      {p.platoonTag && <span style={{ fontSize: 'clamp(.75rem,1.1vw,1.1rem)', color: p.platoonBadgeColor || 'var(--acc)', flexShrink: 0, letterSpacing: '.04em', fontWeight: 700 }}>[{p.platoonTag}]</span>}
                      <span style={{ flex: 1, minWidth: 0, fontSize: 'clamp(.75rem,1.1vw,1.1rem)', fontWeight: 400, color: 'rgba(255,255,255,.78)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.leaderboardName || p.name}
                        {p.leaderboardName && p.leaderboardName !== p.name && <span style={{ color: 'rgba(255,255,255,.35)', fontWeight: 400, marginLeft: '.35vw', fontSize: 'clamp(.55rem,.85vw,.88rem)' }}>({p.name})</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : customerNames.length > 0 ? (
            <div style={{ flexShrink: 0, textAlign: 'center' }}>
              <div style={{ fontSize: 'clamp(1rem,2vw,2rem)', fontWeight: 700, color: 'var(--txt)' }}>{customerNames.join(' · ')}</div>
            </div>
          ) : null}

          {/* Mission Objective */}
          {objectives.length > 0 && (
            <div style={{ flexShrink: 0, paddingTop: '1vh', paddingBottom: '1vh' }}>
              <div style={secLabel}>Mission Objective</div>
              {/* Pill row */}
              <div style={{ display: 'flex', gap: '.6vw', justifyContent: 'center', flexWrap: 'nowrap', marginBottom: '.4vh' }}>
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
              {/* Selected display — fixed height prevents layout jump on first selection */}
              <div style={{ height: '7vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
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
                  <div style={{ fontSize: 'clamp(.7rem,1vw,1rem)', color: 'var(--muted)', fontStyle: 'italic' }}>
                    Select a mission objective above
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Opponent Difficulty — coop only */}
          {mode === 'coop' && (
            <div style={{ display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
            <div style={{ width: 'calc(2 * clamp(220px, 38vw, 560px) + 2.8vw)', background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: '1vw', padding: '.75vh 1.5vw' }}>
              <div style={secLabel}>Opponent Difficulty</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1.5vw' }}>
                {/* Fixed-width left panel — static height prevents layout jump on selection change */}
                <div style={{ flexShrink: 0, width: '19vw', textAlign: 'right' }}>
                  <div style={{ fontSize: 'clamp(.9rem,1.8vw,1.8rem)', fontWeight: 800, color: 'var(--acc)', textTransform: 'uppercase', letterSpacing: '.05em', lineHeight: 1 }}>
                    {selDiff.label}
                  </div>
                  <div style={{ fontSize: 'clamp(.55rem,.85vw,.85rem)', color: 'var(--muted)', fontStyle: 'italic', marginTop: '.2vh', lineHeight: 1.3, height: '2.6vh', overflow: 'hidden' }}>
                    {selDiff.desc}
                  </div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <input
                    type="range" min={0} max={DIFF_OPTS.length - 1}
                    value={DIFF_OPTS.findIndex(d => d.value === difficulty)}
                    onChange={e => pick('difficulty', DIFF_OPTS[+e.target.value].value)}
                    style={{ width: '100%', accentColor: 'var(--acc)', cursor: 'pointer', margin: '.2vh 0', height: '2vh', touchAction: 'manipulation' }}
                  />
                  {/* Labels: padded to match range thumb inset so text aligns with tick marks */}
                  <div style={{ position: 'relative', height: '1.5vh', marginTop: '.25vh', padding: '0 9px', boxSizing: 'border-box' }}>
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
            </div>
          )}

          {/* Env controls — fills remaining space */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: 'calc(2 * clamp(220px, 38vw, 560px) + 2.8vw)', display: 'flex', flexDirection: 'column', gap: '.5vh' }}>

            {/* Visual mode */}
            <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'stretch', overflow: 'hidden' }}>
              <div style={{ flexShrink: 0, width: '2.5vw', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: '1px solid var(--bdr)', marginRight: '.5vw' }}>
                <span style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontSize: 'clamp(.45rem,.65vw,.65rem)', letterSpacing: '.15em', color: 'var(--muted)', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Visual</span>
              </div>
              {VIZ_OPTS.map(opt => {
                const sel = visual === opt.code
                return (
                  <button key={opt.code} onClick={() => pick('visual', opt.code)} style={envOpt(sel)}>
                    <div style={{ fontSize: sel ? 'clamp(1.6rem,3vw,3rem)' : 'clamp(.9rem,1.5vw,1.5rem)', fontWeight: sel ? 800 : 400, color: sel ? 'var(--acc)' : 'var(--muted)', transition: 'font-size .25s, color .15s' }}>
                      {vizRenderName(opt.code, opt.name, { fontFamily: fd, fontSize: sel ? 'clamp(1.6rem,3vw,3rem)' : 'clamp(.9rem,1.5vw,1.5rem)', fontWeight: sel ? 800 : 400 })}
                    </div>
                    <div style={{ fontSize: sel ? 'clamp(.75rem,1.1vw,1.1rem)' : 'clamp(.45rem,.65vw,.65rem)', color: sel ? 'var(--acc)' : 'var(--muted)', opacity: sel ? 1 : 0.35, transition: 'font-size .25s, color .15s, opacity .15s', whiteSpace: 'nowrap', overflow: 'hidden' }}>{opt.desc}</div>
                  </button>
                )
              })}
            </div>

            {/* Audio mode */}
            <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'stretch', overflow: 'hidden' }}>
              <div style={{ flexShrink: 0, width: '2.5vw', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: '1px solid var(--bdr)', marginRight: '.5vw' }}>
                <span style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontSize: 'clamp(.45rem,.65vw,.65rem)', letterSpacing: '.15em', color: 'var(--muted)', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Audio</span>
              </div>
              {AUD_OPTS.map(opt => {
                const sel = audio === opt.code
                return (
                  <button key={opt.code} onClick={() => pick('audio', opt.code)} style={envOpt(sel)}>
                    <div style={{ fontSize: sel ? 'clamp(1.6rem,3vw,3rem)' : 'clamp(.9rem,1.5vw,1.5rem)', fontWeight: sel ? 800 : 400, color: sel ? 'var(--acc)' : 'var(--muted)', transition: 'font-size .25s, color .15s' }}>
                      {audRenderName(opt.code, opt.name, { fontFamily: fd, fontSize: sel ? 'clamp(1.6rem,3vw,3rem)' : 'clamp(.9rem,1.5vw,1.5rem)', fontWeight: sel ? 800 : 400 })}
                    </div>
                    <div style={{ fontSize: sel ? 'clamp(.75rem,1.1vw,1.1rem)' : 'clamp(.45rem,.65vw,.65rem)', color: sel ? 'var(--acc)' : 'var(--muted)', opacity: sel ? 1 : 0.35, transition: 'font-size .25s, color .15s, opacity .15s', whiteSpace: 'nowrap', overflow: 'hidden' }}>{opt.desc}</div>
                  </button>
                )
              })}
            </div>

          </div>
          </div>

          {/* Always-reserved space for UPDATING alert — visibility keeps layout stable */}
          <div style={{ flexShrink: 0, height: '2vh', display: 'flex', alignItems: 'center', justifyContent: 'center', visibility: saving ? 'visible' : 'hidden' }}>
            <span style={{ fontSize: 'clamp(.5rem,.8vw,.8rem)', color: 'var(--muted)', letterSpacing: '.08em' }}>UPDATING…</span>
          </div>

        </div>
      )}
    </div>
  )
}
