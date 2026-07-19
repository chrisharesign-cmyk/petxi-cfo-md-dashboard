import { useEffect, useState } from 'react';
import { supa, REVIEWERS } from './supa';
import { loadNotes, addNote, editNote, promoteLive, pauseProject, resumeLive,
  moveBackLive, completeProject, cancelProject, loadMeetingsForProject,
  archiveProject, unarchiveProject, markProjectDiscussed } from './data';
import { PACE_LABEL, PACE_DESC, statusBadge, fmtDate, describeChange,
  friendlyProjectError, daysInStage, isOverStageLimit, buildProjectPrompt, RAG_LABEL } from './util';
import EditableText from './EditableText';
import { OwnerEditor, ScheduleEditor, AreaEditor, RagEditor } from './ProjectControls';
import { usePrompt, useConfirm } from './Dialogs';
import ProjectDocuments from './Documents';
import ProjectLinks from './ProjectLinks';

// The official SAR score right now — distinct from project.progress_rag,
// which is the informal on-track/at-risk read between formal periods.
function officialCurrentGrade(p, data) {
  const rows = p.scope === 'unit'
    ? data.scores.filter(s => s.unit_id === p.unit_id && s.criterion_id === p.criterion_id)
    : data.oscores.filter(s => s.function_id === p.function_id && s.criterion_id === p.criterion_id);
  return rows.length ? Math.max(...rows.map(r => r.score)) : null;
}

// Anything leaving To discuss gets a date (from pace) and an owner, in the
// same step — no more "queue for later, decide details another day".
function AgreePace({ project, data, act }) {
  const [pace, setPace] = useState('rapid');
  const [owner, setOwner] = useState(project.owner || '');
  const known = [...new Set([...REVIEWERS.map(r => r.name), ...data.projects.map(p => p.owner).filter(Boolean)])];
  const canAgree = owner.trim().length > 0;
  return (
    <span style={{ display: 'inline-flex', gap: '.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
      <select className="formctl" value={pace} onChange={e => setPace(e.target.value)}>
        {['rapid', 'short', 'mid', 'long'].map(p => <option key={p} value={p}>{PACE_LABEL[p]} — {PACE_DESC[p]}</option>)}
      </select>
      <input className="formctl" list={`agree-owners-${project.id}`} placeholder="owner (required)"
        value={owner} onChange={e => setOwner(e.target.value)} style={{ width: 160 }} />
      <datalist id={`agree-owners-${project.id}`}>{known.map(n => <option key={n} value={n} />)}</datalist>
      <button className="btn primary" disabled={!canAgree}
        onClick={() => act(promoteLive, project.id, pace, data.period, { owner: owner.trim() })}>Agree</button>
    </span>
  );
}

export default function CaseFile({ projectId, me, data, onBack, onRefresh }) {
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
  const [askConfirm, confirmDialog] = useConfirm();

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
    <>
      <button className="linklike" onClick={onBack}>← Back</button>
      <div className="card" style={{ marginTop: '1rem' }}>
        <p>Couldn't find that project — it may have just been refreshed. Go back and try again.</p>
      </div>
    </>
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
  ].sort((a, b) => new Date(b.at) - new Date(a.at));

  const act = async (fn, ...args) => {
    setBusy(true); setActionError('');
    try { await fn(...args); await load(); onRefresh(); }
    catch (e) { setActionError(friendlyProjectError(e)); }
    finally { setBusy(false); }
  };

  const complete = async () => {
    const what = await askText('What changed? Required to mark this complete.', { confirmLabel: 'Complete' });
    if (!what) return;
    await act(completeProject, project.id, { what_changed: what, grade_at_completion: officialCurrentGrade(project, data) });
  };
  const cancel = async () => {
    const reason = await askText('Reason for cancelling — kept on record, not deleted.', { confirmLabel: 'Cancel project', danger: true });
    if (!reason) return;
    await act(cancelProject, project.id, reason);
  };
  const archive = async () => {
    const ok = await askConfirm('Archive this project? It stops showing up anywhere by default (and stops counting toward its criterion\'s live-project total), but nothing is deleted — you can bring it back any time.', { confirmLabel: 'Archive', danger: true });
    if (!ok) return;
    await act(archiveProject, project.id);
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
  const copyPrompt = () => {
    navigator.clipboard?.writeText(buildProjectPrompt(project, data));
    setCopied(true); setTimeout(() => setCopied(false), 2500);
  };

  return (
    <>
      <button className="linklike" onClick={onBack}>← Back</button>
      <div className="panel-h" style={{ marginTop: '.6rem' }}>
        <span className="bar" style={{ background: 'var(--g1)' }} />
        <EditableText table="projects" id={project.id} field="title" value={project.title} className="areaTitle" onSaved={onRefresh} />
      </div>

      {project.archived_at && (
        <div className="card" style={{ borderColor: 'var(--g4)', marginTop: '1rem' }}>
          Archived {new Date(project.archived_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} —
          hidden by default and not counted as running.{' '}
          <button className="btn" disabled={busy} onClick={() => act(unarchiveProject, project.id)}>Unarchive</button>
        </div>
      )}

      <div className="card" style={{ marginTop: '1rem' }}>
        <div className="casefile-meta">
          <AreaEditor project={project} data={data} onSaved={onRefresh} />
          <span className="meta-sep">·</span>
          <span>owner <OwnerEditor project={project} data={data} onSaved={onRefresh} /></span>
          <span className="meta-sep">·</span>
          <span>target <ScheduleEditor project={project} data={data} onSaved={onRefresh} /></span>
        </div>

        <div className="casefile-meta" style={{ marginTop: '.5rem' }}>
          <span className={`st ${badge.cls}`}>{badge.label}</span>
          {days !== null && !['completed', 'cancelled'].includes(project.status) && (
            <span className={overLimit ? 'at-stage-warn' : ''}>
              {days}d at this stage{overLimit ? ` ⚠ over 14d limit for ${PACE_LABEL[project.pace]}` : ''}
            </span>
          )}
          {!['completed', 'cancelled'].includes(project.status) && <>
            <span className="meta-sep">·</span>
            <span title="Informal — how it's going right now. Separate from the locked SAR grade, which only updates at the start of next quarter's assessment.">
              progress ⓘ <RagEditor project={project} onSaved={onRefresh} />
              {project.progress_rag && <span className="muted" style={{ marginLeft: '.3rem' }}>{RAG_LABEL[project.progress_rag]}</span>}
            </span>
          </>}
        </div>

        <div className="casefile-actions" style={{ marginTop: '.8rem' }}>
          {project.status === 'potential' && <AgreePace project={project} data={data} act={act} />}
          {project.status === 'queued' && <AgreePace project={project} data={data} act={act} />}
          {project.status === 'live' && <>
            <button className="btn" disabled={busy} onClick={() => act(pauseProject, project.id)}>Pause</button>
            <button className="btn" disabled={busy} onClick={complete}>Complete</button>
          </>}
          {project.status === 'paused' && <button className="btn" disabled={busy} onClick={() => act(resumeLive, project.id)}>Resume — back to live</button>}
          {project.status === 'completed' && <button className="btn" disabled={busy} onClick={() => act(moveBackLive, project.id)}>Moved back — regressed to live</button>}
          {['potential', 'queued', 'live', 'paused'].includes(project.status) &&
            <button className="btn" disabled={busy} onClick={cancel}>Cancel</button>}
          {!project.discussed_at && <button className="btn" disabled={busy} onClick={() => act(markProjectDiscussed, project.id)}>Mark discussed</button>}
          {!project.archived_at && <button className="btn" disabled={busy} onClick={archive}>Archive</button>}
        </div>
        {actionError && <p className="muted" style={{ color: 'var(--g4)', marginTop: '.5rem' }}>{actionError}</p>}
        {project.status === 'completed' && (
          <p className="muted" style={{ marginTop: '.5rem' }}>Created at {project.grade_at_creation} → completed at {project.grade_at_completion ?? '—'}. {project.what_changed}</p>
        )}
      </div>

      <div className="card thoughts-card" style={{ marginTop: '1rem' }}>
        <h4 className="crit-card-h">Project Summary</h4>
        <p className="thoughts-sub">What this project is and why — written by whoever assigns it.</p>
        <EditableCaseText table="projects" id={project.id} field="summary" value={project.summary}
          placeholder="No summary yet — click to write one" onSaved={onRefresh} />
      </div>

      <div className="card thoughts-card" style={{ marginTop: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <h4 className="crit-card-h">Project Plan</h4>
          <button className="btn" onClick={copyPrompt} title="Copies a ready-made prompt describing this problem — paste it into claude.ai, then paste the answer back in below">
            {copied ? 'Copied ✓' : 'Copy prompt for Claude'}
          </button>
        </div>
        <p className="thoughts-sub">How to actually do it — written by the owner once they've picked it up.</p>
        <EditableCaseText table="projects" id={project.id} field="suggested_solution" value={project.suggested_solution}
          placeholder="No plan yet — click to write one" onSaved={onRefresh} />
      </div>

      {meetings.length > 0 && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <h4 className="crit-card-h">Meetings ({meetings.length})</h4>
          {meetings.map(m => (
            <div key={m.id} style={{ marginTop: '.5rem' }}>
              <button className="linklike" onClick={() => setOpenMeetingId(openMeetingId === m.id ? null : m.id)}>
                {new Date(m.started_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                {m.title ? ` — ${m.title}` : ''}{m.minutes ? ' 📝' : ''}
              </button>
              {openMeetingId === m.id && (
                <p className="muted" style={{ fontSize: '.82rem', marginTop: '.3rem', marginLeft: '1rem' }}>
                  {m.minutes || 'No minutes added yet — record and paste them in from the Meetings tab.'}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="card" style={{ marginTop: '1rem' }}>
        <ProjectLinks project={project} me={me} data={data} />
      </div>

      <div className="card" style={{ marginTop: '1rem' }}>
        <ProjectDocuments projectId={project.id} me={me} />
      </div>

      <div className="card" style={{ marginTop: '1rem' }}>
        <h4 className="crit-card-h">Timeline</h4>
        <div className="feed" style={{ marginTop: '.6rem' }}>
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

        <p className="muted" style={{ fontSize: '.78rem', marginTop: '.8rem' }}>This is your progress-update log — what's happened with the plan since last time.</p>
        <form onSubmit={submitNote} style={{ marginTop: '.4rem', display: 'flex', gap: '.5rem' }}>
          <input className="formctl" placeholder={`What's happened this week? — ${me}`} value={noteBody} onChange={e => setNoteBody(e.target.value)} style={{ flex: 1 }} />
          <button className="btn primary" disabled={busy}>Add</button>
        </form>
      </div>
      {textDialog}
      {confirmDialog}
    </>
  );
}

// Long-form fields (Summary, Plan) — same click-to-edit pattern as
// EditableText, but a taller, wider textarea befitting multi-paragraph
// content instead of the compact inline-field size EditableText assumes.
function EditableCaseText({ table, id, field, value, placeholder, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setBusy(true); setError('');
    try {
      const { error: err } = await supa.from(table).update({ [field]: draft }).eq('id', id);
      if (err) throw err;
      setEditing(false);
      onSaved?.();
    } catch (e) { setError(e.message || String(e)); }
    finally { setBusy(false); }
  };

  if (!editing) {
    return (
      <div className="editable" style={{ whiteSpace: 'pre-wrap' }} onClick={() => { setDraft(value || ''); setEditing(true); }} title="Click to edit">
        {value || <span className="muted">{placeholder}</span>}
      </div>
    );
  }
  return (
    <div>
      <textarea className="formctl" value={draft} onChange={e => setDraft(e.target.value)} autoFocus rows={12}
        style={{ width: '100%', fontSize: '.95rem', lineHeight: 1.6 }}
        onKeyDown={e => { if (e.key === 'Escape') setEditing(false); }} />
      <div style={{ marginTop: '.5rem', display: 'flex', gap: '.5rem' }}>
        <button className="btn primary" disabled={busy} onClick={save}>Save</button>
        <button className="btn" onClick={() => setEditing(false)}>Cancel</button>
      </div>
      {error && <p className="muted" style={{ color: 'var(--g4)' }}>{error}</p>}
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
