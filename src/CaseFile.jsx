import { useEffect, useState } from 'react';
import { supa } from './supa';
import { loadNotes, addNote, editNote, promoteLive, queueProject, pauseProject, resumeLive,
  moveBackLive, completeProject, cancelProject, updateProjectDue } from './data';
import { STATUS_LABEL, fmtDate, describeChange, friendlyProjectError } from './util';

function areaName(p, data) {
  return p.scope === 'unit'
    ? data.units.find(u => u.id === p.unit_id)?.name
    : data.ofuncs.find(f => f.id === p.function_id)?.name;
}
function critName(p, data) {
  return p.scope === 'unit'
    ? data.criteria.find(c => c.id === p.criterion_id)?.name
    : data.ocrit.find(c => c.id === p.criterion_id)?.name;
}
function currentGrade(p, data) {
  const rows = p.scope === 'unit'
    ? data.scores.filter(s => s.unit_id === p.unit_id && s.criterion_id === p.criterion_id)
    : data.oscores.filter(s => s.function_id === p.function_id && s.criterion_id === p.criterion_id);
  return rows.length ? Math.max(...rows.map(r => r.score)) : null;
}

export default function CaseFile({ projectId, me, data, onClose, onRefresh }) {
  const [notes, setNotes] = useState([]);
  const [audit, setAudit] = useState([]);
  const [busy, setBusy] = useState(false);
  const [noteBody, setNoteBody] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editBody, setEditBody] = useState('');
  const [actionError, setActionError] = useState('');

  const project = data.projects.find(p => p.id === projectId);

  const load = async () => {
    const [n, a] = await Promise.all([
      loadNotes(projectId),
      supa.from('audit_log').select('*').eq('table_name', 'projects').eq('record_pk', String(projectId)).order('at'),
    ]);
    setNotes(n);
    setAudit(a.data || []);
  };
  useEffect(() => { load(); }, [projectId]);

  if (!project) return null;

  // A note's edit history is a chain of rows linked by replaces_note_id.
  // Walk forward from the root to the latest version; show that as current,
  // with every earlier version available to expand.
  const nextOf = (id) => notes.find(n => n.replaces_note_id === id);
  const chainFrom = (root) => {
    const chain = [root]; let cur = root, nxt;
    while ((nxt = nextOf(cur.id))) { chain.push(nxt); cur = nxt; }
    return chain;
  };

  const feed = [
    { at: project.created_at, kind: 'created', text: `Created — graded ${project.grade_at_creation ?? '—'} at creation.` },
    ...audit.filter(r => r.action === 'UPDATE').map(r => ({ at: r.at, kind: 'change', text: describeChange(r), actor: r.actor_name })),
    ...notes.filter(n => !n.replaces_note_id).map(root => {
      const chain = chainFrom(root);
      return { at: root.created_at, kind: 'note', note: chain[chain.length - 1], prior: chain.slice(0, -1) };
    }),
  ].sort((a, b) => new Date(a.at) - new Date(b.at));

  const act = async (fn, ...args) => {
    setBusy(true); setActionError('');
    try { await fn(...args); await load(); onRefresh(); }
    catch (e) { setActionError(friendlyProjectError(e, data, project)); }
    finally { setBusy(false); }
  };

  const complete = async () => {
    const what = prompt('What changed? (required to complete)');
    if (!what) return;
    await act(completeProject, project.id, { what_changed: what, grade_at_completion: currentGrade(project, data) });
  };
  const cancel = async () => {
    const reason = prompt('Reason for cancelling (kept on record, not deleted):');
    if (!reason) return;
    await act(cancelProject, project.id, reason);
  };
  const submitNote = async e => {
    e.preventDefault();
    if (!noteBody.trim()) return;
    await act(addNote, project.id, me, noteBody.trim());
    setNoteBody('');
  };
  const saveEdit = async (note) => {
    await act(editNote, note, editBody.trim());
    setEditingId(null);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal casefile" onClick={e => e.stopPropagation()}>
        <button className="modalclose" onClick={onClose}>×</button>
        <h3>{project.title}</h3>
        <p className="muted">{areaName(project, data)} &gt; {critName(project, data)} · owner {project.owner || '—'} · target {fmtDate(project.due)}</p>
        <p><span className={`st st-${project.status === 'live' ? 'rapid' : project.status === 'completed' ? 'done' : 'hold'}`}>{STATUS_LABEL[project.status]}</span></p>

        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', margin: '.6rem 0' }}>
          {project.status === 'potential' && <>
            <button disabled={busy} onClick={() => act(promoteLive, project.id)}>Tick — start now</button>
            <button disabled={busy} onClick={() => act(queueProject, project.id)}>Line up</button>
          </>}
          {project.status === 'queued' && <button disabled={busy} onClick={() => act(promoteLive, project.id)}>Promote to live</button>}
          {project.status === 'live' && <>
            <button disabled={busy} onClick={() => act(pauseProject, project.id)}>Pause</button>
            <button disabled={busy} onClick={complete}>Complete</button>
          </>}
          {project.status === 'paused' && <button disabled={busy} onClick={() => act(resumeLive, project.id)}>Resume — back to live</button>}
          {project.status === 'completed' && <button disabled={busy} onClick={() => act(moveBackLive, project.id)}>Moved back — regressed to live</button>}
          {['potential', 'queued', 'live', 'paused'].includes(project.status) &&
            <button disabled={busy} onClick={cancel}>Cancel</button>}
          {['live', 'paused'].includes(project.status) && (
            <input type="date" value={project.due || ''} onChange={e => act(updateProjectDue, project.id, e.target.value)} title="Target date" />
          )}
        </div>
        {actionError && <p className="muted" style={{ color: 'var(--g4)' }}>{actionError}</p>}

        {project.status === 'completed' && (
          <p className="muted">Created at {project.grade_at_creation} → completed at {project.grade_at_completion ?? '—'}. {project.what_changed}</p>
        )}
        {project.suggested_solution && <p className="muted"><b>Suggested:</b> {project.suggested_solution}</p>}

        <h4 style={{ marginTop: '1rem' }}>Timeline</h4>
        <div className="feed">
          {feed.map((f, i) => (
            <div key={i} className="feeditem">
              <span className="muted" style={{ fontSize: '.7rem' }}>{new Date(f.at).toLocaleString('en-GB')}</span>
              {f.kind !== 'note' ? (
                <p>{f.text}{f.actor && <span className="muted"> — {f.actor}</span>}</p>
              ) : (
                <div>
                  <p><b>{f.note.author}</b>: {editingId === f.note.id
                    ? <form onSubmit={e => { e.preventDefault(); saveEdit(f.note); }}>
                        <input value={editBody} onChange={e => setEditBody(e.target.value)} />
                        <button>Save</button> <button type="button" onClick={() => setEditingId(null)}>Cancel</button>
                      </form>
                    : f.note.body}
                    {editingId !== f.note.id && f.note.author === me &&
                      <button className="linklike" onClick={() => { setEditingId(f.note.id); setEditBody(f.note.body); }}> edit</button>}
                  </p>
                  {f.prior.length > 0 && <EditHistory edits={f.prior} />}
                </div>
              )}
            </div>
          ))}
        </div>

        <form onSubmit={submitNote} style={{ marginTop: '.8rem', display: 'flex', gap: '.4rem' }}>
          <input placeholder={`Add a note as ${me}`} value={noteBody} onChange={e => setNoteBody(e.target.value)} style={{ flex: 1, padding: '.4rem' }} />
          <button disabled={busy}>Add</button>
        </form>
      </div>
    </div>
  );
}

function EditHistory({ edits }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginLeft: '1rem' }}>
      <button className="linklike" onClick={() => setOpen(o => !o)}>edited — {open ? 'hide' : 'view'} previous</button>
      {open && edits.map(e => <p key={e.id} className="muted" style={{ fontSize: '.78rem' }}>{new Date(e.created_at).toLocaleString('en-GB')}: {e.body}</p>)}
    </div>
  );
}
