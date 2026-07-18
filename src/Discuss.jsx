import { useState } from 'react';
import { promoteLive, queueProject } from './data';
import { overdueBy, friendlyProjectError, daysInStage } from './util';

const INITIAL_SHOWN = 8;
const AGING_POTENTIAL_DAYS = 14;

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

const SORTS = {
  'Worst grade first': (a, b) => (b.grade_at_creation || 0) - (a.grade_at_creation || 0),
  'Oldest first': (a, b) => new Date(a.created_at) - new Date(b.created_at),
  'Newest first': (a, b) => new Date(b.created_at) - new Date(a.created_at),
};

export default function DiscussTab({ data, me, onRefresh, onOpenCase, onGoToProjects, onGoToMeetings }) {
  const [rowError, setRowError] = useState(null); // { id, msg }
  const [toast, setToast] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [sortKey, setSortKey] = useState('Worst grade first');
  const potentials = data.projects
    .filter(p => p.status === 'potential')
    .sort(SORTS[sortKey]);
  const shown = showAll ? potentials : potentials.slice(0, INITIAL_SHOWN);
  const waiting = data.projects.filter(p => p.status === 'queued');
  const overdue = data.projects.filter(p => p.due && overdueBy(p.due) && ['live', 'paused'].includes(p.status));

  // The default habit is Rapid Fix, one click. Anything else (Short/Mid/
  // Long term) is picked from the case file, which is why the row itself
  // is clickable — this is the fix for "clicking a project shows nothing".
  const tick = async (p, e) => {
    e.stopPropagation();
    try {
      await promoteLive(p.id, 'rapid', data.period); setRowError(null);
      setToast(`"${p.title}" is now live as Rapid Fix — find it any time in Excellence Projects.`);
      onRefresh();
    } catch (e2) { setRowError({ id: p.id, msg: friendlyProjectError(e2, data, p) }); }
  };
  const queueForLater = async (p, e) => {
    e.stopPropagation();
    await queueProject(p.id);
    setToast(`"${p.title}" moved to Excellence Projects, queued — it'll wait there until you promote it to live.`);
    onRefresh();
  };

  return (
    <>
      <p className="muted">
        Recording, past minutes and project-linked meetings have moved to their own{' '}
        {onGoToMeetings ? <button className="linklike" onClick={onGoToMeetings}>Meetings</button> : 'Meetings'} tab.
      </p>

      <div className="panel-h" style={{ marginTop: '1.4rem', justifyContent: 'space-between' }}>
        <span><span className="bar" style={{ background: 'var(--g4)' }} />Items to Discuss — {potentials.length} potential</span>
        <select className="formctl" value={sortKey} onChange={e => setSortKey(e.target.value)}>
          {Object.keys(SORTS).map(k => <option key={k} value={k}>{k}</option>)}
        </select>
      </div>
      <p className="muted" style={{ marginBottom: '.8rem' }}>
        Click a project to open it — that's where the plan lives, and where you can assign an owner or agree a
        different pace (Short, Mid or Long term instead of the Rapid Fix default). <b>Agree — Rapid Fix</b> here is
        the one-click shortcut for the common case; <b>Queue for later</b> holds it without starting it yet. Either way it leaves this
        list and moves to the{' '}
        {onGoToProjects ? <button className="linklike" onClick={onGoToProjects}>Excellence Projects</button> : 'Excellence Projects'} tab, it isn't deleted.
      </p>
      {toast && <div className="card" style={{ marginBottom: '.8rem', borderColor: 'var(--g2)' }}>{toast}</div>}
      <div className="card">
        {!potentials.length && <p className="muted">Nothing waiting on a decision.</p>}
        {shown.map(p => {
          const waiting = daysInStage(p.status_changed_at);
          const aging = waiting !== null && waiting >= AGING_POTENTIAL_DAYS;
          return (
          <div key={p.id} className="discussrow" style={{ cursor: 'pointer' }} onClick={() => onOpenCase(p.id)}>
            <span className="key-dot s4" style={{ width: '1.4rem', height: '1.4rem', fontSize: '.8rem' }}>{p.grade_at_creation}</span>
            <div style={{ flex: 1 }}>
              <b>{p.title}</b><br />
              <span className="muted">{areaName(p, data)} &gt; {critName(p, data)}{p.owner ? ` · owner ${p.owner}` : ''}</span>
              {aging && <span className="overdue"> · ⏳ waiting {waiting}d for a decision</span>}
              {p.suggested_solution && <p className="muted" style={{ marginTop: '.3rem' }}>{p.suggested_solution}</p>}
              {rowError?.id === p.id && <p className="muted" style={{ color: 'var(--g4)' }}>{rowError.msg}</p>}
            </div>
            <div style={{ display: 'flex', gap: '.4rem' }}>
              <button onClick={(e) => tick(p, e)} title="Agree this as-is and start it immediately">Agree — Rapid Fix</button>
              <button onClick={(e) => queueForLater(p, e)} title="Queue it for later, without starting it yet">Queue for later</button>
            </div>
          </div>
          );
        })}
        {potentials.length > INITIAL_SHOWN && (
          <button className="linklike" style={{ marginTop: '.6rem' }} onClick={() => setShowAll(s => !s)}>
            {showAll ? 'Show fewer' : `Show all ${potentials.length}`}
          </button>
        )}
      </div>

      {(waiting.length > 0 || overdue.length > 0) && (
        <div className="card" style={{ marginTop: '1rem' }}>
          {waiting.length > 0 && <p><b>{waiting.length}</b> queued, waiting for a live slot to free up
            {onGoToProjects && <> — <button className="linklike" onClick={onGoToProjects}>view them</button></>}.</p>}
          {overdue.length > 0 && <p><b>{overdue.length}</b> overdue: {overdue.map(p => p.title).join(', ')}</p>}
        </div>
      )}
    </>
  );
}
