import { useState } from 'react';
import { addProject } from './data';
import { STATUS_LABEL, statusBadge, fmtDate, overdueBy, daysInStage } from './util';

const RAG = { G: '#97D700', A: '#E8A317', R: '#D0342C' };
const STATUSES = ['potential', 'queued', 'live', 'paused', 'completed', 'cancelled'];

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
  const toggle = f => setFilters(s => { const n = new Set(s); n.has(f) ? n.delete(f) : n.add(f); return n; });

  const periodStart = data.period ? new Date(data.period.starts) : null;
  const rows = data.projects.filter(p => {
    if (!filters.size) return true;
    for (const f of filters) {
      if (STATUSES.includes(f) && p.status === f) return true;
      if (f === 'Overdue' && p.due && overdueBy(p.due) && !['completed', 'cancelled'].includes(p.status)) return true;
      if (f === 'New this period' && periodStart && new Date(p.created_at) >= periodStart) return true;
    }
    return false;
  });

  return (
    <>
      <div className="panel-h" style={{ justifyContent: 'space-between', display: 'flex' }}>
        <span><span className="bar" style={{ background: 'var(--g1)' }} />Excellence Projects List — {data.projects.length} projects</span>
        <button onClick={() => setShowAdd(s => !s)}>{showAdd ? 'Cancel' : '+ Add project'}</button>
      </div>
      <p className="muted" style={{ marginBottom: '.6rem' }}>Click any row to open it — pause, complete, cancel, add notes, or change its target date.</p>

      <div className="fchips">
        {[...STATUSES, 'Overdue', 'New this period'].map(f => (
          <button key={f} className={`fchip ${filters.has(f) ? 'active' : ''}`} onClick={() => toggle(f)}>
            {STATUS_LABEL[f] || f}
          </button>
        ))}
      </div>

      {showAdd && <AddProjectForm data={data} me={me} onDone={() => { setShowAdd(false); onRefresh(); }} />}

      <div className="card">
        <table className="ptable">
          <thead>
            <tr>
              <th>Project</th><th>Area</th><th>Owner</th><th>Status</th><th>Impact</th>
              <th>At stage</th><th>Target</th><th>Blocker</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(p => {
              const isNew = periodStart && new Date(p.created_at) >= periodStart;
              const overdue = p.due && overdueBy(p.due) && !['completed', 'cancelled'].includes(p.status);
              const badge = statusBadge(p);
              const days = daysInStage(p.status_changed_at);
              const overLimit = p.status === 'live' && p.pace === 'rapid' && days > 14;
              const showDays = days !== null && !['completed', 'cancelled'].includes(p.status);
              return (
                <tr key={p.id} onClick={() => onOpenCase(p.id)} style={{ cursor: 'pointer' }}>
                  <td>{p.title}{isNew && <span className="newtag">NEW</span>}</td>
                  <td>{areaName(p, data)} &gt; {critName(p, data)}</td>
                  <td>{p.owner || '—'}</td>
                  <td><span className={`st ${badge.cls}`}>{badge.label}</span></td>
                  <td>{p.impact ? <span className="rag" style={{ background: RAG[p.impact] }} title={p.impact} /> : '—'}</td>
                  <td>{showDays ? <>{days}d{overLimit && <span className="overdue"> ⚠ over 14d limit</span>}</> : '—'}</td>
                  <td>{fmtDate(p.due)}{overdue && <span className="overdue"> {overdueBy(p.due)}d overdue</span>}</td>
                  <td>{p.blocked_by || '—'}</td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={8} className="muted">No projects match this filter.</td></tr>}
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
