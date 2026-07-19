import { useState } from 'react';
import { REVIEWERS } from './supa';
import { addProject, markProjectDiscussed } from './data';
import { STATUS_LABEL, PACE_LABEL, statusBadge, statusSortKey, fmtDate, overdueBy, daysInStage, isOverStageLimit, RAG_LABEL, autoTarget } from './util';
import { OwnerEditor, RagEditor, TargetEditor, StatusMenu } from './ProjectControls';
import EditableText from './EditableText';

// 'potential'/'queued' aren't offered here on purpose — nothing can be
// created in those statuses any more (everything goes straight to live),
// and every existing row in them is already archived, so they'd always be
// empty filters. Only statuses a live project can actually still reach.
const STATUSES = ['paused', 'completed', 'cancelled'];
// "Live" itself never appears as visible text anywhere (every live project
// shows its pace instead — Rapid Fix / Short & mid-term / Long term) — so
// filter on pace here too, rather than on a "Live" label nothing displays.
const PACES = [
  { key: 'pace:rapid', label: 'Rapid Fix', test: p => p.status === 'live' && p.pace === 'rapid' },
  { key: 'pace:shortmid', label: PACE_LABEL.short, test: p => p.status === 'live' && ['short', 'mid'].includes(p.pace) },
  { key: 'pace:long', label: 'Long term', test: p => p.status === 'live' && p.pace === 'long' },
];

const COLUMNS = [
  { key: 'title', label: 'Project' },
  { key: 'area', label: 'Area' },
  { key: 'owner', label: 'Owner' },
  { key: 'status', label: 'Status' },
  { key: 'sar', label: 'SAR' },
  { key: 'current', label: 'Progress' },
  { key: 'stage', label: 'At stage' },
  { key: 'target', label: 'Target' },
  { key: 'blocker', label: 'Blocker' },
  { key: 'created', label: 'Added' },
  { key: 'updated', label: 'Last edited' },
];
const RAG_RANK = { G: 0, A: 1, R: 2 };
function sortValue(p, data, key) {
  switch (key) {
    case 'title': return p.title?.toLowerCase() || '';
    case 'area': return `${areaName(p, data)} ${critName(p, data)}`.toLowerCase();
    case 'owner': return p.owner?.toLowerCase() || '￿'; // unowned sorts last
    case 'status': return statusSortKey(p); // real timescale, not alphabetical
    case 'sar': return p.grade_at_creation ?? 99;
    case 'current': return p.progress_rag ? RAG_RANK[p.progress_rag] : 99;
    case 'stage': return daysInStage(p.status_changed_at) ?? -1;
    case 'target': return p.due || '9999-99-99';
    case 'blocker': return p.blocked_by?.toLowerCase() || '';
    case 'created': return p.created_at || '';
    case 'updated': return p.updated_at || '';
    default: return '';
  }
}

function areaName(p, data) {
  return p.scope === 'unit'
    ? data.units.find(u => u.id === p.unit_id)?.name
    : data.ofuncs.find(f => f.id === p.function_id)?.name;
}
function critName(p, data) {
  return p.scope === 'unit'
    ? data.criteria.find(c => c.id === p.criterion_id)?.name
    : data.ocrit.find(c => c.id === p.criterion_id)?.name;
}

export default function ProjectsTab({ data, me, onRefresh, onOpenCase }) {
  const [filters, setFilters] = useState(new Set());
  const [showAdd, setShowAdd] = useState(false);
  const [sort, setSort] = useState({ key: 'stage', dir: 'desc' });
  const toggle = f => setFilters(s => { const n = new Set(s); n.has(f) ? n.delete(f) : n.add(f); return n; });
  const toggleSort = key => setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });

  const periodStart = data.period ? new Date(data.period.starts) : null;
  const activeCount = data.projects.filter(p => !p.archived_at).length;
  const rows = data.projects.filter(p => {
    if (filters.has('Archived')) return !!p.archived_at;
    if (p.archived_at) return false;
    if (!filters.size) return true;
    for (const f of filters) {
      if (STATUSES.includes(f) && p.status === f) return true;
      const pace = PACES.find(pc => pc.key === f);
      if (pace && pace.test(p)) return true;
      if (f === 'Overdue' && p.due && overdueBy(p.due) && !['completed', 'cancelled'].includes(p.status)) return true;
      if (f === 'New this period' && periodStart && new Date(p.created_at) >= periodStart) return true;
      if (f === 'To be discussed' && !p.discussed_at) return true;
      if (f === 'Mine' && p.owner === me) return true;
      if (f === 'On track' && p.progress_rag === 'G') return true;
      if (f === 'Some concern' && p.progress_rag === 'A') return true;
      if (f === 'At risk' && p.progress_rag === 'R') return true;
    }
    return false;
  }).sort((a, b) => {
    const av = sortValue(a, data, sort.key), bv = sortValue(b, data, sort.key);
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sort.dir === 'asc' ? cmp : -cmp;
  });

  return (
    <>
      <div className="panel-h" style={{ justifyContent: 'space-between', display: 'flex' }}>
        <span><span className="bar" style={{ background: 'var(--g1)' }} />Excellence Projects List — {activeCount} projects</span>
        <button onClick={() => setShowAdd(s => !s)}>{showAdd ? 'Cancel' : '+ Add project'}</button>
      </div>
      <p className="muted" style={{ marginBottom: '.6rem' }}>
        Owner, Status, Progress, Target and Blocker are all editable right here in the table. Click the project name,
        area or "at stage" to open the full case file with notes and history. Click a column header to sort.
      </p>

      <div className="fchips">
        {STATUSES.map(f => (
          <button key={f} className={`fchip ${filters.has(f) ? 'active' : ''}`} onClick={() => toggle(f)}>
            {STATUS_LABEL[f]}
          </button>
        ))}
        {PACES.map(pc => (
          <button key={pc.key} className={`fchip ${filters.has(pc.key) ? 'active' : ''}`} onClick={() => toggle(pc.key)}>
            {pc.label}
          </button>
        ))}
        {['Overdue', 'New this period', 'To be discussed', 'Mine', 'On track', 'Some concern', 'At risk', 'Archived'].map(f => (
          <button key={f} className={`fchip ${filters.has(f) ? 'active' : ''}`} onClick={() => toggle(f)}>
            {f}
          </button>
        ))}
      </div>

      {showAdd && <AddProjectForm data={data} me={me} onDone={() => { setShowAdd(false); onRefresh(); }} />}

      <div className="card">
        <table className="ptable">
          <thead>
            <tr>
              {COLUMNS.map(c => (
                <th key={c.key} className="sortable" onClick={() => toggleSort(c.key)}>
                  {c.label}
                  {sort.key === c.key && <span className="sortarrow">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(p => {
              const isNew = periodStart && new Date(p.created_at) >= periodStart;
              const overdue = p.due && overdueBy(p.due) && !['completed', 'cancelled'].includes(p.status);
              const badge = statusBadge(p);
              const days = daysInStage(p.status_changed_at);
              const overLimit = isOverStageLimit(p, days);
              const showDays = days !== null && !['completed', 'cancelled'].includes(p.status);
              return (
                <tr key={p.id}>
                  <td onClick={() => onOpenCase(p.id)} style={{ cursor: 'pointer' }}>{p.title}{isNew && <span className="newtag">NEW</span>}</td>
                  <td onClick={() => onOpenCase(p.id)} style={{ cursor: 'pointer' }}>{areaName(p, data)} &gt; {critName(p, data)}</td>
                  <td><OwnerEditor project={p} data={data} onSaved={onRefresh} /></td>
                  <td>
                    <span className={`st ${badge.cls}`}>{badge.label}</span>
                    {!p.discussed_at && (
                      <button className="linklike" style={{ marginLeft: '.4rem', fontSize: '.68rem' }}
                        title="Not yet raised at a meeting — click to mark discussed"
                        onClick={() => markProjectDiscussed(p.id).then(onRefresh)}>to discuss</button>
                    )}
                    <StatusMenu project={p} data={data} onSaved={onRefresh} />
                  </td>
                  <td onClick={() => onOpenCase(p.id)} style={{ cursor: 'pointer' }}>
                    {p.grade_at_creation ? <span className={`chip s${p.grade_at_creation}`} style={{ position: 'static' }}>{p.grade_at_creation}</span> : '—'}
                  </td>
                  <td><RagEditor project={p} onSaved={onRefresh} /></td>
                  <td onClick={() => onOpenCase(p.id)} style={{ cursor: 'pointer' }}>
                    {showDays ? <>{days}d{overLimit && <span className="overdue"> ⚠ over 14d limit</span>}</> : '—'}
                  </td>
                  <td>
                    <TargetEditor project={p} onSaved={onRefresh} />
                    {overdue && <span className="overdue"> {overdueBy(p.due)}d overdue</span>}
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <EditableText table="projects" id={p.id} field="blocked_by" value={p.blocked_by} placeholder="—" onSaved={onRefresh} />
                  </td>
                  <td onClick={() => onOpenCase(p.id)} style={{ cursor: 'pointer' }}>{fmtDate(p.created_at?.slice(0, 10))}</td>
                  <td onClick={() => onOpenCase(p.id)} style={{ cursor: 'pointer' }}>{fmtDate(p.updated_at?.slice(0, 10))}</td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={12} className="muted">No projects match this filter.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

// Goes straight to live — no more discuss/potential holding stage. Owner
// and pace (and so a date) are both required at creation, same rule as
// adding a project from a criterion's own page.
function AddProjectForm({ data, me, onDone }) {
  const [scope, setScope] = useState('unit');
  const [areaId, setAreaId] = useState('');
  const [criterionId, setCriterionId] = useState('');
  const [title, setTitle] = useState('');
  const [pace, setPace] = useState('rapid');
  const [owner, setOwner] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const known = [...new Set([...REVIEWERS.map(r => r.name), ...data.projects.map(p => p.owner).filter(Boolean)])];

  const critOptions = scope === 'unit'
    ? data.criteria.filter(c => !c.unit_id || c.unit_id === areaId)
    : data.ocrit;

  const submit = async e => {
    e.preventDefault();
    if (!areaId || !criterionId || !title.trim() || !owner.trim()) {
      setError('Area, criterion, title and owner are all required.'); return;
    }
    setBusy(true); setError('');
    try {
      const scoreRows = scope === 'unit' ? data.scores : data.oscores;
      const relevant = scoreRows.filter(s => s.criterion_id === criterionId &&
        (scope === 'unit' ? s.unit_id === areaId : s.function_id === areaId));
      const grade = relevant.length ? Math.max(...relevant.map(s => s.score)) : null;
      await addProject({
        title: title.trim(), scope,
        unit_id: scope === 'unit' ? areaId : null,
        function_id: scope === 'org' ? areaId : null,
        criterion_id: criterionId,
        status: 'live', pace, owner: owner.trim(),
        due: autoTarget(pace, data.period), grade_at_creation: grade,
      });
      onDone();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <form className="card" onSubmit={submit} style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', marginBottom: '.6rem' }}>
        <select value={scope} onChange={e => { setScope(e.target.value); setAreaId(''); setCriterionId(''); }}>
          <option value="unit">Business unit</option>
          <option value="org">Org function</option>
        </select>
        <select value={areaId} onChange={e => { setAreaId(e.target.value); setCriterionId(''); }} required>
          <option value="">— area —</option>
          {(scope === 'unit' ? data.units : data.ofuncs).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select value={criterionId} onChange={e => setCriterionId(e.target.value)} required disabled={!areaId}>
          <option value="">— criterion —</option>
          {critOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <input placeholder="Project title" value={title} onChange={e => setTitle(e.target.value)}
        style={{ width: '100%', marginBottom: '.6rem', padding: '.4rem' }} required />
      <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', marginBottom: '.6rem' }}>
        <select value={pace} onChange={e => setPace(e.target.value)}>
          {['rapid', 'short', 'mid', 'long'].map(p => <option key={p} value={p}>{PACE_LABEL[p]}</option>)}
        </select>
        <input list="add-project-owners" placeholder="owner (required)" value={owner} onChange={e => setOwner(e.target.value)} />
        <datalist id="add-project-owners">{known.map(n => <option key={n} value={n} />)}</datalist>
      </div>
      {error && <p className="muted" style={{ color: 'var(--g4)' }}>{error}</p>}
      <button disabled={busy}>Add — goes live immediately</button>
    </form>
  );
}
