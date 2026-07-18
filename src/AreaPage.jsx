import { useEffect, useState } from 'react';
import { REVIEWERS } from './supa';
import { periodMeans } from './data';
import { meanGrade } from './matrixdata';
import { fmtDate } from './util';
import EditableText from './EditableText';

function Sparkline({ points }) {
  if (points.length < 2) return <p className="muted">Not enough history yet.</p>;
  const w = 240, h = 48, pad = 6;
  const xs = points.map((_, i) => pad + (i * (w - 2 * pad)) / (points.length - 1));
  const ys = points.map(p => pad + (1 - (4 - p.mean) / 3) * (h - 2 * pad)); // 1=best(top) .. 4=worst(bottom)
  const d = xs.map((x, i) => `${i ? 'L' : 'M'}${x},${ys[i]}`).join(' ');
  return (
    <svg width={w} height={h}>
      <path d={d} fill="none" stroke="var(--g2)" strokeWidth="2" />
      {xs.map((x, i) => <circle key={i} cx={x} cy={ys[i]} r="3" fill={`var(--g${meanGrade(points[i].mean)})`} />)}
    </svg>
  );
}

export default function AreaPage({ scope, id, data, onBack, onOpenCase }) {
  const [trajectory, setTrajectory] = useState([]);
  useEffect(() => { periodMeans(scope, id).then(setTrajectory).catch(() => {}); }, [scope, id]);

  const area = scope === 'unit' ? data.units.find(u => u.id === id) : data.ofuncs.find(f => f.id === id);
  const criteria = scope === 'unit'
    ? data.criteria.filter(c => !c.unit_id || c.unit_id === id)
    : data.ocrit;
  const scoreRows = scope === 'unit' ? data.scores : data.oscores;
  const gradeFor = (critId) => {
    const rows = scoreRows.filter(s => s.criterion_id === critId && (scope === 'unit' ? s.unit_id === id : s.function_id === id));
    return REVIEWERS.map(r => ({ reviewer: r, row: rows.find(s => s.reviewer === r.name) }));
  };
  const table = scope === 'unit' ? 'units' : 'org_functions';
  const critTable = scope === 'unit' ? 'criteria' : 'org_criteria';

  const projects = data.projects.filter(p => p.scope === scope && (scope === 'unit' ? p.unit_id === id : p.function_id === id));
  const open = projects.filter(p => ['potential', 'queued', 'live', 'paused'].includes(p.status));
  const completed = projects.filter(p => p.status === 'completed');

  return (
    <>
      <button className="linklike" onClick={onBack}>← Back to QIP</button>
      <div className="panel-h" style={{ marginTop: '.6rem' }}>
        <span className="bar" style={{ background: 'var(--g2)' }} />
        <EditableText table={table} id={id} field="name" value={area?.name} className="areaTitle" />
        <button className="linklike" style={{ marginLeft: 'auto' }} onClick={() => window.print()}>Export PDF</button>
      </div>

      <div className="card">
        <h4>This period's grades</h4>
        <table className="ptable">
          <thead><tr><th>Criterion</th>{REVIEWERS.map(r => <th key={r.key}>{r.short}</th>)}<th>Judged against</th></tr></thead>
          <tbody>
            {criteria.map(c => {
              const cells = gradeFor(c.id);
              const snap = cells.find(x => x.row?.descriptor_snapshot)?.row?.descriptor_snapshot;
              return (
                <tr key={c.id}>
                  <td><EditableText table={critTable} id={c.id} field="name" value={c.name} /></td>
                  {cells.map(({ reviewer, row }) => (
                    <td key={reviewer.key}>{row ? <span className={`chip s${row.score}`} style={{ position: 'static' }}>{row.score}</span> : '—'}</td>
                  ))}
                  <td className="muted" style={{ fontSize: '.76rem' }}>
                    {snap || <EditableText table={critTable} id={c.id} field="solution" value={c.solution} placeholder="add suggested solution" />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginTop: '1rem' }}>
        <h4>Mean trajectory, by period</h4>
        <Sparkline points={trajectory.sort((a, b) => a.period_id.localeCompare(b.period_id))} />
      </div>

      <div className="card" style={{ marginTop: '1rem' }}>
        <h4>Open projects ({open.length})</h4>
        {!open.length && <p className="muted">None open.</p>}
        {open.map(p => (
          <p key={p.id}><button className="linklike" onClick={() => onOpenCase(p.id)}>{p.title}</button>
            {' '}— {p.status}, target {fmtDate(p.due)}</p>
        ))}
        <h4 style={{ marginTop: '1rem' }}>Completed ({completed.length})</h4>
        {!completed.length && <p className="muted">None yet.</p>}
        {completed.map(p => (
          <p key={p.id}><button className="linklike" onClick={() => onOpenCase(p.id)}>{p.title}</button>
            {' '}— created at {p.grade_at_creation} → completed at {p.grade_at_completion ?? '—'}. {p.what_changed}</p>
        ))}
      </div>
    </>
  );
}
