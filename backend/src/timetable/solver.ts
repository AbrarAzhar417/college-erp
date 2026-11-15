/**
 * Timetable solver (runs fully offline, no external AI service).
 *
 * HARD rules (never broken in the result):
 *  - a section has one lesson per period
 *  - a teacher is in one place per period
 *  - teacher unavailable periods are respected
 *  - teacher max periods per day
 *  - a subject appears at most ceil(sessions / days) times per day in a section
 *  - double periods stay together and never cross the break
 *  - locked lessons never move
 *
 * SOFT goals (minimised): teacher free gaps, long non-stop runs, uneven daily load,
 * gaps in a section's day, heavy subjects late in the day, same subject back-to-back.
 *
 * Method: greedy construction -> ejection-chain repair -> simulated annealing.
 */

export interface TTConfig { days: number[]; periodCount: number; breakAfter: number }
export interface TeacherIn { id: number; name: string; maxPerDay: number; maxPerWeek: number; unavailable: { day: number; period: number }[] }
export interface LessonIn {
  sectionId: number; sectionLabel: string; subjectId: number; subjectName: string; heavy: boolean; science?: boolean;
  teacherId: number | null; periodsPerWeek: number; block: number;
}
export interface SlotOut { sectionId: number; day: number; period: number; subjectId: number; teacherId: number; grp: number; locked: boolean }
export interface SolverInput { config: TTConfig; teachers: TeacherIn[]; lessons: LessonIn[]; locked: SlotOut[] }

export interface Issue { level: 'error' | 'warning'; message: string }

export interface SolveResult {
  slots: SlotOut[];
  placed: number; total: number;
  unplaced: { sectionLabel: string; subjectName: string; teacherName: string; periods: number }[];
  initialCost: number; cost: number;
  breakdown: { teacherGaps: number; longRuns: number; unevenDays: number; sectionGaps: number; heavyLate: number; backToBack: number; scienceRuns?: number };
  teacherStats: { id: number; name: string; load: number; maxPerWeek: number; busiestDay: number; gaps: number }[];
  validationErrors: string[];
  ms: number;
}

const W_GAP = 4, W_RUN = 5, W_BAL = 2, W_SGAP = 3, W_HEAVY = 1.5, W_ADJ = 4, W_SCI = 14;
const MAX_RUN = 3;
/** More than this many science lessons in a row in one class is penalised heavily. */
export const MAX_SCIENCE_RUN = 2;

const lessonCap = (l: LessonIn, days: number) => Math.max(1, Math.ceil(l.periodsPerWeek / l.block / days));
const segmentEnd = (p: number, c: TTConfig) => (c.breakAfter > 0 && p < c.breakAfter ? c.breakAfter : c.periodCount);

// ---------------------------------------------------------------------------
// Pre-checks: tell the user what is impossible BEFORE solving
// ---------------------------------------------------------------------------
export function precheck(inp: Omit<SolverInput, 'locked'>): Issue[] {
  const issues: Issue[] = [];
  const { config: c } = inp;
  const D = c.days.length, P = c.periodCount, T = D * P;
  const tById = new Map(inp.teachers.map(t => [t.id, t]));
  const longestSeg = Math.max(c.breakAfter > 0 ? c.breakAfter : P, c.breakAfter > 0 ? P - c.breakAfter : P);

  if (inp.lessons.length === 0) issues.push({ level: 'error', message: 'No subjects are set up for any section yet. Add them in Curriculum.' });

  const secLoad = new Map<number, { label: string; n: number }>();
  const tLoad = new Map<number, number>();
  for (const l of inp.lessons) {
    const sl = secLoad.get(l.sectionId) ?? { label: l.sectionLabel, n: 0 };
    sl.n += l.periodsPerWeek; secLoad.set(l.sectionId, sl);

    if (l.periodsPerWeek % l.block !== 0)
      issues.push({ level: 'error', message: `${l.sectionLabel} ${l.subjectName}: ${l.periodsPerWeek} periods cannot be split into double periods of ${l.block}.` });
    if (l.block > longestSeg)
      issues.push({ level: 'error', message: `${l.sectionLabel} ${l.subjectName}: a ${l.block}-period lesson does not fit before/after the break.` });
    if (l.teacherId == null) {
      issues.push({ level: 'error', message: `${l.sectionLabel} ${l.subjectName} has no teacher. Use "Assign teachers automatically".` });
    } else {
      tLoad.set(l.teacherId, (tLoad.get(l.teacherId) ?? 0) + l.periodsPerWeek);
    }
  }
  for (const [, s] of secLoad)
    if (s.n > T) issues.push({ level: 'error', message: `${s.label} has ${s.n} periods per week but only ${T} slots exist. Remove ${s.n - T} periods.` });

  for (const [id, load] of tLoad) {
    const t = tById.get(id); if (!t) continue;
    const blocked = new Set(t.unavailable.filter(u => c.days.includes(u.day) && u.period < P).map(u => `${u.day}-${u.period}`)).size;
    const avail = T - blocked;
    if (load > t.maxPerWeek) issues.push({ level: 'error', message: `${t.name} is assigned ${load} periods but the weekly limit is ${t.maxPerWeek}.` });
    else if (load > avail) issues.push({ level: 'error', message: `${t.name} is assigned ${load} periods but is free for only ${avail} slots.` });
    else if (load > t.maxPerDay * D) issues.push({ level: 'error', message: `${t.name}: ${load} periods cannot fit with a daily limit of ${t.maxPerDay} over ${D} days.` });
    else if (load > 0.96 * Math.min(avail, t.maxPerWeek, t.maxPerDay * D))
      issues.push({ level: 'warning', message: `${t.name} is almost fully loaded (${load} periods). A perfect timetable may be hard to find.` });
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Independent validator (used for publish, manual moves, and to double-check the solver)
// ---------------------------------------------------------------------------
export function validateSlots(inp: Omit<SolverInput, 'locked'>, slots: SlotOut[], limit = 25): string[] {
  const errs: string[] = [];
  const push = (m: string) => { if (errs.length < limit) errs.push(m); };
  const { config: c } = inp;
  const D = c.days.length, P = c.periodCount;
  const dayName = (d: number) => ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d] ?? `Day ${d}`;
  const tById = new Map(inp.teachers.map(t => [t.id, t]));
  const lByKey = new Map(inp.lessons.map(l => [`${l.sectionId}-${l.subjectId}`, l]));
  const label = new Map(inp.lessons.map(l => [l.sectionId, l.sectionLabel]));
  const unav = new Map(inp.teachers.map(t => [t.id, new Set(t.unavailable.map(u => `${u.day}-${u.period}`))]));

  const secCell = new Set<string>();
  const tchCell = new Map<string, SlotOut>();
  const tDay = new Map<string, number>();
  const perLesson = new Map<string, number>();
  const sessions = new Map<string, Set<number>>();       // lesson+day -> grp set
  const groups = new Map<string, SlotOut[]>();

  for (const s of slots) {
    const dIdx = c.days.indexOf(s.day);
    if (dIdx < 0 || s.period < 0 || s.period >= P) { push(`A lesson is placed outside the school week (${dayName(s.day)} period ${s.period + 1}).`); continue; }
    const where = `${label.get(s.sectionId) ?? s.sectionId} on ${dayName(s.day)} period ${s.period + 1}`;
    const l = lByKey.get(`${s.sectionId}-${s.subjectId}`);
    if (!l) { push(`${where}: this subject is not part of the section's curriculum.`); continue; }
    if (l.teacherId !== s.teacherId) push(`${where}: ${l.subjectName} is assigned to a different teacher.`);
    const t = tById.get(s.teacherId);
    if (!t) { push(`${where}: unknown teacher.`); continue; }

    const sk = `${s.sectionId}-${s.day}-${s.period}`;
    if (secCell.has(sk)) push(`${where} has two lessons.`); secCell.add(sk);

    const tk = `${s.teacherId}-${s.day}-${s.period}`;
    const other = tchCell.get(tk);
    if (other) push(`${t.name} would teach ${label.get(other.sectionId)} and ${label.get(s.sectionId)} at the same time (${dayName(s.day)} period ${s.period + 1}).`);
    else tchCell.set(tk, s);

    if (unav.get(s.teacherId)!.has(`${s.day}-${s.period}`)) push(`${t.name} is not available on ${dayName(s.day)} period ${s.period + 1}.`);

    const dk = `${s.teacherId}-${s.day}`;
    tDay.set(dk, (tDay.get(dk) ?? 0) + 1);

    const lk = `${s.sectionId}-${s.subjectId}`;
    perLesson.set(lk, (perLesson.get(lk) ?? 0) + 1);
    const sk2 = `${lk}-${s.day}`;
    (sessions.get(sk2) ?? sessions.set(sk2, new Set()).get(sk2)!).add(s.grp);

    const gk = `${s.sectionId}-${s.grp}`;
    (groups.get(gk) ?? groups.set(gk, []).get(gk)!).push(s);
  }

  for (const [k, n] of tDay) {
    const t = tById.get(Number(k.split('-')[0]))!;
    if (n > t.maxPerDay) push(`${t.name} would teach ${n} periods on ${dayName(Number(k.split('-')[1]))} (limit ${t.maxPerDay}).`);
  }
  for (const [k, n] of perLesson) {
    const l = lByKey.get(k)!;
    if (n > l.periodsPerWeek) push(`${l.sectionLabel} ${l.subjectName} has ${n} periods but needs only ${l.periodsPerWeek}.`);
  }
  for (const [k, g] of sessions) {
    const [sec, sub] = k.split('-').map(Number);
    const l = lByKey.get(`${sec}-${sub}`)!;
    if (g.size > lessonCap(l, D)) push(`${l.sectionLabel} has ${l.subjectName} too many times on one day.`);
  }
  for (const g of groups.values()) {
    const l = lByKey.get(`${g[0].sectionId}-${g[0].subjectId}`)!;
    g.sort((a, b) => a.day - b.day || a.period - b.period);
    if (g.length !== l.block) { push(`${l.sectionLabel} ${l.subjectName}: lesson should be ${l.block} period(s) together.`); continue; }
    for (let i = 1; i < g.length; i++) {
      if (g[i].day !== g[0].day || g[i].period !== g[i - 1].period + 1) push(`${l.sectionLabel} ${l.subjectName}: double period is split up.`);
    }
    if (g.length > 1 && segmentEnd(g[0].period, c) < g[g.length - 1].period + 1) push(`${l.sectionLabel} ${l.subjectName}: double period crosses the break.`);
  }
  return errs;
}

// ---------------------------------------------------------------------------
// Solver
// ---------------------------------------------------------------------------
function mulberry32(a: number) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const tick = () => new Promise<void>(r => setImmediate(r));

export interface SolveOptions {
  timeMs: number;
  seed?: number;
  onProgress?: (p: { phase: string; pct: number; placed: number; total: number }) => void;
  isCancelled?: () => boolean;
}

export async function solve(inp: SolverInput, opts: SolveOptions): Promise<SolveResult> {
  const startedAt = Date.now();
  const rng = mulberry32(opts.seed ?? (Date.now() & 0xffffff));
  const { config: cfg } = inp;
  const D = cfg.days.length, P = cfg.periodCount, T = D * P;
  const half = Math.ceil(P / 2);

  // ---- index everything ----
  const secIds = [...new Set(inp.lessons.map(l => l.sectionId))];
  const secIdx = new Map(secIds.map((id, i) => [id, i]));
  const tIdx = new Map(inp.teachers.map((t, i) => [t.id, i]));
  const S = secIds.length, Tn = inp.teachers.length;
  const lessons = inp.lessons.filter(l => l.teacherId != null && tIdx.has(l.teacherId));
  const L = lessons.length;
  const lessonOf = new Map(lessons.map((l, i) => [`${l.sectionId}-${l.subjectId}`, i]));
  const cap = lessons.map(l => lessonCap(l, D));
  const lessonTc = lessons.map(l => tIdx.get(l.teacherId!)!);
  const lessonSec = lessons.map(l => secIdx.get(l.sectionId)!);
  const lessonSubj = lessons.map(l => l.subjectId);
  const lessonHeavy = lessons.map(l => l.heavy);
  const lessonSci = lessons.map(l => !!l.science);
  const maxDay = inp.teachers.map(t => t.maxPerDay);

  const unavail = new Uint8Array(Tn * T);
  inp.teachers.forEach((t, i) => t.unavailable.forEach(u => {
    const d = cfg.days.indexOf(u.day);
    if (d >= 0 && u.period >= 0 && u.period < P) unavail[i * T + d * P + u.period] = 1;
  }));

  // ---- build events ----
  const evSec: number[] = [], evTc: number[] = [], evLesson: number[] = [], evLen: number[] = [], evLocked: number[] = [];
  const lockedByGrp = new Map<string, SlotOut[]>();
  for (const s of inp.locked) {
    const k = `${s.sectionId}-${s.grp}`;
    (lockedByGrp.get(k) ?? lockedByGrp.set(k, []).get(k)!).push(s);
  }
  const lockedSessions = new Array(L).fill(0);
  const lockedStarts: { e: number; t: number }[] = [];
  for (const g of lockedByGrp.values()) {
    const li = lessonOf.get(`${g[0].sectionId}-${g[0].subjectId}`);
    if (li === undefined) continue;
    g.sort((a, b) => a.day - b.day || a.period - b.period);
    const d = cfg.days.indexOf(g[0].day); if (d < 0) continue;
    const e = evSec.length;
    evSec.push(lessonSec[li]); evTc.push(lessonTc[li]); evLesson.push(li); evLen.push(g.length); evLocked.push(1);
    lockedSessions[li]++;
    lockedStarts.push({ e, t: d * P + g[0].period });
  }
  for (let li = 0; li < L; li++) {
    const sessions = lessons[li].periodsPerWeek / lessons[li].block - lockedSessions[li];
    for (let k = 0; k < sessions; k++) {
      evSec.push(lessonSec[li]); evTc.push(lessonTc[li]); evLesson.push(li); evLen.push(lessons[li].block); evLocked.push(0);
    }
  }
  const E = evSec.length;
  const totalPeriods = evLen.reduce((a, b) => a + b, 0);

  // teacher pressure: how full is each teacher (harder first)
  const tLoad = new Array(Tn).fill(0);
  for (let e = 0; e < E; e++) tLoad[evTc[e]] += evLen[e];
  const pressure = tLoad.map((ld, i) => {
    let free = T; for (let t = 0; t < T; t++) if (unavail[i * T + t]) free--;
    return ld / Math.max(1, Math.min(free, inp.teachers[i].maxPerWeek));
  });

  const secFill = new Array(S).fill(0);
  for (let e = 0; e < E; e++) secFill[evSec[e]] += evLen[e] / T;

  // ---- mutable state ----
  const secGrid = new Int32Array(S * T);
  const tcGrid = new Int32Array(Tn * T);
  const evPos = new Int32Array(E);
  const lessonDay = new Int16Array(L * D);
  const teacherDay = new Int16Array(Tn * D);
  const tCost = new Float64Array(Tn);
  const sCost = new Float64Array(S);
  const lastPlaced = new Int32Array(E);
  let iter = 0;

  const reset = () => {
    secGrid.fill(-1); tcGrid.fill(-1); evPos.fill(-1); lessonDay.fill(0); teacherDay.fill(0); lastPlaced.fill(-100);
    for (const { e, t } of lockedStarts) if (conflictsFree(e, t)) place(e, t);
  };

  function place(e: number, t: number) {
    const len = evLen[e], sec = evSec[e], tc = evTc[e];
    for (let k = 0; k < len; k++) { secGrid[sec * T + t + k] = e; tcGrid[tc * T + t + k] = e; }
    evPos[e] = t;
    const d = (t / P) | 0;
    lessonDay[evLesson[e] * D + d]++;
    teacherDay[tc * D + d] += len;
  }
  function unplace(e: number) {
    const t = evPos[e]; if (t < 0) return;
    const len = evLen[e], sec = evSec[e], tc = evTc[e];
    for (let k = 0; k < len; k++) { secGrid[sec * T + t + k] = -1; tcGrid[tc * T + t + k] = -1; }
    evPos[e] = -1;
    const d = (t / P) | 0;
    lessonDay[evLesson[e] * D + d]--;
    teacherDay[tc * D + d] -= len;
  }

  const startValid = (e: number, t: number) => {
    const p = t % P;
    return p + evLen[e] <= segmentEnd(p, cfg);
  };

  const out: number[] = [];
  /** Returns false when (e, t) is impossible. Otherwise fills `out` with events that must be evicted. */
  function conflicts(e: number, t: number): boolean {
    out.length = 0;
    if (!startValid(e, t)) return false;
    const len = evLen[e], sec = evSec[e], tc = evTc[e];
    for (let k = 0; k < len; k++) if (unavail[tc * T + t + k]) return false;
    for (let k = 0; k < len; k++) {
      const a = secGrid[sec * T + t + k];
      if (a >= 0 && a !== e) { if (evLocked[a]) return false; if (!out.includes(a)) out.push(a); }
      const b = tcGrid[tc * T + t + k];
      if (b >= 0 && b !== e) { if (evLocked[b]) return false; if (!out.includes(b)) out.push(b); }
    }
    const day = (t / P) | 0;
    let removed = 0;
    for (const x of out) if (evTc[x] === tc) removed += evLen[x];
    let over = teacherDay[tc * D + day] - removed + len - maxDay[tc];
    if (over > 0) {
      const cand: number[] = [];
      for (let p = 0; p < P; p++) {
        const x = tcGrid[tc * T + day * P + p];
        if (x >= 0 && x !== e && !evLocked[x] && !out.includes(x) && !cand.includes(x)) cand.push(x);
      }
      while (over > 0 && cand.length) { const x = cand.splice((rng() * cand.length) | 0, 1)[0]; out.push(x); over -= evLen[x]; }
      if (over > 0) return false;
    }
    const l = evLesson[e];
    let same = 0; for (const x of out) if (evLesson[x] === l) same++;
    if (lessonDay[l * D + day] - same + 1 > cap[l]) {
      const cand: number[] = [];
      for (let p = 0; p < P; p++) {
        const x = secGrid[sec * T + day * P + p];
        if (x >= 0 && x !== e && evLesson[x] === l && !evLocked[x] && !out.includes(x) && !cand.includes(x)) cand.push(x);
      }
      if (!cand.length) return false;
      out.push(cand[(rng() * cand.length) | 0]);
    }
    return true;
  }
  const conflictsFree = (e: number, t: number) => conflicts(e, t) && out.length === 0;

  // ---- soft cost ----
  function teacherCostOf(tc: number) {
    let cost = 0, dev = 0, total = 0;
    for (let d = 0; d < D; d++) for (let p = 0; p < P; p++) if (tcGrid[tc * T + d * P + p] >= 0) total++;
    const avg = total / D;
    for (let d = 0; d < D; d++) {
      const base = tc * T + d * P;
      let first = -1, last = -1, cnt = 0, run = 0;
      for (let p = 0; p < P; p++) {
        if (cfg.breakAfter > 0 && p === cfg.breakAfter) run = 0;
        if (tcGrid[base + p] >= 0) {
          cnt++; if (first < 0) first = p; last = p; run++;
          if (run > MAX_RUN) cost += W_RUN;
        } else run = 0;
      }
      if (cnt > 0) cost += (last - first + 1 - cnt) * W_GAP;
      dev += Math.abs(cnt - avg);
    }
    return cost + dev * W_BAL;
  }
  function sectionCostOf(s: number) {
    let cost = 0;
    for (let d = 0; d < D; d++) {
      const base = s * T + d * P;
      let last = -1, sci = 0;
      for (let p = 0; p < P; p++) if (secGrid[base + p] >= 0) last = p;
      for (let p = 0; p < P; p++) {
        const e = secGrid[base + p];
        if (cfg.breakAfter > 0 && p === cfg.breakAfter) sci = 0;
        if (e < 0) { sci = 0; if (p < last) cost += W_SGAP; continue; }
        if (lessonSci[evLesson[e]]) { sci++; if (sci > MAX_SCIENCE_RUN) cost += W_SCI; } else sci = 0;
        if (lessonHeavy[evLesson[e]] && p >= half && evPos[e] === d * P + p) cost += W_HEAVY;
        if (p > 0 && !(cfg.breakAfter > 0 && p === cfg.breakAfter)) {
          const f = secGrid[base + p - 1];
          if (f >= 0 && f !== e && lessonSubj[evLesson[f]] === lessonSubj[evLesson[e]]) cost += W_ADJ;
        }
      }
    }
    return cost;
  }
  const recomputeAll = () => {
    let sum = 0;
    for (let i = 0; i < Tn; i++) { tCost[i] = teacherCostOf(i); sum += tCost[i]; }
    for (let i = 0; i < S; i++) { sCost[i] = sectionCostOf(i); sum += sCost[i]; }
    return sum;
  };

  // ---- time slicing / progress ----
  let lastYield = Date.now();
  const report = async (phase: string, pct: number) => {
    const now = Date.now();
    if (now - lastYield > 40) {
      lastYield = now;
      let placed = 0; for (let e = 0; e < E; e++) if (evPos[e] >= 0) placed += evLen[e];
      opts.onProgress?.({ phase, pct: Math.min(99, Math.round(pct)), placed, total: totalPeriods });
      await tick();
    }
  };
  const cancelled = () => !!opts.isCancelled?.();

  // ---- phase A + B: construct and repair ----
  const order = [...Array(E).keys()].filter(e => !evLocked[e]);
  const bestState = { unplaced: Infinity, pos: new Int32Array(E) };

  async function construct(budgetEnd: number, attempt: number): Promise<number[]> {
    reset();
    order.sort((a, b) => ((pressure[evTc[b]] + secFill[evSec[b]]) - (pressure[evTc[a]] + secFill[evSec[a]])) || (evLen[b] - evLen[a]) || (rng() - 0.5));
    recomputeAll();
    let unplaced: number[] = [];
    for (let i = 0; i < order.length; i++) {
      const e = order[i];
      let bestT = -1, bestScore = Infinity;
      const tc = evTc[e], sec = evSec[e];
      const before = tCost[tc] + sCost[sec];
      for (let t = 0; t < T; t++) {
        if (!conflictsFree(e, t)) continue;
        place(e, t);
        const delta = teacherCostOf(tc) + sectionCostOf(sec) - before;
        unplace(e);
        const score = delta + rng() * (attempt === 0 ? 0.4 : 2);
        if (score < bestScore) { bestScore = score; bestT = t; }
      }
      if (bestT < 0) unplaced.push(e);
      else { place(e, bestT); tCost[tc] = teacherCostOf(tc); sCost[sec] = sectionCostOf(sec); lastPlaced[e] = iter; }
      await report('Placing lessons', 5 + (i / order.length) * 25);
      if (cancelled()) return unplaced;
    }

    const repairStart = Date.now();
    // repair with ejection chains (min-conflicts + tabu + a little random walk)
    let guard = 0;
    while (unplaced.length && Date.now() < budgetEnd && !cancelled()) {
      iter++; guard++;
      const e = unplaced.splice((rng() * unplaced.length) | 0, 1)[0];
      let bestT = -1, bestScore = Infinity, bestOut: number[] = [];
      const walk = rng() < 0.06;
      for (let t = 0; t < T; t++) {
        if (!conflicts(e, t)) continue;
        let score = out.length * 1000 + rng() * 8;
        for (const x of out) score += Math.max(0, 40 - (iter - lastPlaced[x])) * 6;
        if (walk) score = rng();
        if (score < bestScore) { bestScore = score; bestT = t; bestOut = out.slice(); }
      }
      if (bestT < 0) { unplaced.push(e); if (guard > 3000 + 50 * unplaced.length) break; continue; }
      for (const x of bestOut) { unplace(x); unplaced.push(x); }
      place(e, bestT); lastPlaced[e] = iter;
      if (unplaced.length < bestState.unplaced) { bestState.unplaced = unplaced.length; bestState.pos.set(evPos); }
      if (guard % 25 === 0) await report('Resolving clashes', 30 + 20 * Math.min(1, (Date.now() - repairStart) / Math.max(1, budgetEnd - repairStart)));
    }
    if (unplaced.length < bestState.unplaced) { bestState.unplaced = unplaced.length; bestState.pos.set(evPos); }
    return unplaced;
  }

  const t0 = Date.now();
  const deadline = t0 + opts.timeMs;
  opts.onProgress?.({ phase: 'Preparing', pct: 2, placed: 0, total: totalPeriods });
  let unplaced: number[] = [];
  const buildEnd = t0 + opts.timeMs * 0.7;
  for (let attempt = 0; attempt < 30; attempt++) {
    const budget = Math.min(buildEnd, Date.now() + Math.max(3000, opts.timeMs * 0.4));
    unplaced = await construct(Math.max(budget, Date.now() + 500), attempt);
    if (unplaced.length === 0 || cancelled() || Date.now() >= buildEnd) break;
  }
  if (unplaced.length > 0 && bestState.unplaced < Infinity) {
    reset();
    for (let e = 0; e < E; e++) if (!evLocked[e] && bestState.pos[e] >= 0) place(e, bestState.pos[e]);
    unplaced = []; for (let e = 0; e < E; e++) if (evPos[e] < 0) unplaced.push(e);
  }

  // ---- phase C: simulated annealing on soft cost ----
  let total = recomputeAll();
  const initialCost = total;
  if (unplaced.length === 0 && !cancelled()) {
    const movable: number[] = []; for (let e = 0; e < E; e++) if (!evLocked[e]) movable.push(e);
    const optStart = Date.now(), optEnd = Math.max(deadline, optStart + 800);
    let n = 0;
    while (movable.length && !cancelled()) {
      if ((n++ & 255) === 0) {
        const now = Date.now(); if (now >= optEnd) break;
        await report('Optimising', 50 + ((now - optStart) / (optEnd - optStart)) * 48);
      }
      const progress = Math.min(1, (Date.now() - optStart) / (optEnd - optStart));
      const temp = 2.2 * (1 - progress) + 0.03;
      const e = movable[(rng() * movable.length) | 0];
      const oldT = evPos[e], tc = evTc[e], sec = evSec[e];

      if (rng() < 0.5) {
        // relocate
        const t = (rng() * T) | 0; if (t === oldT) continue;
        const before = tCost[tc] + sCost[sec];
        unplace(e);
        if (!conflictsFree(e, t)) { place(e, oldT); continue; }
        place(e, t);
        const nt = teacherCostOf(tc), ns = sectionCostOf(sec);
        const delta = nt + ns - before;
        if (delta <= 0 || rng() < Math.exp(-delta / temp)) { tCost[tc] = nt; sCost[sec] = ns; total += delta; }
        else { unplace(e); place(e, oldT); }
      } else {
        // swap with another lesson of the same section
        const f = secGrid[sec * T + ((rng() * T) | 0)];
        if (f < 0 || f === e || evLocked[f] || evLen[f] !== evLen[e]) continue;
        const pf = evPos[f], tf = evTc[f];
        const before = tCost[tc] + (tf !== tc ? tCost[tf] : 0) + sCost[sec];
        unplace(e); unplace(f);
        let ok = false;
        if (conflictsFree(e, pf)) {
          place(e, pf);
          if (conflictsFree(f, oldT)) { place(f, oldT); ok = true; } else unplace(e);
        }
        if (!ok) { place(e, oldT); place(f, pf); continue; }
        const nt1 = teacherCostOf(tc), nt2 = tf !== tc ? teacherCostOf(tf) : 0, ns = sectionCostOf(sec);
        const delta = nt1 + nt2 + ns - before;
        if (delta <= 0 || rng() < Math.exp(-delta / temp)) { tCost[tc] = nt1; if (tf !== tc) tCost[tf] = nt2; sCost[sec] = ns; total += delta; }
        else { unplace(e); unplace(f); place(e, oldT); place(f, pf); }
      }
    }
  }

  // ---- results ----
  total = recomputeAll();
  const slots: SlotOut[] = [];
  for (let e = 0; e < E; e++) {
    const t = evPos[e]; if (t < 0) continue;
    const l = lessons[evLesson[e]];
    for (let k = 0; k < evLen[e]; k++) {
      const tt = t + k;
      slots.push({ sectionId: l.sectionId, day: cfg.days[(tt / P) | 0], period: tt % P, subjectId: l.subjectId, teacherId: l.teacherId!, grp: e + 1, locked: !!evLocked[e] });
    }
  }

  const breakdown = { teacherGaps: 0, longRuns: 0, unevenDays: 0, sectionGaps: 0, heavyLate: 0, backToBack: 0, scienceRuns: 0 };
  const teacherStats: SolveResult['teacherStats'] = [];
  for (let tc = 0; tc < Tn; tc++) {
    let load = 0, busiest = 0, gaps = 0;
    const counts: number[] = [];
    for (let d = 0; d < D; d++) {
      let first = -1, last = -1, cnt = 0, run = 0;
      for (let p = 0; p < P; p++) {
        if (cfg.breakAfter > 0 && p === cfg.breakAfter) run = 0;
        if (tcGrid[tc * T + d * P + p] >= 0) { cnt++; if (first < 0) first = p; last = p; run++; if (run > MAX_RUN) breakdown.longRuns++; } else run = 0;
      }
      if (cnt) gaps += last - first + 1 - cnt;
      counts.push(cnt); load += cnt; busiest = Math.max(busiest, cnt);
    }
    breakdown.teacherGaps += gaps;
    const avg = load / D; breakdown.unevenDays += counts.reduce((a, c) => a + Math.abs(c - avg), 0);
    if (load > 0) teacherStats.push({ id: inp.teachers[tc].id, name: inp.teachers[tc].name, load, maxPerWeek: inp.teachers[tc].maxPerWeek, busiestDay: busiest, gaps });
  }
  for (let s = 0; s < S; s++) for (let d = 0; d < D; d++) {
    let last = -1, sci = 0; for (let p = 0; p < P; p++) if (secGrid[s * T + d * P + p] >= 0) last = p;
    for (let p = 0; p < P; p++) {
      const e = secGrid[s * T + d * P + p];
      if (cfg.breakAfter > 0 && p === cfg.breakAfter) sci = 0;
      if (e < 0) { sci = 0; if (p < last) breakdown.sectionGaps++; continue; }
      if (lessonSci[evLesson[e]]) { sci++; if (sci > MAX_SCIENCE_RUN) breakdown.scienceRuns!++; } else sci = 0;
      if (lessonHeavy[evLesson[e]] && p >= half && evPos[e] === d * P + p) breakdown.heavyLate++;
      if (p > 0 && !(cfg.breakAfter > 0 && p === cfg.breakAfter)) {
        const f = secGrid[s * T + d * P + p - 1];
        if (f >= 0 && f !== e && lessonSubj[evLesson[f]] === lessonSubj[evLesson[e]]) breakdown.backToBack++;
      }
    }
  }
  teacherStats.sort((a, b) => b.load - a.load);

  const unplacedOut: SolveResult['unplaced'] = [];
  const grouped = new Map<string, number>();
  for (let e = 0; e < E; e++) if (evPos[e] < 0) {
    const l = lessons[evLesson[e]]; const k = `${evLesson[e]}`;
    grouped.set(k, (grouped.get(k) ?? 0) + evLen[e]);
  }
  for (const [k, periods] of grouped) {
    const l = lessons[Number(k)];
    unplacedOut.push({ sectionLabel: l.sectionLabel, subjectName: l.subjectName, teacherName: inp.teachers[lessonTc[Number(k)]].name, periods });
  }

  const validationErrors = validateSlots(inp, slots);
  const placed = slots.length;
  opts.onProgress?.({ phase: 'Done', pct: 100, placed, total: totalPeriods });
  return { slots, placed, total: totalPeriods, unplaced: unplacedOut, initialCost, cost: total, breakdown, teacherStats, validationErrors, ms: Date.now() - startedAt };
}
