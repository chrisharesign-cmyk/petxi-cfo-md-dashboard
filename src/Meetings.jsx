import { useEffect, useRef, useState } from 'react';
import { startMeeting, endMeeting, loadMeetings, updateMeeting, deleteMeeting,
  markProjectDiscussed, loadMeetingDocuments, uploadMeetingDocument, deleteMeetingDocument, meetingDocumentUrl,
  loadNotes, addNote } from './data';
import { qipAgenda, projectAgenda } from './agenda';
import { fmtDate, PACE_LABEL, statusBadge, RAG_LABEL, daysInStage } from './util';
import { useConfirm } from './Dialogs';

// 'criterion' stays here only so an old row (started before this kind was
// retired) still renders sensibly in the past-meetings list — it's no
// longer offered as a way to start a new one.
const KIND_LABEL = { qip: 'QIP meeting', project: 'Project meeting', criterion: 'Criterion meeting' };
const KIND_CLASS = { qip: 'st-fix', project: 'st-embed', criterion: 'st-hold' };

const cellKeyOf = w => `${w.scope}:${w.unit_id || w.function_id}:${w.criterion_id}`;

export default function MeetingsTab({ data, me, onRefresh }) {
  const [kind, setKind] = useState('qip');
  const [projectId, setProjectId] = useState('');
  const [agenda, setAgenda] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [meeting, setMeeting] = useState(null);
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState([]);
  const [supported, setSupported] = useState(true);
  const [past, setPast] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [expandedKey, setExpandedKey] = useState(null);
  const [busy, setBusy] = useState(false);
  const recRef = useRef(null);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    setSupported(!!SR);
  }, []);

  const refreshPast = () => loadMeetings().then(setPast).catch(() => {});
  useEffect(() => { refreshPast(); }, []);

  useEffect(() => {
    if (transcript.length) localStorage.setItem('petxi-meeting-draft', JSON.stringify(transcript));
  }, [transcript]);

  const selectedProject = projectId ? data.projects.find(p => String(p.id) === String(projectId)) : null;

  // Every grade-4 is on the agenda by default — a 4 always needs raising.
  // Grade-3s are there to pick from, not forced on.
  const prepareAgenda = () => {
    const a = kind === 'qip' ? qipAgenda(data) : projectAgenda(selectedProject, data);
    setAgenda(a);
    setExpandedKey(null);
    if (kind === 'qip') setSelected(new Set([...a.grade4.solutions, ...a.grade4.progress].map(cellKeyOf)));
  };
  const toggleSelected = key => setSelected(s => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const allAgendaRows = () => !agenda || kind !== 'qip' ? [] :
    [...agenda.grade4.solutions, ...agenda.grade4.progress, ...agenda.grade3.solutions, ...agenda.grade3.progress];

  const markNewDiscussed = async (id) => {
    await markProjectDiscussed(id);
    onRefresh?.();
    setAgenda(a => (a && a.newProjects) ? { ...a, newProjects: a.newProjects.filter(p => p.id !== id) } : a);
  };

  const startSpeech = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (ev) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) setTranscript(t => [...t, { at: new Date().toISOString(), text: ev.results[i][0].transcript }]);
      }
    };
    rec.onend = () => { if (recRef.current) rec.start(); }; // keep alive through drilling into agenda items
    recRef.current = rec;
    rec.start();
  };

  // Saves the agenda you actually picked (not every 3/4 by default) and
  // starts recording in one step — the meeting row and its snapshot of
  // what's on today's agenda are created together.
  const saveAgendaAndRecord = async () => {
    setBusy(true);
    try {
      const rows = allAgendaRows().filter(w => selected.has(cellKeyOf(w)))
        .map(w => ({ scope: w.scope, unit_id: w.unit_id ?? null, function_id: w.function_id ?? null, criterion_id: w.criterion_id, grade_at_meeting: w.grade }));
      const m = await startMeeting(me, data.period?.id, { kind, project_id: kind === 'project' ? Number(projectId) : null, agendaRows: rows });
      setMeeting(m);
      setTranscript([]);
      setRecording(true);
      setExpandedKey(null);
      startSpeech();
    } finally { setBusy(false); }
  };

  const stopRec = async () => {
    const rec = recRef.current;
    recRef.current = null;
    rec?.stop?.();
    setRecording(false);
    if (meeting) {
      await endMeeting(meeting.id, { transcript, attendees: [me], promoted_project_ids: [] });
      localStorage.removeItem('petxi-meeting-draft');
      setMeeting(null); setAgenda(null); setSelected(new Set()); setExpandedKey(null);
      refreshPast();
    }
  };

  const backToSetup = () => { setAgenda(null); setSelected(new Set()); setExpandedKey(null); };

  const copyForClaude = (lines) => {
    const prompt = `Write up minutes from this PET-Xi meeting transcript. Summarise decisions, ` +
      `list any projects agreed or actions assigned, and note follow-ups.\n\nTranscript:\n` +
      lines.map(t => `[${t.at}] ${t.text}`).join('\n');
    navigator.clipboard?.writeText(prompt);
  };

  const building = agenda && !meeting; // agenda picked, not recording yet
  const live = !!meeting; // recording (or just about to stop)

  return (
    <>
      <div className="panel-h"><span className="bar" style={{ background: 'var(--g3)' }} />Meetings</div>
      <p className="muted" style={{ marginBottom: '.8rem' }}>
        Build a <b>QIP meeting</b> agenda from every current grade 4 and 3 — units and horizontal departments both —
        or start a <b>Project meeting</b> for one specific project. Click any agenda item to check the project's
        progress without leaving the meeting; recording keeps running while you do. When Claude's written up the
        minutes from the transcript, paste them back in below.
      </p>

      {!agenda && (
        <div className="card">
          <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <select className="formctl" value={kind} onChange={e => { setKind(e.target.value); setProjectId(''); }}>
              <option value="qip">QIP meeting</option>
              <option value="project">Project meeting</option>
            </select>
            {kind === 'project' && (
              <select className="formctl" value={projectId} onChange={e => setProjectId(e.target.value)}>
                <option value="">— pick project —</option>
                {data.projects.filter(p => !p.archived_at && p.status !== 'cancelled').map(p => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
              </select>
            )}
            <button className="btn primary" onClick={prepareAgenda} disabled={kind === 'project' && !selectedProject}>
              Prepare meeting
            </button>
          </div>
          {!supported && <p className="muted" style={{ color: 'var(--g4)', marginTop: '.6rem' }}>
            Live transcription needs Chrome or Edge — this browser doesn't support it. You can still build and save an agenda, just not record.</p>}
        </div>
      )}

      {agenda && kind === 'qip' && (
        <QipMeetingRoom
          agenda={agenda} selected={selected} onToggle={toggleSelected}
          building={building} live={live} recording={recording} busy={busy}
          expandedKey={expandedKey} setExpandedKey={setExpandedKey}
          data={data} me={me} onRefresh={onRefresh}
          onMarkDiscussed={markNewDiscussed}
          onSaveAndRecord={saveAgendaAndRecord} onCancel={backToSetup}
          onStop={stopRec} transcript={transcript}
        />
      )}
      {agenda && kind === 'project' && (
        <ProjectMeetingRoom
          pa={agenda} building={building} live={live} recording={recording} busy={busy}
          data={data} me={me} onRefresh={onRefresh}
          onSaveAndRecord={saveAgendaAndRecord} onCancel={backToSetup}
          onStop={stopRec} transcript={transcript}
        />
      )}

      <div className="panel-h" style={{ marginTop: '1.4rem' }}><span className="bar" style={{ background: 'var(--g2)' }} />Past meetings ({past.length})</div>
      <div className="card">
        <table className="ptable">
          <thead>
            <tr><th>Date</th><th>Meeting</th><th>Type</th><th>Lines</th><th>Minutes</th></tr>
          </thead>
          <tbody>
            {!past.length && <tr><td colSpan={5} className="muted">None recorded yet.</td></tr>}
            {past.map(m => (
              <MeetingRow key={m.id} m={m} data={data} me={me}
                expanded={expandedId === m.id}
                onToggle={() => setExpandedId(expandedId === m.id ? null : m.id)}
                onCopy={copyForClaude} onChanged={refreshPast} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// Shared "here's what's happening with this project" strip — status, RAG,
// notes, and a quick way to log one, all inline so reviewing progress mid-
// meeting never means leaving the meeting (and losing the recording).
function InlineProjectPanel({ project, me, onRefresh }) {
  const [notes, setNotes] = useState([]);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { loadNotes(project.id).then(setNotes).catch(() => {}); }, [project.id]);
  const badge = statusBadge(project);
  const days = daysInStage(project.status_changed_at);
  const submit = async e => {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    try { await addNote(project.id, me, body.trim()); setBody(''); loadNotes(project.id).then(setNotes); onRefresh?.(); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ padding: '.7rem .9rem', background: 'var(--paper)', borderRadius: 8, marginTop: '.4rem' }}>
      <p style={{ display: 'flex', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap', margin: 0 }}>
        <b>{project.title}</b>
        <span className={`st ${badge.cls}`}>{badge.label}</span>
        <span className="muted">owner {project.owner || '—'}</span>
        {days !== null && <span className="muted">{days}d at this stage</span>}
        {project.progress_rag && <span><span className={`rag rag-${project.progress_rag}`} /> {RAG_LABEL[project.progress_rag]}</span>}
      </p>
      {project.blocked_by && <p className="muted" style={{ marginTop: '.3rem' }}>Blocker: {project.blocked_by}</p>}
      <div style={{ marginTop: '.5rem', maxHeight: 140, overflowY: 'auto' }}>
        {!notes.length && <p className="muted" style={{ fontSize: '.8rem' }}>No progress notes yet.</p>}
        {notes.slice(-4).reverse().map(n => (
          <p key={n.id} style={{ fontSize: '.8rem', marginTop: '.2rem' }}><b>{n.author}</b>: {n.body}</p>
        ))}
      </div>
      <form onSubmit={submit} style={{ display: 'flex', gap: '.4rem', marginTop: '.5rem' }}>
        <input className="formctl" placeholder={`Log what's happened — ${me}`} value={body} onChange={e => setBody(e.target.value)} style={{ flex: 1 }} />
        <button className="btn" disabled={busy}>Add</button>
      </form>
    </div>
  );
}

// The criterion has no live project yet — show what's actually driving the
// grade instead, so the meeting can decide whether one's needed.
function InlineCauseSummary({ w, data }) {
  const crit = w.scope === 'unit' ? data.criteria.find(c => c.id === w.criterion_id) : data.ocrit.find(c => c.id === w.criterion_id);
  const areaKey = w.scope === 'unit' ? w.unit_id : w.function_id;
  const causeCol = w.scope === 'unit' ? 'likely_cause_by_unit' : 'likely_cause_by_function';
  const cause = crit?.[causeCol]?.[areaKey]?.[w.grade - 1] || crit?.likely_cause?.[w.grade - 1];
  return (
    <div style={{ padding: '.7rem .9rem', background: 'var(--paper)', borderRadius: 8, marginTop: '.4rem' }}>
      <p className="muted" style={{ margin: 0, fontSize: '.78rem' }}>No live project against this yet.</p>
      <p style={{ marginTop: '.4rem', fontSize: '.86rem' }}>{cause || 'No root-cause analysis written yet.'}</p>
    </div>
  );
}

function AgendaSection({ label, grade, bucket, selected, onToggle, editable, expandedKey, setExpandedKey, data, me, onRefresh }) {
  const rows = [...bucket.solutions.map(w => ({ ...w, grade, hasProject: false })), ...bucket.progress.map(w => ({ ...w, grade, hasProject: true }))]
    .sort((a, b) => (a.scope === b.scope ? a.areaName.localeCompare(b.areaName) : a.scope === 'unit' ? -1 : 1));
  if (!rows.length) return null;
  return (
    <>
      <tr className="band"><td colSpan={5}>{label}<span>{rows.length} cell{rows.length === 1 ? '' : 's'}</span></td></tr>
      {rows.flatMap(w => {
        const key = cellKeyOf(w);
        const open = expandedKey === key;
        return [
          <tr key={key} style={{ cursor: 'pointer' }} onClick={() => setExpandedKey(open ? null : key)}>
            <td onClick={e => e.stopPropagation()}>
              {editable
                ? <input type="checkbox" checked={selected.has(key)} onChange={() => onToggle(key)} />
                : <input type="checkbox" checked={selected.has(key)} disabled />}
            </td>
            <td><span className={`chip s${grade}`} style={{ position: 'static' }}>{grade}</span></td>
            <td>{w.areaName}{w.scope === 'org' && <span className="muted" style={{ fontSize: '.68rem' }}> · department</span>}</td>
            <td>{w.critName}</td>
            <td className="muted">{w.hasProject ? `${w.projects.length} live project${w.projects.length === 1 ? '' : 's'}` : 'needs a project'}</td>
          </tr>,
          open && (
            <tr key={key + '-detail'}><td colSpan={5} style={{ padding: 0 }}>
              {w.hasProject
                ? w.projects.map(p => <InlineProjectPanel key={p.id} project={p} me={me} onRefresh={onRefresh} />)
                : <InlineCauseSummary w={w} data={data} />}
            </td></tr>
          ),
        ];
      })}
    </>
  );
}

function QipMeetingRoom({ agenda, selected, onToggle, building, live, recording, busy, expandedKey, setExpandedKey,
  data, me, onRefresh, onMarkDiscussed, onSaveAndRecord, onCancel, onStop, transcript }) {
  return (
    <div className="card" style={{ marginTop: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.5rem' }}>
        <h4 className="crit-card-h" style={{ margin: 0 }}>
          {building ? 'Build the agenda' : recording ? '● Recording' : 'Agenda'}
        </h4>
        <div style={{ display: 'flex', gap: '.5rem' }}>
          {building && <button className="btn" onClick={onCancel}>Cancel</button>}
          {building && <button className="btn primary" disabled={busy} onClick={onSaveAndRecord}>Save agenda &amp; start recording</button>}
          {live && recording && <button className="btn danger" onClick={onStop}>■ Stop &amp; save</button>}
        </div>
      </div>
      {building && <p className="muted" style={{ fontSize: '.8rem', marginTop: '.3rem' }}>
        Every grade 4 is ticked by default — a 4 always needs raising. Tick any grade 3s worth discussing too. Click a row to check that criterion's progress before deciding.</p>}
      {recording && <p className="muted" style={{ fontSize: '.8rem', marginTop: '.3rem' }}>
        {transcript.length} line{transcript.length === 1 ? '' : 's'} captured. Click any agenda item to review progress — recording keeps running.</p>}

      {agenda.newProjects.length > 0 && (
        <div style={{ marginTop: '.8rem' }}>
          <p style={{ fontWeight: 700 }}>New projects — not yet discussed ({agenda.newProjects.length})</p>
          {agenda.newProjects.map(p => (
            <p key={p.id} style={{ marginTop: '.3rem' }}>
              {p.title} <span className="muted">— owner {p.owner || '—'}, added {fmtDate(p.created_at?.slice(0, 10))}</span>
              {' '}<button className="linklike" onClick={() => onMarkDiscussed(p.id)}>mark discussed</button>
            </p>
          ))}
        </div>
      )}

      <table className="ptable" style={{ marginTop: '.8rem' }}>
        <thead><tr><th>On agenda</th><th>Grade</th><th>Area</th><th>Criterion</th><th>Status</th></tr></thead>
        <tbody>
          <AgendaSection label="Grade 4" grade={4} bucket={agenda.grade4} selected={selected} onToggle={onToggle} editable={building}
            expandedKey={expandedKey} setExpandedKey={setExpandedKey} data={data} me={me} onRefresh={onRefresh} />
          <AgendaSection label="Grade 3" grade={3} bucket={agenda.grade3} selected={selected} onToggle={onToggle} editable={building}
            expandedKey={expandedKey} setExpandedKey={setExpandedKey} data={data} me={me} onRefresh={onRefresh} />
          {!agenda.grade4.solutions.length && !agenda.grade4.progress.length && !agenda.grade3.solutions.length && !agenda.grade3.progress.length && (
            <tr><td colSpan={5} className="muted">Nothing graded 3 or 4 right now.</td></tr>
          )}
        </tbody>
      </table>

      {transcript.length > 0 && (
        <div style={{ marginTop: '.8rem', maxHeight: 200, overflowY: 'auto' }}>
          {transcript.map((t, i) => <p key={i} className="muted" style={{ fontSize: '.78rem' }}>{t.text}</p>)}
        </div>
      )}
    </div>
  );
}

function ProjectMeetingRoom({ pa, building, live, recording, busy, data, me, onRefresh, onSaveAndRecord, onCancel, onStop, transcript }) {
  if (!pa) return null;
  const { project, area, crit, excellenceText, progressRag, daysAtStage, overdue } = pa;
  const badge = statusBadge(project);
  return (
    <div className="card" style={{ marginTop: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.5rem' }}>
        <h4 className="crit-card-h" style={{ margin: 0 }}>{project.title}</h4>
        <div style={{ display: 'flex', gap: '.5rem' }}>
          {building && <button className="btn" onClick={onCancel}>Cancel</button>}
          {building && <button className="btn primary" disabled={busy} onClick={onSaveAndRecord}>Start recording</button>}
          {live && recording && <button className="btn danger" onClick={onStop}>■ Stop &amp; save</button>}
        </div>
      </div>
      <p className="muted">{area?.name} &gt; {crit?.name}</p>
      <p><b>Status:</b> <span className={`st ${badge.cls}`}>{badge.label}</span>
        {' '}· <b>Pace:</b> {PACE_LABEL[project.pace] || '—'} · <b>Owner:</b> {project.owner || '—'}</p>
      <p><b>Target:</b> {fmtDate(project.due)}{overdue && <span className="overdue"> — {overdue}d overdue</span>}</p>
      <p><b>Days at current stage:</b> {daysAtStage ?? '—'}</p>
      {project.blocked_by && <p><b>Blocker:</b> {project.blocked_by}</p>}
      {progressRag && <p><b>Progress:</b> <span className={`rag rag-${progressRag}`} /> {RAG_LABEL[progressRag]}</p>}
      {excellenceText && <p className="muted"><b>Aiming for:</b> {excellenceText}</p>}

      <InlineProjectPanel project={project} me={me} onRefresh={onRefresh} />

      {transcript.length > 0 && (
        <div style={{ marginTop: '.8rem', maxHeight: 200, overflowY: 'auto' }}>
          {transcript.map((t, i) => <p key={i} className="muted" style={{ fontSize: '.78rem' }}>{t.text}</p>)}
        </div>
      )}
    </div>
  );
}

function MeetingRow({ m, data, me, expanded, onToggle, onCopy, onChanged }) {
  const [title, setTitle] = useState(m.title || '');
  const [minutes, setMinutes] = useState(m.minutes || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [askConfirm, confirmDialog] = useConfirm();
  const project = m.project_id ? data.projects.find(p => p.id === m.project_id) : null;
  const label = m.title || (m.kind === 'project' ? (project ? `Project meeting — ${project.title}` : 'Project meeting') : KIND_LABEL[m.kind] || KIND_LABEL.qip);

  const save = async () => {
    setBusy(true); setError('');
    try { await updateMeeting(m.id, { title: title.trim() || null, minutes: minutes.trim() || null }); onChanged(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const remove = async () => {
    const ok = await askConfirm(`Delete this meeting (${label}) permanently? This can't be undone.`, { confirmLabel: 'Delete meeting', danger: true });
    if (!ok) return;
    setBusy(true); setError('');
    try { await deleteMeeting(m.id); onChanged(); }
    catch (e) { setError(e.message); setBusy(false); }
  };

  return (
    <>
      <tr style={{ cursor: 'pointer' }} onClick={onToggle}>
        <td>{new Date(m.started_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
        <td>{label}</td>
        <td><span className={`st ${KIND_CLASS[m.kind] || 'st-fix'}`}>{m.kind === 'project' ? 'Project' : m.kind === 'criterion' ? 'Criterion' : 'QIP'}</span></td>
        <td className="muted">{(m.transcript || []).length}</td>
        <td className="muted">{m.minutes ? '📝 added' : '—'}</td>
      </tr>
      {expanded && (
        <tr><td colSpan={5} style={{ paddingLeft: '1.2rem' }}>
          {project && <p className="muted">Linked to {project.title}</p>}
          <label className="muted" style={{ fontSize: '.74rem', display: 'block', marginBottom: '.2rem' }}>Title</label>
          <input className="formctl" value={title} onChange={e => setTitle(e.target.value)} placeholder={label} style={{ width: '100%', marginBottom: '.5rem' }} />
          <label className="muted" style={{ fontSize: '.74rem', display: 'block', marginBottom: '.2rem' }}>Minutes &amp; actions — paste what Claude produced from the transcript</label>
          <textarea className="formctl" value={minutes} onChange={e => setMinutes(e.target.value)} placeholder="Paste Claude's minutes here…" rows={6} style={{ width: '100%', marginBottom: '.5rem' }} />
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
            <button className="btn primary" disabled={busy} onClick={save}>Save</button>
            <button className="btn" onClick={() => onCopy(m.transcript || [])} disabled={!m.transcript?.length}>Copy transcript for Claude</button>
            <button className="btn danger" disabled={busy} onClick={remove}>Delete meeting</button>
          </div>
          {error && <p className="muted" style={{ color: 'var(--g4)' }}>{error}</p>}

          <MeetingDocuments meetingId={m.id} me={me} />

          {(m.transcript || []).length > 0 && (
            <div style={{ marginTop: '.6rem', maxHeight: 180, overflowY: 'auto' }}>
              {m.transcript.map((t, i) => <p key={i} className="muted" style={{ fontSize: '.76rem' }}>{t.text}</p>)}
            </div>
          )}
          {!m.transcript?.length && <p className="muted">No transcript captured — Chrome/Edge speech recognition may not have been available.</p>}
        </td></tr>
      )}
      {confirmDialog}
    </>
  );
}

// Optional file attachment alongside pasted minutes — for when someone
// already has a formatted doc (Word, PDF) they want to keep as-is.
function MeetingDocuments({ meetingId, me }) {
  const [docs, setDocs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [askConfirm, confirmDialog] = useConfirm();
  const fileRef = useRef(null);

  const refresh = () => loadMeetingDocuments(meetingId).then(setDocs).catch(e => setError(e.message));
  useEffect(() => { refresh(); }, [meetingId]);

  const onPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true); setError('');
    try { await uploadMeetingDocument(meetingId, file, me); refresh(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const remove = async (doc) => {
    const ok = await askConfirm(`Delete "${doc.filename}"? This can't be undone.`, { confirmLabel: 'Delete document', danger: true });
    if (!ok) return;
    try { await deleteMeetingDocument(doc); refresh(); }
    catch (err) { setError(err.message); }
  };

  return (
    <div style={{ marginTop: '.6rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
        <label className="muted" style={{ fontSize: '.74rem' }}>Attached documents {docs.length > 0 && `(${docs.length})`}</label>
        <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? 'Uploading…' : '+ Attach file'}</button>
        <input ref={fileRef} type="file" onChange={onPick} style={{ display: 'none' }} />
      </div>
      {error && <p className="muted" style={{ color: 'var(--g4)' }}>{error}</p>}
      {docs.map(d => (
        <div key={d.id} className="docrow">
          <span>{d.filename}</span>
          <span className="muted"> · {d.uploaded_by || 'unknown'} · {new Date(d.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
          <a className="linklike" href={meetingDocumentUrl(d.storage_path)} download={d.filename}>download</a>
          <button className="linklike" onClick={() => remove(d)}>delete</button>
        </div>
      ))}
      {confirmDialog}
    </div>
  );
}
