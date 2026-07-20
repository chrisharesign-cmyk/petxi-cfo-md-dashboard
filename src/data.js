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
  const [units, criteria, ofuncs, ocrit, scores, oscores, projects, periods, projectLinks, contentFlags, finalScores] = await Promise.all([
    supa.from('units').select('*').order('sort'),
    supa.from('criteria').select('*').order('sort'),
    supa.from('org_functions').select('*').order('sort'),
    supa.from('org_criteria').select('*').order('sort'),
    supa.from('scores').select('*').eq('period_id', periodId),
    supa.from('org_scores').select('*').eq('period_id', periodId),
    supa.from('projects').select('*').order('created_at', { ascending: false }),
    supa.from('sar_periods').select('*').order('starts'),
    supa.from('project_links').select('*').eq('confirmed', true),
    supa.from('content_flags').select('*'),
    supa.from('final_scores').select('*').eq('period_id', periodId),
  ]);
  const err = [units, criteria, ofuncs, ocrit, scores, oscores, projects, periods, projectLinks, contentFlags, finalScores].find(r => r.error);
  if (err) throw err.error;
  const period = periods.data.find(p => p.id === periodId);
  return {
    units: units.data, criteria: criteria.data,
    ofuncs: ofuncs.data, ocrit: ocrit.data,
    scores: scores.data, oscores: oscores.data,
    projects: projects.data, periods: periods.data, period,
    projectLinks: projectLinks.data,
    contentFlags: contentFlags.data,
    finalScores: finalScores.data,
  };
}

// ---- grade-change flags: whenever a cell's worst-of-both-reviewers grade
// moves, the content written for the new grade may not have been written
// (or written for the old situation) — flag it so CriterionPage can show a
// "this grading change needs review" banner instead of silently showing
// whatever's sitting in that grade's slot. One open flag per cell; the
// unique index lets a second grade change just replace it.
export async function flagGradeChange({ scope, unit_id, function_id, criterion_id, old_grade, new_grade }) {
  if (!new_grade) return;
  const { error } = await supa.from('content_flags')
    .upsert({ scope, unit_id: unit_id || '', function_id: function_id || '', criterion_id, old_grade, new_grade, flagged_at: new Date().toISOString() },
            { onConflict: 'scope,unit_id,function_id,criterion_id' });
  if (error) throw error;
}
export async function clearContentFlag({ scope, unit_id, function_id, criterion_id }) {
  const { error } = await supa.from('content_flags').delete()
    .match({ scope, unit_id: unit_id || '', function_id: function_id || '', criterion_id });
  if (error) throw error;
}

// ---- draft scoring (blocked once the period is locked — caller must check) ----
// `score` of 1-4 is a real grade; `score: null` is an explicit "N/A" — the
// reviewer has looked and this genuinely isn't theirs to grade (e.g. an area
// they've never worked with). Either way a row exists; clearScore below is
// the separate "remove this, go back to not-yet-scored" action.
const numericGrades = arr => arr.filter(s => s != null);
export async function setScore({ criterion_id, unit_id, score, reviewer, period_id, week = weekStart() }) {
  const { data: existing } = await supa.from('scores').select('reviewer,score')
    .match({ criterion_id, unit_id, week_start: week, period_id });
  const oldNums = numericGrades((existing || []).map(s => s.score));
  const oldGrade = oldNums.length ? Math.max(...oldNums) : null;
  const { error } = await supa.from('scores')
    .upsert({ criterion_id, unit_id, week_start: week, period_id, score, reviewer, updated_at: new Date().toISOString() },
            { onConflict: 'criterion_id,unit_id,week_start,reviewer' });
  if (error) throw error;
  const otherNums = numericGrades((existing || []).filter(s => s.reviewer !== reviewer).map(s => s.score));
  const newNums = numericGrades([score, ...otherNums]);
  const newGrade = newNums.length ? Math.max(...newNums) : null;
  if (newGrade !== oldGrade) await flagGradeChange({ scope: 'unit', unit_id, criterion_id, old_grade: oldGrade, new_grade: newGrade });
}
export async function clearScore({ criterion_id, unit_id, reviewer, period_id, week = weekStart() }) {
  const { error } = await supa.from('scores').delete()
    .match({ criterion_id, unit_id, week_start: week, period_id, reviewer });
  if (error) throw error;
}
export async function setOrgScore({ function_id, criterion_id, score, reviewer, period_id, week = weekStart() }) {
  const { data: existing } = await supa.from('org_scores').select('reviewer,score')
    .match({ function_id, criterion_id, week_start: week, period_id });
  const oldNums = numericGrades((existing || []).map(s => s.score));
  const oldGrade = oldNums.length ? Math.max(...oldNums) : null;
  const { error } = await supa.from('org_scores')
    .upsert({ function_id, criterion_id, week_start: week, period_id, score, reviewer, updated_at: new Date().toISOString() },
            { onConflict: 'function_id,criterion_id,week_start,reviewer' });
  if (error) throw error;
  const otherNums = numericGrades((existing || []).filter(s => s.reviewer !== reviewer).map(s => s.score));
  const newNums = numericGrades([score, ...otherNums]);
  const newGrade = newNums.length ? Math.max(...newNums) : null;
  if (newGrade !== oldGrade) await flagGradeChange({ scope: 'org', function_id, criterion_id, old_grade: oldGrade, new_grade: newGrade });
}
export async function clearOrgScore({ function_id, criterion_id, reviewer, period_id, week = weekStart() }) {
  const { error } = await supa.from('org_scores').delete()
    .match({ function_id, criterion_id, week_start: week, period_id, reviewer });
  if (error) throw error;
}

// ---- agreed final score: once Chris and Fleur have graded independently,
// this is where they record what they've actually agreed the grade is.
// Separate from scores/org_scores (each reviewer's own read) so reconciling
// never overwrites either individual score — it's a third, joint number.
export async function setFinalScore({ scope, unit_id, function_id, criterion_id, score, period_id, decided_by }) {
  const { error } = await supa.from('final_scores')
    .upsert({ scope, unit_id: unit_id || '', function_id: function_id || '', criterion_id, period_id, score, decided_by, updated_at: new Date().toISOString() },
            { onConflict: 'scope,unit_id,function_id,criterion_id,period_id' });
  if (error) throw error;
}
export async function clearFinalScore({ scope, unit_id, function_id, criterion_id, period_id }) {
  const { error } = await supa.from('final_scores').delete()
    .match({ scope, unit_id: unit_id || '', function_id: function_id || '', criterion_id, period_id });
  if (error) throw error;
}

function descriptorFor(crit, unitId) {
  return (crit.descriptors_by_unit?.[unitId]) || crit.descriptors;
}

async function loadForPeriod(periodId) {
  const [criteriaR, ocritR, scoresR, oscoresR, projectsR] = await Promise.all([
    supa.from('criteria').select('*'),
    supa.from('org_criteria').select('*'),
    supa.from('scores').select('*').eq('period_id', periodId),
    supa.from('org_scores').select('*').eq('period_id', periodId),
    supa.from('projects').select('*'),
  ]);
  const err = [criteriaR, ocritR, scoresR, oscoresR, projectsR].find(r => r.error);
  if (err) throw err.error;
  return {
    criteria: criteriaR.data, ocrit: ocritR.data,
    scores: scoresR.data, oscores: oscoresR.data, projects: projectsR.data,
  };
}

// Worst grade per cell-key, across every reviewer — a project's identity
// ignores the reviewer dimension, so two reviewers both grading 3 is one
// cell. N/A rows (score null) never win the "worst" comparison.
export function worstGrades(scores, oscores) {
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

// The final, explicit lock action. Returns { blocked: true, cells: [...] }
// if any 4-graded cell has no live project, otherwise snapshots wording and
// freezes every reviewer. Projects are no longer auto-spooled on lock —
// every criterion has its own always-visible page now (root cause +
// projects), so there's no gap for a placeholder project to fill.
export async function lockPeriod(periodId, lockedBy) {
  const { criteria, ocrit, scores, oscores, projects } = await loadForPeriod(periodId);
  const critById = Object.fromEntries(criteria.map(c => [c.id, c]));
  const ocritById = Object.fromEntries(ocrit.map(c => [c.id, c]));
  const liveKeys = new Set(projects.filter(p => p.status === 'live' && !p.archived_at).map(projectCellKey));
  const worst = worstGrades(scores, oscores);

  // block lock if any 4 has no live project linked to its cell-key
  const blockers = Object.entries(worst)
    .filter(([key, w]) => w.grade === 4 && !liveKeys.has(key))
    .map(([key, w]) => ({ key, ...w }));
  if (blockers.length) return { blocked: true, cells: blockers };

  // snapshot descriptor wording for every scored cell this period
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

  const { error: lockErr } = await supa.from('sar_periods')
    .update({ locked_at: new Date().toISOString(), locked_by: lockedBy })
    .eq('id', periodId);
  if (lockErr) throw lockErr;
  return { blocked: false };
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
// that's straight from To discuss (Tick) or out of the queue (Promote).
// due lets a specific future quarter be picked instead of the generic
// "long term = next period" default. owner is required going forward —
// anything leaving To discuss gets a date and an owner in the same step.
export async function promoteLive(id, pace, period, { due, owner } = {}) {
  if (!pace) throw new Error('Pick a pace (Rapid Fix, Short, Mid or Long term) to agree this project.');
  const extra = { pace, due: due || autoTarget(pace, period) };
  if (owner !== undefined) extra.owner = owner;
  return setStatus(id, 'live', extra);
}
// Re-target a project's schedule at any status, not just at the moment it
// first goes live — e.g. moving a paused project out to a named future quarter.
export async function rescheduleProject(id, { pace, due }) {
  const { error } = await supa.from('projects').update({ pace, due, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}
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

// progress_rag is an informal on-track/at-risk read a project owner can set
// any time between formal SAR periods — separate from the locked scores
// table, so it never touches the official historical record. Changes are
// captured automatically by the existing audit trigger on projects, which
// is what the Activity tab's "what moved" section reads from.
export async function updateProgressRag(id, rag) {
  const { error } = await supa.from('projects')
    .update({ progress_rag: rag, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

// "Deleting" a project archives it instead — nothing is destroyed, it just
// stops showing up by default (and stops counting toward a criterion's
// live-project count). Reversible.
export async function archiveProject(id) {
  const { error } = await supa.from('projects')
    .update({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}
export async function unarchiveProject(id) {
  const { error } = await supa.from('projects')
    .update({ archived_at: null, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}
// "Has this project actually been raised at a meeting yet" — separate from
// status/owner/pace, which are already real the moment a project is
// created. Manual, not inferred from meeting content, so it can't misfire.
export async function markProjectDiscussed(id) {
  const { error } = await supa.from('projects').update({ discussed_at: new Date().toISOString() }).eq('id', id);
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
// Two kinds going forward: 'qip' (the standing review — its agenda is
// computed live by qipAgenda() off current grades/projects) and 'project'
// (carries project_id, agenda computed by projectAgenda()). 'criterion' is
// still a legal value in the DB (one historic row has it) but is no longer
// offered as a way to start a new meeting — a criterion meeting's whole
// purpose, discussing root cause before a project exists, is now just the
// "solutions needed" section of every QIP agenda.
export async function startMeeting(started_by, period_id, { kind = 'qip', project_id = null, title = null, agendaRows = [] } = {}) {
  const { data, error } = await supa.from('meetings')
    .insert({ started_by, period_id, kind, project_id, title }).select().single();
  if (error) throw error;
  if (kind === 'qip' && agendaRows.length) {
    const { error: mcErr } = await supa.from('meeting_criteria')
      .insert(agendaRows.map(r => ({ meeting_id: data.id, ...r })));
    if (mcErr) throw mcErr;
  }
  return data;
}
export async function endMeeting(id, { transcript, attendees, promoted_project_ids }) {
  const { error } = await supa.from('meetings')
    .update({ ended_at: new Date().toISOString(), transcript, attendees, promoted_project_ids })
    .eq('id', id);
  if (error) throw error;
}
// Editing after the fact — mainly for pasting Claude-generated minutes back in.
export async function updateMeeting(id, fields) {
  const { error } = await supa.from('meetings').update(fields).eq('id', id);
  if (error) throw error;
}
// The one genuine hard-delete in this app — meetings are a working record,
// not an audited financial one, and the user explicitly wants to be able
// to bin a bad recording. UI must confirm before calling this.
export async function deleteMeeting(id) {
  const { error } = await supa.from('meetings').delete().eq('id', id);
  if (error) throw error;
}
export async function loadMeetings() {
  const { data, error } = await supa.from('meetings').select('*').not('ended_at', 'is', null).order('started_at', { ascending: false });
  if (error) throw error;
  return data;
}
export async function lastQipMeeting() {
  const { data, error } = await supa.from('meetings').select('started_at')
    .eq('kind', 'qip').not('ended_at', 'is', null).order('started_at', { ascending: false }).limit(1);
  if (error) throw error;
  return data?.[0]?.started_at || null;
}
export async function loadMeetingsForProject(projectId) {
  const { data, error } = await supa.from('meetings').select('*')
    .eq('project_id', projectId).not('ended_at', 'is', null).order('started_at', { ascending: false });
  if (error) throw error;
  return data;
}
// Every meeting that ever touched this criterion — old single-criterion
// meetings (the retired 'criterion' kind) via the direct columns, plus
// every QIP meeting whose snapshotted agenda covered it via meeting_criteria.
export async function loadMeetingsForCriterion(scope, unit_id, function_id, criterion_id) {
  let directQ = supa.from('meetings').select('*').eq('scope', scope).eq('criterion_id', criterion_id).not('ended_at', 'is', null);
  directQ = scope === 'unit' ? directQ.eq('unit_id', unit_id) : directQ.eq('function_id', function_id);
  let linkQ = supa.from('meeting_criteria').select('grade_at_meeting, meetings(*)').eq('scope', scope).eq('criterion_id', criterion_id);
  linkQ = scope === 'unit' ? linkQ.eq('unit_id', unit_id) : linkQ.eq('function_id', function_id);
  const [direct, linked] = await Promise.all([directQ, linkQ]);
  if (direct.error) throw direct.error;
  if (linked.error) throw linked.error;
  const fromLinks = linked.data.map(r => ({ ...r.meetings, grade_at_meeting: r.grade_at_meeting })).filter(m => m?.ended_at);
  const byId = new Map([...direct.data, ...fromLinks].map(m => [m.id, m]));
  return [...byId.values()].sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
}

// ---- meeting documents: attach a formatted doc alongside pasted minutes ----
export async function loadMeetingDocuments(meetingId) {
  const { data, error } = await supa.from('meeting_documents').select('*')
    .eq('meeting_id', meetingId).order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}
export async function uploadMeetingDocument(meetingId, file, uploadedBy) {
  const path = `meetings/${meetingId}/${Date.now()}-${file.name}`;
  const { error: upErr } = await supa.storage.from('project-docs').upload(path, file, { contentType: file.type || 'application/octet-stream' });
  if (upErr) throw upErr;
  const { error } = await supa.from('meeting_documents').insert({
    meeting_id: meetingId, filename: file.name, storage_path: path,
    uploaded_by: uploadedBy, mime_type: file.type || 'application/octet-stream', size_bytes: file.size,
  });
  if (error) throw error;
}
export function meetingDocumentUrl(storage_path) {
  return supa.storage.from('project-docs').getPublicUrl(storage_path).data.publicUrl;
}
export async function deleteMeetingDocument(doc) {
  await supa.storage.from('project-docs').remove([doc.storage_path]);
  const { error } = await supa.from('meeting_documents').delete().eq('id', doc.id);
  if (error) throw error;
}

// ---- project links: "also affects" tags beyond a project's primary home ----
export async function loadProjectLinks(projectId) {
  const { data, error } = await supa.from('project_links').select('*').eq('project_id', projectId);
  if (error) throw error;
  return data;
}
// confirmed defaults true — the normal "+ Add area" flow tags something the
// person typing it already believes. Suggested links (confirmed: false,
// with a note explaining the reasoning) are for judgment calls that aren't
// mine to make alone — a person reviews and confirms or dismisses each one.
export async function addProjectLink(projectId, { scope, unit_id, function_id, criterion_id }, createdBy, { confirmed = true, note = null } = {}) {
  const { error } = await supa.from('project_links').insert({
    project_id: projectId, scope,
    unit_id: scope === 'unit' ? unit_id : null,
    function_id: scope === 'org' ? function_id : null,
    criterion_id, created_by: createdBy, confirmed, note,
  });
  if (error) throw error;
}
export async function confirmProjectLinks(ids) {
  const { error } = await supa.from('project_links').update({ confirmed: true }).in('id', ids);
  if (error) throw error;
}
export async function removeProjectLink(id) {
  const { error } = await supa.from('project_links').delete().eq('id', id);
  if (error) throw error;
}

// ---- root cause: one living record per criterion, why it scores the way it does ----
export async function loadRootCause(scope, unit_id, function_id, criterion_id) {
  let q = supa.from('root_causes').select('*').eq('scope', scope).eq('criterion_id', criterion_id);
  q = scope === 'unit' ? q.eq('unit_id', unit_id) : q.eq('function_id', function_id);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  return data;
}
export async function saveRootCause({ id, scope, unit_id, function_id, criterion_id, body, updatedBy }) {
  if (id) {
    const { error } = await supa.from('root_causes')
      .update({ body, updated_by: updatedBy, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
  } else {
    const { error } = await supa.from('root_causes').insert({
      scope, unit_id: scope === 'unit' ? unit_id : null, function_id: scope === 'org' ? function_id : null,
      criterion_id, body, updated_by: updatedBy,
    });
    if (error) throw error;
  }
}

// ---- project documents: PDF attachments, on any project ----
export async function loadDocuments(projectId) {
  const { data, error } = await supa.from('project_documents').select('*')
    .eq('project_id', projectId).order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}
export async function uploadDocument(projectId, file, uploadedBy) {
  const path = `${projectId}/${Date.now()}-${file.name}`;
  const { error: upErr } = await supa.storage.from('project-docs').upload(path, file, { contentType: file.type || 'application/pdf' });
  if (upErr) throw upErr;
  const { error } = await supa.from('project_documents').insert({
    project_id: projectId, filename: file.name, storage_path: path,
    uploaded_by: uploadedBy, mime_type: file.type || 'application/pdf', size_bytes: file.size,
  });
  if (error) throw error;
}
export function documentUrl(storage_path) {
  return supa.storage.from('project-docs').getPublicUrl(storage_path).data.publicUrl;
}
export async function deleteDocument(doc) {
  await supa.storage.from('project-docs').remove([doc.storage_path]);
  const { error } = await supa.from('project_documents').delete().eq('id', doc.id);
  if (error) throw error;
}

// Org-wide mean, by period, across every unit and org-function score —
// the single trend line for "are we better than last quarter, overall".
export async function overallTrend() {
  const [scores, oscores, periods] = await Promise.all([
    supa.from('scores').select('period_id, score'),
    supa.from('org_scores').select('period_id, score'),
    supa.from('sar_periods').select('*').order('starts'),
  ]);
  const err = [scores, oscores, periods].find(r => r.error);
  if (err) throw err.error;
  const byPeriod = {};
  [...scores.data, ...oscores.data].forEach(r => { (byPeriod[r.period_id] ||= []).push(r.score); });
  return periods.data
    .filter(p => byPeriod[p.id]?.length)
    .map(p => ({
      period_id: p.id, label: p.label, locked: !!p.locked_at,
      mean: byPeriod[p.id].reduce((a, b) => a + b, 0) / byPeriod[p.id].length,
    }));
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

// Same as periodMeans but narrowed to one criterion — the trend line on a
// CriterionPage, one row instead of a whole area.
export async function periodMeansForCriterion(scope, unitOrFunctionId, criterionId) {
  const col = scope === 'unit' ? 'unit_id' : 'function_id';
  const table = scope === 'unit' ? 'scores' : 'org_scores';
  const { data, error } = await supa.from(table).select('period_id, score')
    .eq(col, unitOrFunctionId).eq('criterion_id', criterionId);
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
