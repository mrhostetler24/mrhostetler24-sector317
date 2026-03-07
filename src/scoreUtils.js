// src/scoreUtils.js
// Pure scoring calculations for COOP and VERSUS modes.
// No React, no DOM, no browser APIs.
// Shared by OpsView.jsx (client) and any server-side code.

// ── Environment multipliers ────────────────────────────────────────────────────

/** Visual environment multipliers (sr.visual code → multiplier) */
export const VISUAL_MULT = { V: 1.0, C: 1.2, S: 1.4, B: 1.8, R: 1.2 }

/** Audio environment multipliers (sr.audio code → multiplier) */
export const AUDIO_MULT  = { O: 1.0, T: 1.0, C: 1.2 }

/** COOP live-op difficulty multipliers (sr.live_op_difficulty → multiplier) */
export const DIFF_MULT = {
  NONE:     0.75,
  HARMLESS: 0.85,
  EASY:     0.95,
  MEDIUM:   1.00,
  HARD:     1.08,
  EXPERT:   1.16,
}

// ── COOP scoring ───────────────────────────────────────────────────────────────

/** COOP base points per run outcome */
export const COOP_BASE = {
  FullSuccess:   63.18,
  ObjectiveOnly: 40.20,
  TargetsOnly:   28.72,
  Fail:          11.49,
}

/** Map boolean outcome flags to COOP outcome key */
export function coopOutcome(objectiveComplete, targetsEliminated) {
  if (objectiveComplete && targetsEliminated) return 'FullSuccess'
  if (objectiveComplete)                      return 'ObjectiveOnly'
  if (targetsEliminated)                      return 'TargetsOnly'
  return 'Fail'
}

/**
 * Calculate a single COOP run score (stored with 4-decimal precision).
 * Formula: base_points(outcome) × visual_mult × audio_mult × diff_mult
 *
 * Perfect (EXPERT + Dark + Cranked):
 *   63.18 × 1.16 × 1.8 × 1.2 = 158.3038 → displays as 158.3
 */
export function calcCoopRunScore({ visual, audio, cranked, objectiveComplete, targetsEliminated, liveOpDifficulty }) {
  const vM  = VISUAL_MULT[visual] ?? 1.0
  const aM  = AUDIO_MULT[audio]   ?? (cranked ? 1.2 : 1.0) // legacy cranked fallback
  const dM  = DIFF_MULT[liveOpDifficulty] ?? DIFF_MULT.MEDIUM
  const base = COOP_BASE[coopOutcome(!!objectiveComplete, !!targetsEliminated)]
  return +(base * vM * aM * dM).toFixed(4)
}

// ── VERSUS scoring ─────────────────────────────────────────────────────────────

/** VERSUS base points per team-run outcome */
export const VERSUS_BASE = {
  HunterWin:  70,
  HunterLoss: 35,
  CoyoteWin:  130,
  CoyoteLoss: 35,
}

/** War bonus (flat, added to winning team's session score — not env-multiplied) */
export const WAR_BONUS = { SWEEP: 25, TIEBREAK: 15 }

/**
 * Environmental dampener for VERSUS.
 * env      = visual_mult × audio_mult
 * env_damp = 1 + 0.5 × (env − 1)
 *
 * Dark + Cranked: env = 1.8 × 1.2 = 2.16 → env_damp = 1.58
 */
export function calcVersusEnvDamp(visual, audio, cranked) {
  const vM  = VISUAL_MULT[visual] ?? 1.0
  const aM  = AUDIO_MULT[audio]   ?? (cranked ? 1.2 : 1.0)
  const env = vM * aM
  return 1 + 0.5 * (env - 1)
}

/**
 * Calculate a single VERSUS run score for one team.
 *
 * @param {string}  role        - 'hunter' | 'coyote'
 * @param {number}  winningTeam - which team number won this run (1 or 2)
 * @param {number}  team        - this row's team number (1 or 2)
 * @param {string}  visual      - environment visual code
 * @param {string}  audio       - environment audio code
 * @param {boolean} cranked     - legacy cranked boolean
 *
 * Perfect hunter win (Dark + Cranked):  70  × 1.58 = 110.6
 * Perfect coyote win (Dark + Cranked): 130  × 1.58 = 205.4
 * Session perfect = 110.6 + 205.4 = 316.0, then +25 sweep = 341.0
 */
export function calcVersusRunScore({ role, winningTeam, team, visual, audio, cranked }) {
  const envDamp = calcVersusEnvDamp(visual, audio, cranked)
  const won     = winningTeam === team
  let outcome
  if (role === 'hunter') outcome = won ? 'HunterWin'  : 'HunterLoss'
  else                   outcome = won ? 'CoyoteWin'  : 'CoyoteLoss'
  return +(VERSUS_BASE[outcome] * envDamp).toFixed(4)
}

// ── War outcome ────────────────────────────────────────────────────────────────

/**
 * Compute which original player group wins the war (session-level W/L).
 *
 * In OpsView, team numbers are stable UI labels (team 1 = Hunters, team 2 = Coyotes)
 * but the actual players rotate: original group 1 plays Hunters in run 1 and Coyotes
 * in run 2. So run2WinnerTeam is INVERTED relative to original groups.
 *
 * Translation:
 *   run 1 winner team 1 → original group 1 wins run 1
 *   run 2 winner team 1 → original group 2 wins run 2  (3 - 1 = 2)
 *   run 2 winner team 2 → original group 1 wins run 2  (3 - 2 = 1)
 *
 * Returns { warWinner: 1|2, warWinType: 'SWEEP'|'TIEBREAK' }
 * in terms of original groups (matching reservation_players.team).
 * Returns null if data is incomplete.
 *
 * @param {number|null} run1WinnerTeam       - winning_team from run 1 session_runs row
 * @param {number|null} run2WinnerTeam       - winning_team from run 2 session_runs row
 * @param {number|null} group1HunterElapsed  - elapsed_seconds when group 1 was hunter (run 1)
 * @param {number|null} group2HunterElapsed  - elapsed_seconds when group 2 was hunter (run 2)
 */
export function calcWarOutcome({ run1WinnerTeam, run2WinnerTeam, group1HunterElapsed, group2HunterElapsed }) {
  if (run1WinnerTeam == null || run2WinnerTeam == null) return null

  // If both hunter teams lost their runs (both coyote teams won), it's a draw — no war bonus
  if (run1WinnerTeam === 2 && run2WinnerTeam === 2) return null

  const origRun1Winner = run1WinnerTeam            // run 1: team numbers match original groups
  const origRun2Winner = 3 - run2WinnerTeam        // run 2: teams swapped, invert (1↔2)

  if (origRun1Winner === origRun2Winner) {
    return { warWinner: origRun1Winner, warWinType: 'SWEEP' }
  }

  // 1-1 tiebreak: fastest hunter completion time wins
  if (group1HunterElapsed != null && group2HunterElapsed != null) {
    const winner = group1HunterElapsed <= group2HunterElapsed ? 1 : 2
    const timeDiff = Math.abs(group1HunterElapsed - group2HunterElapsed)
    return { warWinner: winner, warWinType: 'TIEBREAK', timeDiff }
  }

  return null // incomplete — can't determine
}
