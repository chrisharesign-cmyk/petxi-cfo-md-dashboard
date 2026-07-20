import { useEffect, useState } from 'react';
import { REVIEWERS } from './supa';
import { periodMeans } from './data';
import { fmtDate, buildAreaPrompt, finalScoreFor } from './util';
import EditableText from './EditableText';
import Sparkline from './Sparkline';

export default function AreaPage({ scope, id, data, onBack, onOpenCase, onOpenCriterion, onRefresh }) {
  const [trajectory, setTrajectory] = useState([]);
  const [copied, setCopied] = useState(false);
  useEffect(() => { periodMeans(scope, id).then(setTrajectory).catch(() => {}); }, [scope, id]);
  const copyAreaPrompt = () => {
    navigator.clipboard?.writeText(buildAreaPrompt(scope, id, data));
    setCopied(true); setTimeout(() => setCopied(false), 2500);
  };

  const area = scope === 'unit' ? data.units.find(u => u.id === id) : data.ofuncs.find(f => f.id === id);
  const criteria = scope === 'unit'
    ? data.criteria.filter(c => !c.unit_id || c.unit_id === id)
    : data.ocrit;
  const scoreRows = scope === 'unit' ? data.scores : data.oscores;
  const gradeFor = (critId) => {
    const rows = scoreRows.filter(s => s.criterion_id === critId && (scope === 'unit' ? s.unit_id === id : s.function_id === id));
    return REVIEWERS.map(r => ({ reviewer: r, row: rows.find(s => s.reviewer === r.name) }));
  };
  // The standard this criterion was actually judged against: the agreed
  // final score's descriptor if one's been set, else whichever grade the
  // reviewers' own scores currently point to (worst-of-both, same as
  // everywhere else pre-agreement).
  const descriptorsFor = (c) => (scope === 'unit' ? c.descriptors_by_unit?.[id] : c.descriptors_by_function?.[id]) || c.descriptors;
  const judgedAgainst = (c, cells) => {
    const agreed = finalScoreFor(data, {
      scope, unit_id: scope === 'unit' ? id : null, function_id: scope === 'org' ? id : null, criterion_id: c.id,
    });
    const scored = cells.map(x => x.row?.score).filter(Boolean);
    const grade = agreed || (scored.length ? Math.max(...scored) : null);
    return grade ? descriptorsFor(c)?.[grade - 1] : null;
  };
  const table = scope === 'unit' ? 'units' : 'org_functions';
  const critTable = scope === 'unit' ? 'criteria' : 'org_criteria';

  const projects = data.projects.filter(p => !p.archived_at && p.scope === scope && (scope === 'unit' ? p.unit_id === id : p.function_id === id));
  const open = projects.filter(p => ['potential', 'queued', 'live', 'paused'].includes(p.status));
  const completed = projects.filter(p => p.status === 'completed');

  return (
    <>
      <button className="linklike" onClick={onBack}>← Back to QIP</button>
      <div className="panel-h" style={{ marginTop: '.6rem' }}>
        <span className="bar" style={{ background: 'var(--g2)' }} />
        <EditableText table={table} id={id} field="name" value={area?.name} className="areaTitle" onSaved={onRefresh} />
        <span style={{ marginLeft: 'auto', display: 'flex', gap: '.5rem' }}>
          <button className="btn" onClick={copyAreaPrompt} title="Copies a prompt covering everything at 3 or 4 in this area — paste into claude.ai for a holistic plan">
            {copied ? 'Copied ✓' : 'Explore with Claude'}
          </button>
          <button className="btn" onClick={() => window.print()}>Export PDF</button>
        </span>
      </div>

      <div className="card">
        <h4>This period's grades</h4>
        <table className="ptable">
          <thead><tr><th>Criterion</th>{REVIEWERS.map(r => <th key={r.key}>{r.short}</th>)}<th>Judged against</th></tr></thead>
          <tbody>
            {criteria.map(c => {
              const cells = gradeFor(c.id);
              const snap = cells.find(x => x.row?.descriptor_snapshot)?.row?.descriptor_snapshot;
              const judged = snap || judgedAgainst(c, cells);
              return (
                <tr key={c.id}>
                  <td>
                    <EditableText table={critTable} id={c.id} field="name" value={c.name} onSaved={onRefresh} />
                    {onOpenCriterion && (
                      <button className="linklike" style={{ marginLeft: '.4rem', fontSize: '.72rem' }}
                        onClick={() => onOpenCriterion(scope === 'unit'
                          ? { scope, unit_id: id, function_id: null, criterion_id: c.id }
                          : { scope, unit_id: null, function_id: id, criterion_id: c.id })}>
                        root cause &amp; projects →
                      </button>
                    )}
                  </td>
                  {cells.map(({ reviewer, row }) => (
                    <td key={reviewer.key}>
                      {row && row.score != null
                        ? <span className={`chip s${row.score}`} style={{ position: 'static' }}>{row.score}</span>
                        : row
                          ? <span className="chip na" style={{ position: 'static' }}>N/A</span>
                          : '—'}
                    </td>
                  ))}
                  <td className="muted" style={{ fontSize: '.76rem' }}>
                    {judged || <span className="muted">Not yet scored — nothing to judge against.</span>}
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
