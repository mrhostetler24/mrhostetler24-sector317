// src/StaffingScheduler.jsx
// Staffing scheduler module — Daily Roster, Conflicts/Pickups, Week View.
// Mounted under the Schedule tab for Manager/Admin users in AdminPortal.
// Uses existing shifts + users state; writes back via updateShift from supabase.js.

import { useState, useMemo, useCallback } from 'react'
import { updateShift } from './supabase.js'

// ── Helpers ────────────────────────────────────────────────────────────────

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function addDays(isoDate, n) {
  const d = new Date(isoDate + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

function weekMonday(isoDate) {
  const d = new Date(isoDate + 'T00:00:00')
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d.toISOString().slice(0, 10)
}

function fmtTime(t) {
  if (!t) return '—'
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`
}

function fmtDate(isoDate) {
  if (!isoDate) return '—'
  const d = new Date(isoDate + 'T00:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function fmtDateShort(isoDate) {
  if (!isoDate) return '—'
  const d = new Date(isoDate + 'T00:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' })
}

function fmtPhone(raw) {
  if (!raw) return '—'
  const d = raw.replace(/\D/g, '')
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
  return raw
}

// Derive a status string from the shift's boolean flags
function shiftStatus(shift) {
  if (shift.conflicted) return 'conflict'
  if (shift.open || !shift.staffId) return 'open'
  return 'scheduled'
}

// Returns true if the shift date is within 14 days from now (schedule already "published")
function isWithin14Days(dateISO) {
  return new Date(dateISO + 'T00:00:00') < new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
}

// Max week we allow navigation to (10 weeks out from today)
function maxWeekStart() {
  return weekMonday(addDays(todayISO(), 70))
}

// ── Component ──────────────────────────────────────────────────────────────

export default function StaffingScheduler({ currentUser, shifts, setShifts, users, isManager, onAlert }) {
  const today = todayISO()

  // Internal view tabs
  const [view, setView] = useState('roster')

  // Daily roster state
  const [selectedDate, setSelectedDate] = useState(today)

  // Week view state
  const [weekStart, setWeekStart] = useState(weekMonday(today))

  // Assignment state: { shiftId, selectedUserId }
  const [assigning, setAssigning] = useState(null)

  // Availability override modal state
  const [availWarn, setAvailWarn] = useState(null) // { shiftId, userId, proceed }

  const [saving, setSaving] = useState(false)

  // Staff-only users list (active staff, managers, admins)
  const staffUsers = useMemo(
    () => users.filter(u => ['staff', 'manager', 'admin'].includes(u.access) && u.active !== false)
            .sort((a, b) => a.name.localeCompare(b.name)),
    [users]
  )

  function getUserById(id) {
    return users.find(u => u.id === id) ?? null
  }

  // ── Assignment logic ──────────────────────────────────────────────────────

  async function doAssign(shiftId, userId) {
    setSaving(true)
    try {
      await updateShift(shiftId, {
        staffId: userId ?? null,
        open: !userId,
        conflicted: false,
        conflictNote: null,
      })
      setShifts(prev => prev.map(s =>
        s.id === shiftId
          ? { ...s, staffId: userId ?? null, open: !userId, conflicted: false, conflictNote: null }
          : s
      ))
      onAlert(userId ? 'Shift assigned.' : 'Shift unassigned.')
    } catch (e) {
      onAlert('Error saving shift: ' + e.message)
    } finally {
      setSaving(false)
      setAssigning(null)
      setAvailWarn(null)
    }
  }

  // TODO: align to final schema when staff_availability table exists
  // For now, no availability data — assign directly.
  function tryAssign(shiftId, userId) {
    // Placeholder availability check — always proceeds
    doAssign(shiftId, userId)
  }

  // ── Computed slices ───────────────────────────────────────────────────────

  // A) Daily roster — shifts for selectedDate, sorted by start time
  const dayShifts = useMemo(
    () => shifts.filter(s => s.date === selectedDate)
             .sort((a, b) => (a.start ?? '').localeCompare(b.start ?? '')),
    [shifts, selectedDate]
  )

  const dayConflictCount = useMemo(
    () => dayShifts.filter(s => s.conflicted).length,
    [dayShifts]
  )

  // B) Conflicts / open pickups — all dates, sorted by date then time
  const pickupShifts = useMemo(
    () => shifts
      .filter(s => s.conflicted || s.open || !s.staffId)
      .sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? '').localeCompare(b.start ?? '')),
    [shifts]
  )

  // C) Week view — shifts in the selected week
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  )

  const weekShifts = useMemo(
    () => shifts.filter(s => s.date >= weekStart && s.date <= weekDays[6]),
    [shifts, weekStart, weekDays]
  )

  // Week grid rows: one row per staff member (and one for unassigned)
  const weekRows = useMemo(() => {
    // Collect all staffIds that appear in this week's shifts
    const ids = new Set(weekShifts.map(s => s.staffId).filter(Boolean))
    const hasOpen = weekShifts.some(s => !s.staffId)

    const rows = []
    for (const id of ids) {
      const u = getUserById(id)
      rows.push({ id, name: u?.name ?? 'Unknown', role: u?.role ?? u?.access ?? '—' })
    }
    rows.sort((a, b) => a.name.localeCompare(b.name))
    if (hasOpen) rows.push({ id: null, name: 'Unassigned', role: '—' })
    return rows
  }, [weekShifts, users]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sub-components (inline to keep file self-contained) ───────────────────

  function StatusBadge({ shift }) {
    const st = shiftStatus(shift)
    if (st === 'conflict')   return <span className="badge b-conflict" style={{ fontSize: '.65rem' }}>Conflict</span>
    if (st === 'open')       return <span className="badge b-available" style={{ fontSize: '.65rem' }}>Open</span>
    return <span className="badge b-ok" style={{ fontSize: '.65rem' }}>Scheduled</span>
  }

  function AssignControls({ shift }) {
    const isThisOne = assigning?.shiftId === shift.id
    const st = shiftStatus(shift)

    if (isThisOne) {
      return (
        <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={assigning.selectedUserId ?? ''}
            onChange={e => setAssigning(prev => ({ ...prev, selectedUserId: e.target.value }))}
            style={{ fontSize: '.8rem', padding: '.25rem .45rem', background: 'var(--surf2)', color: 'var(--txt)', border: '1px solid var(--bdr)', borderRadius: 4 }}
          >
            <option value="">— select staff —</option>
            {staffUsers.map(u => (
              <option key={u.id} value={u.id}>
                {u.name}{u.role ? ` · ${u.role}` : ''}
              </option>
            ))}
          </select>
          <button
            className="btn btn-ok btn-sm"
            disabled={!assigning.selectedUserId || saving}
            onClick={() => tryAssign(shift.id, assigning.selectedUserId)}
          >
            Assign
          </button>
          <button className="btn btn-s btn-sm" onClick={() => setAssigning(null)}>Cancel</button>
        </div>
      )
    }

    if (isManager) {
      return (
        <button
          className="btn btn-s btn-sm"
          onClick={() => setAssigning({ shiftId: shift.id, selectedUserId: shift.staffId ?? '' })}
        >
          {st === 'scheduled' ? 'Reassign' : 'Assign / Pick Up'}
        </button>
      )
    }

    // Staff: can only self-pick-up open/conflict shifts
    if (st !== 'scheduled') {
      return (
        <button className="btn btn-ok btn-sm" disabled={saving} onClick={() => tryAssign(shift.id, currentUser.id)}>
          Pick Up
        </button>
      )
    }

    return null
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ marginTop: '2rem', borderTop: '1px solid var(--bdr)', paddingTop: '1.75rem' }}>

      {/* Section header */}
      <div className="ph" style={{ marginBottom: '1.1rem' }}>
        <div className="ph-left">
          <div className="pt">Staffing Scheduler</div>
          <div className="ps">Daily roster · Conflict resolution · Weekly view &nbsp;·&nbsp; <span style={{ fontStyle: 'italic' }}>Schedules editable up to 2 weeks out.</span></div>
        </div>
      </div>

      {/* Internal tabs */}
      <div className="tabs" style={{ marginBottom: '1.25rem' }}>
        {([
          ['roster',    'Daily Roster'],
          ['conflicts', `Conflicts / Pickups${pickupShifts.length > 0 ? ` (${pickupShifts.length})` : ''}`],
          ['week',      'Week View (10 wks)'],
          ['templates', 'Templates'],
        ]).map(([key, label]) => (
          <button key={key} className={`tab${view === key ? ' on' : ''}`} onClick={() => setView(key)}>
            {label}
          </button>
        ))}
      </div>

      {/* ── A) DAILY ROSTER ──────────────────────────────────────────────── */}
      {view === 'roster' && (
        <div>
          {/* Controls row */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
            <div className="f" style={{ margin: 0 }}>
              <label style={{ marginBottom: '.3rem', fontSize: '.78rem', display: 'block', color: 'var(--muted)' }}>Date</label>
              <input
                type="date"
                value={selectedDate}
                onChange={e => setSelectedDate(e.target.value)}
                style={{ fontSize: '.9rem', padding: '.35rem .6rem', background: 'var(--surf2)', color: 'var(--txt)', border: '1px solid var(--bdr)', borderRadius: 4 }}
              />
            </div>

            {dayConflictCount > 0 && (
              <span className="badge b-conflict">
                {dayConflictCount} conflict{dayConflictCount !== 1 ? 's' : ''}
              </span>
            )}

            {isWithin14Days(selectedDate) && (
              <span style={{ fontSize: '.72rem', color: 'var(--warnL)', fontFamily: 'var(--fd)', letterSpacing: '.04em', alignSelf: 'flex-end', paddingBottom: '.15rem' }}>
                ⚠ ADMIN COORDINATION REQUIRED — WITHIN 14 DAYS
              </span>
            )}
          </div>

          {dayShifts.length === 0 ? (
            <div className="empty">No shifts scheduled for {fmtDate(selectedDate)}.</div>
          ) : (
            <div className="tw">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--surf2)', borderBottom: '1px solid var(--bdr)' }}>
                    {['Staff', 'Role', 'Start', 'End', 'Phone', 'Status', ...(isManager ? ['Actions'] : [])].map(h => (
                      <th key={h} style={{ padding: '.5rem .85rem', textAlign: 'left', fontSize: '.75rem', color: 'var(--muted)', fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dayShifts.map((shift, i) => {
                    const staff = getUserById(shift.staffId)
                    return (
                      <tr
                        key={shift.id}
                        style={{
                          borderBottom: i < dayShifts.length - 1 ? '1px solid var(--bdr)' : 'none',
                          background: shift.conflicted ? 'rgba(184,150,12,.04)' : undefined,
                        }}
                      >
                        <td style={{ padding: '.52rem .85rem', fontSize: '.88rem', fontWeight: staff ? undefined : undefined }}>
                          {staff ? staff.name : <span style={{ color: 'var(--muted)', fontStyle: 'italic' }}>Unassigned</span>}
                        </td>
                        <td style={{ padding: '.52rem .85rem', fontSize: '.83rem', color: 'var(--muted)' }}>
                          {staff?.role ?? '—'}
                        </td>
                        <td style={{ padding: '.52rem .85rem', fontSize: '.84rem', fontFamily: 'var(--fd)' }}>{fmtTime(shift.start)}</td>
                        <td style={{ padding: '.52rem .85rem', fontSize: '.84rem', fontFamily: 'var(--fd)' }}>{fmtTime(shift.end)}</td>
                        <td style={{ padding: '.52rem .85rem', fontSize: '.83rem', fontFamily: 'var(--fd)', color: 'var(--muted)' }}>
                          {fmtPhone(staff?.phone)}
                        </td>
                        <td style={{ padding: '.52rem .85rem' }}>
                          <StatusBadge shift={shift} />
                        </td>
                        {isManager && (
                          <td style={{ padding: '.52rem .85rem' }}>
                            <AssignControls shift={shift} />
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── B) CONFLICTS / PICKUPS ───────────────────────────────────────── */}
      {view === 'conflicts' && (
        <div>
          <p style={{ fontSize: '.84rem', color: 'var(--muted)', marginBottom: '1rem' }}>
            {isManager
              ? 'All unresolved conflicts and open shifts across all upcoming dates.'
              : 'Open shifts and conflicts you may pick up.'}
          </p>

          {pickupShifts.length === 0 ? (
            <div className="empty">No open conflicts or pickups — all shifts are covered.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.65rem' }}>
              {pickupShifts.map(shift => {
                const staff    = getUserById(shift.staffId)
                const locked   = isWithin14Days(shift.date)
                return (
                  <div
                    key={shift.id}
                    className={`shift-card ${shiftStatus(shift)}`}
                    style={{ gap: '.75rem', flexWrap: 'wrap' }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '.3rem' }}>
                        <StatusBadge shift={shift} />
                        {locked && (
                          <span style={{ fontSize: '.65rem', color: 'var(--warnL)', fontFamily: 'var(--fd)', letterSpacing: '.04em' }}>
                            ⚠ ADMIN COORD. REQ.
                          </span>
                        )}
                        <span style={{ fontSize: '.82rem', fontFamily: 'var(--fd)', color: 'var(--muted)' }}>
                          {fmtDate(shift.date)}
                        </span>
                        <span style={{ fontSize: '.82rem', fontFamily: 'var(--fd)' }}>
                          {fmtTime(shift.start)} – {fmtTime(shift.end)}
                        </span>
                      </div>
                      {staff && (
                        <div style={{ fontSize: '.8rem', color: 'var(--muted)' }}>
                          Originally: {staff.name}{staff.role ? ` (${staff.role})` : ''}
                        </div>
                      )}
                      {shift.conflictNote && (
                        <div style={{ fontSize: '.79rem', color: 'var(--warnL)', marginTop: '.2rem' }}>
                          {shift.conflictNote}
                        </div>
                      )}
                    </div>
                    <div style={{ alignSelf: 'center' }}>
                      <AssignControls shift={shift} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── C) WEEK VIEW ─────────────────────────────────────────────────── */}
      {view === 'week' && (
        <div>
          {/* Week navigator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '.65rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
            <button
              className="btn btn-s btn-sm"
              onClick={() => setWeekStart(addDays(weekStart, -7))}
            >
              ← Prev
            </button>
            <span style={{ fontSize: '.88rem', fontFamily: 'var(--fd)', minWidth: 210, textAlign: 'center' }}>
              {fmtDate(weekStart)} – {fmtDate(weekDays[6])}
            </span>
            <button
              className="btn btn-s btn-sm"
              disabled={weekStart >= maxWeekStart()}
              onClick={() => setWeekStart(prev => {
                const next = addDays(prev, 7)
                return next > maxWeekStart() ? maxWeekStart() : next
              })}
            >
              Next →
            </button>
            <button className="btn btn-s btn-sm" onClick={() => setWeekStart(weekMonday(today))}>
              Today
            </button>
            <span style={{ fontSize: '.72rem', color: 'var(--muted)', fontStyle: 'italic' }}>
              (navigate up to 10 weeks out)
            </span>
          </div>

          {/* Week grid: rows = staff, cols = days */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.8rem' }}>
              <thead>
                <tr style={{ background: 'var(--surf2)' }}>
                  <th style={{ padding: '.45rem .75rem', textAlign: 'left', borderBottom: '1px solid var(--bdr)', color: 'var(--muted)', minWidth: 110, fontWeight: 600, fontSize: '.72rem', letterSpacing: '.04em', textTransform: 'uppercase' }}>
                    Staff / Role
                  </th>
                  {weekDays.map(d => (
                    <th
                      key={d}
                      style={{
                        padding: '.45rem .55rem',
                        textAlign: 'center',
                        borderBottom: '1px solid var(--bdr)',
                        color: d === today ? 'var(--acc)' : 'var(--txt)',
                        minWidth: 88,
                        fontWeight: d === today ? 700 : 500,
                        fontSize: '.72rem',
                      }}
                    >
                      {fmtDateShort(d)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weekRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--muted)', fontStyle: 'italic' }}>
                      No shifts scheduled for this week.
                    </td>
                  </tr>
                ) : (
                  weekRows.map((row, ri) => (
                    <tr key={row.id ?? '__open'} style={{ borderBottom: ri < weekRows.length - 1 ? '1px solid var(--bdr)' : 'none' }}>
                      <td style={{ padding: '.45rem .75rem', verticalAlign: 'middle' }}>
                        <div style={{ fontSize: '.84rem', fontWeight: 500 }}>{row.name}</div>
                        <div style={{ fontSize: '.72rem', color: 'var(--muted)' }}>{row.role}</div>
                      </td>
                      {weekDays.map(d => {
                        const dayS = weekShifts.filter(s =>
                          s.date === d && (row.id ? s.staffId === row.id : !s.staffId)
                        )
                        return (
                          <td key={d} style={{ padding: '.35rem .4rem', textAlign: 'center', verticalAlign: 'top', background: d === today ? 'rgba(var(--acc-rgb, 90,138,58),.04)' : undefined }}>
                            {dayS.map(s => {
                              const st = shiftStatus(s)
                              return (
                                <div
                                  key={s.id}
                                  style={{
                                    background: st === 'conflict' ? 'rgba(184,150,12,.15)'
                                              : st === 'open'     ? 'rgba(90,138,58,.1)'
                                              : 'var(--surf2)',
                                    borderRadius: 4,
                                    padding: '.2rem .3rem',
                                    marginBottom: '.2rem',
                                    lineHeight: 1.35,
                                  }}
                                >
                                  <div style={{ fontSize: '.73rem', fontFamily: 'var(--fd)' }}>
                                    {fmtTime(s.start)}–{fmtTime(s.end)}
                                  </div>
                                  {st !== 'scheduled' && (
                                    <div style={{ fontSize: '.65rem', color: st === 'conflict' ? 'var(--warnL)' : 'var(--okB)', marginTop: '.1rem' }}>
                                      {st}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </td>
                        )
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── D) TEMPLATES (placeholder) ───────────────────────────────────── */}
      {view === 'templates' && (
        <div className="empty" style={{ padding: '2.5rem 1.5rem', textAlign: 'center' }}>
          <div style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--txt)', marginBottom: '.6rem' }}>
            Template &amp; Stamping (Admin) — Coming Next
          </div>
          <div style={{ color: 'var(--muted)', fontSize: '.86rem', maxWidth: 420, margin: '0 auto', lineHeight: 1.6 }}>
            Define reusable weekly shift templates and stamp them onto future schedule weeks.
            Holiday overrides and shift pattern automation will live here.
          </div>
        </div>
      )}

      {/* ── Availability override modal ───────────────────────────────────── */}
      {availWarn && (
        <div className="mo">
          <div className="mc mo-sm">
            <div className="mt2">Availability Conflict</div>
            <p style={{ fontSize: '.87rem', color: 'var(--muted)', margin: '.5rem 0 1.25rem', lineHeight: 1.55 }}>
              This assignment conflicts with the staff member's stated availability.
              <br />Assign anyway?
            </p>
            <div className="ma">
              <button className="btn btn-d btn-sm" disabled={saving} onClick={availWarn.proceed}>
                Assign Anyway
              </button>
              <button className="btn btn-s btn-sm" onClick={() => setAvailWarn(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
