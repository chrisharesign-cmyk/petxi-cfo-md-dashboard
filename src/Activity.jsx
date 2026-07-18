import { useEffect, useState } from 'react';
import { loadRecentActivity } from './data';
import { describeActivityRow, gradeMovement, daysInStage } from './util';

function areaName(p, data) {
  return p.scope === 'unit'
    ? data.units.find(u => u.id === p.unit_id)?.name
    : data.ofuncs.find(f => f.id === p.function_id)?.name;
}

// A project counts as "touched" this week only for genuine progress
// signals — a note, a status move, or a re-grade — sourced from the same
// filtered feed shown below. Reassigning an owner or nudging a target date
// doesn't count; that's exactly the kind of non-activity worth surfacing.
const STALE_MIN_DAYS = 3;
function staleOwnedProjects(data, feed) {
  const activeIds = new Set();
  feed.forEach(({ row }) => {
    if (row.table_name === 'project_notes' && row.new_row?.project_id) activeIds.add(Number(row.new_row.project_id));
    if (row.table_name === 'projects' && row.record_pk) activeIds.add(Number(row.record_pk));
  });
  return data.projects
    .filter(p => ['live', 'paused'].includes(p.status) && p.owner && !activeIds.has(p.id))
    .map(p => ({ p, days: daysInStage(p.status_changed_at) }))
    .filter(x => x.days === null || x.days >= STALE_MIN_DAYS)
    .sort((a, b) => (b.days ?? 0) - (a.days ?? 0));
}

export default function ActivityTab({ data, onOpenCase }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { loadRecentActivity(7).then(setRows).catch(e => setErr(e.message)); }, []);

  const movements = data.projects
    .map(p => ({ p, m: gradeMovement(p) }))
    .filter(x => x.m);
  const wins = movements.filter(x => x.m.improved);
  const regressions = movements.filter(x => !x.m.improved);

  const feed = (rows || [])
    .map(r => ({ row: r, d: describeActivityRow(r, data) }))
    .filter(x => x.d);
  const stale = rows ? staleOwnedProjects(data, feed) : [];

  return (
    <>
      <div className="panel-h"><span className="bar" style={{ background: 'var(--g2)' }} />This Week</div>
      <p className="muted" style={{ marginBottom: '1rem' }}>
        A rollup for anyone who wasn't in the room — what's moved, what's improved, and what actually happened,
        over the last 7 days.
      </p>

      {rows && (
        <div className="card exec-summary">
          <b>{wins.length}</b> improved, <b>{regressions.length}</b> slipped, <b>{feed.length}</b> update{feed.length === 1 ? '' : 's'} logged
          {stale.length > 0 && <> — <b style={{ color: 'var(--g4)' }}>{stale.length} owned project{stale.length === 1 ? '' : 's'} with no visible progress</b></>}.
        </div>
      )}

      <div className="card win-card">
        <h4>🎉 Wins {wins.length > 0 && `(${wins.length})`}</h4>
        {!wins.length && <p className="muted">No re-grades logged as improved yet — use "Current read" in a project's case file to log progress as it happens.</p>}
        {wins.map(({ p, m }) => (
          <p key={p.id} className="win-row">
            <button className="linklike" onClick={() => onOpenCase(p.id)}>{p.title}</button>
            {' '}— {areaName(p, data)}: <b style={{ color: 'var(--g2)' }}>{m.from} → {m.to}</b>
          </p>
        ))}
      </div>

      {regressions.length > 0 && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <h4>⚠ Slipped ({regressions.length})</h4>
          {regressions.map(({ p, m }) => (
            <p key={p.id}>
              <button className="linklike" onClick={() => onOpenCase(p.id)}>{p.title}</button>
              {' '}— {areaName(p, data)}: <b style={{ color: 'var(--g4)' }}>{m.from} → {m.to}</b>
            </p>
          ))}
        </div>
      )}

      {stale.length > 0 && (
        <div className="card stale-card" style={{ marginTop: '1rem' }}>
          <h4>🔇 No visible progress ({stale.length})</h4>
          <p className="muted" style={{ marginBottom: '.5rem' }}>
            Owned, live or on hold, but no note, status move or re-grade in the last 7 days.
          </p>
          {stale.map(({ p, days }) => (
            <p key={p.id}>
              <button className="linklike" onClick={() => onOpenCase(p.id)}>{p.title}</button>
              {' '}— {areaName(p, data)} · owner <b>{p.owner}</b>
              {days !== null && <span className="muted"> · {days}d at this stage</span>}
            </p>
          ))}
        </div>
      )}

      <div className="card" style={{ marginTop: '1rem' }}>
        <h4>Activity, last 7 days {feed.length > 0 && `(${feed.length})`}</h4>
        {err && <p className="muted" style={{ color: 'var(--g4)' }}>{err}</p>}
        {!err && !rows && <p className="muted">Loading…</p>}
        {rows && !feed.length && <p className="muted">Nothing logged this week yet.</p>}
        {feed.map(({ row, d }) => (
          <div key={row.id} className="activity-row">
            <span className="muted" style={{ fontSize: '.7rem', fontFamily: 'var(--mono)' }}>
              {new Date(row.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </span>
            <span>{d.icon} {d.text}</span>
          </div>
        ))}
      </div>
    </>
  );
}
