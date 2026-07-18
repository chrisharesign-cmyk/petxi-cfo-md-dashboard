import { useState } from 'react';
import { addProject } from './data';
import { STATUS_LABEL, PACE_LABEL, statusBadge, statusSortKey, fmtDate, overdueBy, daysInStage, isOverStageLimit, gradeMovement } from './util';
import { OwnerEditor, ImpactEditor, TargetEditor, StatusMenu } from './ProjectControls';
import EditableText from './EditableText';

const RAG = { G: '#97D700', A: '#E8A317', R: '#D0342C' };
// Not-yet-live / no-longer-open statuses — filterable directly by status.
const STATUSES = ['potential', 'queued', 'paused', 'completed', 'cancelled'];
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
  { key: 'current', label: 'Current read' },
  { key: 'impact', label: 'Impact' },
  { key: 'stage', label: 'At stage' },
  { key: 'target', label: 'Target' },
  { key: 'blocker', label: 'Blocker' },
  { key: 'created', label: 'Added' },
  { key: 'updated', label: 'Last edited' },
];
const IMPACT_RANK = { G: 0, A: 1, R: 2 };
function sortValue(p, data, key) {
  switch (key) {
    case 'title': return p.title?.toLowerCase() || '';
    case 'area': return `${areaName(p, data)} ${critName(p, data)}`.toLowerCase();
    case 'owner': return p.owner?.toLowerCase() || '￿'; // unowned sorts last
    case 'status': return statusSortKey(p); // real timescale, not alphabetical
    case 'sar': return p.grade_at_creation ?? 99;
    case 'current': return p.current_grade ?? p.grade_at_creation ?? 99;
    case 'impact': return p.impact ? IMPACT_RANK[p.impact] : 99;
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
  const rows = data.projects.filter(p => {
    if (!filters.size) return true;
    for (const f of filters) {
      if (STATUSES.includes(f) && p.status === f) return true;
      const pace = PACES.find(pc => pc.key === f);
      if (pace && pace.test(p)) return true;
      if (f === 'Overdue' && p.due && overdueBy(p.due) && !['completed', 'cancelled'].includes(p.status)) return true;
      if (f === 'New this period' && periodStart && new Date(p.created_at) >= periodStart) return true;
      if (f === 'Mine' && p.owner === me) return true;
      const m = gradeMovement(p);
      if (f === 'Improved' && m?.improved) return true;
      if (f === 'Slipped' && m && !m.improved) return true;
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
        <span><span className="bar" style={{ background: 'var(--g1)' }} />Excellence Projects List — {data.projects.length} projects</span>
        <button onClick={() => setShowAdd(s => !s)}>{showAdd ? 'Cancel' : '+ Add project'}</button>
      </div>
      <p className="muted" style={{ marginBottom: '.6rem' }}>
        Owner, Status, Impact, Target and Blocker are all editable right here in the table. Click the project name,
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
        {['Overdue', 'New this period', 'Mine', 'Improved', 'Slipped'].map(f => (
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
                    <StatusMenu project={p} data={data} onSaved={onRefresh} />
                  </td>
                  <td onClick={() => onOpenCase(p.id)} style={{ cursor: 'pointer' }}>
                    {p.grade_at_creation ? <span className={`chip s${p.grade_at_creation}`} style={{ position: 'static' }}>{p.grade_at_creation}</span> : '—'}
                  </td>
                  <td onClick={() => onOpenCase(p.id)} style={{ cursor: 'pointer' }}>
                    {p.current_grade
                      ? <span className={`chip s${p.current_grade}`} style={{ position: 'static' }}>{p.current_grade}</span>
                      : <span className="muted">same</span>}
                  </td>
                  <td><ImpactEditor project={p} onSaved={onRefresh} /></td>
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

function AddProjectForm({ data, me, onDone }) {
  const [scope, setScope] = useState('unit');
  const [areaId, setAreaId] = useState('');
  const [criterionId, setCriterionId] = useState('');
  const [title, setTitle] = useState('');
  const [impact, setImpact] = useState('A');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const critOptions = scope === 'unit'
    ? data.criteria.filter(c => !c.unit_id || c.unit_id === areaId)
    : data.ocrit;

  const submit = async e => {
    e.preventDefault();
    if (!areaId || !criterionId || !title) { setError('Area, criterion and title are required.'); return; }
    setBusy(true); setError('');
    try {
      // Every project starts life in Items to Discuss, manual or spooled —
      // owner, pace and target all get decided there, not at creation.
      await addProject({
        title, scope,
        unit_id: scope === 'unit' ? areaId : null,
        function_id: scope === 'org' ? areaId : null,
        criterion_id: criterionId,
        status: 'potential',
        impact,
        suggested_solution: 'Claude integration coming soon — draft the starting plan here.',
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
      <select value={impact} onChange={e => setImpact(e.target.value)} style={{ marginBottom: '.6rem' }}>
        <option value="G">Impact: high (G)</option>
        <option value="A">Impact: medium (A)</option>
        <option value="R">Impact: low (R)</option>
      </select>
      {error && <p className="muted" style={{ color: 'var(--g4)' }}>{error}</p>}
      <button disabled={busy}>Add to Items to Discuss</button>
    </form>
  );
}
