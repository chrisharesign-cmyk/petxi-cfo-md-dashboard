import { useState } from 'react';
import { REVIEWERS } from './supa';
import { setFinalScore, clearFinalScore } from './data';
import { finalScoreFor } from './util';

// Every unit/org criterion at least one reviewer has actually graded this
// period (a real 1-4, not just an N/A) — the raw material for
// reconciliation. Unit-specific criteria (rst1, sch1, etc.) only ever
// apply to their own unit, same rule the matrix itself uses. byKey holds
// each reviewer's raw score: undefined (not touched), null (N/A), or 1-4.
function cellRows(data) {
  const scoresByKey = (rows, match) => {
    const byKey = {};
    REVIEWERS.forEach(r => { byKey[r.key] = rows.find(s => match(s) && s.reviewer === r.name)?.score; });
    return byKey;
  };
  const hasRealGrade = byKey => Object.values(byKey).some(v => v != null);

  const unitCells = [];
  data.units.forEach(u => {
    data.criteria.filter(c => !c.unit_id || c.unit_id === u.id).forEach(c => {
      const match = s => s.unit_id === u.id && s.criterion_id === c.id;
      const byKey = scoresByKey(data.scores, match);
      if (!hasRealGrade(byKey)) return;
      unitCells.push({ scope: 'unit', unit_id: u.id, function_id: null, criterion_id: c.id, areaName: u.name, critName: c.name, byKey });
    });
  });

  const orgCells = [];
  data.ofuncs.forEach(f => {
    data.ocrit.forEach(c => {
      const match = s => s.function_id === f.id && s.criterion_id === c.id;
      const byKey = scoresByKey(data.oscores, match);
      if (!hasRealGrade(byKey)) return;
      orgCells.push({ scope: 'org', unit_id: null, function_id: f.id, criterion_id: c.id, areaName: f.name, critName: c.name, byKey });
    });
  });

  return [...unitCells, ...orgCells];
}

const cellKeyOf = row => `${row.scope}:${row.unit_id || row.function_id}:${row.criterion_id}`;
// N/A votes don't count as an opinion to disagree over — only real grades do.
const realGrades = byKey => Object.values(byKey).filter(v => v != null);

export default function AgreeScores({ data, me, canEdit, onRefresh }) {
  if (!data.period) return <p className="muted">Loading…</p>;
  const rows = cellRows(data);
  const disagreements = rows.filter(r => new Set(realGrades(r.byKey)).size > 1);
  const rest = rows.filter(r => new Set(realGrades(r.byKey)).size <= 1);
  const [busy, setBusy] = useState(null);

  const decide = async (row, score) => {
    const key = cellKeyOf(row);
    setBusy(key);
    try {
      const args = { scope: row.scope, unit_id: row.unit_id, function_id: row.function_id, criterion_id: row.criterion_id, period_id: data.period.id };
      if (score == null) await clearFinalScore(args);
      else await setFinalScore({ ...args, score, decided_by: me });
      await onRefresh();
    } finally { setBusy(null); }
  };

  return (
    <>
      <div className="panel-h"><span className="bar" style={{ background: 'var(--g3)' }} />Agree Final Scores</div>
      <p className="muted" style={{ marginBottom: '1rem' }}>
        Once reviewers disagree — or you just want to record what you've settled on — pick the grade you've
        actually agreed. The agreed score becomes the one the app uses everywhere else — matrix means, PDF
        export, project grading — until you change it here.
      </p>
      {!canEdit && <p className="muted" style={{ marginBottom: '1rem' }}>This period is locked — agreement is read-only.</p>}

      {disagreements.length > 0 && (
        <div className="card" style={{ marginBottom: '1rem', borderColor: 'var(--g4)' }}>
          <h4 className="crit-card-h">Disagreements ({disagreements.length})</h4>
          <p className="muted" style={{ margin: '.2rem 0 .5rem', fontSize: '.8rem' }}>These are the ones that actually need a decision.</p>
          {disagreements.map(row => (
            <AgreeRow key={cellKeyOf(row)} row={row} data={data} canEdit={canEdit} busy={busy === cellKeyOf(row)} onDecide={decide} />
          ))}
        </div>
      )}

      <div className="card">
        <h4 className="crit-card-h">Everything else scored ({rest.length})</h4>
        {!rows.length && <p className="muted">Nothing scored yet this period.</p>}
        {rest.map(row => (
          <AgreeRow key={cellKeyOf(row)} row={row} data={data} canEdit={canEdit} busy={busy === cellKeyOf(row)} onDecide={decide} />
        ))}
      </div>
    </>
  );
}

function AgreeRow({ row, data, canEdit, busy, onDecide }) {
  const decided = finalScoreFor(data, row);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '.7rem', padding: '.5rem 0', borderBottom: '1px solid var(--line-soft)', flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 200 }}><b>{row.areaName}</b> &gt; {row.critName}</div>
      {REVIEWERS.map(r => (
        <span key={r.key} className="muted" style={{ fontSize: '.78rem' }}>
          {r.short} {row.byKey[r.key] === undefined ? '–' : row.byKey[r.key] === null ? 'N/A' : row.byKey[r.key]}
        </span>
      ))}
      <span style={{ display: 'inline-flex', gap: '.3rem' }}>
        {[1, 2, 3, 4].map(g => (
          <button key={g} disabled={!canEdit || busy}
            className={`chip s${g}`}
            style={{ position: 'static', boxShadow: decided === g ? '0 0 0 2px var(--ink)' : undefined }}
            onClick={() => onDecide(row, decided === g ? null : g)}
            title={decided === g ? 'Final decision — click to clear' : `Set final decision to ${g}`}>
            {g}
          </button>
        ))}
      </span>
      {decided != null
        ? <span style={{ fontSize: '.78rem', fontWeight: 700 }}>Final: {decided}</span>
        : <span className="muted" style={{ fontSize: '.78rem' }}>No decision yet</span>}
    </div>
  );
}
