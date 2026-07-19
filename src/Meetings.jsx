import { useEffect, useRef, useState } from 'react';
import { startMeeting, endMeeting, loadMeetings, updateMeeting, deleteMeeting,
  markProjectDiscussed, loadMeetingDocuments, uploadMeetingDocument, deleteMeetingDocument, meetingDocumentUrl } from './data';
import { qipAgenda, agendaCriteriaRows, projectAgenda } from './agenda';
import { fmtDate, PACE_LABEL, statusBadge } from './util';
import { useConfirm } from './Dialogs';

// 'criterion' stays here only so an old row (started before this kind was
// retired) still renders sensibly in the past-meetings list — it's no
// longer offered as a way to start a new one.
const KIND_LABEL = { qip: 'QIP meeting', project: 'Project meeting', criterion: 'Criterion meeting' };
const KIND_CLASS = { qip: 'st-fix', project: 'st-embed', criterion: 'st-hold' };

export default function MeetingsTab({ data, me, onOpenCase, onOpenCriterion, onRefresh }) {
  const [kind, setKind] = useState('qip');
  const [projectId, setProjectId] = useState('');
  const [agenda, setAgenda] = useState(null);
  const [meeting, setMeeting] = useState(null);
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState([]);
  const [supported, setSupported] = useState(true);
  const [past, setPast] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
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
  const readyToRecord = kind === 'qip' || (kind === 'project' && selectedProject);

  const prepareAgenda = () => setAgenda(kind === 'qip' ? qipAgenda(data) : projectAgenda(selectedProject, data));

  const markNewDiscussed = async (id) => {
    await markProjectDiscussed(id);
    onRefresh?.();
    setAgenda(a => (a && a.newProjects) ? { ...a, newProjects: a.newProjects.filter(p => p.id !== id) } : a);
  };

  const startRec = async () => {
    if (!readyToRecord) return;
    const currentAgenda = agenda || (kind === 'qip' ? qipAgenda(data) : projectAgenda(selectedProject, data));
    const m = await startMeeting(me, data.period?.id, {
      kind,
      project_id: kind === 'project' ? Number(projectId) : null,
      agendaRows: kind === 'qip' ? agendaCriteriaRows(currentAgenda) : [],
    });
    setMeeting(m);
    setAgenda(currentAgenda);
    setTranscript([]);
    setRecording(true);
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (ev) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) {
          setTranscript(t => [...t, { at: new Date().toISOString(), text: ev.results[i][0].transcript }]);
        }
      }
    };
    rec.onend = () => { if (recRef.current) rec.start(); }; // keep alive across tab switches until user stops
    recRef.current = rec;
    rec.start();
  };

  const stopRec = async () => {
    const rec = recRef.current;
    recRef.current = null;
    rec?.stop?.();
    setRecording(false);
    if (meeting) {
      await endMeeting(meeting.id, { transcript, attendees: [me], promoted_project_ids: [] });
      localStorage.removeItem('petxi-meeting-draft');
      setMeeting(null);
      refreshPast();
    }
  };

  const copyForClaude = (lines) => {
    const prompt = `Write up minutes from this PET-Xi meeting transcript. Summarise decisions, ` +
      `list any projects agreed or actions assigned, and note follow-ups.\n\nTranscript:\n` +
      lines.map(t => `[${t.at}] ${t.text}`).join('\n');
    navigator.clipboard?.writeText(prompt);
  };

  return (
    <>
      <div className="panel-h"><span className="bar" style={{ background: 'var(--g3)' }} />Meetings</div>
      <p className="muted" style={{ marginBottom: '.8rem' }}>
        Record a <b>QIP meeting</b> — its agenda is generated live from current grades and projects, every time —
        or a <b>Project meeting</b> for one specific project. When Claude's written up the minutes from the
        transcript, paste them back in or attach the file on that meeting's row below.
      </p>
      <div className="card">
        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '.8rem' }}>
          <select className="formctl" value={kind}
            onChange={e => { setKind(e.target.value); setProjectId(''); setAgenda(null); }} disabled={recording}>
            <option value="qip">QIP meeting</option>
            <option value="project">Project meeting</option>
          </select>
          {kind === 'project' && (
            <select className="formctl" value={projectId} onChange={e => { setProjectId(e.target.value); setAgenda(null); }} disabled={recording}>
              <option value="">— pick project —</option>
              {data.projects.filter(p => !p.archived_at && p.status !== 'cancelled').map(p => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>
          )}
          <button onClick={prepareAgenda} disabled={kind === 'project' && !selectedProject}>Prepare agenda</button>
          {!recording
            ? <button onClick={startRec} disabled={!readyToRecord}>● Record</button>
            : <button className="danger" onClick={stopRec}>■ Stop &amp; save</button>}
          <button onClick={() => copyForClaude(transcript)} disabled={!transcript.length}>Copy for Claude</button>
        </div>
        {!supported && <p className="muted" style={{ color: 'var(--g4)' }}>
          Live transcription needs Chrome or Edge — this browser doesn't support it. Recording can't start here.</p>}
        {recording && <p className="muted">Recording — {transcript.length} line{transcript.length === 1 ? '' : 's'} captured. Keep this tab open; switching tabs is fine.</p>}

        {agenda && kind === 'qip' && (
          <QipAgendaView agenda={agenda} onMarkDiscussed={markNewDiscussed} onOpenCase={onOpenCase} onOpenCriterion={onOpenCriterion} />
        )}
        {agenda && kind === 'project' && (
          <ProjectAgendaView pa={agenda} onOpenCase={onOpenCase} onOpenCriterion={onOpenCriterion} />
        )}

        {transcript.length > 0 && (
          <div style={{ marginTop: '.8rem', maxHeight: 220, overflowY: 'auto' }}>
            {transcript.map((t, i) => <p key={i} className="muted" style={{ fontSize: '.78rem' }}>{t.text}</p>)}
          </div>
        )}
      </div>

      <div className="panel-h" style={{ marginTop: '1.4rem' }}><span className="bar" style={{ background: 'var(--g2)' }} />Past meetings ({past.length})</div>
      <div className="card">
        {!past.length && <p className="muted">None recorded yet.</p>}
        {past.map(m => (
          <MeetingRow key={m.id} m={m} data={data} me={me}
            expanded={expandedId === m.id}
            onToggle={() => setExpandedId(expandedId === m.id ? null : m.id)}
            onOpenCase={onOpenCase} onCopy={copyForClaude} onChanged={refreshPast} />
        ))}
      </div>
    </>
  );
}

function QipAgendaView({ agenda, onMarkDiscussed, onOpenCase, onOpenCriterion }) {
  const open = w => onOpenCriterion({ scope: w.scope, unit_id: w.unit_id ?? null, function_id: w.function_id ?? null, criterion_id: w.criterion_id });
  return (
    <div style={{ marginTop: '.8rem' }}>
      <h4 className="crit-card-h" style={{ marginBottom: '.6rem' }}>Agenda</h4>

      <p style={{ fontWeight: 700 }}>New projects — not yet discussed ({agenda.newProjects.length})</p>
      {!agenda.newProjects.length && <p className="muted">None.</p>}
      {agenda.newProjects.map(p => (
        <p key={p.id} style={{ marginTop: '.3rem' }}>
          <button className="linklike" onClick={() => onOpenCase(p.id)}>{p.title}</button>
          <span className="muted"> — owner {p.owner || '—'}, added {fmtDate(p.created_at?.slice(0, 10))}</span>
          {' '}<button className="linklike" onClick={() => onMarkDiscussed(p.id)}>mark discussed</button>
        </p>
      ))}

      <GradeBlock label="Grade 4" bucket={agenda.grade4} onOpen={open} onOpenCase={onOpenCase} />
      <GradeBlock label="Grade 3" bucket={agenda.grade3} onOpen={open} onOpenCase={onOpenCase} />

      <p style={{ fontWeight: 700, marginTop: '.8rem' }}>Other updates</p>
      <p className="muted">Open agenda slot — anything else worth raising that isn't grade-driven.</p>
    </div>
  );
}

function GradeBlock({ label, bucket, onOpen, onOpenCase }) {
  return (
    <>
      <p style={{ fontWeight: 700, marginTop: '.8rem' }}>{label} — solutions needed ({bucket.solutions.length})</p>
      {!bucket.solutions.length && <p className="muted">None — every {label.toLowerCase()} has a live project against it.</p>}
      {bucket.solutions.map(w => (
        <p key={w.key} style={{ marginTop: '.3rem' }}>
          <button className="linklike" onClick={() => onOpen(w)}>{w.areaName} &gt; {w.critName}</button>
        </p>
      ))}
      <p style={{ fontWeight: 700, marginTop: '.8rem' }}>{label} — progress updates ({bucket.progress.length})</p>
      {!bucket.progress.length && <p className="muted">None.</p>}
      {bucket.progress.map(w => (
        <div key={w.key} style={{ marginTop: '.3rem' }}>
          <button className="linklike" onClick={() => onOpen(w)}>{w.areaName} &gt; {w.critName}</button>
          {w.projects.map(p => (
            <p key={p.id} className="muted" style={{ marginLeft: '1rem', fontSize: '.82rem' }}>
              <button className="linklike" onClick={() => onOpenCase(p.id)}>{p.title}</button>
              {' '}— {PACE_LABEL[p.pace] || p.pace}, owner {p.owner || '—'}
            </p>
          ))}
        </div>
      ))}
    </>
  );
}

function ProjectAgendaView({ pa, onOpenCase, onOpenCriterion }) {
  if (!pa) return null;
  const { project, area, crit, excellenceText, movement, daysAtStage, overdue } = pa;
  const badge = statusBadge(project);
  return (
    <div style={{ marginTop: '.8rem' }}>
      <h4 className="crit-card-h" style={{ marginBottom: '.4rem' }}>
        Agenda — <button className="linklike" onClick={() => onOpenCase(project.id)}>{project.title}</button>
      </h4>
      <p className="muted">{area?.name} &gt; {crit?.name}</p>
      <p><b>Status:</b> <span className={`st ${badge.cls}`}>{badge.label}</span>
        {' '}· <b>Pace:</b> {PACE_LABEL[project.pace] || '—'} · <b>Owner:</b> {project.owner || '—'}</p>
      <p><b>Target:</b> {fmtDate(project.due)}{overdue && <span className="overdue"> — {overdue}d overdue</span>}</p>
      <p><b>Days at current stage:</b> {daysAtStage ?? '—'}</p>
      {project.blocked_by && <p><b>Blocker:</b> {project.blocked_by}</p>}
      {movement && (
        <p style={{ color: movement.improved ? 'var(--g2)' : 'var(--g4)', fontWeight: 700 }}>
          {movement.improved ? '🎉' : '⚠'} Grade moved {movement.from} → {movement.to}
        </p>
      )}
      {excellenceText && <p className="muted"><b>Aiming for:</b> {excellenceText}</p>}
      <button className="linklike"
        onClick={() => onOpenCriterion({ scope: project.scope, unit_id: project.unit_id, function_id: project.function_id, criterion_id: project.criterion_id })}>
        open criterion page →
      </button>
    </div>
  );
}

function MeetingRow({ m, data, me, expanded, onToggle, onOpenCase, onCopy, onChanged }) {
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
    <div style={{ marginTop: '.4rem', borderTop: '1px solid var(--line-soft)', paddingTop: '.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
        <button className="linklike" onClick={onToggle}>
          {new Date(m.started_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} — {label}
        </button>
        <span className={`st ${KIND_CLASS[m.kind] || 'st-fix'}`}>{m.kind === 'project' ? 'Project' : m.kind === 'criterion' ? 'Criterion' : 'QIP'}</span>
        {m.minutes && <span className="muted" style={{ fontSize: '.74rem' }}>📝 minutes added</span>}
        <span className="muted" style={{ fontSize: '.74rem' }}>
          {(m.transcript || []).length} line{(m.transcript || []).length === 1 ? '' : 's'}
          {m.attendees?.length ? ` · ${m.attendees.join(', ')}` : ''}
        </span>
      </div>
      {expanded && (
        <div style={{ marginTop: '.5rem', marginLeft: '1rem' }}>
          {project && <p className="muted">Linked to <button className="linklike" onClick={() => onOpenCase(project.id)}>{project.title}</button></p>}
          <label className="muted" style={{ fontSize: '.74rem', display: 'block', marginBottom: '.2rem' }}>Title</label>
          <input className="formctl" value={title} onChange={e => setTitle(e.target.value)} placeholder={label} style={{ width: '100%', marginBottom: '.5rem' }} />
          <label className="muted" style={{ fontSize: '.74rem', display: 'block', marginBottom: '.2rem' }}>Minutes — paste what Claude produced from the transcript</label>
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
        </div>
      )}
      {confirmDialog}
    </div>
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
