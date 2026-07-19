import { useEffect, useState } from 'react';
import { loadProjectLinks, addProjectLink, removeProjectLink, confirmProjectLinks } from './data';

// A project's primary home lives on the project row itself — this is for
// tagging any OTHER unit or horizontal it also affects (e.g. a horizontal
// initiative that specifically touches Schools too), so it shows up there
// as well instead of being forced into a single home.
//
// Whether something "also affects" another area is often a judgment call,
// not a fact — so alongside manual tagging, a suggestion can be added
// unconfirmed (confirmed: false, with a note explaining the reasoning) and
// sits in its own review list with a checkbox until a person confirms or
// dismisses it, rather than being silently treated as a real tag.
export default function ProjectLinks({ project, me, data }) {
  const [links, setLinks] = useState([]);
  const [adding, setAdding] = useState(false);
  const [scope, setScope] = useState('unit');
  const [areaId, setAreaId] = useState('');
  const [criterionId, setCriterionId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(new Set());

  const refresh = () => loadProjectLinks(project.id).then(setLinks).catch(e => setError(e.message));
  useEffect(() => { refresh(); }, [project.id]);

  const confirmed = links.filter(l => l.confirmed);
  const pending = links.filter(l => !l.confirmed);
  const toggleChecked = id => setChecked(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const confirmSelected = async () => {
    if (!checked.size) return;
    setBusy(true); setError('');
    try { await confirmProjectLinks([...checked]); setChecked(new Set()); refresh(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const dismissSelected = async () => {
    if (!checked.size) return;
    setBusy(true); setError('');
    try { await Promise.all([...checked].map(removeProjectLink)); setChecked(new Set()); refresh(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };

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
        <h4 style={{ margin: 0 }}>Also affects {confirmed.length > 0 && `(${confirmed.length})`}</h4>
        <button className="btn" onClick={() => setAdding(a => !a)}>{adding ? 'Cancel' : '+ Add area'}</button>
      </div>
      <p className="muted" style={{ fontSize: '.78rem', marginTop: '.2rem' }}>
        Its primary home is above — tag any other unit or horizontal this project also affects, so it shows up
        as a dot there too.
      </p>
      {!confirmed.length && !adding && <p className="muted">Nothing else tagged yet.</p>}
      {confirmed.length > 0 && (
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', marginTop: '.4rem' }}>
          {confirmed.map(l => (
            <span key={l.id} className="fchip active" style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem' }} title={l.note || undefined}>
              {areaName(l)} &gt; {critName(l)}
              <button className="linklike" style={{ color: 'var(--xi)', fontWeight: 800, textDecoration: 'none' }} onClick={() => remove(l.id)} title="Remove">×</button>
            </span>
          ))}
        </div>
      )}

      {pending.length > 0 && (
        <div className="card" style={{ marginTop: '.8rem', background: 'var(--paper)', borderColor: 'var(--g2)' }}>
          <p style={{ fontWeight: 700, fontSize: '.85rem' }}>Suggested — worth reviewing ({pending.length})</p>
          <p className="muted" style={{ fontSize: '.78rem', marginTop: '.1rem' }}>
            Judgment calls, not facts — tick the ones that genuinely hold up and confirm them, or dismiss the rest.
          </p>
          {pending.map(l => (
            <label key={l.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '.5rem', marginTop: '.5rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={checked.has(l.id)} onChange={() => toggleChecked(l.id)} style={{ marginTop: '.2rem' }} />
              <span>
                <b style={{ fontSize: '.84rem' }}>{areaName(l)} &gt; {critName(l)}</b>
                {l.note && <span className="muted" style={{ display: 'block', fontSize: '.78rem', marginTop: '.1rem' }}>{l.note}</span>}
              </span>
            </label>
          ))}
          <div style={{ display: 'flex', gap: '.5rem', marginTop: '.7rem' }}>
            <button className="btn primary" disabled={busy || !checked.size} onClick={confirmSelected}>Confirm selected</button>
            <button className="btn" disabled={busy || !checked.size} onClick={dismissSelected}>Dismiss selected</button>
          </div>
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
