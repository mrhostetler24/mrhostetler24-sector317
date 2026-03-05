// src/stampUtils.js
// Pure stamp-computation helpers shared between StaffingScheduler.jsx (client)
// and api/auto-stamp.js (Vercel cron). No React, no DOM, no browser APIs.

export function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

export function addDays(isoDate, n) {
  const d = new Date(isoDate + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

export function timeToMinutes(t) {
  if (!t) return 0
  const parts = t.split(':').map(Number)
  return parts[0] * 60 + (parts[1] ?? 0)
}

export function minutesToTime(m) {
  const h = Math.floor(m / 60)
  const min = m % 60
  return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`
}

// Returns 1 or 2 based on how many complete 7-day periods have elapsed since
// cycleStartDate. Defaults to week 1 if no cycleStartDate or date is before it.
export function getWeekNumber(dateStr, cycleStartDate) {
  if (!cycleStartDate) return 1
  const daysDiff = Math.floor((new Date(dateStr) - new Date(cycleStartDate)) / 86400000)
  if (daysDiff < 0) return 1
  return (Math.floor(daysDiff / 7) % 2) + 1
}

// Returns true when a staff availability block prevents the staff member from
// covering at least 3 hours of the shift on the given date.
export function isStaffBlocked(staffId, date, shiftStart, shiftEnd, staffBlocks) {
  const relevant = (staffBlocks ?? []).filter(b =>
    b.staffId === staffId && b.startDate <= date && b.endDate >= date
  )
  if (!relevant.length) return false

  let s0 = timeToMinutes(shiftStart)
  let e0 = timeToMinutes(shiftEnd)

  for (const blk of relevant) {
    if (!blk.startTime || !blk.endTime) return true  // full-day block
    const bs = timeToMinutes(blk.startTime)
    const be = timeToMinutes(blk.endTime)
    if (bs >= e0 || be <= s0) continue                // no overlap
    if (bs <= s0 && be >= e0) return true             // block covers entire shift
    // Clip and check remaining duration
    const remaining = Math.max(0, (bs > s0 ? bs : e0) - Math.min(e0, be > s0 ? be : s0))
    if (remaining < 180) return true
  }
  return false
}

/**
 * Compute which shifts would be created/updated by stamping the given template
 * slots across the 91-day horizon, respecting existing shifts and blocks.
 *
 * Existing shift rules:
 *   - isModified = true  → skip (human changed staff or time — never overwrite)
 *   - isModified = false, matches template exactly → skip (no DB write needed)
 *   - isModified = false, differs from template → include as update
 *
 * Each result item has all shift fields plus _existingId when updating.
 */
export function computeStampShifts(slots, existingShifts, blocks, assignments, cycleStartDate, staffBlocks) {
  const today  = todayISO()
  const result = []

  for (let i = 1; i <= 91; i++) {
    const date      = addDays(today, i)
    const dow       = new Date(date + 'T00:00:00').getDay()
    const dayBlocks = blocks.filter(b => b.date === date)

    if (dayBlocks.some(b => b.isFullDay || b.isHoliday)) continue // full-day or holiday → skip

    for (const slot of slots.filter(s => s.dayOfWeek === dow)) {
      const existing = existingShifts.find(s => s.date === date && s.templateSlotId === slot.id)

      let s0 = timeToMinutes(slot.startTime)
      let e0 = timeToMinutes(slot.endTime)
      let eliminated = false

      for (const blk of dayBlocks.filter(b => !b.isFullDay)) {
        const bs = timeToMinutes(blk.startTime)
        const be = timeToMinutes(blk.endTime)
        if (bs <= s0 && be >= e0) { eliminated = true; break }  // block covers entire slot
        if (bs <= s0 && be > s0)  s0 = be                        // clips start
        if (bs < e0  && be >= e0) e0 = bs                        // clips end
        if (bs > s0  && be < e0)  e0 = bs                        // block in middle: keep first portion
      }

      if (eliminated) continue
      if (e0 - s0 < 180) continue  // < 3 hours after trimming → eliminate

      const weekNum    = getWeekNumber(date, cycleStartDate)
      const assignment = (assignments ?? []).find(a => a.slotId === slot.id && a.weekNumber === weekNum)

      // Check staff availability block — if blocked, fall back to open shift
      let finalStaffId = assignment?.staffId ?? null
      let isOpen       = !assignment
      if (assignment?.staffId) {
        const blocked = isStaffBlocked(
          assignment.staffId, date,
          minutesToTime(s0), minutesToTime(e0),
          staffBlocks
        )
        if (blocked) { finalStaffId = null; isOpen = true }
      }

      if (existing) {
        if (existing.isModified) continue  // human edited → never overwrite

        // Skip if it already exactly matches the template (avoid no-op DB writes)
        const noChange = (
          existing.start   === minutesToTime(s0) &&
          existing.end     === minutesToTime(e0) &&
          existing.staffId === finalStaffId &&
          existing.open    === isOpen &&
          existing.role    === (slot.role ?? null)
        )
        if (noChange) continue

        // Template changed → update (also resets conflict state)
        result.push({
          _existingId:    existing.id,
          date,
          start:          minutesToTime(s0),
          end:            minutesToTime(e0),
          templateSlotId: slot.id,
          role:           slot.role ?? null,
          open:           isOpen,
          staffId:        finalStaffId,
          conflicted:     false,
          conflictNote:   null,
        })
        continue
      }

      result.push({
        date,
        start:          minutesToTime(s0),
        end:            minutesToTime(e0),
        templateSlotId: slot.id,
        role:           slot.role ?? null,
        open:           isOpen,
        staffId:        finalStaffId,
        conflicted:     false,
        conflictNote:   null,
      })
    }
  }

  return result
}
