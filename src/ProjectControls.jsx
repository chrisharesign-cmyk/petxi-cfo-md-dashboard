import { useState } from 'react';
import { supa, REVIEWERS } from './supa';
import { promoteLive, queueProject, pauseProject, resumeLive, moveBackLive,
  completeProject, cancelProject, updateProjectDue } from './data';
import { PACE_LABEL, PACE_DESC, friendlyProjectError } from './util';
import { usePrompt } from './Dialogs';

// Owner isn't limited to the two reviewers — anyone (Josh, ops staff, etc.)
// can be named. Typing a new name and saving it writes straight to
// projects.owner in Supabase; it then shows up as a suggestion next time,
// built from every distinct owner already in use.
export function OwnerEditor({ project, data, onSaved }) {
  const [value, setValue] = useState(project.owner || '');
  const [editing, setEditing] = useState(false);
  const known = [...new Set([...REVIEWERS.map(r => r.name), ...data.projects.map(p => p.owner).filter(Boolean)])];

  const save = async () => {
    const { error } = await supa.from('projects').update({ owner: value || null, updated_at: new Date().toISOString() }).eq('id', project.id);
    if (!error) { setEditing(false); onSaved?.(); }
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
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }} />
      <datalist id={`owners-${project.id}`}>{known.map(n => <option key={n} value={n} />)}</datalist>
      <button onClick={save}>Save</button>
      <button type="button" onClick={() => setEditing(false)}>Cancel</button>
    </span>
  );
}

const IMPACT_LABEL = { G: 'High', A: 'Medium', R: 'Low' };
export function ImpactEditor({ project, onSaved }) {
  const save = async (val) => {
    const { error } = await supa.from('projects').update({ impact: val || null, updated_at: new Date().toISOString() }).eq('id', project.id);
    if (!error) onSaved?.();
  };
  return (
    <select className="formctl" value={project.impact || ''} onClick={e => e.stopPropagation()} onChange={e => save(e.target.value)}>
      <option value="">—</option>
      {Object.entries(IMPACT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
    </select>
  );
}

export function TargetEditor({ project, onSaved }) {
  return (
    <input type="date" className="formctl" value={project.due || ''} onClick={e => e.stopPropagation()}
      onChange={async e => { await updateProjectDue(project.id, e.target.value); onSaved?.(); }} />
  );
}

// Compact version of the case file's status actions, for editing straight
// from a table row without opening the case file. Same guarded functions —
// completing still requires a note, cancelling still requires a reason.
export function StatusMenu({ project, data, onSaved }) {
  const [open, setOpen] = useState(false);
  const [pace, setPace] = useState('rapid');
  const [error, setError] = useState('');
  const [askText, textDialog] = usePrompt();

  const run = async (fn, ...args) => {
    setError('');
    try { await fn(...args); setOpen(false); onSaved?.(); }
    catch (e) { setError(friendlyProjectError(e, data, project)); }
  };
  const complete = async () => {
    const what = await askText('What changed? Required to mark this complete.', { confirmLabel: 'Complete' });
    if (!what) return;
    const rows = project.scope === 'unit'
      ? data.scores.filter(s => s.unit_id === project.unit_id && s.criterion_id === project.criterion_id)
      : data.oscores.filter(s => s.function_id === project.function_id && s.criterion_id === project.criterion_id);
    const grade = rows.length ? Math.max(...rows.map(r => r.score)) : null;
    run(completeProject, project.id, { what_changed: what, grade_at_completion: grade });
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
          {project.status === 'potential' && <>
            <select className="formctl" value={pace} onChange={e => setPace(e.target.value)}>
              {['rapid', 'short', 'mid', 'long'].map(p => <option key={p} value={p}>{PACE_LABEL[p]}</option>)}
            </select>
            <button onClick={() => run(promoteLive, project.id, pace, data.period)}>Agree</button>
            <button onClick={() => run(queueProject, project.id)}>Queue for later</button>
          </>}
          {project.status === 'queued' && <>
            <select className="formctl" value={pace} onChange={e => setPace(e.target.value)}>
              {['rapid', 'short', 'mid', 'long'].map(p => <option key={p} value={p}>{PACE_LABEL[p]}</option>)}
            </select>
            <button onClick={() => run(promoteLive, project.id, pace, data.period)}>Agree</button>
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
