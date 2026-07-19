import { useState } from 'react';
import { setFinalScore, clearFinalScore } from './data';
import { finalScoreFor } from './util';

// Every unit/org criterion either reviewer has actually scored this period —
// the raw material for reconciliation. Unit-specific criteria (rst1, sch1,
// etc.) only ever apply to their own unit, same rule the matrix itself uses.
function cellRows(data) {
  const chScore = (rows, match) => rows.find(s => match(s) && s.reviewer === 'Chris Haresign')?.score || null;
  const fsScore = (rows, match) => rows.find(s => match(s) && s.reviewer === 'Fleur Sexton')?.score || null;

  const unitCells = [];
  data.units.forEach(u => {
    data.criteria.filter(c => !c.unit_id || c.unit_id === u.id).forEach(c => {
      const match = s => s.unit_id === u.id && s.criterion_id === c.id;
      const ch = chScore(data.scores, match), fs = fsScore(data.scores, match);
      if (!ch && !fs) return;
      unitCells.push({ scope: 'unit', unit_id: u.id, function_id: null, criterion_id: c.id, areaName: u.name, critName: c.name, ch, fs });
    });
  });

  const orgCells = [];
  data.ofuncs.forEach(f => {
    data.ocrit.forEach(c => {
      const match = s => s.function_id === f.id && s.criterion_id === c.id;
      const ch = chScore(data.oscores, match), fs = fsScore(data.oscores, match);
      if (!ch && !fs) return;
      orgCells.push({ scope: 'org', unit_id: null, function_id: f.id, criterion_id: c.id, areaName: f.name, critName: c.name, ch, fs });
    });
  });

  return [...unitCells, ...orgCells];
}

const cellKeyOf = row => `${row.scope}:${row.unit_id || row.function_id}:${row.criterion_id}`;

export default function AgreeScores({ data, me, canEdit, onRefresh }) {
  if (!data.period) return <p className="muted">Loading…</p>;
  const rows = cellRows(data);
  const disagreements = rows.filter(r => r.ch && r.fs && r.ch !== r.fs);
  const rest = rows.filter(r => !(r.ch && r.fs && r.ch !== r.fs));
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
        Once you've both scored a criterion, pick the grade you've actually agreed on. The agreed score becomes
        the one the app uses everywhere else — matrix means, PDF export, project grading — until you change it here.
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
      <span className="muted" style={{ fontSize: '.78rem' }}>CH {row.ch ?? '–'}</span>
      <span className="muted" style={{ fontSize: '.78rem' }}>FS {row.fs ?? '–'}</span>
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
