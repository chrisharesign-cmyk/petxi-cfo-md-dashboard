import { useEffect, useState } from 'react';
import { loadRecentActivity, overallTrend, lastQipMeeting } from './data';
import { activityRowInfo, liveActivitySummary, ragMovementsFromRows, daysInStage, RAG_LABEL } from './util';
import { meanGrade } from './matrixdata';
import Sparkline from './Sparkline';

const WINDOWS = [[7, '7 days'], [14, '14 days'], [30, '30 days'], [90, 'the quarter']];
const QIP_MEETING_OVERDUE_DAYS = 14;
// Every icon activityRowInfo can hand back, in a fixed display order — the
// breakdown chips only show the ones actually present in the window.
const ACTIVITY_TYPES = [
  ['📝', 'note'], ['↪', 'status move'], ['🎉', 'RAG improved'], ['⚠', 'RAG worsened'],
  ['🚦', 'RAG set'], ['➕', 'new project'], ['🔒', 'SAR lock'], ['🎙', 'meeting recorded'],
];

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
  const sorted = trend ? [...trend].sort((a, b) => a.period_id.localeCompare(b.period_id)) : [];
  const last = sorted[sorted.length - 1];
  const prev = sorted[sorted.length - 2];
  const delta = last && prev ? +(prev.mean - last.mean).toFixed(2) : null; // grade 1=best, so a fall in mean = improvement
  return (
    <div className="card kpi-tile">
      <span className="kpi-label">Overall trend, by period</span>
      {!trend
        ? <p className="muted">Loading…</p>
        : sorted.length < 2
          ? <p className="muted">Not enough history yet — this fills in as periods lock.</p>
          : <>
              <span className="kpi-value" style={{ color: `var(--g${meanGrade(last.mean)})` }}>{last.mean.toFixed(2)}</span>
              <div style={{ marginTop: '.5rem' }}><Sparkline points={sorted.map(s => ({ mean: s.mean }))} /></div>
              {prev && (
                <span className="kpi-sub">
                  {delta > 0
                    ? <>improved {Math.abs(delta).toFixed(2)} vs {prev.label || prev.period_id}</>
                    : delta < 0
                      ? <>slipped {Math.abs(delta).toFixed(2)} vs {prev.label || prev.period_id}</>
                      : <>unchanged vs {prev.label || prev.period_id}</>}
                </span>
              )}
            </>}
    </div>
  );
}

function QipMeetingCard() {
  const [at, setAt] = useState(undefined); // undefined = loading, null = none yet
  useEffect(() => { lastQipMeeting().then(setAt).catch(() => setAt(null)); }, []);
  const days = at ? Math.floor((Date.now() - new Date(at)) / 86400000) : null;
  const overdue = days !== null && days >= QIP_MEETING_OVERDUE_DAYS;
  return (
    <div className={`card kpi-tile ${overdue ? 'stale-card' : ''}`}>
      <span className="kpi-label">Last Fleur · QIP meeting</span>
      {at === undefined && <p className="muted">Loading…</p>}
      {at === null && <p className="muted">None recorded yet — record one from the Meetings tab.</p>}
      {at && <>
        <span className="kpi-value">{days}d ago</span>
        <span className="kpi-sub">
          {new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
          {overdue && <span style={{ color: 'var(--g4)', fontWeight: 600 }}> — overdue for a catch-up</span>}
        </span>
      </>}
    </div>
  );
}

// A tile earns colour only where the number has an unambiguous status: zero
// of a bad thing is good news, any of it is a problem. Volume metrics
// (moved/total) stay neutral — there's no single "correct" count to compare
// against, so tinting them would just be noise.
function KpiTile({ label, value, sub, tone }) {
  return (
    <div className={`card kpi-tile ${tone === 'good' ? 'win-card' : tone === 'bad' ? 'stale-card' : ''}`}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {sub && <span className="kpi-sub">{sub}</span>}
    </div>
  );
}

export default function ActivityTab({ data, onOpenCase }) {
  const [days, setDays] = useState(7);
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { setRows(null); loadRecentActivity(days).then(setRows).catch(e => setErr(e.message)); }, [days]);

  const { wins, slips } = ragMovementsFromRows(rows || [], data);

  const feed = (rows || [])
    .map(r => ({ row: r, d: activityRowInfo(r, data) }))
    .filter(x => x.d);
  const stale = rows ? staleOwnedProjects(data, feed) : [];
  const summary = rows ? liveActivitySummary(data, rows) : null;

  const windowLabel = WINDOWS.find(([d]) => d === days)?.[1] || `${days} days`;

  const typeCounts = {};
  feed.forEach(({ d }) => { typeCounts[d.icon] = (typeCounts[d.icon] || 0) + 1; });

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

      {rows && summary && (
        <div className="kpi-row">
          <KpiTile label="Live projects moved" value={`${summary.moved}/${summary.total}`} />
          <KpiTile label="Wins" value={wins.length} tone={wins.length > 0 ? 'good' : undefined} />
          <KpiTile label="Slipped" value={slips.length} tone={slips.length > 0 ? 'bad' : 'good'} />
          <KpiTile label="Stalled" value={summary.stalled} tone={summary.stalled > 0 ? 'bad' : 'good'} />
          <KpiTile label="No visible progress" value={stale.length} tone={stale.length > 0 ? 'bad' : 'good'} />
        </div>
      )}

      <div className="kpi-row" style={{ marginTop: '.8rem' }}>
        <TrendCard />
        <QipMeetingCard />
      </div>

      <div className="card" style={{ marginTop: '1rem' }}>
        <h4 className="crit-card-h">🎉 Wins {wins.length > 0 && `(${wins.length})`}</h4>
        {!wins.length && <p className="muted" style={{ marginTop: '.5rem' }}>No progress ratings improved this window — set the RAG in a project's case file to track it as it happens.</p>}
        {wins.length > 0 && (
          <div style={{ marginTop: '.3rem' }}>
            {wins.map(w => (
              <div key={w.id} className="activity-row">
                <button className="linklike" onClick={() => onOpenCase(w.id)}>{w.title}</button>
                <span className="muted"> — {areaName(w, data)}</span>
                <div className="muted" style={{ marginTop: '.15rem' }}>
                  <span className={`rag rag-${w.from}`} /> {RAG_LABEL[w.from]} → <span className={`rag rag-${w.to}`} /> {RAG_LABEL[w.to]}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {slips.length > 0 && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <h4 className="crit-card-h">⚠ Slipped ({slips.length})</h4>
          <div style={{ marginTop: '.3rem' }}>
            {slips.map(w => (
              <div key={w.id} className="activity-row">
                <button className="linklike" onClick={() => onOpenCase(w.id)}>{w.title}</button>
                <span className="muted"> — {areaName(w, data)}</span>
                <div className="muted" style={{ marginTop: '.15rem' }}>
                  <span className={`rag rag-${w.from}`} /> {RAG_LABEL[w.from]} → <span className={`rag rag-${w.to}`} /> {RAG_LABEL[w.to]}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {stale.length > 0 && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <h4 className="crit-card-h">🔇 No visible progress ({stale.length})</h4>
          <p className="muted" style={{ margin: '.35rem 0 .5rem' }}>
            Owned, live or on hold, but no note, status move or re-grade in the last {windowLabel}.
          </p>
          <div>
            {stale.map(({ p, days }) => (
              <div key={p.id} className="activity-row">
                <button className="linklike" onClick={() => onOpenCase(p.id)}>{p.title}</button>
                <span className="muted"> — {areaName(p, data)}</span>
                <div className="muted" style={{ marginTop: '.15rem' }}>
                  owner <b style={{ color: 'var(--ink)' }}>{p.owner}</b>
                  {days !== null && <> · {days}d at this stage</>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: '1rem' }}>
        <h4 className="crit-card-h">Activity, last {windowLabel} {feed.length > 0 && `(${feed.length})`}</h4>
        {err && <p className="muted" style={{ color: 'var(--g4)' }}>{err}</p>}
        {!err && !rows && <p className="muted">Loading…</p>}
        {rows && !feed.length && <p className="muted">Nothing logged in this window yet.</p>}
        {feed.length > 0 && (
          <div className="activity-breakdown">
            {ACTIVITY_TYPES.filter(([icon]) => typeCounts[icon]).map(([icon, label]) => (
              <span key={icon} className="abchip">{icon} <b>{typeCounts[icon]}</b> {label}{typeCounts[icon] === 1 ? '' : 's'}</span>
            ))}
          </div>
        )}
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
