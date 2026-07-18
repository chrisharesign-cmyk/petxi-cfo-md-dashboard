import { useEffect, useState } from 'react';
import { supa } from './supa';
import { loadNotes, addNote, editNote, promoteLive, queueProject, pauseProject, resumeLive,
  moveBackLive, completeProject, cancelProject, updateProjectDue, updateCurrentGrade, loadMeetingsForProject } from './data';
import { PACE_LABEL, PACE_DESC, statusBadge, fmtDate, describeChange,
  friendlyProjectError, daysInStage, isOverStageLimit, buildProjectPrompt, gradeMovement } from './util';
import EditableText from './EditableText';
import { OwnerEditor, TargetEditor, AreaEditor } from './ProjectControls';
import { usePrompt } from './Dialogs';

// The official SAR score right now — distinct from project.current_grade,
// which is the informal, project-linked re-read between formal periods.
function officialCurrentGrade(p, data) {
  const rows = p.scope === 'unit'
    ? data.scores.filter(s => s.unit_id === p.unit_id && s.criterion_id === p.criterion_id)
    : data.oscores.filter(s => s.function_id === p.function_id && s.criterion_id === p.criterion_id);
  return rows.length ? Math.max(...rows.map(r => r.score)) : null;
}

function AgreePace({ project, data, act }) {
  const [pace, setPace] = useState('rapid');
  return (
    <span style={{ display: 'inline-flex', gap: '.4rem', alignItems: 'center' }}>
      <select className="formctl" value={pace} onChange={e => setPace(e.target.value)}>
        {['rapid', 'short', 'mid', 'long'].map(p => <option key={p} value={p}>{PACE_LABEL[p]} — {PACE_DESC[p]}</option>)}
      </select>
      <button className="btn primary" onClick={() => act(promoteLive, project.id, pace, data.period)}>Agree</button>
    </span>
  );
}

export default function CaseFile({ projectId, me, data, onClose, onRefresh }) {
  const [notes, setNotes] = useState([]);
  const [audit, setAudit] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [openMeetingId, setOpenMeetingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [noteBody, setNoteBody] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editBody, setEditBody] = useState('');
  const [actionError, setActionError] = useState('');
  const [copied, setCopied] = useState(false);
  const [askText, textDialog] = usePrompt();

  const project = data.projects.find(p => p.id === projectId);

  const load = async () => {
    const [n, a] = await Promise.all([
      loadNotes(projectId),
      supa.from('audit_log').select('*').eq('table_name', 'projects').eq('record_pk', String(projectId)).order('at'),
    ]);
    setNotes(n);
    setAudit(a.data || []);
    setMeetings(await loadMeetingsForProject(projectId).catch(() => []));
  };
  useEffect(() => { load(); }, [projectId]);

  if (!project) return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <button className="modalclose" onClick={onClose}>×</button>
        <p>Couldn't find that project — it may have just been refreshed. Close and try again.</p>
      </div>
    </div>
  );

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
    ...audit.filter(r => r.action === 'UPDATE')
      .map(r => ({ at: r.at, kind: 'change', text: describeChange(r), actor: r.actor_name }))
      .filter(r => r.text), // drop rows where nothing user-visible actually changed
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
    const what = await askText('What changed? Required to mark this complete.', { confirmLabel: 'Complete' });
    if (!what) return;
    await act(completeProject, project.id, { what_changed: what, grade_at_completion: project.current_grade ?? officialCurrentGrade(project, data) });
  };
  const cancel = async () => {
    const reason = await askText('Reason for cancelling — kept on record, not deleted.', { confirmLabel: 'Cancel project', danger: true });
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

  const badge = statusBadge(project);
  const days = daysInStage(project.status_changed_at);
  const overLimit = isOverStageLimit(project, days);
  const movement = gradeMovement(project);
  const copyPrompt = () => {
    navigator.clipboard?.writeText(buildProjectPrompt(project, data));
    setCopied(true); setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal casefile" onClick={e => e.stopPropagation()}>
        <button className="modalclose" onClick={onClose}>×</button>
        <h3><EditableText table="projects" id={project.id} field="title" value={project.title} onSaved={onRefresh} /></h3>

        <div className="casefile-meta">
          <AreaEditor project={project} data={data} onSaved={onRefresh} />
          <span className="meta-sep">·</span>
          <span>owner <OwnerEditor project={project} data={data} onSaved={onRefresh} /></span>
          <span className="meta-sep">·</span>
          <span>target <TargetEditor project={project} onSaved={onRefresh} /></span>
        </div>

        <div className="casefile-meta" style={{ marginTop: '.3rem' }}>
          <span className={`st ${badge.cls}`}>{badge.label}</span>
          {days !== null && !['completed', 'cancelled'].includes(project.status) && (
            <span className={overLimit ? 'at-stage-warn' : ''}>
              {days}d at this stage{overLimit ? ` ⚠ over 14d limit for ${PACE_LABEL[project.pace]}` : ''}
            </span>
          )}
          {!['completed', 'cancelled'].includes(project.status) && <>
            <span className="meta-sep">·</span>
            <span title={`Informal — separate from the locked SAR score, graded ${project.grade_at_creation} at creation`}>
              current read ⓘ <select className="formctl" value={project.current_grade ?? ''}
                onChange={e => act(updateCurrentGrade, project.id, e.target.value ? Number(e.target.value) : null)}>
                <option value="">— unchanged —</option>
                {[1, 2, 3, 4].map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </span>
            {movement && (
              <span style={{ color: movement.improved ? 'var(--g2)' : 'var(--g4)', fontWeight: 700 }}>
                {movement.improved ? '🎉' : '⚠'} {movement.from} → {movement.to}
              </span>
            )}
          </>}
        </div>

        <div className="casefile-actions">
          {project.status === 'potential' && <>
            <AgreePace project={project} data={data} act={act} />
            <button className="btn" disabled={busy} onClick={() => act(queueProject, project.id)}>Queue for later</button>
          </>}
          {project.status === 'queued' && <AgreePace project={project} data={data} act={act} />}
          {project.status === 'live' && <>
            <button className="btn" disabled={busy} onClick={() => act(pauseProject, project.id)}>Pause</button>
            <button className="btn primary" disabled={busy} onClick={complete}>Complete</button>
          </>}
          {project.status === 'paused' && <button className="btn primary" disabled={busy} onClick={() => act(resumeLive, project.id)}>Resume — back to live</button>}
          {project.status === 'completed' && <button className="btn" disabled={busy} onClick={() => act(moveBackLive, project.id)}>Moved back — regressed to live</button>}
          {['potential', 'queued', 'live', 'paused'].includes(project.status) &&
            <button className="btn danger" disabled={busy} onClick={cancel}>Cancel</button>}
        </div>
        {actionError && <p className="muted" style={{ color: 'var(--g4)' }}>{actionError}</p>}

        {project.status === 'completed' && (
          <p className="muted">Created at {project.grade_at_creation} → completed at {project.grade_at_completion ?? '—'}. {project.what_changed}</p>
        )}

        <div className="plan-box">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h4 style={{ margin: 0 }}>Plan</h4>
            <button className="btn" onClick={copyPrompt} title="Copies a ready-made prompt describing this problem — paste it into claude.ai, then paste the answer back in below">
              {copied ? 'Copied ✓' : 'Copy prompt for Claude'}
            </button>
          </div>
          <EditableText table="projects" id={project.id} field="suggested_solution" value={project.suggested_solution}
            placeholder="No plan yet — click to write one" multiline
            onSaved={onRefresh} />
        </div>

        {meetings.length > 0 && (
          <div style={{ marginTop: '1rem' }}>
            <h4>Meetings ({meetings.length})</h4>
            {meetings.map(m => (
              <div key={m.id} style={{ marginTop: '.3rem' }}>
                <button className="linklike" onClick={() => setOpenMeetingId(openMeetingId === m.id ? null : m.id)}>
                  {new Date(m.started_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  {m.title ? ` — ${m.title}` : ''}{m.minutes ? ' 📝' : ''}
                </button>
                {openMeetingId === m.id && (
                  <p className="muted" style={{ fontSize: '.78rem', marginLeft: '1rem' }}>
                    {m.minutes || 'No minutes added yet — record and paste them in from the Meetings tab.'}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        <h4 style={{ marginTop: '1rem' }}>Timeline</h4>
        <div className="feed">
          {feed.map((f, i) => (
            <div key={i} className="feeditem">
              <span className="muted" style={{ fontSize: '.7rem' }}>{new Date(f.at).toLocaleString('en-GB')}</span>
              {f.kind !== 'note' ? (
                <p>{f.text}{f.actor && f.actor !== 'unknown' && <span className="muted"> — {f.actor}</span>}</p>
              ) : (
                <div>
                  <p><b>{f.note.author}</b>: {editingId === f.note.id
                    ? <form onSubmit={e => { e.preventDefault(); saveEdit(f.note); }} style={{ display: 'inline-flex', gap: '.3rem' }}>
                        <input className="formctl" value={editBody} onChange={e => setEditBody(e.target.value)} />
                        <button className="btn">Save</button> <button type="button" className="btn" onClick={() => setEditingId(null)}>Cancel</button>
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

        <p className="muted" style={{ fontSize: '.74rem', marginTop: '.8rem' }}>This is your progress-update log — what's happened with the plan since last time.</p>
        <form onSubmit={submitNote} style={{ marginTop: '.3rem', display: 'flex', gap: '.4rem' }}>
          <input className="formctl" placeholder={`What's happened this week? — ${me}`} value={noteBody} onChange={e => setNoteBody(e.target.value)} style={{ flex: 1 }} />
          <button className="btn primary" disabled={busy}>Add</button>
        </form>
      </div>
      {textDialog}
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
