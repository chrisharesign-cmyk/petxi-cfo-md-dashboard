import { useEffect, useState } from 'react';
import { loadProjectLinks, addProjectLink, removeProjectLink } from './data';

// A project's primary home lives on the project row itself — this is for
// tagging any OTHER unit or horizontal it also affects (e.g. a horizontal
// initiative that specifically touches Schools too), so it shows up there
// as well instead of being forced into a single home.
export default function ProjectLinks({ project, me, data }) {
  const [links, setLinks] = useState([]);
  const [adding, setAdding] = useState(false);
  const [scope, setScope] = useState('unit');
  const [areaId, setAreaId] = useState('');
  const [criterionId, setCriterionId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = () => loadProjectLinks(project.id).then(setLinks).catch(e => setError(e.message));
  useEffect(() => { refresh(); }, [project.id]);

  const critOptions = scope === 'unit'
    ? data.criteria.filter(c => !c.unit_id || c.unit_id === areaId)
    : data.ocrit;

  const areaName = (l) => l.scope === 'unit'
    ? data.units.find(u => u.id === l.unit_id)?.name
    : data.ofuncs.find(f => f.id === l.function_id)?.name;
  const critName = (l) => l.scope === 'unit'
    ? data.criteria.find(c => c.id === l.criterion_id)?.name
    : data.ocrit.find(c => c.id === l.criterion_id)?.name;

  const add = async () => {
    if (!areaId || !criterionId) { setError('Pick an area and a criterion.'); return; }
    if (scope === project.scope && criterionId === project.criterion_id &&
      areaId === (project.scope === 'unit' ? project.unit_id : project.function_id)) {
      setError("That's already this project's primary area.");
      return;
    }
    setBusy(true); setError('');
    try {
      await addProjectLink(project.id, { scope, unit_id: areaId, function_id: areaId, criterion_id: criterionId }, me);
      setAreaId(''); setCriterionId(''); setAdding(false);
      refresh();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const remove = async (id) => {
    try { await removeProjectLink(id); refresh(); } catch (e) { setError(e.message); }
  };

  return (
    <div style={{ marginTop: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h4 style={{ margin: 0 }}>Also affects {links.length > 0 && `(${links.length})`}</h4>
        <button className="btn" onClick={() => setAdding(a => !a)}>{adding ? 'Cancel' : '+ Add area'}</button>
      </div>
      <p className="muted" style={{ fontSize: '.78rem', marginTop: '.2rem' }}>
        Its primary home is above — tag any other unit or horizontal this project also affects, so it shows up
        as a dot there too.
      </p>
      {!links.length && !adding && <p className="muted">Nothing else tagged yet.</p>}
      {links.length > 0 && (
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', marginTop: '.4rem' }}>
          {links.map(l => (
            <span key={l.id} className="fchip active" style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem' }}>
              {areaName(l)} &gt; {critName(l)}
              <button className="linklike" style={{ color: '#fff' }} onClick={() => remove(l.id)} title="Remove">×</button>
            </span>
          ))}
        </div>
      )}
      {adding && (
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', marginTop: '.6rem', alignItems: 'center' }}>
          <select className="formctl" value={scope} onChange={e => { setScope(e.target.value); setAreaId(''); setCriterionId(''); }}>
            <option value="unit">Business unit</option>
            <option value="org">Org function</option>
          </select>
          <select className="formctl" value={areaId} onChange={e => { setAreaId(e.target.value); setCriterionId(''); }}>
            <option value="">— area —</option>
            {(scope === 'unit' ? data.units : data.ofuncs).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select className="formctl" value={criterionId} onChange={e => setCriterionId(e.target.value)} disabled={!areaId}>
            <option value="">— criterion —</option>
            {critOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button className="btn primary" disabled={busy} onClick={add}>Add</button>
        </div>
      )}
      {error && <p className="muted" style={{ color: 'var(--g4)' }}>{error}</p>}
    </div>
  );
}
