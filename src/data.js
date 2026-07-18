import { supa, weekStart } from './supa';
import { autoTarget } from './util';

// ---- cell-key helpers: a project's identity ignores the reviewer dimension ----
export const unitCellKey = (unit_id, criterion_id) => `unit:${unit_id}:${criterion_id}`;
export const orgCellKey = (function_id, criterion_id) => `org:${function_id}:${criterion_id}`;
export const projectCellKey = (p) =>
  p.scope === 'unit' ? unitCellKey(p.unit_id, p.criterion_id) : orgCellKey(p.function_id, p.criterion_id);

export const OPEN_STATUSES = ['potential', 'queued', 'live', 'paused'];

// ---- periods ----
export async function loadPeriods() {
  const { data, error } = await supa.from('sar_periods').select('*').order('starts');
  if (error) throw error;
  return data;
}

// Load the whole matrix structure + one period's scores/projects in one go.
export async function loadAll(periodId) {
  const [units, criteria, ofuncs, ocrit, scores, oscores, projects, periods] = await Promise.all([
    supa.from('units').select('*').order('sort'),
    supa.from('criteria').select('*').order('sort'),
    supa.from('org_functions').select('*').order('sort'),
    supa.from('org_criteria').select('*').order('sort'),
    supa.from('scores').select('*').eq('period_id', periodId),
    supa.from('org_scores').select('*').eq('period_id', periodId),
    supa.from('projects').select('*').order('created_at', { ascending: false }),
    supa.from('sar_periods').select('*').order('starts'),
  ]);
  const err = [units, criteria, ofuncs, ocrit, scores, oscores, projects, periods].find(r => r.error);
  if (err) throw err.error;
  const period = periods.data.find(p => p.id === periodId);
  return {
    units: units.data, criteria: criteria.data,
    ofuncs: ofuncs.data, ocrit: ocrit.data,
    scores: scores.data, oscores: oscores.data,
    projects: projects.data, periods: periods.data, period,
  };
}

// ---- draft scoring (blocked once the period is locked — caller must check) ----
export async function setScore({ criterion_id, unit_id, score, reviewer, period_id, week = weekStart() }) {
  const { error } = await supa.from('scores')
    .upsert({ criterion_id, unit_id, week_start: week, period_id, score, reviewer, updated_at: new Date().toISOString() },
            { onConflict: 'criterion_id,unit_id,week_start,reviewer' });
  if (error) throw error;
}
export async function clearScore({ criterion_id, unit_id, reviewer, period_id, week = weekStart() }) {
  const { error } = await supa.from('scores').delete()
    .match({ criterion_id, unit_id, week_start: week, period_id, reviewer });
  if (error) throw error;
}
export async function setOrgScore({ function_id, criterion_id, score, reviewer, period_id, week = weekStart() }) {
  const { error } = await supa.from('org_scores')
    .upsert({ function_id, criterion_id, week_start: week, period_id, score, reviewer, updated_at: new Date().toISOString() },
            { onConflict: 'function_id,criterion_id,week_start,reviewer' });
  if (error) throw error;
}
export async function clearOrgScore({ function_id, criterion_id, reviewer, period_id, week = weekStart() }) {
  const { error } = await supa.from('org_scores').delete()
    .match({ function_id, criterion_id, week_start: week, period_id, reviewer });
  if (error) throw error;
}

function descriptorFor(crit, unitId) {
  return (crit.descriptors_by_unit?.[unitId]) || crit.descriptors;
}

async function loadForPeriod(periodId) {
  const [criteriaR, ocritR, scoresR, oscoresR, projectsR, unitsR, ofuncsR] = await Promise.all([
    supa.from('criteria').select('*'),
    supa.from('org_criteria').select('*'),
    supa.from('scores').select('*').eq('period_id', periodId),
    supa.from('org_scores').select('*').eq('period_id', periodId),
    supa.from('projects').select('*'),
    supa.from('units').select('*'),
    supa.from('org_functions').select('*'),
  ]);
  const err = [criteriaR, ocritR, scoresR, oscoresR, projectsR, unitsR, ofuncsR].find(r => r.error);
  if (err) throw err.error;
  return {
    criteria: criteriaR.data, ocrit: ocritR.data,
    scores: scoresR.data, oscores: oscoresR.data, projects: projectsR.data,
    units: unitsR.data, ofuncs: ofuncsR.data,
  };
}

// Worst grade per cell-key, across both reviewers — a project's identity
// ignores the reviewer dimension, so CH and FS both grading 3 is one cell.
function worstGrades(scores, oscores) {
  const worst = {};
  scores.forEach(s => {
    const key = unitCellKey(s.unit_id, s.criterion_id);
    if (!worst[key] || s.score > worst[key].grade)
      worst[key] = { grade: s.score, scope: 'unit', unit_id: s.unit_id, criterion_id: s.criterion_id };
  });
  oscores.forEach(s => {
    const key = orgCellKey(s.function_id, s.criterion_id);
    if (!worst[key] || s.score > worst[key].grade)
      worst[key] = { grade: s.score, scope: 'org', function_id: s.function_id, criterion_id: s.criterion_id };
  });
  return worst;
}

// §4.2 — one potential per cell-key graded 3 or 4 with no open project yet,
// carrying that criterion's suggested solution. Safe to call repeatedly:
// only ever fills gaps, never duplicates or touches existing projects.
async function generatePotentials(worst, projects, critById, ocritById, unitById, ofuncById) {
  const openKeys = new Set(projects.filter(p => OPEN_STATUSES.includes(p.status)).map(projectCellKey));
  const toCreate = Object.entries(worst)
    .filter(([key, w]) => w.grade >= 3 && !openKeys.has(key))
    .map(([key, w]) => {
      const crit = w.scope === 'unit' ? critById[w.criterion_id] : ocritById[w.criterion_id];
      const areaName = w.scope === 'unit' ? unitById[w.unit_id]?.name || w.unit_id : ofuncById[w.function_id]?.name || w.function_id;
      return {
        title: `${crit?.name || w.criterion_id} — ${areaName}`,
        scope: w.scope,
        unit_id: w.scope === 'unit' ? w.unit_id : null,
        function_id: w.scope === 'org' ? w.function_id : null,
        criterion_id: w.criterion_id,
        status: 'potential',
        grade_at_creation: w.grade,
        suggested_solution: crit?.solution || 'Claude integration coming soon — draft the starting plan here.',
      };
    });
  if (toCreate.length) {
    const { error } = await supa.from('projects').insert(toCreate);
    if (error) throw error;
  }
  return toCreate.length;
}

// Lightweight, non-freezing action: scan current draft grades and spool out
// potential projects for any 3 or 4 that doesn't already have one, with
// suggested solutions attached. Doesn't touch locked_at — both reviewers
// can keep scoring right through it, and it's safe to run again later.
export async function spoolProjects(periodId) {
  const { criteria, ocrit, scores, oscores, projects, units, ofuncs } = await loadForPeriod(periodId);
  const critById = Object.fromEntries(criteria.map(c => [c.id, c]));
  const ocritById = Object.fromEntries(ocrit.map(c => [c.id, c]));
  const unitById = Object.fromEntries(units.map(u => [u.id, u]));
  const ofuncById = Object.fromEntries(ofuncs.map(f => [f.id, f]));
  const worst = worstGrades(scores, oscores);
  const created = await generatePotentials(worst, projects, critById, ocritById, unitById, ofuncById);
  return { created };
}

// The final, explicit lock action. Returns { blocked: true, cells: [...] }
// if any 4-graded cell has no live project, otherwise performs the lock:
// snapshots wording, spools any remaining potentials, freezes both
// reviewers, stamps locked_at/locked_by. One-way — use spoolProjects()
// for the routine "generate projects as we go" pass instead.
export async function lockPeriod(periodId, lockedBy) {
  const { criteria, ocrit, scores, oscores, projects, units, ofuncs } = await loadForPeriod(periodId);
  const critById = Object.fromEntries(criteria.map(c => [c.id, c]));
  const ocritById = Object.fromEntries(ocrit.map(c => [c.id, c]));
  const unitById = Object.fromEntries(units.map(u => [u.id, u]));
  const ofuncById = Object.fromEntries(ofuncs.map(f => [f.id, f]));
  const liveKeys = new Set(projects.filter(p => p.status === 'live').map(projectCellKey));
  const worst = worstGrades(scores, oscores);

  // 2.4 — block lock if any 4 has no live project linked to its cell-key
  const blockers = Object.entries(worst)
    .filter(([key, w]) => w.grade === 4 && !liveKeys.has(key))
    .map(([key, w]) => ({ key, ...w }));
  if (blockers.length) return { blocked: true, cells: blockers };

  // 2.5 — snapshot descriptor wording for every scored cell this period
  await Promise.all([
    ...scores.map(s => {
      const c = critById[s.criterion_id];
      const desc = c ? descriptorFor(c, s.unit_id)?.[s.score - 1] : null;
      return desc ? supa.from('scores').update({ descriptor_snapshot: desc }).eq('id', s.id) : null;
    }).filter(Boolean),
    ...oscores.map(s => {
      const c = ocritById[s.criterion_id];
      const desc = c?.descriptors?.[s.score - 1];
      return desc ? supa.from('org_scores').update({ descriptor_snapshot: desc }).eq('id', s.id) : null;
    }).filter(Boolean),
  ]);

  const created = await generatePotentials(worst, projects, critById, ocritById, unitById, ofuncById);

  const { error: lockErr } = await supa.from('sar_periods')
    .update({ locked_at: new Date().toISOString(), locked_by: lockedBy })
    .eq('id', periodId);
  if (lockErr) throw lockErr;
  return { blocked: false, created };
}

// ---- projects: human-only transitions, never destroyed ----
export async function addProject(p) {
  const { data, error } = await supa.from('projects').insert(p).select().single();
  if (error) throw error;
  return data;
}
async function setStatus(id, status, extra = {}) {
  const now = new Date().toISOString();
  const { error } = await supa.from('projects')
    .update({ status, updated_at: now, status_changed_at: now, ...extra }).eq('id', id);
  if (error) throw error;
}
// Pace is chosen exactly once, at the moment a project goes live — whether
// that's straight from potential (Tick) or out of the queue (Promote).
export async function promoteLive(id, pace, period) {
  if (!pace) throw new Error('Pick a pace (Rapid Fix, Short, Mid or Long term) to agree this project.');
  return setStatus(id, 'live', { pace, due: autoTarget(pace, period) });
}
export const queueProject = (id) => setStatus(id, 'queued');
export const pauseProject = (id) => setStatus(id, 'paused');
export const resumeLive = (id) => setStatus(id, 'live'); // keeps existing pace/due
export const moveBackLive = (id) => setStatus(id, 'live'); // keeps existing pace/due
export async function completeProject(id, { what_changed, grade_at_completion }) {
  if (!what_changed) throw new Error('A what-changed note is required to complete a project.');
  return setStatus(id, 'completed', { what_changed, grade_at_completion });
}
export async function cancelProject(id, cancel_reason) {
  if (!cancel_reason) throw new Error('Cancelling a project requires a reason.');
  return setStatus(id, 'cancelled', { cancel_reason });
}
export async function updateProjectDue(id, due) {
  const { error } = await supa.from('projects').update({ due, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

// current_grade is an informal, project-linked re-read of a criterion
// between formal SAR periods — separate from the locked scores table, so
// it never touches the official historical record. Changes are captured
// automatically by the existing audit trigger on projects, which is what
// the Activity tab's "what moved" section reads from.
export async function updateCurrentGrade(id, grade) {
  const { error } = await supa.from('projects')
    .update({ current_grade: grade, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

// Everything that happened in the last `days` days, across every audited
// table, for the Activity tab.
export async function loadRecentActivity(days = 7) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await supa.from('audit_log').select('*').gte('at', since).order('at', { ascending: false });
  if (error) throw error;
  return data;
}

// ---- project notes: append-only, an "edit" is a new row pointing at the old one ----
export async function loadNotes(project_id) {
  const { data, error } = await supa.from('project_notes').select('*').eq('project_id', project_id).order('created_at');
  if (error) throw error;
  return data;
}
export async function addNote(project_id, author, body) {
  const { error } = await supa.from('project_notes').insert({ project_id, author, body });
  if (error) throw error;
}
export async function editNote(oldNote, newBody) {
  const { error } = await supa.from('project_notes')
    .insert({ project_id: oldNote.project_id, author: oldNote.author, body: newBody, replaces_note_id: oldNote.id });
  if (error) throw error;
}

// ---- meetings ----
export async function startMeeting(started_by, period_id) {
  const { data, error } = await supa.from('meetings')
    .insert({ started_by, period_id }).select().single();
  if (error) throw error;
  return data;
}
export async function endMeeting(id, { transcript, attendees, promoted_project_ids }) {
  const { error } = await supa.from('meetings')
    .update({ ended_at: new Date().toISOString(), transcript, attendees, promoted_project_ids })
    .eq('id', id);
  if (error) throw error;
}
export async function loadMeetings() {
  const { data, error } = await supa.from('meetings').select('*').not('ended_at', 'is', null).order('started_at', { ascending: false });
  if (error) throw error;
  return data;
}

// ---- historic means, by period (per-area trajectory) ----
export async function periodMeans(scope, id) {
  const col = scope === 'unit' ? 'unit_id' : 'function_id';
  const table = scope === 'unit' ? 'scores' : 'org_scores';
  const { data, error } = await supa.from(table).select(`period_id, score`).eq(col, id);
  if (error) throw error;
  const byPeriod = {};
  data.forEach(r => { (byPeriod[r.period_id] ||= []).push(r.score); });
  return Object.entries(byPeriod).map(([period_id, arr]) =>
    ({ period_id, mean: arr.reduce((a, b) => a + b, 0) / arr.length }));
}

// Historic means per unit, week by week — kept for provenance/back-compat.
export async function history(unit_id) {
  const { data, error } = await supa.from('scores')
    .select('week_start, score').eq('unit_id', unit_id).order('week_start');
  if (error) throw error;
  const byWeek = {};
  data.forEach(r => { (byWeek[r.week_start] ||= []).push(r.score); });
  return Object.entries(byWeek).map(([week, arr]) =>
    ({ week, mean: arr.reduce((a, b) => a + b, 0) / arr.length }));
}
