import { useState } from 'react';
import { supa, REVIEWERS } from './supa';
import { promoteLive, pauseProject, resumeLive, moveBackLive,
  completeProject, cancelProject, updateProjectDue, rescheduleProject } from './data';
import { PACE_LABEL, PACE_DESC, friendlyProjectError, fmtDate, autoTarget, upcomingQuarters, quarterLabel, RAG_LABEL, officialCurrentGrade } from './util';
import { usePrompt } from './Dialogs';

// Owner isn't limited to reviewers — anyone (Josh, ops staff, etc.)
// can be named. Typing a new name and saving it writes straight to
// projects.owner in Supabase; it then shows up as a suggestion next time,
// built from every distinct owner already in use.
export function OwnerEditor({ project, data, onSaved }) {
  const [value, setValue] = useState(project.owner || '');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const known = [...new Set([...REVIEWERS.map(r => r.name), ...data.projects.map(p => p.owner).filter(Boolean)])];

  const save = async () => {
    setError('');
    const { error: err } = await supa.from('projects').update({ owner: value.trim() || null, updated_at: new Date().toISOString() }).eq('id', project.id);
    if (err) { setError(friendlyProjectError(err)); return; }
    setEditing(false); onSaved?.();
  };

  if (!editing) {
    return (
      <span className="editable" onClick={(e) => { e.stopPropagation(); setValue(project.owner || ''); setEditing(true); }}>
        {project.owner || <span className="muted">— no owner —</span>}
      </span>
    );
  }
  return (
    <span className="editform" onClick={e => e.stopPropagation()}>
      <input list={`owners-${project.id}`} value={value} onChange={e => setValue(e.target.value)} autoFocus
        onFocus={e => e.target.select()}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }} />
      <datalist id={`owners-${project.id}`}>{known.map(n => <option key={n} value={n} />)}</datalist>
      <button onClick={save}>Save</button>
      <button type="button" onClick={() => setEditing(false)}>Cancel</button>
      {error && <span className="muted" style={{ color: 'var(--g4)', display: 'block', width: '100%' }}>{error}</span>}
    </span>
  );
}

// Lets a project be moved to a different unit-criterion or org horizontal
// after the fact — first-pass categorisation is often a best guess, this
// is how it gets corrected without recreating the project from scratch.
export function AreaEditor({ project, data, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [scope, setScope] = useState(project.scope);
  const [areaId, setAreaId] = useState(project.scope === 'unit' ? project.unit_id : project.function_id);
  const [criterionId, setCriterionId] = useState(project.criterion_id);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const areaName = project.scope === 'unit'
    ? data.units.find(u => u.id === project.unit_id)?.name
    : data.ofuncs.find(f => f.id === project.function_id)?.name;
  const critName = project.scope === 'unit'
    ? data.criteria.find(c => c.id === project.criterion_id)?.name
    : data.ocrit.find(c => c.id === project.criterion_id)?.name;

  if (!editing) {
    return (
      <span className="editable" onClick={(e) => {
        e.stopPropagation();
        setScope(project.scope);
        setAreaId(project.scope === 'unit' ? project.unit_id : project.function_id);
        setCriterionId(project.criterion_id);
        setError('');
        setEditing(true);
      }}>
        {areaName} &gt; {critName}
      </span>
    );
  }

  const critOptions = scope === 'unit'
    ? data.criteria.filter(c => !c.unit_id || c.unit_id === areaId)
    : data.ocrit;

  const save = async () => {
    if (!areaId || !criterionId) { setError('Pick an area and a criterion.'); return; }
    setBusy(true); setError('');
    const patch = scope === 'unit'
      ? { scope: 'unit', unit_id: areaId, function_id: null, criterion_id: criterionId }
      : { scope: 'org', unit_id: null, function_id: areaId, criterion_id: criterionId };
    const { error } = await supa.from('projects').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', project.id);
    setBusy(false);
    if (error) { setError(friendlyProjectError(error)); return; }
    setEditing(false);
    onSaved?.();
  };

  return (
    <span className="editform" onClick={e => e.stopPropagation()} style={{ flexWrap: 'wrap' }}>
      <select className="formctl" value={scope} onChange={e => { setScope(e.target.value); setAreaId(''); setCriterionId(''); }}>
        <option value="unit">Business unit</option>
        <option value="org">Org function</option>
      </select>
      <select className="formctl" value={areaId || ''} onChange={e => { setAreaId(e.target.value); setCriterionId(''); }}>
        <option value="">— area —</option>
        {(scope === 'unit' ? data.units : data.ofuncs).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <select className="formctl" value={criterionId || ''} onChange={e => setCriterionId(e.target.value)} disabled={!areaId}>
        <option value="">— criterion —</option>
        {critOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <button onClick={save} disabled={busy}>Save</button>
      <button type="button" onClick={() => setEditing(false)}>Cancel</button>
      {error && <span className="muted" style={{ color: 'var(--g4)', display: 'block', width: '100%' }}>{error}</span>}
    </span>
  );
}

// An informal on-track/at-risk read, R/A/G, settable any time — separate
// from the locked SAR grade, which only moves at the start of the next
// assessment period. Three dots, click to set, click the active one again
// to clear.
export function RagEditor({ project, onSaved }) {
  const save = async (val) => {
    const { error } = await supa.from('projects').update({ progress_rag: val, updated_at: new Date().toISOString() }).eq('id', project.id);
    if (!error) onSaved?.();
  };
  return (
    <span style={{ display: 'inline-flex', gap: '.3rem', alignItems: 'center' }} onClick={e => e.stopPropagation()}>
      {['G', 'A', 'R'].map(k => (
        <button key={k} type="button" title={RAG_LABEL[k]}
          className={`rag-pick rag-${k} ${project.progress_rag === k ? 'active' : ''}`}
          onClick={() => save(project.progress_rag === k ? null : k)} />
      ))}
    </span>
  );
}

export function TargetEditor({ project, onSaved }) {
  return (
    <input type="date" className="formctl" value={project.due || ''} onClick={e => e.stopPropagation()}
      onChange={async e => { await updateProjectDue(project.id, e.target.value); onSaved?.(); }} />
  );
}

// Full scheduling control for the case file — same relative tags as agreeing
// a pace (Quick fix / 2 weeks / This quarter), plus any of the next several
// specific quarters by name, or a raw custom date. Works at any status, not
// just at the moment a project first goes live.
export function ScheduleEditor({ project, data, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState('custom');
  const [customDate, setCustomDate] = useState(project.due || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const quarters = data.period ? upcomingQuarters(data.period, 8) : [];

  const open = () => {
    setChoice('custom');
    setCustomDate(project.due || '');
    setError('');
    setEditing(true);
  };

  const save = async () => {
    setBusy(true); setError('');
    try {
      if (choice === 'custom') {
        if (!customDate) { setError('Pick a date.'); setBusy(false); return; }
        await rescheduleProject(project.id, { pace: project.pace, due: customDate });
      } else if (choice.startsWith('long:')) {
        const q = quarters[Number(choice.split(':')[1])];
        await rescheduleProject(project.id, { pace: 'long', due: q.ends });
      } else {
        await rescheduleProject(project.id, { pace: choice, due: autoTarget(choice, data.period) });
      }
      setEditing(false);
      onSaved?.();
    } catch (e) { setError(friendlyProjectError(e)); } finally { setBusy(false); }
  };

  if (!editing) {
    return (
      <span className="editable" onClick={(e) => { e.stopPropagation(); open(); }}>
        {project.due ? fmtDate(project.due) : <span className="muted">— no target —</span>}
        {project.pace && <span className="muted"> ({PACE_LABEL[project.pace]})</span>}
      </span>
    );
  }
  return (
    <span className="editform" onClick={e => e.stopPropagation()} style={{ flexWrap: 'wrap' }}>
      <select className="formctl" value={choice} onChange={e => setChoice(e.target.value)}>
        <option value="rapid">Quick fix — coming Friday</option>
        <option value="short">2 weeks out</option>
        <option value="mid">This quarter{data.period ? ` — by ${fmtDate(data.period.ends)}` : ''}</option>
        {quarters.map((q, i) => <option key={i} value={`long:${i}`}>{quarterLabel(q)}</option>)}
        <option value="custom">Custom date…</option>
      </select>
      {choice === 'custom' && (
        <input type="date" className="formctl" value={customDate} onChange={e => setCustomDate(e.target.value)} />
      )}
      <button onClick={save} disabled={busy}>Save</button>
      <button type="button" onClick={() => setEditing(false)}>Cancel</button>
      {error && <span className="muted" style={{ color: 'var(--g4)', display: 'block', width: '100%' }}>{error}</span>}
    </span>
  );
}

// Compact version of the case file's status actions, for editing straight
// from a table row without opening the case file. Same guarded functions —
// completing still requires a note, cancelling still requires a reason.
export function StatusMenu({ project, data, onSaved }) {
  const [open, setOpen] = useState(false);
  const [pace, setPace] = useState('rapid');
  const [owner, setOwner] = useState(project.owner || '');
  const [error, setError] = useState('');
  const [askText, textDialog] = usePrompt();
  const knownOwners = [...new Set([...REVIEWERS.map(r => r.name), ...data.projects.map(p => p.owner).filter(Boolean)])];

  const run = async (fn, ...args) => {
    setError('');
    try { await fn(...args); setOpen(false); onSaved?.(); }
    catch (e) { setError(friendlyProjectError(e)); }
  };
  const agree = () => run(promoteLive, project.id, pace, data.period, { owner: owner.trim() });
  const complete = async () => {
    const what = await askText('What changed? Required to mark this complete.', { confirmLabel: 'Complete' });
    if (!what) return;
    run(completeProject, project.id, { what_changed: what, grade_at_completion: officialCurrentGrade(project, data) });
  };
  const cancel = async () => {
    const reason = await askText('Reason for cancelling — kept on record, not deleted.', { confirmLabel: 'Cancel project', danger: true });
    if (!reason) return;
    run(cancelProject, project.id, reason);
  };

  return (
    <span style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
      <button className="linklike" onClick={() => setOpen(o => !o)}>{open ? 'close ▴' : 'change ▾'}</button>
      {open && (
        <div className="statusmenu">
          {error && <p className="muted" style={{ color: 'var(--g4)' }}>{error}</p>}
          {(project.status === 'potential' || project.status === 'queued') && <>
            <select className="formctl" value={pace} onChange={e => setPace(e.target.value)}>
              {['rapid', 'short', 'mid', 'long'].map(p => <option key={p} value={p}>{PACE_LABEL[p]}</option>)}
            </select>
            <input className="formctl" list={`sm-owners-${project.id}`} placeholder="owner (required)"
              value={owner} onChange={e => setOwner(e.target.value)} />
            <datalist id={`sm-owners-${project.id}`}>{knownOwners.map(n => <option key={n} value={n} />)}</datalist>
            <button disabled={!owner.trim()} onClick={agree}>Agree</button>
          </>}
          {project.status === 'live' && <>
            <button onClick={() => run(pauseProject, project.id)}>Pause</button>
            <button onClick={complete}>Complete</button>
          </>}
          {project.status === 'paused' && <button onClick={() => run(resumeLive, project.id)}>Resume</button>}
          {project.status === 'completed' && <button onClick={() => run(moveBackLive, project.id)}>Move back to live</button>}
          {['potential', 'queued', 'live', 'paused'].includes(project.status) && <button onClick={cancel}>Cancel</button>}
        </div>
      )}
      {textDialog}
    </span>
  );
}
