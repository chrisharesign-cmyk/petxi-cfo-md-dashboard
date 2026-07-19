import { useEffect, useState } from 'react';
import { loadRecentActivity, overallTrend, lastQipMeeting } from './data';
import { activityRowInfo, liveActivitySummary, ragMovementsFromRows, daysInStage, RAG_LABEL } from './util';
import { meanGrade } from './matrixdata';
import Sparkline from './Sparkline';

const WINDOWS = [[7, '7 days'], [14, '14 days'], [30, '30 days'], [90, 'the quarter']];
const QIP_MEETING_OVERDUE_DAYS = 14;

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
    .filter(p => !p.archived_at && ['live', 'paused'].includes(p.status) && p.owner && !activeIds.has(p.id))
    .map(p => ({ p, days: daysInStage(p.status_changed_at) }))
    .filter(x => x.days === null || x.days >= STALE_MIN_DAYS)
    .sort((a, b) => (b.days ?? 0) - (a.days ?? 0));
}

function TrendCard() {
  const [trend, setTrend] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { overallTrend().then(setTrend).catch(e => setErr(e.message)); }, []);
  if (err) return null;
  if (!trend) return <div className="card" style={{ marginBottom: '1rem' }}><p className="muted">Loading trend…</p></div>;
  const sorted = [...trend].sort((a, b) => a.period_id.localeCompare(b.period_id));
  const last = sorted[sorted.length - 1];
  const prev = sorted[sorted.length - 2];
  const delta = last && prev ? +(prev.mean - last.mean).toFixed(2) : null; // grade 1=best, so a fall in mean = improvement
  return (
    <div className="card">
      <h4 className="crit-card-h">Overall trend — org-wide mean, by period</h4>
      {sorted.length < 2
        ? <p className="muted">Not enough history yet — this fills in as periods lock.</p>
        : <>
            <Sparkline points={sorted.map(s => ({ mean: s.mean }))} />
            <p className="muted">
              This period: <b style={{ color: `var(--g${meanGrade(last.mean)})` }}>{last.mean.toFixed(2)}</b>
              {prev && (
                delta > 0
                  ? <> — improved {Math.abs(delta).toFixed(2)} vs last period ({prev.label || prev.period_id})</>
                  : delta < 0
                    ? <> — slipped {Math.abs(delta).toFixed(2)} vs last period ({prev.label || prev.period_id})</>
                    : <> — unchanged vs last period ({prev.label || prev.period_id})</>
              )}
            </p>
          </>}
    </div>
  );
}

function QipMeetingCard() {
  const [at, setAt] = useState(undefined); // undefined = loading, null = none yet
  useEffect(() => { lastQipMeeting().then(setAt).catch(() => setAt(null)); }, []);
  if (at === undefined) return null;
  const days = at ? Math.floor((Date.now() - new Date(at)) / 86400000) : null;
  const overdue = days !== null && days >= QIP_MEETING_OVERDUE_DAYS;
  return (
    <div className={`card ${overdue ? 'stale-card' : ''}`} style={{ marginTop: '1rem' }}>
      {at
        ? <p>Last Fleur - QIP meeting: <b>{days}d ago</b> ({new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })})
            {overdue && <span style={{ color: 'var(--g4)' }}> — overdue for a catch-up</span>}</p>
        : <p className="muted">No Fleur - QIP meeting recorded yet — record one from the Meetings tab.</p>}
    </div>
  );
}

export default function ActivityTab({ data, onOpenCase }) {
  const [days, setDays] = useState(7);
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { setRows(null); loadRecentActivity(days).then(setRows).catch(e => setErr(e.message)); }, [days]);

  const { wins, slips } = ragMovementsFromRows(rows || []);

  const feed = (rows || [])
    .map(r => ({ row: r, d: activityRowInfo(r, data) }))
    .filter(x => x.d);
  const stale = rows ? staleOwnedProjects(data, feed) : [];
  const summary = rows ? liveActivitySummary(data, rows) : null;

  const windowLabel = WINDOWS.find(([d]) => d === days)?.[1] || `${days} days`;

  return (
    <>
      <div className="panel-h" style={{ justifyContent: 'space-between', display: 'flex' }}>
        <span><span className="bar" style={{ background: 'var(--g2)' }} />This Week</span>
        <select className="formctl" value={days} onChange={e => setDays(Number(e.target.value))}>
          {WINDOWS.map(([d, l]) => <option key={d} value={d}>Last {l}</option>)}
        </select>
      </div>
      <p className="muted" style={{ marginBottom: '1rem' }}>
        A rollup for anyone who wasn't in the room — what's moved, what's improved, and what actually happened,
        over the last {windowLabel}.
      </p>

      <TrendCard />
      <QipMeetingCard />

      {rows && summary && (
        <div className="card exec-summary" style={{ marginTop: '1rem' }}>
          <b>{summary.moved}/{summary.total}</b> live project{summary.total === 1 ? '' : 's'} moved,{' '}
          <b style={{ color: summary.stalled > 0 ? 'var(--g4)' : undefined }}>{summary.stalled}/{summary.total}</b> stalled,{' '}
          <b style={{ color: summary.notMoved > 0 ? 'var(--g4)' : undefined }}>{summary.notMoved}/{summary.total}</b> not moved, over the last {windowLabel}
          {stale.length > 0 && <> — <b style={{ color: 'var(--g4)' }}>{stale.length} owned project{stale.length === 1 ? '' : 's'} with no visible progress</b></>}.
        </div>
      )}

      <div className="card win-card" style={{ marginTop: '1rem' }}>
        <h4 className="crit-card-h">🎉 Wins {wins.length > 0 && `(${wins.length})`}</h4>
        {!wins.length && <p className="muted" style={{ marginTop: '.5rem' }}>No progress ratings improved this window — set the RAG in a project's case file to track it as it happens.</p>}
        {wins.map(w => (
          <p key={w.id} className="win-row" style={{ marginTop: '.5rem' }}>
            <button className="linklike" onClick={() => onOpenCase(w.id)}>{w.title}</button>
            {' '}— {areaName(w, data)}: <b style={{ color: 'var(--g2)' }}><span className={`rag rag-${w.from}`} /> {RAG_LABEL[w.from]} → <span className={`rag rag-${w.to}`} /> {RAG_LABEL[w.to]}</b>
          </p>
        ))}
      </div>

      {slips.length > 0 && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <h4 className="crit-card-h">⚠ Slipped ({slips.length})</h4>
          {slips.map(w => (
            <p key={w.id} style={{ marginTop: '.5rem' }}>
              <button className="linklike" onClick={() => onOpenCase(w.id)}>{w.title}</button>
              {' '}— {areaName(w, data)}: <b style={{ color: 'var(--g4)' }}><span className={`rag rag-${w.from}`} /> {RAG_LABEL[w.from]} → <span className={`rag rag-${w.to}`} /> {RAG_LABEL[w.to]}</b>
            </p>
          ))}
        </div>
      )}

      {stale.length > 0 && (
        <div className="card stale-card" style={{ marginTop: '1rem' }}>
          <h4 className="crit-card-h">🔇 No visible progress ({stale.length})</h4>
          <p className="muted" style={{ margin: '.35rem 0 .5rem' }}>
            Owned, live or on hold, but no note, status move or re-grade in the last {windowLabel}.
          </p>
          {stale.map(({ p, days }) => (
            <p key={p.id} style={{ marginTop: '.4rem' }}>
              <button className="linklike" onClick={() => onOpenCase(p.id)}>{p.title}</button>
              {' '}— {areaName(p, data)} · owner <b>{p.owner}</b>
              {days !== null && <span className="muted"> · {days}d at this stage</span>}
            </p>
          ))}
        </div>
      )}

      <div className="card" style={{ marginTop: '1rem' }}>
        <h4 className="crit-card-h">Activity, last {windowLabel} {feed.length > 0 && `(${feed.length})`}</h4>
        {err && <p className="muted" style={{ color: 'var(--g4)' }}>{err}</p>}
        {!err && !rows && <p className="muted">Loading…</p>}
        {rows && !feed.length && <p className="muted">Nothing logged in this window yet.</p>}
        {feed.length > 0 && (
          <table className="ptable" style={{ marginTop: '.5rem' }}>
            <thead>
              <tr>
                <th>Date</th><th>Status</th><th>Project</th><th>Primary criteria</th><th>RAG</th>
              </tr>
            </thead>
            <tbody>
              {feed.map(({ row, d }) => (
                <tr key={row.id}>
                  <td className="muted" style={{ fontFamily: 'var(--mono)', fontSize: '.72rem', whiteSpace: 'nowrap' }}>
                    {new Date(row.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td>{d.icon} {d.status}</td>
                  <td>
                    {d.projectId
                      ? <button className="linklike" onClick={() => onOpenCase(d.projectId)}>{d.title}</button>
                      : <span className="muted">{d.title || '—'}</span>}
                  </td>
                  <td>{d.criteria || <span className="muted">—</span>}</td>
                  <td>{d.rag ? <><span className={`rag rag-${d.rag}`} /> {RAG_LABEL[d.rag]}</> : <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
