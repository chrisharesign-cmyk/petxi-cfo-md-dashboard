import { useEffect, useState } from 'react';
import { REVIEWERS } from './supa';
import { loadRootCause, saveRootCause, periodMeansForCriterion, loadMeetingsForCriterion, addProject } from './data';
import { fmtDate, autoTarget, statusBadge, PACE_LABEL } from './util';
import Sparkline from './Sparkline';
import EditableCriterionField from './EditableCriterionField';

// One criterion's own page: current scores, trend, root cause (why it
// scores the way it does) and every project (solution) against it — the
// drill-down reached by double-clicking its circle on the SAR matrix.
export default function CriterionPage({ scope, unit_id, function_id, criterion_id, data, me, onBack, onOpenCase, onRefresh }) {
  const area = scope === 'unit' ? data.units.find(u => u.id === unit_id) : data.ofuncs.find(f => f.id === function_id);
  const crit = scope === 'unit' ? data.criteria.find(c => c.id === criterion_id) : data.ocrit.find(c => c.id === criterion_id);
  const areaOrFnId = scope === 'unit' ? unit_id : function_id;

  const [trajectory, setTrajectory] = useState([]);
  const [rootCause, setRootCause] = useState(undefined); // undefined = loading, null = none yet
  const [editingRC, setEditingRC] = useState(false);
  const [rcBody, setRcBody] = useState('');
  const [rcBusy, setRcBusy] = useState(false);
  const [meetings, setMeetings] = useState([]);
  const [showAdd, setShowAdd] = useState(false);

  const refreshRootCause = () => loadRootCause(scope, unit_id, function_id, criterion_id).then(setRootCause).catch(() => setRootCause(null));

  useEffect(() => {
    periodMeansForCriterion(scope, areaOrFnId, criterion_id).then(setTrajectory).catch(() => {});
    refreshRootCause();
    loadMeetingsForCriterion(scope, unit_id, function_id, criterion_id).then(setMeetings).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, unit_id, function_id, criterion_id]);

  const scoreRows = scope === 'unit' ? data.scores : data.oscores;
  const scoreCells = REVIEWERS.map(r => {
    const row = scoreRows.find(s => s.criterion_id === criterion_id &&
      (scope === 'unit' ? s.unit_id === unit_id : s.function_id === function_id) && s.reviewer === r.name);
    return { reviewer: r, score: row?.score };
  });

  const projects = data.projects.filter(p => !p.archived_at && p.scope === scope && p.criterion_id === criterion_id &&
    (scope === 'unit' ? p.unit_id === unit_id : p.function_id === function_id));
  const liveCount = projects.filter(p => p.status === 'live').length;

  // Everything below is editable in place (see EditableCriterionField) —
  // seeded content is a head start, not something that needs a code change
  // to correct. table/areaKey/*Col pick out where in the row each field
  // lives; descriptors and likely_cause are one text per grade (1-4) so
  // "what this currently looks like" and "why" can track whichever grade
  // is actually scored, not just the aspirational top grade.
  const table = scope === 'unit' ? 'criteria' : 'org_criteria';
  const areaKey = scope === 'unit' ? unit_id : function_id;
  const descCol = scope === 'unit' ? 'descriptors_by_unit' : 'descriptors_by_function';
  const causeCol = scope === 'unit' ? 'likely_cause_by_unit' : 'likely_cause_by_function';
  const solCol = scope === 'unit' ? 'solution_by_unit' : 'solution_by_function';

  const descArr = crit?.[descCol]?.[areaKey] || crit?.descriptors || ['', '', '', ''];
  const causeArr = crit?.[causeCol]?.[areaKey] || crit?.likely_cause || ['', '', '', ''];
  const improveText = crit?.[solCol]?.[areaKey] ?? crit?.solution ?? '';

  const currentGrade = Math.max(0, ...scoreCells.map(c => c.score || 0)) || null;
  const gradeIdx = currentGrade ? currentGrade - 1 : null;
  const currentStateText = gradeIdx !== null ? descArr[gradeIdx] : null;
  const excellenceText = descArr[0];
  const likelyCauseText = causeArr[gradeIdx ?? 0];

  const buildDescValue = idx => draft => {
    const base = { ...(crit?.[descCol] || {}) };
    const arr = [...(base[areaKey] || crit?.descriptors || ['', '', '', ''])];
    arr[idx] = draft;
    base[areaKey] = arr;
    return base;
  };
  const buildCauseValue = idx => draft => {
    const base = { ...(crit?.[causeCol] || {}) };
    const arr = [...(base[areaKey] || crit?.likely_cause || ['', '', '', ''])];
    arr[idx] = draft;
    base[areaKey] = arr;
    return base;
  };
  const buildSolutionValue = draft => {
    const base = { ...(crit?.[solCol] || {}) };
    base[areaKey] = draft;
    return base;
  };

  const saveRC = async () => {
    setRcBusy(true);
    try { await saveRootCause({ id: rootCause?.id, scope, unit_id, function_id, criterion_id, body: rcBody, updatedBy: me }); setEditingRC(false); await refreshRootCause(); }
    finally { setRcBusy(false); }
  };

  return (
    <>
      <button className="linklike" onClick={onBack}>← Back</button>
      <div className="panel-h" style={{ marginTop: '.6rem' }}>
        <span className="bar" style={{ background: 'var(--g2)' }} />
        {area?.name} &gt; {crit?.name}
      </div>

      <div className="card" style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '1.4rem' }}>
          {scoreCells.map(({ reviewer, score }) => (
            <div key={reviewer.key} style={{ textAlign: 'center' }}>
              <div className="muted" style={{ fontSize: '.7rem', fontFamily: 'var(--mono)', marginBottom: '.2rem' }}>{reviewer.short}</div>
              <span className={`chip ${score ? 's' + score : 'empty'}`} style={{ position: 'static' }}>{score || '–'}</span>
            </div>
          ))}
        </div>
        <div>
          <div className="muted" style={{ fontSize: '.7rem', marginBottom: '.2rem' }}>Trend</div>
          <Sparkline points={[...trajectory].sort((a, b) => a.period_id.localeCompare(b.period_id))} />
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <span className={`st ${liveCount ? 'st-rapid' : 'st-embed'}`}>{liveCount} running</span>
        </div>
      </div>

      {currentGrade && (
        <div className="card state-card" style={{ marginTop: '1rem' }}>
          <div className="state-label">
            <span className="gradepill" style={{ background: `var(--g${currentGrade})` }}>{currentGrade}</span>
            What this currently looks like
          </div>
          <EditableCriterionField table={table} id={criterion_id} column={descCol} value={currentStateText}
            buildNewValue={buildDescValue(gradeIdx)} onSaved={onRefresh} placeholder="— click to describe the current reality —" />
        </div>
      )}

      <div className="card legend-card" style={{ marginTop: '1rem' }}>
        <b>What excellent looks like</b>
        <EditableCriterionField table={table} id={criterion_id} column={descCol} value={excellenceText}
          buildNewValue={buildDescValue(0)} onSaved={onRefresh} placeholder="— click to describe grade 1 —" />
      </div>

      <div className="card thoughts-card" style={{ marginTop: '1rem' }}>
        <h4>Claude's initial thoughts on how to improve</h4>
        <p className="thoughts-sub">
          A starting point for this {scope === 'unit' ? 'unit' : 'horizontal'} — worth challenging, not just
          following, and fully editable below. {currentGrade ? 'Tracks the currently graded score.' : "Applies whatever the current grade; there's always a next step."}
        </p>
        <div className="thoughts-sec">
          <div className="thoughts-label"><span className="dot" />Why this is probably happening{currentGrade ? ` (at grade ${currentGrade})` : ''}</div>
          <EditableCriterionField table={table} id={criterion_id} column={causeCol} value={likelyCauseText}
            buildNewValue={buildCauseValue(gradeIdx ?? 0)} onSaved={onRefresh} placeholder="— click to add —" />
        </div>
        <div className="thoughts-sec">
          <div className="thoughts-label"><span className="dot" />What could help</div>
          <EditableCriterionField table={table} id={criterion_id} column={solCol} value={improveText}
            buildNewValue={buildSolutionValue} onSaved={onRefresh} placeholder="— click to add ideas, one per line —"
            renderValue={v => (
              <ul className="thoughts-list">
                {v.split('\n').map(line => line.replace(/^[\s-]+/, '').trim()).filter(Boolean).map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            )} />
        </div>
      </div>

      <div className="card" style={{ marginTop: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h4 style={{ margin: 0 }}>Root cause</h4>
          {!editingRC && <button className="btn" onClick={() => { setRcBody(rootCause?.body || ''); setEditingRC(true); }}>{rootCause?.body ? 'Edit' : '+ Add'}</button>}
        </div>
        <p className="muted" style={{ fontSize: '.78rem', marginTop: '.2rem' }}>
          Why this criterion scores the way it does — the thinking behind the projects below.
        </p>
        {editingRC ? (
          <div style={{ marginTop: '.6rem' }}>
            <textarea className="formctl" rows={5} style={{ width: '100%' }} value={rcBody} onChange={e => setRcBody(e.target.value)} autoFocus />
            <div style={{ display: 'flex', gap: '.5rem', marginTop: '.5rem' }}>
              <button className="btn primary" disabled={rcBusy} onClick={saveRC}>Save</button>
              <button className="btn" onClick={() => setEditingRC(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          rootCause?.body
            ? <p style={{ marginTop: '.5rem', whiteSpace: 'pre-wrap' }}>{rootCause.body}</p>
            : <p className="muted" style={{ marginTop: '.5rem' }}>Nothing written yet.</p>
        )}
      </div>

      <div className="card" style={{ marginTop: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h4 style={{ margin: 0 }}>Projects ({projects.length})</h4>
          <button className="btn" onClick={() => setShowAdd(s => !s)}>{showAdd ? 'Cancel' : '+ Add project'}</button>
        </div>
        {showAdd && (
          <AddCriterionProject scope={scope} unit_id={unit_id} function_id={function_id} criterion_id={criterion_id}
            data={data} excellenceText={excellenceText} onDone={() => { setShowAdd(false); onRefresh(); }} />
        )}
        {!projects.length && !showAdd && <p className="muted" style={{ marginTop: '.5rem' }}>No projects yet — the solutions to whatever's in root cause above.</p>}
        {projects.map(p => {
          const badge = statusBadge(p);
          return (
            <p key={p.id} style={{ marginTop: '.5rem' }}>
              <button className="linklike" onClick={() => onOpenCase(p.id)}>{p.title}</button>
              {' '}<span className={`st ${badge.cls}`}>{badge.label}</span>
              {p.owner && <span className="muted"> · owner {p.owner}</span>}
            </p>
          );
        })}
      </div>

      {meetings.length > 0 && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <h4>Meetings ({meetings.length})</h4>
          {meetings.map(m => (
            <p key={m.id} className="muted">{fmtDate(m.started_at?.slice(0, 10))} — {m.title || 'Meeting'}</p>
          ))}
        </div>
      )}
    </>
  );
}

// Goes straight to live — no more discuss/potential holding stage. Owner
// and pace (and so a date) are both required at creation, same rule as
// everywhere else a project can start.
function AddCriterionProject({ scope, unit_id, function_id, criterion_id, data, excellenceText, onDone }) {
  const [title, setTitle] = useState('');
  const [pace, setPace] = useState('rapid');
  const [owner, setOwner] = useState('');
  const [impact, setImpact] = useState('A');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const known = [...new Set([...REVIEWERS.map(r => r.name), ...data.projects.map(p => p.owner).filter(Boolean)])];

  const scoreRows = scope === 'unit' ? data.scores : data.oscores;
  const relevant = scoreRows.filter(s => s.criterion_id === criterion_id &&
    (scope === 'unit' ? s.unit_id === unit_id : s.function_id === function_id));
  const grade = relevant.length ? Math.max(...relevant.map(s => s.score)) : null;

  const submit = async (e) => {
    e.preventDefault();
    if (!title.trim() || !owner.trim()) { setError('Title and owner are both required.'); return; }
    setBusy(true); setError('');
    try {
      await addProject({
        title: title.trim(), scope,
        unit_id: scope === 'unit' ? unit_id : null,
        function_id: scope === 'org' ? function_id : null,
        criterion_id, status: 'live', pace, owner: owner.trim(), impact,
        due: autoTarget(pace, data.period), grade_at_creation: grade,
      });
      onDone();
    } catch (e2) { setError(e2.message); } finally { setBusy(false); }
  };

  return (
    <form className="card" onSubmit={submit} style={{ marginTop: '.6rem', background: 'var(--paper)' }}>
      {excellenceText && (
        <p className="muted" style={{ fontSize: '.78rem', marginBottom: '.6rem' }}>
          <b>Aiming for:</b> {excellenceText}
        </p>
      )}
      <input className="formctl" placeholder="Project title" value={title} onChange={e => setTitle(e.target.value)}
        style={{ width: '100%', marginBottom: '.5rem' }} required autoFocus />
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.5rem' }}>
        <select className="formctl" value={pace} onChange={e => setPace(e.target.value)}>
          {['rapid', 'short', 'mid', 'long'].map(p => <option key={p} value={p}>{PACE_LABEL[p]}</option>)}
        </select>
        <input className="formctl" list="cp-owners" placeholder="owner (required)" value={owner} onChange={e => setOwner(e.target.value)} />
        <datalist id="cp-owners">{known.map(n => <option key={n} value={n} />)}</datalist>
        <select className="formctl" value={impact} onChange={e => setImpact(e.target.value)}>
          <option value="G">Impact: high</option>
          <option value="A">Impact: medium</option>
          <option value="R">Impact: low</option>
        </select>
      </div>
      {error && <p className="muted" style={{ color: 'var(--g4)' }}>{error}</p>}
      <button className="btn primary" disabled={busy}>Add — goes live immediately</button>
    </form>
  );
}
