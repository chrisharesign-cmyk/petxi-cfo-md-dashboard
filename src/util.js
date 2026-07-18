// Shared helpers used across the QIP screens.

export const STATUS_LABEL = {
  potential: 'Potential', queued: 'Queued', live: 'Live',
  paused: 'On Hold', completed: 'Completed', cancelled: 'Cancelled',
};
export const STATUS_CLASS = {
  potential: 'st-embed', queued: 'st-hold', live: 'st-rapid',
  paused: 'st-hold', completed: 'st-done', cancelled: 'st-embed',
};

// Pace is chosen once, at the moment a project is agreed and goes live —
// it drives both the badge shown in Excellence Projects and the target date.
export const PACE_LABEL = { rapid: 'Rapid Fix', short: 'Short & mid-term', mid: 'Short & mid-term', long: 'Long term' };
export const PACE_CLASS = { rapid: 'st-rapid', short: 'st-fix', mid: 'st-fix', long: 'st-embed' };
export const PACE_DESC = {
  rapid: 'Immediate — what can be done right away', short: 'Two weeks out',
  mid: 'By the end of this SAR period', long: 'By the end of the next SAR period',
};

// The badge shown in Excellence Projects: pace for live projects, plain
// status label for everything else (queued/paused/completed/...).
export function statusBadge(p) {
  if (p.status === 'live' && p.pace) return { label: PACE_LABEL[p.pace], cls: PACE_CLASS[p.pace] };
  return { label: STATUS_LABEL[p.status], cls: STATUS_CLASS[p.status] };
}

// Pace target dates. rapid = coming Friday; short = +2 weeks;
// mid = end of this SAR period; long = end of the next SAR period.
export function autoTarget(pace, period, from = new Date()) {
  const d = new Date(from);
  if (pace === 'rapid') {
    const day = d.getDay(); // 0 Sun..6 Sat, Friday=5
    let add = (5 - day + 7) % 7;
    if (add === 0) add = 7; // today is Friday or later in the week -> next Friday
    d.setDate(d.getDate() + add);
    return d.toISOString().slice(0, 10);
  }
  if (pace === 'short') { d.setDate(d.getDate() + 14); return d.toISOString().slice(0, 10); }
  if (pace === 'mid') return period?.ends || null;
  if (pace === 'long') return period ? nextPeriod(period).ends : null;
  return null;
}

// Days since a project entered its current status/pace. Rapid Fix items
// past 14 days get flagged — everything else has no ceiling (yet).
export function daysInStage(statusChangedAt) {
  if (!statusChangedAt) return null;
  return Math.floor((Date.now() - new Date(statusChangedAt)) / 86400000);
}

// Next fiscal quarter after `p` (Oct-Dec Q1, Jan-Mar Q2, Apr-Jun Q3, Jul-Sep Q4).
export function nextPeriod(p) {
  const start = new Date(p.ends + 'T00:00:00'); start.setDate(start.getDate() + 1);
  const end = new Date(start); end.setMonth(end.getMonth() + 3); end.setDate(end.getDate() - 1);
  const m = start.getMonth();
  let q, label, fy;
  if (m === 9) { q = 1; label = 'Q1 · October – December'; fy = start.getFullYear() + 1; }
  else if (m === 0) { q = 2; label = 'Q2 · January – March'; fy = start.getFullYear(); }
  else if (m === 3) { q = 3; label = 'Q3 · April – June'; fy = start.getFullYear(); }
  else { q = 4; label = 'Q4 · July – September'; fy = start.getFullYear(); }
  return { id: `FY${String(fy).slice(-2)}Q${q}`, label, starts: start.toISOString().slice(0, 10), ends: end.toISOString().slice(0, 10) };
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function overdueBy(iso) {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso + 'T00:00:00')) / 86400000);
  return days > 0 ? days : null;
}

// §4.3 — promoting a second live project on a cell-key must fail gracefully,
// naming the project that's already live there.
export function friendlyProjectError(err, data, project) {
  if (err?.message?.includes('projects_one_live_per_cell')) {
    const other = data.projects.find(p => p.status === 'live' && p.scope === project.scope &&
      p.criterion_id === project.criterion_id &&
      (project.scope === 'unit' ? p.unit_id === project.unit_id : p.function_id === project.function_id));
    return `${other?.title || 'Another project'} is already live here — pause or complete it first.`;
  }
  return err?.message || String(err);
}

// No live Claude API in this app (would need a server-side key) — instead,
// build a good copy-paste prompt so a real conversation can happen manually.
function critFor(project, data) {
  return project.scope === 'unit'
    ? data.criteria.find(c => c.id === project.criterion_id)
    : data.ocrit.find(c => c.id === project.criterion_id);
}
function areaNameFor(project, data) {
  return project.scope === 'unit'
    ? data.units.find(u => u.id === project.unit_id)?.name
    : data.ofuncs.find(f => f.id === project.function_id)?.name;
}

export function buildProjectPrompt(project, data) {
  const crit = critFor(project, data);
  const desc = crit?.descriptors?.[(project.grade_at_creation || 4) - 1];
  return `We run a quarterly quality review (1=best/Mastery, 4=worst/Critical) at PET-Xi Training. ` +
    `"${areaNameFor(project, data)}" scored ${project.grade_at_creation} on "${crit?.name || project.criterion_id}".\n\n` +
    (desc ? `What a ${project.grade_at_creation} looks like here: ${desc}\n\n` : '') +
    (project.suggested_solution ? `Draft plan so far: ${project.suggested_solution}\n\n` : '') +
    `Propose a concrete, practical plan to fix this — who should own it, the first 2-3 actions, and whether it's ` +
    `a quick fix or needs a longer-term plan. Keep it to a few short paragraphs, no fluff.`;
}

export function buildAreaPrompt(scope, id, data) {
  const areaName = scope === 'unit' ? data.units.find(u => u.id === id)?.name : data.ofuncs.find(f => f.id === id)?.name;
  const criteria = scope === 'unit' ? data.criteria.filter(c => !c.unit_id || c.unit_id === id) : data.ocrit;
  const scoreRows = scope === 'unit' ? data.scores : data.oscores;
  const bad = criteria.map(c => {
    const rows = scoreRows.filter(s => s.criterion_id === c.id && (scope === 'unit' ? s.unit_id === id : s.function_id === id));
    const worst = rows.length ? Math.max(...rows.map(r => r.score)) : null;
    return worst >= 3 ? { name: c.name, grade: worst, desc: c.descriptors?.[worst - 1] } : null;
  }).filter(Boolean);
  if (!bad.length) return `"${areaName}" has no criteria scoring 3 or 4 this period — nothing urgent to explore.`;
  return `We run a quarterly quality review (1=best/Mastery, 4=worst/Critical) at PET-Xi Training. ` +
    `"${areaName}" has ${bad.length} criteria scoring 3 or 4 this period:\n\n` +
    bad.map(b => `- ${b.name}: ${b.grade}${b.desc ? ` — ${b.desc}` : ''}`).join('\n') +
    `\n\nLooking at these together, propose a holistic plan for "${areaName}" — likely root cause connecting them, ` +
    `who should own fixing it, and the first few concrete actions. Keep it to a few short paragraphs, no fluff.`;
}

// Plain-English rendering of an audit_log row's old_row/new_row diff.
export function describeChange(row) {
  if (row.action === 'INSERT') return `created`;
  if (row.action === 'DELETE') return `deleted`;
  const before = row.old_row || {}, after = row.new_row || {};
  const changed = Object.keys(after).filter(k =>
    k !== 'updated_at' && JSON.stringify(after[k]) !== JSON.stringify(before[k]));
  if (!changed.length) return 'updated';
  return changed.map(k => `${k}: "${before[k] ?? '—'}" → "${after[k] ?? '—'}"`).join('; ');
}
