// src/StaffingScheduler.jsx
// Staffing scheduler — Daily Roster, Conflicts/Pickups, Week View, Templates.
// All staffing schedule components live in this file.
// Weeks start on Sunday throughout.

import { useState, useMemo, useEffect } from 'react'
import {
  updateShift, createShiftBatch,
  fetchShiftTemplates, upsertShiftTemplate, deleteShiftTemplate, setActiveShiftTemplate,
  fetchTemplateSlots, upsertTemplateSlot, deleteTemplateSlot,
  fetchSlotAssignments, upsertSlotAssignment,
  fetchScheduleBlocks, createScheduleBlock, updateScheduleBlock, deleteScheduleBlock,
  fetchUserRoles, addUserRole, removeUserRole,
  fetchStaffRoles,
} from './supabase.js'

// ── Constants ──────────────────────────────────────────────────────────────

const DAY_NAMES      = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_NAMES_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// 15-minute interval options for time selects (00:00 … 23:45)
const TIME_OPTIONS = (() => {
  const opts = []
  for (let h = 0; h < 24; h++)
    for (const m of [0, 15, 30, 45])
      opts.push(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`)
  return opts
})()

// ── Pure helpers ───────────────────────────────────────────────────────────

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function addDays(isoDate, n) {
  const d = new Date(isoDate + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

// Returns the Sunday that starts the week containing isoDate
function weekSunday(isoDate) {
  const d = new Date(isoDate + 'T00:00:00')
  d.setDate(d.getDate() - d.getDay()) // d.getDay() === 0 for Sun → no change
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

function timeToMinutes(t) {
  if (!t) return 0
  const parts = t.split(':').map(Number)
  return parts[0] * 60 + (parts[1] ?? 0)
}

function minutesToTime(m) {
  const h = Math.floor(m / 60)
  const min = m % 60
  return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`
}

function shiftStatus(shift) {
  if (shift.conflicted)          return 'conflict'
  if (shift.open || !shift.staffId) return 'open'
  return 'scheduled'
}

function isWithin14Days(dateISO) {
  return new Date(dateISO + 'T00:00:00') < new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
}

function maxWeekStart() {
  return weekSunday(addDays(todayISO(), 70))
}

/**
 * Compute which shifts would be created by stamping the given template slots
 * across the 91-day horizon, respecting existing stamped shifts and blocks.
 *
 * Rules:
 *  - Full-day block → skip the entire day
 *  - Partial block clips the shift start or end
 *  - If resulting shift < 3 hours (180 min) → eliminate
 *  - If this slot was already stamped for that date → skip
 */
// Returns 1 or 2 based on how many complete 7-day periods have elapsed since cycleStartDate.
// If no cycleStartDate or date is before it, defaults to week 1.
function getWeekNumber(dateStr, cycleStartDate) {
  if (!cycleStartDate) return 1
  const daysDiff = Math.floor((new Date(dateStr) - new Date(cycleStartDate)) / 86400000)
  if (daysDiff < 0) return 1
  return (Math.floor(daysDiff / 7) % 2) + 1
}

function computeStampShifts(slots, existingShifts, blocks, assignments, cycleStartDate) {
  const today  = todayISO()
  const result = []

  for (let i = 1; i <= 91; i++) {
    const date      = addDays(today, i)
    const dow       = new Date(date + 'T00:00:00').getDay()
    const dayBlocks = blocks.filter(b => b.date === date)

    if (dayBlocks.some(b => b.isFullDay || b.isHoliday)) continue // full-day or holiday → skip

    for (const slot of slots.filter(s => s.dayOfWeek === dow)) {
      // Already stamped for this date?
      if (existingShifts.some(s => s.date === date && s.templateSlotId === slot.id)) continue

      let s0 = timeToMinutes(slot.startTime)
      let e0 = timeToMinutes(slot.endTime)
      let eliminated = false

      for (const blk of dayBlocks.filter(b => !b.isFullDay)) {
        const bs = timeToMinutes(blk.startTime)
        const be = timeToMinutes(blk.endTime)
        if (bs <= s0 && be >= e0) { eliminated = true; break }  // block covers entire slot
        if (bs <= s0 && be > s0)  s0 = be                        // clips start
        if (bs < e0  && be >= e0) e0 = bs                        // clips end
        // block in the middle: keep first portion (simpler & predictable)
        if (bs > s0 && be < e0)   e0 = bs
      }

      if (eliminated) continue
      if (e0 - s0 < 180) continue  // < 3 hours after trimming → eliminate

      const weekNum    = getWeekNumber(date, cycleStartDate)
      const assignment = (assignments ?? []).find(a => a.slotId === slot.id && a.weekNumber === weekNum)

      result.push({
        date,
        start:          minutesToTime(s0),
        end:            minutesToTime(e0),
        templateSlotId: slot.id,
        role:           slot.role ?? null,
        open:           !assignment,
        staffId:        assignment?.staffId ?? null,
        conflicted:     false,
        conflictNote:   null,
      })
    }
  }

  return result
}

// ── Main component ─────────────────────────────────────────────────────────

export default function StaffingScheduler({ currentUser, shifts, setShifts, users, isManager, onAlert }) {
  const today = todayISO()

  // ── View tabs ──────────────────────────────────────────────────────────────
  const [view, setView] = useState('roster')

  // ── Daily roster ───────────────────────────────────────────────────────────
  const [selectedDate, setSelectedDate] = useState(today)

  // ── Week view ──────────────────────────────────────────────────────────────
  const [weekStart, setWeekStart] = useState(weekSunday(today))

  // ── Assignment ─────────────────────────────────────────────────────────────
  const [assigning,  setAssigning]  = useState(null)  // { shiftId, selectedUserId }
  const [availWarn,  setAvailWarn]  = useState(null)
  const [saving,     setSaving]     = useState(false)

  // ── Template data (lazy-loaded on first Templates visit) ───────────────────
  const [templates,       setTemplates]       = useState([])
  const [editingTmplId,   setEditingTmplId]   = useState(null)  // template shown in builder
  const [editingSlots,    setEditingSlots]     = useState([])    // slots for editingTmplId
  const [slotAssignments, setSlotAssignments] = useState([])    // {id,slotId,weekNumber,staffId}
  const [scheduleBlocks,  setScheduleBlocks]  = useState([])
  const [userRoles,       setUserRoles]       = useState([])
  const [templatesLoaded, setTemplatesLoaded] = useState(false)
  const [tmplLoading,     setTmplLoading]     = useState(false)

  // ── Stamp state ────────────────────────────────────────────────────────────
  const [stampPreview, setStampPreview] = useState(null)  // { shifts[], templateName }
  const [stamping,     setStamping]     = useState(false)

  // ── Template builder UI ───────────────────────────────────────────────────
  const [showNewTmpl,  setShowNewTmpl]  = useState(false)
  const [newTmplName,  setNewTmplName]  = useState('')
  const [tmplSaving,   setTmplSaving]   = useState(false)
  const [addingSlot,   setAddingSlot]   = useState(false)
  const [slotDraft,    setSlotDraft]    = useState({ dayOfWeek: 1, startTime: '09:00', endTime: '17:00', role: '', qty: 1, forAllRoles: false })
  const [editingSlotId, setEditingSlotId] = useState(null)  // id of slot being inline-edited

  // ── Block builder UI ──────────────────────────────────────────────────────
  const [addingBlock,    setAddingBlock]    = useState(false)
  const [editingBlockId, setEditingBlockId] = useState(null)
  const [blockDraft,     setBlockDraft]     = useState({ date: today, label: '', isFullDay: true, startTime: '09:00', endTime: '17:00', isHoliday: false })
  const [blockSaving,    setBlockSaving]    = useState(false)
  const [blockTab,       setBlockTab]       = useState('future') // 'future' | 'past'

  // ── Staff roles UI ────────────────────────────────────────────────────────
  const [roleSaving,  setRoleSaving]  = useState(new Set())  // Set of "userId_role" saving keys

  // ── Templates sub-tabs ─────────────────────────────────────────────────────
  const [tmplView, setTmplView] = useState('builder')

  // ── Staff list ─────────────────────────────────────────────────────────────
  const staffUsers = useMemo(
    () => users
      .filter(u => ['staff', 'manager', 'admin'].includes(u.access) && u.active !== false)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [users]
  )

  function getUserById(id) {
    return users.find(u => u.id === id) ?? null
  }

  // ── Template data loading ──────────────────────────────────────────────────
  useEffect(() => {
    if (view === 'templates' && !templatesLoaded && !tmplLoading) {
      loadTemplateData()
    }
  }, [view]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadTemplateData() {
    setTmplLoading(true)
    try {
      const [tmplList, blockList, roleList, canonicalRoles] = await Promise.all([
        fetchShiftTemplates(),
        fetchScheduleBlocks(todayISO(), addDays(todayISO(), 180)),
        fetchUserRoles(),
        fetchStaffRoles(),
      ])
      setTemplates(tmplList)
      setScheduleBlocks(blockList)
      setUserRoles(roleList)
      setAllRoles(canonicalRoles)
      const first = tmplList.find(t => t.active) ?? tmplList[0] ?? null
      setEditingTmplId(first?.id ?? null)
      setTemplatesLoaded(true)
    } catch (e) {
      onAlert('Error loading template data: ' + e.message)
    } finally {
      setTmplLoading(false)
    }
  }

  // Sort helper: day (Sun=0) → start time → role alphabetically
  const sortSlots = slots => [...slots].sort((a, b) =>
    a.dayOfWeek - b.dayOfWeek ||
    a.startTime.localeCompare(b.startTime) ||
    (a.role ?? '').localeCompare(b.role ?? '')
  )

  // Load slots + assignments whenever the editing template changes
  useEffect(() => {
    if (!editingTmplId) { setEditingSlots([]); setSlotAssignments([]); return }
    Promise.all([
      fetchTemplateSlots(editingTmplId),
      fetchSlotAssignments(editingTmplId),
    ])
      .then(([slots, asgns]) => {
        setEditingSlots(sortSlots(slots))
        setSlotAssignments(asgns)
      })
      .catch(() => { setEditingSlots([]); setSlotAssignments([]) })
  }, [editingTmplId])

  // ── Assignment logic ───────────────────────────────────────────────────────

  async function doAssign(shiftId, userId) {
    setSaving(true)
    try {
      await updateShift(shiftId, {
        staffId:      userId ?? null,
        open:         !userId,
        conflicted:   false,
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

  function tryAssign(shiftId, userId) {
    doAssign(shiftId, userId)
  }

  // ── Template CRUD ──────────────────────────────────────────────────────────

  async function handleCreateTemplate() {
    const name = newTmplName.trim()
    if (!name) return
    setTmplSaving(true)
    try {
      const created = await upsertShiftTemplate({ name, active: false })
      setTemplates(prev => [...prev, created])
      setEditingTmplId(created.id)
      setNewTmplName('')
      setShowNewTmpl(false)
    } catch (e) {
      onAlert('Error creating template: ' + e.message)
    } finally {
      setTmplSaving(false)
    }
  }

  async function handleDeleteTemplate(id) {
    const tmpl = templates.find(t => t.id === id)
    if (tmpl?.active) { onAlert('Deactivate the template before deleting it.'); return }
    if (!window.confirm(`Delete template "${tmpl?.name}"? All its slots will be removed.`)) return
    try {
      await deleteShiftTemplate(id)
      const remaining = templates.filter(t => t.id !== id)
      setTemplates(remaining)
      if (editingTmplId === id) setEditingTmplId(remaining[0]?.id ?? null)
    } catch (e) {
      onAlert('Error deleting template: ' + e.message)
    }
  }

  async function handleSetActive(id) {
    setTmplSaving(true)
    try {
      await setActiveShiftTemplate(id)
      setTemplates(prev => prev.map(t => ({ ...t, active: t.id === id })))
      setStampPreview(null)
    } catch (e) {
      onAlert('Error activating template: ' + e.message)
    } finally {
      setTmplSaving(false)
    }
  }

  // ── Slot CRUD ──────────────────────────────────────────────────────────────

  async function handleSaveSlot() {
    if (!editingTmplId) return
    setTmplSaving(true)
    try {
      const base = {
        templateId: editingTmplId,
        dayOfWeek:  Number(slotDraft.dayOfWeek),
        startTime:  slotDraft.startTime,
        endTime:    slotDraft.endTime,
        role:       slotDraft.role || null,
      }

      if (editingSlotId) {
        // Editing existing slot — just update it (qty ignored)
        const saved = await upsertTemplateSlot({ ...base, id: editingSlotId })
        setEditingSlots(prev => sortSlots([...prev.filter(s => s.id !== saved.id), saved]))
      } else {
        // New slot — create copies (qty per role, or qty copies of single role)
        const qty = Math.max(1, Math.min(20, Number(slotDraft.qty) || 1))
        const roles = slotDraft.forAllRoles && allRoles.length > 0
          ? allRoles
          : [slotDraft.role || null]
        const saved = await Promise.all(
          roles.flatMap(r =>
            Array.from({ length: qty }, () => upsertTemplateSlot({ ...base, role: r }))
          )
        )
        setEditingSlots(prev => sortSlots([...prev, ...saved]))
      }

      setSlotDraft({ dayOfWeek: 1, startTime: '09:00', endTime: '17:00', role: '', qty: 1, forAllRoles: false })
      setAddingSlot(false)
      setEditingSlotId(null)
    } catch (e) {
      onAlert('Error saving slot: ' + e.message)
    } finally {
      setTmplSaving(false)
    }
  }

  function startEditSlot(slot) {
    setSlotDraft({
      dayOfWeek: slot.dayOfWeek,
      startTime: slot.startTime.slice(0, 5),  // trim seconds if present
      endTime:   slot.endTime.slice(0, 5),
      role:      slot.role ?? '',
      qty:       1,
    })
    setEditingSlotId(slot.id)
    setAddingSlot(true)
  }

  async function handleDeleteSlot(id) {
    try {
      await deleteTemplateSlot(id)
      setEditingSlots(prev => prev.filter(s => s.id !== id))
    } catch (e) {
      onAlert('Error removing slot: ' + e.message)
    }
  }

  async function handleDuplicateSlot(slot) {
    try {
      const saved = await upsertTemplateSlot({
        templateId: slot.templateId,
        dayOfWeek:  slot.dayOfWeek,
        startTime:  slot.startTime.slice(0, 5),
        endTime:    slot.endTime.slice(0, 5),
        role:       slot.role ?? null,
      })
      setEditingSlots(prev => sortSlots([...prev, saved]))
    } catch (e) {
      onAlert('Error duplicating slot: ' + e.message)
    }
  }

  // ── Stamp ──────────────────────────────────────────────────────────────────

  async function previewStamp() {
    const active = templates.find(t => t.active)
    if (!active) { onAlert('No active template. Set a template as active first.'); return }
    setStamping(true)
    try {
      let slots = editingSlots
      let asgns = slotAssignments
      if (editingTmplId !== active.id) {
        ;[slots, asgns] = await Promise.all([
          fetchTemplateSlots(active.id),
          fetchSlotAssignments(active.id),
        ])
      }
      const newShifts = computeStampShifts(slots, shifts, scheduleBlocks, asgns, active.cycleStartDate)
      setStampPreview({ shifts: newShifts, templateName: active.name })
    } catch (e) {
      onAlert('Error computing stamp preview: ' + e.message)
    } finally {
      setStamping(false)
    }
  }

  async function applyStamp() {
    if (!stampPreview?.shifts?.length) return
    setStamping(true)
    try {
      const created = await createShiftBatch(stampPreview.shifts)
      setShifts(prev => [...prev, ...created])
      onAlert(`Stamped ${created.length} new shift${created.length !== 1 ? 's' : ''}.`)
      setStampPreview(null)
    } catch (e) {
      onAlert('Error applying stamp: ' + e.message)
    } finally {
      setStamping(false)
    }
  }

  // ── Block CRUD ─────────────────────────────────────────────────────────────

  const resetBlockForm = () => {
    setBlockDraft({ date: todayISO(), label: '', isFullDay: true, startTime: '09:00', endTime: '17:00', isHoliday: false })
    setAddingBlock(false)
    setEditingBlockId(null)
  }

  function startEditBlock(blk) {
    setBlockDraft({
      date:      blk.date,
      label:     blk.label ?? '',
      isFullDay: blk.isFullDay,
      startTime: blk.startTime ? blk.startTime.slice(0, 5) : '09:00',
      endTime:   blk.endTime   ? blk.endTime.slice(0, 5)   : '17:00',
      isHoliday: blk.isHoliday,
    })
    setEditingBlockId(blk.id)
    setAddingBlock(true)
  }

  async function handleSaveBlock() {
    setBlockSaving(true)
    const payload = {
      ...blockDraft,
      startTime: blockDraft.isFullDay ? null : blockDraft.startTime,
      endTime:   blockDraft.isFullDay ? null : blockDraft.endTime,
    }
    try {
      if (editingBlockId) {
        const saved = await updateScheduleBlock(editingBlockId, payload)
        setScheduleBlocks(prev =>
          prev.map(b => b.id === saved.id ? saved : b).sort((a, b) => a.date.localeCompare(b.date))
        )
      } else {
        const saved = await createScheduleBlock({ ...payload, createdBy: currentUser?.id ?? null })
        setScheduleBlocks(prev => [...prev, saved].sort((a, b) => a.date.localeCompare(b.date)))
      }
      resetBlockForm()
      setStampPreview(null)
    } catch (e) {
      onAlert('Error saving block: ' + e.message)
    } finally {
      setBlockSaving(false)
    }
  }

  async function handleDeleteBlock(id) {
    try {
      await deleteScheduleBlock(id)
      setScheduleBlocks(prev => prev.filter(b => b.id !== id))
      setStampPreview(null)
    } catch (e) {
      onAlert('Error removing block: ' + e.message)
    }
  }

  // ── User role CRUD ─────────────────────────────────────────────────────────

  // Toggle a cross-training role on/off for a staff member (checkbox click)
  async function handleToggleUserRole(userId, role, currentEntry) {
    const key = `${userId}_${role}`
    if (roleSaving.has(key)) return
    setRoleSaving(prev => new Set([...prev, key]))

    if (currentEntry) {
      // optimistic remove
      setUserRoles(prev => prev.filter(r => r.id !== currentEntry.id))
      try {
        await removeUserRole(currentEntry.id)
      } catch (e) {
        setUserRoles(prev => [...prev, currentEntry])  // revert
        onAlert('Error removing role: ' + e.message)
      }
    } else {
      // optimistic add (temp id until DB responds)
      const tempId = `temp_${userId}_${role}`
      setUserRoles(prev => [...prev, { id: tempId, userId, role }])
      try {
        const saved = await addUserRole(userId, role)
        setUserRoles(prev => prev.map(r => r.id === tempId ? saved : r))
      } catch (e) {
        setUserRoles(prev => prev.filter(r => r.id !== tempId))  // revert
        onAlert('Error adding role: ' + e.message)
      }
    }

    setRoleSaving(prev => { const s = new Set(prev); s.delete(key); return s })
  }

  // ── Computed slices ────────────────────────────────────────────────────────

  const dayShifts = useMemo(
    () => shifts
      .filter(s => s.date === selectedDate)
      .sort((a, b) => (a.start ?? '').localeCompare(b.start ?? '')),
    [shifts, selectedDate]
  )

  const dayConflictCount = useMemo(
    () => dayShifts.filter(s => s.conflicted).length,
    [dayShifts]
  )

  const pickupShifts = useMemo(
    () => shifts
      .filter(s => s.conflicted || s.open || !s.staffId)
      .sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? '').localeCompare(b.start ?? '')),
    [shifts]
  )

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  )

  const weekShifts = useMemo(
    () => shifts.filter(s => s.date >= weekStart && s.date <= weekDays[6]),
    [shifts, weekStart, weekDays]
  )

  const weekRows = useMemo(() => {
    const ids    = new Set(weekShifts.map(s => s.staffId).filter(Boolean))
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

  // Canonical role list from staff_roles table
  const [allRoles, setAllRoles] = useState([])

  // Roles by user map (for Roles tab)
  const rolesByUser = useMemo(() => {
    const map = {}
    for (const ur of userRoles) {
      if (!map[ur.userId]) map[ur.userId] = []
      map[ur.userId].push(ur)
    }
    return map
  }, [userRoles])

  // ── Inner UI components ────────────────────────────────────────────────────

  function StatusBadge({ shift }) {
    const st = shiftStatus(shift)
    if (st === 'conflict') return <span className="badge b-conflict" style={{ fontSize: '.65rem' }}>Conflict</span>
    if (st === 'open')     return <span className="badge b-available" style={{ fontSize: '.65rem' }}>Open</span>
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

    if (st !== 'scheduled') {
      return (
        <button className="btn btn-ok btn-sm" disabled={saving} onClick={() => tryAssign(shift.id, currentUser.id)}>
          Pick Up
        </button>
      )
    }
    return null
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ marginTop: '2rem', borderTop: '1px solid var(--bdr)', paddingTop: '1.75rem' }}>

      {/* Section header */}
      <div className="ph" style={{ marginBottom: '1.1rem' }}>
        <div className="ph-left">
          <div className="pt">Staffing Scheduler</div>
          <div className="ps">Daily roster · Conflict resolution · Weekly view &nbsp;·&nbsp; <span style={{ fontStyle: 'italic' }}>Schedules editable up to 2 weeks out.</span></div>
        </div>
      </div>

      {/* Main tabs */}
      <div className="tabs" style={{ marginBottom: '1.25rem' }}>
        {([
          ['roster',    'Daily Roster'],
          ['conflicts', `Conflicts / Pickups${pickupShifts.length > 0 ? ` (${pickupShifts.length})` : ''}`],
          ['week',      'Week View'],
          ['templates', 'Templates'],
        ]).map(([key, label]) => (
          <button key={key} className={`tab${view === key ? ' on' : ''}`} onClick={() => setView(key)}>
            {label}
          </button>
        ))}
      </div>

      {/* ── A) DAILY ROSTER ──────────────────────────────────────────────────── */}
      {view === 'roster' && (
        <div>
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
                        <td style={{ padding: '.52rem .85rem', fontSize: '.88rem' }}>
                          {staff ? staff.name : <span style={{ color: 'var(--muted)', fontStyle: 'italic' }}>Unassigned</span>}
                        </td>
                        <td style={{ padding: '.52rem .85rem', fontSize: '.83rem', color: 'var(--muted)' }}>
                          {shift.role ?? staff?.role ?? '—'}
                        </td>
                        <td style={{ padding: '.52rem .85rem', fontSize: '.84rem', fontFamily: 'var(--fd)' }}>{fmtTime(shift.start)}</td>
                        <td style={{ padding: '.52rem .85rem', fontSize: '.84rem', fontFamily: 'var(--fd)' }}>{fmtTime(shift.end)}</td>
                        <td style={{ padding: '.52rem .85rem', fontSize: '.83rem', fontFamily: 'var(--fd)', color: 'var(--muted)' }}>{fmtPhone(staff?.phone)}</td>
                        <td style={{ padding: '.52rem .85rem' }}><StatusBadge shift={shift} /></td>
                        {isManager && (
                          <td style={{ padding: '.52rem .85rem' }}><AssignControls shift={shift} /></td>
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

      {/* ── B) CONFLICTS / PICKUPS ───────────────────────────────────────────── */}
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
                const staff  = getUserById(shift.staffId)
                const locked = isWithin14Days(shift.date)
                return (
                  <div key={shift.id} className={`shift-card ${shiftStatus(shift)}`} style={{ gap: '.75rem', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '.3rem' }}>
                        <StatusBadge shift={shift} />
                        {locked && (
                          <span style={{ fontSize: '.65rem', color: 'var(--warnL)', fontFamily: 'var(--fd)', letterSpacing: '.04em' }}>
                            ⚠ ADMIN COORD. REQ.
                          </span>
                        )}
                        <span style={{ fontSize: '.82rem', fontFamily: 'var(--fd)', color: 'var(--muted)' }}>{fmtDate(shift.date)}</span>
                        <span style={{ fontSize: '.82rem', fontFamily: 'var(--fd)' }}>{fmtTime(shift.start)} – {fmtTime(shift.end)}</span>
                      </div>
                      {staff && (
                        <div style={{ fontSize: '.8rem', color: 'var(--muted)' }}>
                          Originally: {staff.name}{staff.role ? ` (${staff.role})` : ''}
                        </div>
                      )}
                      {shift.conflictNote && (
                        <div style={{ fontSize: '.79rem', color: 'var(--warnL)', marginTop: '.2rem' }}>{shift.conflictNote}</div>
                      )}
                    </div>
                    <div style={{ alignSelf: 'center' }}><AssignControls shift={shift} /></div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── C) WEEK VIEW ─────────────────────────────────────────────────────── */}
      {view === 'week' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.65rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
            <button className="btn btn-s btn-sm" onClick={() => setWeekStart(addDays(weekStart, -7))}>
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
            <button className="btn btn-s btn-sm" onClick={() => setWeekStart(weekSunday(today))}>Today</button>
            <span style={{ fontSize: '.72rem', color: 'var(--muted)', fontStyle: 'italic' }}>(navigate up to 10 weeks out)</span>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.8rem' }}>
              <thead>
                <tr style={{ background: 'var(--surf2)' }}>
                  <th style={{ padding: '.45rem .75rem', textAlign: 'left', borderBottom: '1px solid var(--bdr)', color: 'var(--muted)', minWidth: 110, fontWeight: 600, fontSize: '.72rem', letterSpacing: '.04em', textTransform: 'uppercase' }}>
                    Staff / Role
                  </th>
                  {weekDays.map(d => (
                    <th key={d} style={{
                      padding: '.45rem .55rem', textAlign: 'center', borderBottom: '1px solid var(--bdr)',
                      color: d === today ? 'var(--acc)' : 'var(--txt)',
                      minWidth: 88, fontWeight: d === today ? 700 : 500, fontSize: '.72rem',
                    }}>
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
                                <div key={s.id} style={{
                                  background: st === 'conflict' ? 'rgba(184,150,12,.15)' : st === 'open' ? 'rgba(90,138,58,.1)' : 'var(--surf2)',
                                  borderRadius: 4, padding: '.2rem .3rem', marginBottom: '.2rem', lineHeight: 1.35,
                                }}>
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

      {/* ── D) TEMPLATES ──────────────────────────────────────────────────────── */}
      {view === 'templates' && (
        <div>
          {tmplLoading ? (
            <div className="empty">Loading template data…</div>
          ) : (
            <>
              {/* Templates sub-tabs */}
              <div className="tabs" style={{ marginBottom: '1.25rem' }}>
                {([
                  ['builder', 'Builder'],
                  ['blocks',  'Blocks & Holidays'],
                  ['roles',   'Staff Roles'],
                ]).map(([k, l]) => (
                  <button key={k} className={`tab${tmplView === k ? ' on' : ''}`} onClick={() => setTmplView(k)}>{l}</button>
                ))}
              </div>

              {/* ── D1) BUILDER ─────────────────────────────────────────── */}
              {tmplView === 'builder' && (
                <div>
                  {/* Template selector row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.65rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                    <select
                      value={editingTmplId ?? ''}
                      onChange={e => { setEditingTmplId(e.target.value || null); setStampPreview(null) }}
                      style={{ fontSize: '.88rem', padding: '.3rem .55rem', background: 'var(--surf2)', color: 'var(--txt)', border: '1px solid var(--bdr)', borderRadius: 4, minWidth: 180 }}
                    >
                      {templates.length === 0 && <option value="">— no templates —</option>}
                      {templates.map(t => (
                        <option key={t.id} value={t.id}>
                          {t.name}{t.active ? ' (Active)' : ''}
                        </option>
                      ))}
                    </select>

                    {editingTmplId && !templates.find(t => t.id === editingTmplId)?.active && (
                      <button
                        className="btn btn-ok btn-sm"
                        disabled={tmplSaving}
                        onClick={() => handleSetActive(editingTmplId)}
                      >
                        Set Active
                      </button>
                    )}

                    {editingTmplId && templates.find(t => t.id === editingTmplId)?.active && (
                      <span className="badge b-ok" style={{ fontSize: '.68rem' }}>● Active</span>
                    )}

                    <button className="btn btn-s btn-sm" onClick={() => { setShowNewTmpl(true); setNewTmplName('') }}>
                      + New Template
                    </button>

                    {editingTmplId && !templates.find(t => t.id === editingTmplId)?.active && (
                      <button className="btn btn-d btn-sm" onClick={() => handleDeleteTemplate(editingTmplId)}>
                        Delete
                      </button>
                    )}
                  </div>

                  {/* Cycle start date for 2-week rotation */}
                  {editingTmplId && (() => {
                    const tmpl = templates.find(t => t.id === editingTmplId)
                    if (!tmpl) return null
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '.65rem', marginBottom: '.75rem', flexWrap: 'wrap', fontSize: '.83rem', color: 'var(--txt2)' }}>
                        <span>Cycle week 1 starts:</span>
                        <input
                          type="date"
                          value={tmpl.cycleStartDate ?? ''}
                          onChange={async e => {
                            const val = e.target.value || null
                            try {
                              const updated = await upsertShiftTemplate({ ...tmpl, cycleStartDate: val })
                              setTemplates(prev => prev.map(t => t.id === updated.id ? updated : t))
                            } catch (err) {
                              onAlert('Error saving cycle date: ' + err.message)
                            }
                          }}
                          style={{ fontSize: '.83rem', padding: '.2rem .45rem', background: 'var(--surf2)', color: 'var(--txt)', border: '1px solid var(--bdr)', borderRadius: 4 }}
                        />
                        <span style={{ opacity: .55, fontSize: '.77rem' }}>Week 1/2 alternates every 7 days from this date</span>
                      </div>
                    )
                  })()}

                  {/* New template input */}
                  {showNewTmpl && (
                    <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', marginBottom: '1rem', background: 'var(--surf2)', padding: '.75rem 1rem', borderRadius: 6, border: '1px solid var(--bdr)' }}>
                      <input
                        autoFocus
                        type="text"
                        placeholder="Template name (e.g. Standard Week)"
                        value={newTmplName}
                        onChange={e => setNewTmplName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleCreateTemplate(); if (e.key === 'Escape') setShowNewTmpl(false) }}
                        style={{ flex: 1, fontSize: '.88rem', padding: '.3rem .55rem', background: 'var(--bg)', color: 'var(--txt)', border: '1px solid var(--bdr)', borderRadius: 4 }}
                      />
                      <button className="btn btn-ok btn-sm" disabled={!newTmplName.trim() || tmplSaving} onClick={handleCreateTemplate}>Create</button>
                      <button className="btn btn-s btn-sm" onClick={() => setShowNewTmpl(false)}>Cancel</button>
                    </div>
                  )}

                  {/* Slot table */}
                  {editingTmplId ? (
                    <>
                      <div style={{ fontSize: '.8rem', color: 'var(--muted)', marginBottom: '.75rem' }}>
                        Weekly shift slots for <strong style={{ color: 'var(--txt)' }}>{templates.find(t => t.id === editingTmplId)?.name ?? '—'}</strong>. Each slot becomes one open shift when stamped.
                      </div>

                      {editingSlots.length === 0 ? (
                        <div className="empty" style={{ marginBottom: '1rem' }}>No slots defined — add one below.</div>
                      ) : (
                        <div className="tw" style={{ marginBottom: '1rem' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                              <tr style={{ background: 'var(--surf2)', borderBottom: '1px solid var(--bdr)' }}>
                                {['Day', 'Start', 'End', 'Role', 'Wk 1 Staff', 'Wk 2 Staff', ''].map(h => (
                                  <th key={h} style={{ padding: '.45rem .75rem', textAlign: 'left', fontSize: '.72rem', color: 'var(--muted)', fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase' }}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {editingSlots.map((slot, i) => (
                                <tr key={slot.id} style={{ borderBottom: i < editingSlots.length - 1 ? '1px solid var(--bdr)' : 'none', background: editingSlotId === slot.id ? 'rgba(90,138,58,.06)' : undefined }}>
                                  <td style={{ padding: '.45rem .75rem', fontSize: '.85rem', fontWeight: 500 }}>
                                    {DAY_NAMES_FULL[slot.dayOfWeek]}
                                  </td>
                                  <td style={{ padding: '.45rem .75rem', fontSize: '.84rem', fontFamily: 'var(--fd)' }}>{fmtTime(slot.startTime)}</td>
                                  <td style={{ padding: '.45rem .75rem', fontSize: '.84rem', fontFamily: 'var(--fd)' }}>{fmtTime(slot.endTime)}</td>
                                  <td style={{ padding: '.45rem .75rem', fontSize: '.83rem', color: slot.role ? 'var(--txt)' : 'var(--muted)' }}>
                                    {slot.role ?? <span style={{ fontStyle: 'italic' }}>Any</span>}
                                  </td>
                                  {[1, 2].map(wk => (
                                    <td key={wk} style={{ padding: '.35rem .55rem' }}>
                                      <select
                                        value={slotAssignments.find(a => a.slotId === slot.id && a.weekNumber === wk)?.staffId ?? ''}
                                        onChange={async e => {
                                          const staffId = e.target.value || null
                                          try {
                                            const updated = await upsertSlotAssignment(slot.id, wk, staffId)
                                            setSlotAssignments(prev => {
                                              const filtered = prev.filter(a => !(a.slotId === slot.id && a.weekNumber === wk))
                                              return updated ? [...filtered, updated] : filtered
                                            })
                                          } catch (err) {
                                            onAlert('Error saving assignment: ' + err.message)
                                          }
                                        }}
                                        style={{ fontSize: '.78rem', padding: '.2rem .35rem', background: 'var(--surf2)', color: 'var(--txt)', border: '1px solid var(--bdr)', borderRadius: 4, maxWidth: 130 }}
                                      >
                                        <option value="">— open —</option>
                                        {staffUsers.map(u => (
                                          <option key={u.id} value={u.id}>{u.name}</option>
                                        ))}
                                      </select>
                                    </td>
                                  ))}
                                  <td style={{ padding: '.45rem .75rem' }}>
                                    <div style={{ display: 'flex', gap: '.35rem' }}>
                                        <button className="btn btn-s btn-sm" onClick={() => startEditSlot(slot)}>Edit</button>
                                      <button className="btn btn-s btn-sm" onClick={() => handleDuplicateSlot(slot)} title="Duplicate">⧉</button>
                                      <button className="btn btn-d btn-sm" onClick={() => handleDeleteSlot(slot.id)}>✕</button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* Add / edit slot form */}
                      {addingSlot ? (
                        <div style={{ background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: 6, padding: '1rem', marginBottom: '1rem' }}>
                          <div style={{ fontSize: '.78rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '.75rem' }}>
                            {editingSlotId ? 'Edit Slot' : 'New Slot'}
                          </div>
                          <div style={{ display: 'flex', gap: '.65rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                            {/* Day */}
                            <div className="f" style={{ margin: 0 }}>
                              <label style={{ fontSize: '.72rem', color: 'var(--muted)' }}>Day</label>
                              <select
                                value={slotDraft.dayOfWeek}
                                onChange={e => setSlotDraft(d => ({ ...d, dayOfWeek: Number(e.target.value) }))}
                                style={{ fontSize: '.85rem', padding: '.3rem .5rem', background: 'var(--bg)', color: 'var(--txt)', border: '1px solid var(--bdr)', borderRadius: 4, display: 'block', marginTop: '.25rem' }}
                              >
                                {DAY_NAMES_FULL.map((name, i) => <option key={i} value={i}>{name}</option>)}
                              </select>
                            </div>
                            {/* Start time */}
                            <div className="f" style={{ margin: 0 }}>
                              <label style={{ fontSize: '.72rem', color: 'var(--muted)' }}>Start</label>
                              <select
                                value={slotDraft.startTime}
                                onChange={e => setSlotDraft(d => ({ ...d, startTime: e.target.value }))}
                                style={{ fontSize: '.85rem', padding: '.3rem .5rem', background: 'var(--bg)', color: 'var(--txt)', border: '1px solid var(--bdr)', borderRadius: 4, display: 'block', marginTop: '.25rem' }}
                              >
                                {TIME_OPTIONS.map(t => <option key={t} value={t}>{fmtTime(t)}</option>)}
                              </select>
                            </div>
                            {/* End time */}
                            <div className="f" style={{ margin: 0 }}>
                              <label style={{ fontSize: '.72rem', color: 'var(--muted)' }}>End</label>
                              <select
                                value={slotDraft.endTime}
                                onChange={e => setSlotDraft(d => ({ ...d, endTime: e.target.value }))}
                                style={{ fontSize: '.85rem', padding: '.3rem .5rem', background: 'var(--bg)', color: 'var(--txt)', border: '1px solid var(--bdr)', borderRadius: 4, display: 'block', marginTop: '.25rem' }}
                              >
                                {TIME_OPTIONS.map(t => <option key={t} value={t}>{fmtTime(t)}</option>)}
                              </select>
                            </div>
                            {/* Role */}
                            {!editingSlotId && (
                              <div className="f" style={{ margin: 0, justifyContent: 'flex-end' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '.3rem', fontSize: '.78rem', color: 'var(--muted)', cursor: 'pointer', marginTop: 'auto', paddingBottom: '.1rem' }}>
                                  <input
                                    type="checkbox"
                                    checked={slotDraft.forAllRoles}
                                    onChange={e => setSlotDraft(d => ({ ...d, forAllRoles: e.target.checked }))}
                                  />
                                  ALL
                                </label>
                              </div>
                            )}
                            <div className="f" style={{ margin: 0 }}>
                              <label style={{ fontSize: '.72rem', color: 'var(--muted)' }}>Role</label>
                              <select
                                value={slotDraft.role}
                                onChange={e => setSlotDraft(d => ({ ...d, role: e.target.value }))}
                                disabled={!editingSlotId && slotDraft.forAllRoles}
                                style={{ fontSize: '.85rem', padding: '.3rem .5rem', background: 'var(--bg)', color: 'var(--txt)', border: '1px solid var(--bdr)', borderRadius: 4, display: 'block', marginTop: '.25rem', minWidth: 140, opacity: (!editingSlotId && slotDraft.forAllRoles) ? 0.4 : 1 }}
                              >
                                <option value="">— Any role —</option>
                                {allRoles.map(r => <option key={r} value={r}>{r}</option>)}
                              </select>
                            </div>
                            {!editingSlotId && (
                              <div className="f" style={{ margin: 0 }}>
                                <label style={{ fontSize: '.72rem', color: 'var(--muted)' }}>Qty</label>
                                <input
                                  type="number"
                                  min={1} max={20}
                                  value={slotDraft.qty}
                                  onChange={e => setSlotDraft(d => ({ ...d, qty: Math.max(1, Math.min(20, Number(e.target.value) || 1)) }))}
                                  style={{ fontSize: '.85rem', padding: '.3rem .5rem', background: 'var(--bg)', color: 'var(--txt)', border: '1px solid var(--bdr)', borderRadius: 4, display: 'block', marginTop: '.25rem', width: 60 }}
                                />
                              </div>
                            )}
                            <button className="btn btn-ok btn-sm" disabled={tmplSaving} onClick={handleSaveSlot}>
                              {editingSlotId ? 'Update Slot' : 'Add Slot'}
                            </button>
                            <button className="btn btn-s btn-sm" onClick={() => { setAddingSlot(false); setEditingSlotId(null); setSlotDraft({ dayOfWeek: 1, startTime: '09:00', endTime: '17:00', role: '', qty: 1, forAllRoles: false }) }}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button className="btn btn-s btn-sm" style={{ marginBottom: '1rem' }} onClick={() => { setAddingSlot(true); setEditingSlotId(null) }}>+ Add Slot</button>
                      )}

                      {/* Stamp section */}
                      <div style={{ borderTop: '1px solid var(--bdr)', paddingTop: '1.25rem', marginTop: '.5rem' }}>
                        <div style={{ fontSize: '.8rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '.75rem' }}>
                          Stamp 91-Day Horizon
                        </div>

                        {(() => {
                          const active = templates.find(t => t.active)
                          return (
                            <>
                              {active ? (
                                <div style={{ fontSize: '.84rem', color: 'var(--muted)', marginBottom: '.75rem' }}>
                                  Active template: <strong style={{ color: 'var(--txt)' }}>{active.name}</strong>
                                  {editingTmplId !== active.id && (
                                    <span style={{ marginLeft: '.5rem', color: 'var(--warnL)', fontSize: '.78rem' }}>
                                      (viewing a different template — stamp uses the active one)
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <div style={{ fontSize: '.84rem', color: 'var(--warnL)', marginBottom: '.75rem' }}>
                                  No active template. Select a template and click "Set Active" above.
                                </div>
                              )}

                              {!stampPreview ? (
                                <button
                                  className="btn btn-s"
                                  disabled={!active || stamping}
                                  onClick={previewStamp}
                                >
                                  {stamping ? 'Computing…' : 'Preview Stamp'}
                                </button>
                              ) : (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                                  <div style={{ fontSize: '.88rem' }}>
                                    {stampPreview.shifts.length === 0
                                      ? <span style={{ color: 'var(--okB)' }}>✓ All 91 days already covered — nothing to stamp.</span>
                                      : <span><strong style={{ color: 'var(--acc)' }}>{stampPreview.shifts.length}</strong> new shift{stampPreview.shifts.length !== 1 ? 's' : ''} would be created across {new Set(stampPreview.shifts.map(s => s.date)).size} day{new Set(stampPreview.shifts.map(s => s.date)).size !== 1 ? 's' : ''}.</span>
                                    }
                                  </div>
                                  {stampPreview.shifts.length > 0 && (
                                    <button className="btn btn-ok" disabled={stamping} onClick={applyStamp}>
                                      {stamping ? 'Stamping…' : 'Apply Stamp →'}
                                    </button>
                                  )}
                                  <button className="btn btn-s btn-sm" onClick={() => setStampPreview(null)}>Recalculate</button>
                                </div>
                              )}
                            </>
                          )
                        })()}
                      </div>
                    </>
                  ) : (
                    <div className="empty">Create a template above to start building shift slots.</div>
                  )}
                </div>
              )}

              {/* ── D2) BLOCKS & HOLIDAYS ───────────────────────────────── */}
              {tmplView === 'blocks' && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '.5rem' }}>
                    <div style={{ fontSize: '.84rem', color: 'var(--muted)' }}>
                      <strong>Full Day</strong> — skips the entire day when stamping. <strong>Partial</strong> — trims shift start/end; shifts under 3 hours are eliminated. <strong>Holiday</strong> — also skips the full day (use it to mark closures vs. operational blocks).
                    </div>
                    {!addingBlock && (
                      <button className="btn btn-s btn-sm" onClick={() => { resetBlockForm(); setAddingBlock(true) }}>+ Add Block</button>
                    )}
                  </div>

                  {/* Add / edit block form */}
                  {addingBlock && (
                    <div style={{ background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: 6, padding: '.75rem 1rem', marginBottom: '1.25rem' }}>
                      <div style={{ fontSize: '.72rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '.65rem' }}>
                        {editingBlockId ? 'Edit Block / Holiday' : 'New Block / Holiday'}
                      </div>
                      <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'nowrap', overflowX: 'auto', paddingBottom: '.25rem' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem', flexShrink: 0 }}>
                          <span style={{ fontSize: '.68rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>DATE</span>
                          <input type="date" value={blockDraft.date} onChange={e => setBlockDraft(d => ({ ...d, date: e.target.value }))}
                            style={{ fontSize: '.83rem', padding: '.28rem .4rem', background: 'var(--bg)', color: 'var(--txt)', border: '1px solid var(--bdr)', borderRadius: 4 }} />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem', flexShrink: 0 }}>
                          <span style={{ fontSize: '.68rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>LABEL (OPTIONAL)</span>
                          <input type="text" placeholder="e.g. Christmas, HVAC Maintenance" value={blockDraft.label} onChange={e => setBlockDraft(d => ({ ...d, label: e.target.value }))}
                            style={{ fontSize: '.83rem', padding: '.28rem .4rem', background: 'var(--bg)', color: 'var(--txt)', border: '1px solid var(--bdr)', borderRadius: 4, width: 190 }} />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem', flexShrink: 0 }}>
                          <span style={{ fontSize: '.68rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>TYPE</span>
                          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', height: 28 }}>
                            <label style={{ display: 'flex', gap: '.25rem', alignItems: 'center', fontSize: '.83rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                              <input type="radio" checked={blockDraft.isFullDay} onChange={() => setBlockDraft(d => ({ ...d, isFullDay: true }))} />
                              Full Day
                            </label>
                            <label style={{ display: 'flex', gap: '.25rem', alignItems: 'center', fontSize: '.83rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                              <input type="radio" checked={!blockDraft.isFullDay} onChange={() => setBlockDraft(d => ({ ...d, isFullDay: false }))} />
                              Partial
                            </label>
                          </div>
                        </div>
                        {!blockDraft.isFullDay && (
                          <>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem', flexShrink: 0 }}>
                              <span style={{ fontSize: '.68rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>FROM</span>
                              <select value={blockDraft.startTime} onChange={e => setBlockDraft(d => ({ ...d, startTime: e.target.value }))}
                                style={{ fontSize: '.83rem', padding: '.28rem .4rem', background: 'var(--bg)', color: 'var(--txt)', border: '1px solid var(--bdr)', borderRadius: 4 }}>
                                {TIME_OPTIONS.map(t => <option key={t} value={t}>{fmtTime(t)}</option>)}
                              </select>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem', flexShrink: 0 }}>
                              <span style={{ fontSize: '.68rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>TO</span>
                              <select value={blockDraft.endTime} onChange={e => setBlockDraft(d => ({ ...d, endTime: e.target.value }))}
                                style={{ fontSize: '.83rem', padding: '.28rem .4rem', background: 'var(--bg)', color: 'var(--txt)', border: '1px solid var(--bdr)', borderRadius: 4 }}>
                                {TIME_OPTIONS.map(t => <option key={t} value={t}>{fmtTime(t)}</option>)}
                              </select>
                            </div>
                          </>
                        )}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem', flexShrink: 0 }}>
                          <span style={{ fontSize: '.68rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>&nbsp;</span>
                          <label style={{ display: 'flex', gap: '.3rem', alignItems: 'center', fontSize: '.83rem', cursor: 'pointer', height: 28, whiteSpace: 'nowrap' }}>
                            <input type="checkbox" checked={blockDraft.isHoliday} onChange={e => setBlockDraft(d => ({ ...d, isHoliday: e.target.checked }))} />
                            Holiday
                          </label>
                        </div>
                        <button className="btn btn-ok btn-sm" disabled={blockSaving} onClick={handleSaveBlock}>
                          {editingBlockId ? 'Update' : 'Add Block'}
                        </button>
                        <button className="btn btn-s btn-sm" onClick={resetBlockForm}>Cancel</button>
                      </div>
                    </div>
                  )}

                  {/* Future / Past tabs */}
                  {(() => {
                    const future = scheduleBlocks.filter(b => b.date >= today)
                    const past   = scheduleBlocks.filter(b => b.date <  today)
                    const listed = blockTab === 'future' ? future : past
                    return (
                      <>
                        <div style={{ display: 'flex', gap: 0, marginBottom: '1rem', borderBottom: '1px solid var(--bdr)' }}>
                          {[['future', `Upcoming (${future.length})`], ['past', `Past (${past.length})`]].map(([key, label]) => (
                            <button key={key} onClick={() => setBlockTab(key)}
                              style={{ padding: '.35rem .9rem', fontSize: '.8rem', border: 'none', background: 'none', cursor: 'pointer',
                                color: blockTab === key ? 'var(--txt)' : 'var(--muted)',
                                borderBottom: blockTab === key ? '2px solid var(--acc)' : '2px solid transparent',
                                fontWeight: blockTab === key ? 600 : 400, marginBottom: -1 }}>
                              {label}
                            </button>
                          ))}
                        </div>

                        {listed.length === 0 ? (
                          <div className="empty">{blockTab === 'future' ? 'No upcoming blocks or holidays.' : 'No past blocks or holidays.'}</div>
                        ) : (
                          <div className="tw">
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                              <thead>
                                <tr style={{ background: 'var(--surf2)', borderBottom: '1px solid var(--bdr)' }}>
                                  {['Date', 'Label', 'Type', 'Time Range', 'Holiday', ''].map(h => (
                                    <th key={h} style={{ padding: '.45rem .75rem', textAlign: 'left', fontSize: '.72rem', color: 'var(--muted)', fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase' }}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {listed.map((blk, i) => (
                                  <tr key={blk.id} style={{ borderBottom: i < listed.length - 1 ? '1px solid var(--bdr)' : 'none', background: editingBlockId === blk.id ? 'rgba(90,138,58,.06)' : undefined }}>
                                    <td style={{ padding: '.45rem .75rem', fontSize: '.85rem', fontFamily: 'var(--fd)' }}>{fmtDate(blk.date)}</td>
                                    <td style={{ padding: '.45rem .75rem', fontSize: '.84rem' }}>{blk.label ?? <span style={{ color: 'var(--muted)', fontStyle: 'italic' }}>—</span>}</td>
                                    <td style={{ padding: '.45rem .75rem' }}>
                                      <span className={`badge ${blk.isFullDay ? 'b-conflict' : 'b-warn'}`} style={{ fontSize: '.65rem' }}>
                                        {blk.isFullDay ? 'Full Day' : 'Partial'}
                                      </span>
                                    </td>
                                    <td style={{ padding: '.45rem .75rem', fontSize: '.83rem', fontFamily: 'var(--fd)', color: 'var(--muted)' }}>
                                      {blk.isFullDay ? '—' : `${fmtTime(blk.startTime)} – ${fmtTime(blk.endTime)}`}
                                    </td>
                                    <td style={{ padding: '.45rem .75rem', fontSize: '.83rem' }}>
                                      {blk.isHoliday ? <span style={{ color: 'var(--okB)' }}>✓</span> : <span style={{ color: 'var(--muted)' }}>—</span>}
                                    </td>
                                    <td style={{ padding: '.45rem .75rem' }}>
                                      <div style={{ display: 'flex', gap: '.35rem' }}>
                                        <button className="btn btn-s btn-sm" onClick={() => startEditBlock(blk)}>Edit</button>
                                        <button className="btn btn-d btn-sm" onClick={() => handleDeleteBlock(blk.id)}>✕</button>
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </>
                    )
                  })()}
                </div>
              )}

              {/* ── D3) STAFF ROLES ─────────────────────────────────────── */}
              {tmplView === 'roles' && (
                <div>
                  <div style={{ fontSize: '.84rem', color: 'var(--muted)', marginBottom: '1rem', lineHeight: 1.55 }}>
                    Check additional roles a staff member is cross-trained for. Primary roles are set in Staff Management and cannot be unchecked here.
                  </div>

                  {staffUsers.length === 0 ? (
                    <div className="empty">No active staff members found.</div>
                  ) : allRoles.length === 0 ? (
                    <div className="empty">No roles defined yet. Assign primary roles to staff first in Staff Management, then return here to set cross-training.</div>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
                        <thead>
                          <tr style={{ background: 'var(--surf2)', borderBottom: '1px solid var(--bdr)' }}>
                            <th style={{ padding: '.5rem .85rem', textAlign: 'left', fontSize: '.72rem', color: 'var(--muted)', fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Staff</th>
                            {allRoles.map(role => (
                              <th key={role} style={{ padding: '.5rem .75rem', textAlign: 'center', fontSize: '.72rem', color: 'var(--muted)', fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                                {role}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {staffUsers.map((u, i) => (
                            <tr key={u.id} style={{ borderBottom: i < staffUsers.length - 1 ? '1px solid var(--bdr)' : 'none' }}>
                              <td style={{ padding: '.5rem .85rem', whiteSpace: 'nowrap' }}>
                                <div style={{ fontSize: '.88rem', fontWeight: 500 }}>{u.name}</div>
                                {u.role && <div style={{ fontSize: '.72rem', color: 'var(--muted)' }}>{u.role}</div>}
                              </td>
                              {allRoles.map(role => {
                                const isPrimary = u.role === role
                                const extraEntry = (rolesByUser[u.id] ?? []).find(r => r.role === role)
                                const isChecked  = isPrimary || !!extraEntry
                                const key        = `${u.id}_${role}`
                                return (
                                  <td key={role} style={{ padding: '.5rem .75rem', textAlign: 'center' }}>
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      disabled={isPrimary || roleSaving.has(key)}
                                      onChange={() => handleToggleUserRole(u.id, role, extraEntry ?? null)}
                                      style={{ width: 16, height: 16, cursor: isPrimary ? 'default' : 'pointer', accentColor: 'var(--acc)' }}
                                      title={isPrimary ? 'Primary role — change in Staff Management' : isChecked ? `Remove ${role}` : `Add ${role}`}
                                    />
                                  </td>
                                )
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Availability override modal */}
      {availWarn && (
        <div className="mo">
          <div className="mc mo-sm">
            <div className="mt2">Availability Conflict</div>
            <p style={{ fontSize: '.87rem', color: 'var(--muted)', margin: '.5rem 0 1.25rem', lineHeight: 1.55 }}>
              This assignment conflicts with the staff member's stated availability.
              <br />Assign anyway?
            </p>
            <div className="ma">
              <button className="btn btn-d btn-sm" disabled={saving} onClick={availWarn.proceed}>Assign Anyway</button>
              <button className="btn btn-s btn-sm" onClick={() => setAvailWarn(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
