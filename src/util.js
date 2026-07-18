// Shared helpers used across the QIP screens.

export const STATUS_LABEL = {
  potential: 'Potential', queued: 'Queued', live: 'Live',
  paused: 'Paused', completed: 'Completed', cancelled: 'Cancelled',
};
export const STATUS_CLASS = {
  potential: 'st-embed', queued: 'st-hold', live: 'st-rapid',
  paused: 'st-hold', completed: 'st-done', cancelled: 'st-embed',
};

// §5.9 — target dates auto-fill from status at creation, editable after.
// rapid/live-from-a-4 = coming Friday; short = +1 month; mid = 31 Aug; long = 31 Dec.
export function autoTarget(kind, from = new Date()) {
  const d = new Date(from);
  if (kind === 'rapid') {
    const day = d.getDay(); // 0 Sun..6 Sat, Friday=5
    let add = (5 - day + 7) % 7;
    if (add === 0) add = 7; // today is Friday or later in the week -> next Friday
    d.setDate(d.getDate() + add);
    return d.toISOString().slice(0, 10);
  }
  if (kind === 'short') { d.setMonth(d.getMonth() + 1); return d.toISOString().slice(0, 10); }
  if (kind === 'mid') return `${d.getFullYear()}-08-31`;
  if (kind === 'long') return `${d.getFullYear()}-12-31`;
  return null;
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
