// Shared helpers used across the QIP screens.

export const STATUS_LABEL = {
  potential: 'To discuss', queued: 'Queued', live: 'Live',
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

// Real-timescale ordering for the status/pace column — not alphabetical.
// Done, then live work furthest-out to nearest, then not-yet-live, then
// parked, then cancelled. Live projects sharing a pace bucket (e.g. every
// "Long term" project, which can now be scheduled to any specific future
// quarter) are broken up by actual target date, not lumped together.
const STATUS_RANK = {
  completed: 0, 'live:long': 1, 'live:mid': 2, 'live:short': 2, 'live:rapid': 3,
  queued: 4, potential: 5, paused: 6, cancelled: 7,
};
export function statusSortKey(p) {
  const rank = p.status === 'live' ? (STATUS_RANK[`live:${p.pace}`] ?? 3.5) : (STATUS_RANK[p.status] ?? 8);
  return `${String(rank).padStart(2, '0')}-${p.due || '9999-99-99'}`;
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

// Specific future quarters beyond the immediate next one, for scheduling a
// project against e.g. "Jan–Mar 2027" rather than just the "long term" bucket.
export function upcomingQuarters(period, count = 8) {
  const list = [];
  let p = period;
  for (let i = 0; i < count; i++) {
    p = nextPeriod(p);
    list.push(p);
  }
  return list;
}
export function quarterLabel(q) {
  const start = new Date(q.starts + 'T00:00:00'), end = new Date(q.ends + 'T00:00:00');
  const mon = d => d.toLocaleDateString('en-GB', { month: 'short' });
  return `${mon(start)}–${mon(end)} ${end.getFullYear()}`;
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

export function friendlyProjectError(err) {
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

// Leads with a blatant, all-caps project marker — this gets copied into
// Claude in one tab and the answer pasted back into a different project's
// case file in another, so it must be unmistakable which one it's for even
// after several of these prompts have been fired off in the same session.
export function buildProjectPrompt(project, data) {
  const crit = critFor(project, data);
  const graded = project.grade_at_creation != null;
  const desc = graded ? crit?.descriptors?.[project.grade_at_creation - 1] : null;
  const context = graded
    ? `"${areaNameFor(project, data)}" scored ${project.grade_at_creation} on "${crit?.name || project.criterion_id}".\n\n`
    : `This is a standalone improvement project for "${areaNameFor(project, data)}" — "${crit?.name || project.criterion_id}" — not tied to a specific SAR grade.\n\n`;
  return `PROJECT: "${project.title}" (${areaNameFor(project, data)}) — paste the answer back into this project's ` +
    `Plan box in the QIP app when you're done.\n\n` +
    `We run a quarterly quality review (1=best/Mastery, 4=worst/Critical) at PET-Xi Training. ` +
    context +
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
  return `AREA: "${areaName}" — paste the answer back into ${areaName}'s page in the QIP app when you're done.\n\n` +
    `We run a quarterly quality review (1=best/Mastery, 4=worst/Critical) at PET-Xi Training. ` +
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

// progress_rag is an informal on-track/at-risk read a project owner can set
// any time — separate from the locked SAR score, which only moves at the
// start of the next assessment period. R/A/G, no in-between.
export const RAG_LABEL = { G: 'On track', A: 'Some concern', R: 'At risk' };
const RAG_RANK = { G: 0, A: 1, R: 2 }; // 0 = best

// Scans a window of audit_log rows (already loaded for the Activity tab,
// or a project's own feed) for RAG changes, and splits them into
// improved-this-window vs worsened-this-window. A first-time set (no prior
// value) isn't a movement, so it's excluded — "went from nothing to Green"
// isn't a win, it's just someone finally rating it.
export function ragMovementsFromRows(rows) {
  const wins = [], slips = [];
  rows.forEach(row => {
    if (row.table_name !== 'projects' || row.action !== 'UPDATE') return;
    const before = row.old_row || {}, after = row.new_row || {};
    if (!after.progress_rag || !before.progress_rag || after.progress_rag === before.progress_rag) return;
    const entry = { id: after.id, title: after.title, scope: after.scope, unit_id: after.unit_id, function_id: after.function_id, from: before.progress_rag, to: after.progress_rag };
    (RAG_RANK[after.progress_rag] < RAG_RANK[before.progress_rag] ? wins : slips).push(entry);
  });
  return { wins, slips };
}

// Turns a raw audit_log row into structured fields for the Activity table —
// date, status, project, primary criteria, RAG — rather than a single
// sentence, so the tab can render an actual table. Deliberately filters
// hard — routine scoring and minor field edits (owner, target date, blocker
// text) would drown out the handful of things that actually matter in a
// week: new projects, RAG moves, status moves, notes, locks, meetings.
export function activityRowInfo(row, data) {
  const project = (id) => data.projects.find(p => p.id === Number(id));
  const criterionName = (p) => {
    if (!p) return null;
    const c = p.scope === 'unit' ? data.criteria.find(x => x.id === p.criterion_id) : data.ocrit.find(x => x.id === p.criterion_id);
    return c?.name || p.criterion_id || null;
  };

  if (row.table_name === 'project_notes') {
    if (row.action !== 'INSERT' || !row.new_row?.body) return null;
    const p = project(row.new_row.project_id);
    return {
      icon: '📝', status: `Note by ${row.new_row.author}`,
      projectId: p?.id ?? Number(row.new_row.project_id), title: p?.title || `project #${row.new_row.project_id}`,
      criteria: criterionName(p), rag: p?.progress_rag,
    };
  }
  if (row.table_name === 'projects') {
    if (row.action === 'INSERT') {
      return {
        icon: '➕', status: 'New project',
        projectId: row.new_row?.id, title: row.new_row?.title,
        criteria: criterionName(project(row.new_row?.id) || row.new_row), rag: row.new_row?.progress_rag,
      };
    }
    if (row.action !== 'UPDATE') return null;
    const before = row.old_row || {}, after = row.new_row || {};
    const p = project(after.id);
    if (before.progress_rag !== after.progress_rag && after.progress_rag != null) {
      const improved = before.progress_rag && RAG_RANK[after.progress_rag] < RAG_RANK[before.progress_rag];
      const icon = !before.progress_rag ? '🚦' : improved ? '🎉' : '⚠';
      const status = before.progress_rag
        ? `RAG: ${RAG_LABEL[before.progress_rag]} → ${RAG_LABEL[after.progress_rag]}`
        : `RAG set: ${RAG_LABEL[after.progress_rag]}`;
      return { icon, status, projectId: after.id, title: after.title, criteria: criterionName(p || after), rag: after.progress_rag };
    }
    if (before.status !== after.status) {
      return {
        icon: '↪', status: `Moved to ${STATUS_LABEL[after.status] || after.status}${after.pace ? ` (${PACE_LABEL[after.pace]})` : ''}`,
        projectId: after.id, title: after.title, criteria: criterionName(p || after), rag: after.progress_rag ?? p?.progress_rag,
      };
    }
    return null;
  }
  if (row.table_name === 'sar_periods' && row.new_row?.locked_at && row.old_row?.locked_at == null) {
    return { icon: '🔒', status: `SAR locked by ${row.actor_name} (${row.new_row?.label || row.new_row?.id})`, projectId: null, title: null, criteria: null, rag: null };
  }
  if (row.table_name === 'meetings' && row.action === 'UPDATE' && row.new_row?.ended_at && !row.old_row?.ended_at) {
    return { icon: '🎙', status: `Meeting recorded (${(row.new_row?.transcript || []).length} lines captured)`, projectId: null, title: null, criteria: null, rag: null };
  }
  return null;
}

// Rolls this window's activity up against the full live-project count, for
// the "N/M moved" headline. Buckets are mutually exclusive and always sum
// to the live total: stalled (RAG got worse) takes priority over moved
// (touched some other way — a note, a status move, a RAG improvement), and
// anything untouched is not moved.
export function liveActivitySummary(data, rows) {
  const live = data.projects.filter(p => !p.archived_at && p.status === 'live');
  const liveIds = new Set(live.map(p => p.id));
  const touchedIds = new Set();
  rows.forEach(row => {
    if (row.table_name === 'project_notes' && row.new_row?.project_id) touchedIds.add(Number(row.new_row.project_id));
    if (row.table_name === 'projects' && row.record_pk) touchedIds.add(Number(row.record_pk));
  });
  const { slips } = ragMovementsFromRows(rows);
  const stalledIds = new Set(slips.filter(s => liveIds.has(s.id)).map(s => s.id));
  const movedIds = new Set([...touchedIds].filter(id => liveIds.has(id) && !stalledIds.has(id)));
  return {
    total: live.length,
    moved: movedIds.size,
    stalled: stalledIds.size,
    notMoved: live.filter(p => !touchedIds.has(p.id)).length,
  };
}
