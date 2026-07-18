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

// Days since a project entered its current status/pace.
export function daysInStage(statusChangedAt) {
  if (!statusChangedAt) return null;
  return Math.floor((Date.now() - new Date(statusChangedAt)) / 86400000);
}

// Rapid Fix (immediate) and Short-term (whose own target is 14 days out)
// both get flagged past 14 days at the same stage — Mid/Long have no
// ceiling since their whole point is a longer horizon.
export function isOverStageLimit(project, days) {
  return project.status === 'live' && ['rapid', 'short'].includes(project.pace) && days > 14;
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

// Kept deliberately terse and rigidly formatted — this gets pasted straight
// into a planning doc, so no preamble, no hedging, no essay.
const ANSWER_FORMAT = `Answer in EXACTLY this format and nothing else — no introduction, no caveats, no extra paragraphs:

(1) Owner: [a name and their likely role]

(2) First actions:
a - [one short, concrete sentence]
b - [one short, concrete sentence]
c - [one short, concrete sentence — omit if only 2 actions are genuinely needed]

Each action line is ONE sentence. No headings, no bold text, no restating the problem.`;

export function buildProjectPrompt(project, data) {
  const crit = critFor(project, data);
  const desc = crit?.descriptors?.[(project.grade_at_creation || 4) - 1];
  return `We run a quarterly quality review (1=best/Mastery, 4=worst/Critical) at PET-Xi Training. ` +
    `"${areaNameFor(project, data)}" scored ${project.grade_at_creation} on "${crit?.name || project.criterion_id}".\n\n` +
    (desc ? `What a ${project.grade_at_creation} looks like here: ${desc}\n\n` : '') +
    (project.suggested_solution ? `Draft plan so far: ${project.suggested_solution}\n\n` : '') +
    ANSWER_FORMAT;
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
    `\n\nLooking at these together, treat it as one connected problem for "${areaName}", not ${bad.length} separate ones.\n\n` +
    ANSWER_FORMAT;
}

// Plain-English rendering of an audit_log row's old_row/new_row diff.
// A few columns are bookkeeping, not something worth showing as "changed":
// updated_at/status_changed_at are redundant with the status change itself,
// and suggested_solution's own edits are already shown via the Plan field.
const NOISY_FIELDS = new Set(['updated_at', 'status_changed_at', 'suggested_solution']);
export function describeChange(row) {
  if (row.action === 'INSERT') return `created`;
  if (row.action === 'DELETE') return `deleted`;
  const before = row.old_row || {}, after = row.new_row || {};
  const changed = Object.keys(after).filter(k =>
    !NOISY_FIELDS.has(k) && JSON.stringify(after[k]) !== JSON.stringify(before[k]));
  if (!changed.length) return null; // nothing worth showing — caller should skip this row
  return changed.map(k => `${k}: "${before[k] ?? '—'}" → "${after[k] ?? '—'}"`).join('; ');
}
