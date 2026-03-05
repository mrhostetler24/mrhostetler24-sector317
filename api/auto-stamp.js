// api/auto-stamp.js
// Vercel cron handler — runs nightly at 3 AM UTC to auto-stamp the active template.
// Uses the Supabase service role key to bypass RLS (no user auth in cron context).
//
// Cron schedule: "0 3 * * *" (see vercel.json)
// Auth: Vercel sends Authorization: Bearer <CRON_SECRET> automatically.
//
// Rules:
//   - shift.is_modified = true  → skip (human changed it)
//   - shift matches template exactly → skip (no DB write)
//   - shift differs from template → update
//   - no shift exists for slot/date → create

import { createClient } from '@supabase/supabase-js'
import { computeStampShifts, addDays, todayISO } from '../src/stampUtils.js'

export default async function handler(req, res) {
  // Verify Vercel cron authorization
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  // 1. Fetch the active template
  const { data: tmpl, error: tmplErr } = await supabase
    .from('shift_templates').select('*').eq('active', true).maybeSingle()
  if (tmplErr) return res.status(500).json({ error: tmplErr.message })
  if (!tmpl)   return res.status(200).json({ skipped: 'No active template' })

  const today   = todayISO()
  const horizon = addDays(today, 91)

  // 2. Fetch all needed data in parallel
  const [slotsRes, assignRes, shiftsRes, blocksRes, staffBlocksRes] = await Promise.all([
    supabase.from('shift_template_slots').select('*').eq('template_id', tmpl.id),
    supabase.from('shift_slot_assignments')
      .select('*, shift_template_slots!inner(template_id)')
      .eq('shift_template_slots.template_id', tmpl.id),
    supabase.from('shifts').select('*').gte('date', addDays(today, 1)).lte('date', horizon),
    supabase.from('schedule_blocks').select('*').lte('date', horizon),
    supabase.from('staff_availability_blocks').select('*'),
  ])

  const fetchErr = [slotsRes, assignRes, shiftsRes, blocksRes, staffBlocksRes].find(r => r.error)
  if (fetchErr) return res.status(500).json({ error: fetchErr.error.message })

  // 3. Map DB rows to the app-shape that computeStampShifts expects
  const slots = (slotsRes.data ?? []).map(r => ({
    id:        r.id,
    dayOfWeek: r.day_of_week,
    startTime: r.start_time,
    endTime:   r.end_time,
    role:      r.role ?? null,
  }))
  const assignments = (assignRes.data ?? []).map(r => ({
    slotId:     r.template_slot_id,
    weekNumber: r.week_number,
    staffId:    r.staff_id,
  }))
  const existingShifts = (shiftsRes.data ?? []).map(r => ({
    id:             r.id,
    date:           r.date,
    start:          r.start_time,
    end:            r.end_time,
    staffId:        r.staff_id,
    open:           r.open,
    role:           r.role ?? null,
    templateSlotId: r.template_slot_id,
    isModified:     r.is_modified ?? false,
  }))
  const blocks = (blocksRes.data ?? []).map(r => ({
    date:      r.date,
    isFullDay: r.is_full_day ?? false,
    isHoliday: r.is_holiday ?? false,
    startTime: r.start_time,
    endTime:   r.end_time,
  }))
  const staffBlocks = (staffBlocksRes.data ?? []).map(r => ({
    staffId:   r.staff_id,
    startDate: r.start_date,
    endDate:   r.end_date,
    startTime: r.start_time ?? null,
    endTime:   r.end_time ?? null,
  }))

  // 4. Compute which shifts need to be created or updated
  const toStamp = computeStampShifts(
    slots, existingShifts, blocks, assignments, tmpl.cycle_start_date, staffBlocks
  )
  if (!toStamp.length) return res.status(200).json({ created: 0, updated: 0 })

  // 5. Upsert — always sets is_modified = false (stamp resets the flag)
  const rows = toStamp.map(s => ({
    id:               s._existingId ?? crypto.randomUUID(),
    staff_id:         s.staffId ?? null,
    date:             s.date,
    start_time:       s.start,
    end_time:         s.end,
    open:             s.open ?? true,
    conflicted:       false,
    conflict_note:    null,
    template_slot_id: s.templateSlotId ?? null,
    role:             s.role ?? null,
    is_modified:      false,
  }))

  const { error: upsertErr } = await supabase
    .from('shifts').upsert(rows, { onConflict: 'id' })
  if (upsertErr) return res.status(500).json({ error: upsertErr.message })

  return res.status(200).json({
    created:  toStamp.filter(s => !s._existingId).length,
    updated:  toStamp.filter(s =>  s._existingId).length,
    template: tmpl.name,
  })
}
