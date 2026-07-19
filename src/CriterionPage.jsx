import { useEffect, useState } from 'react';
import { REVIEWERS } from './supa';
import { loadRootCause, saveRootCause, periodMeansForCriterion, loadMeetingsForCriterion, addProject, clearContentFlag } from './data';
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

  // Primary-home projects, plus anything "also affects"-tagged to this cell
  // via project_links — the circle count on the matrix already includes
  // both, so the list here needs to match or it looks like the count is
  // wrong. Linked ones are flagged so it's clear this isn't their main home.
  const isThisCell = (s, u, f, c) => c === criterion_id && (s === 'unit' ? u === unit_id : f === function_id);
  const primaryProjects = data.projects.filter(p => !p.archived_at && isThisCell(p.scope, p.unit_id, p.function_id, p.criterion_id));
  const linkedIds = new Set((data.projectLinks || [])
    .filter(l => isThisCell(l.scope, l.unit_id, l.function_id, l.criterion_id))
    .map(l => l.project_id));
  const linkedProjects = data.projects.filter(p => !p.archived_at && linkedIds.has(p.id) && !primaryProjects.some(pp => pp.id === p.id));
  const projects = [...primaryProjects.map(p => ({ p, linked: false })), ...linkedProjects.map(p => ({ p, linked: true }))];
  const liveCount = projects.filter(({ p }) => p.status === 'live').length;

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
  const flag = (data.contentFlags || []).find(f => f.scope === scope && f.criterion_id === criterion_id &&
    (scope === 'unit' ? f.unit_id === unit_id : f.function_id === function_id));
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

      {flag && (
        <div className="card flag-card" style={{ marginBottom: '1rem' }}>
          <p className="flag-text">
            ⚠ Grade changed from {flag.old_grade ?? '–'} to {flag.new_grade} — the content below is whatever was
            last written for grade {flag.new_grade} and may not fit the new situation yet. Review it, or dismiss
            this once it's been checked.
          </p>
          <button className="btn" onClick={() => clearContentFlag({ scope, unit_id, function_id, criterion_id }).then(onRefresh)}>
            Dismiss
          </button>
        </div>
      )}

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
          <h4 className="crit-card-h">
            <span className="gradepill" style={{ background: `var(--g${currentGrade})` }}>{currentGrade}</span>
            What this currently looks like
          </h4>
          <EditableCriterionField table={table} id={criterion_id} column={descCol} value={currentStateText}
            buildNewValue={buildDescValue(gradeIdx)} onSaved={onRefresh} placeholder="— click to describe the current reality —" />
        </div>
      )}

      <div className="card legend-card" style={{ marginTop: '1rem' }}>
        <h4 className="crit-card-h">What excellent looks like</h4>
        <EditableCriterionField table={table} id={criterion_id} column={descCol} value={excellenceText}
          buildNewValue={buildDescValue(0)} onSaved={onRefresh} placeholder="— click to describe grade 1 —" />
      </div>

      <div className="card" style={{ marginTop: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h4 className="crit-card-h">Your notes</h4>
          {!editingRC && <button className="btn" onClick={() => { setRcBody(rootCause?.body || ''); setEditingRC(true); }}>{rootCause?.body ? 'Edit' : '+ Add'}</button>}
        </div>
        <p className="muted" style={{ fontSize: '.78rem', marginTop: '.2rem' }}>
          Chris and Fleur's own analysis — separate from Claude's starting point above, which already covers
          "why this is probably happening."
        </p>
        {editingRC ? (
          <div style={{ marginTop: '.6rem' }}>
            <textarea className="formctl longtext-area" rows={9} value={rcBody} onChange={e => setRcBody(e.target.value)} autoFocus />
            <div style={{ display: 'flex', gap: '.5rem', marginTop: '.5rem' }}>
              <button className="btn primary" disabled={rcBusy} onClick={saveRC}>Save</button>
              <button className="btn" onClick={() => setEditingRC(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          rootCause?.body
            ? <p className="longtext" style={{ marginTop: '.5rem' }}>{rootCause.body}</p>
            : <p className="muted" style={{ marginTop: '.5rem' }}>Nothing written yet.</p>
        )}
      </div>

      <div className="card thoughts-card" style={{ marginTop: '1rem' }}>
        <h4 className="crit-card-h">Claude's root cause analysis{currentGrade ? ` — grade ${currentGrade}` : ''}</h4>
        <p className="thoughts-sub">
          A starting analysis of why this criterion is likely scoring the way it does — distinct from "Your
          notes" above (your own read) and separate from ways to improve below, since diagnosing the cause and
          proposing the fix are different jobs. {currentGrade ? 'Tracks the currently graded score — change the grade, this changes with it.' : ''}
        </p>
        <EditableCriterionField table={table} id={criterion_id} column={causeCol} value={likelyCauseText}
          buildNewValue={buildCauseValue(gradeIdx ?? 0)} onSaved={onRefresh} placeholder="— click to add —" />
      </div>

      <div className="card thoughts-card" style={{ marginTop: '1rem' }}>
        <h4 className="crit-card-h">Claude's initial thoughts on how to improve</h4>
        <p className="thoughts-sub">
          A starting point for this {scope === 'unit' ? 'unit' : 'horizontal'} — worth challenging, not just
          following, and fully editable below.
        </p>
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

      <div className="card" style={{ marginTop: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h4 className="crit-card-h">Projects ({projects.length})</h4>
          <button className="btn" onClick={() => setShowAdd(s => !s)}>{showAdd ? 'Cancel' : '+ Add project'}</button>
        </div>
        {showAdd && (
          <AddCriterionProject scope={scope} unit_id={unit_id} function_id={function_id} criterion_id={criterion_id}
            data={data} excellenceText={excellenceText} onDone={() => { setShowAdd(false); onRefresh(); }} />
        )}
        {!projects.length && !showAdd && <p className="muted" style={{ marginTop: '.5rem' }}>No projects yet — the solutions to whatever's driving this score.</p>}
        {projects.map(({ p, linked }) => {
          const badge = statusBadge(p);
          return (
            <p key={p.id} style={{ marginTop: '.5rem' }}>
              <button className="linklike" onClick={() => onOpenCase(p.id)}>{p.title}</button>
              {' '}<span className={`st ${badge.cls}`}>{badge.label}</span>
              {p.owner && <span className="muted"> · owner {p.owner}</span>}
              {linked && <span className="muted"> · also affects this criterion</span>}
            </p>
          );
        })}
      </div>

      {meetings.length > 0 && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <h4 className="crit-card-h">Meetings ({meetings.length})</h4>
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
        criterion_id, status: 'live', pace, owner: owner.trim(),
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
      </div>
      {error && <p className="muted" style={{ color: 'var(--g4)' }}>{error}</p>}
      <button className="btn primary" disabled={busy}>Add — goes live immediately</button>
    </form>
  );
}
