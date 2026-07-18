import { useEffect, useRef, useState } from 'react';
import { startMeeting, endMeeting, loadMeetings, updateMeeting, deleteMeeting } from './data';
import { fmtDate, overdueBy } from './util';
import { useConfirm } from './Dialogs';

const KIND_LABEL = { qip: 'Fleur - QIP meeting', project: 'Project meeting' };
const KIND_CLASS = { qip: 'st-fix', project: 'st-embed' };

export default function MeetingsTab({ data, me, onOpenCase }) {
  const [agenda, setAgenda] = useState(null);
  const [meeting, setMeeting] = useState(null);
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState([]);
  const [supported, setSupported] = useState(true);
  const [kind, setKind] = useState('qip');
  const [projectId, setProjectId] = useState('');
  const [past, setPast] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const recRef = useRef(null);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    setSupported(!!SR);
  }, []);

  const refreshPast = () => loadMeetings().then(setPast).catch(() => {});
  useEffect(() => { refreshPast(); }, []);

  // autosave transcript so a refresh/close doesn't lose the in-progress record
  useEffect(() => {
    if (transcript.length) localStorage.setItem('petxi-meeting-draft', JSON.stringify(transcript));
  }, [transcript]);

  const prepareMeeting = () => {
    const potentials = data.projects.filter(p => p.status === 'potential')
      .sort((a, b) => (b.grade_at_creation || 0) - (a.grade_at_creation || 0));
    const overdueP = data.projects.filter(p => p.due && overdueBy(p.due) && ['live', 'paused'].includes(p.status));
    setAgenda({ potentials, overdueP });
  };

  const startRec = async () => {
    if (kind === 'project' && !projectId) return;
    const m = await startMeeting(me, data.period?.id, { kind, project_id: kind === 'project' ? Number(projectId) : null });
    setMeeting(m);
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
    const prompt = `Write up minutes from this PET-Xi QIP review meeting transcript. Summarise decisions, ` +
      `list any projects promoted to live or queued, and note follow-ups.\n\nTranscript:\n` +
      lines.map(t => `[${t.at}] ${t.text}`).join('\n');
    navigator.clipboard?.writeText(prompt);
  };

  return (
    <>
      <div className="panel-h"><span className="bar" style={{ background: 'var(--g3)' }} />Meetings</div>
      <p className="muted" style={{ marginBottom: '.8rem' }}>
        Record a <b>Fleur - QIP meeting</b> for general review, or an <b>individual project meeting</b> linked to
        one project. When Claude's written up the minutes from the transcript, paste them back in on that
        meeting's row below.
      </p>
      <div className="card">
        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '.8rem' }}>
          <select className="formctl" value={kind} onChange={e => { setKind(e.target.value); setProjectId(''); }} disabled={recording}>
            <option value="qip">Fleur - QIP meeting</option>
            <option value="project">Individual project meeting</option>
          </select>
          {kind === 'project' && (
            <select className="formctl" value={projectId} onChange={e => setProjectId(e.target.value)} disabled={recording}>
              <option value="">— pick project —</option>
              {data.projects.filter(p => p.status !== 'cancelled').map(p => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>
          )}
          <button onClick={prepareMeeting}>Prepare meeting</button>
          {!recording
            ? <button onClick={startRec} disabled={kind === 'project' && !projectId}>● Record</button>
            : <button className="danger" onClick={stopRec}>■ Stop &amp; save</button>}
          <button onClick={() => copyForClaude(transcript)} disabled={!transcript.length}>Copy for Claude</button>
        </div>
        {!supported && <p className="muted" style={{ color: 'var(--g4)' }}>
          Live transcription needs Chrome or Edge — this browser doesn't support it. Recording can't start here.</p>}
        {recording && <p className="muted">Recording — {transcript.length} line{transcript.length === 1 ? '' : 's'} captured. Keep this tab open; switching tabs is fine.</p>}

        {agenda && (
          <div style={{ marginTop: '.8rem' }}>
            <h4>Agenda</h4>
            <p><b>Potentials, worst first:</b></p>
            <ul>
              {agenda.potentials.map(p => (
                <li key={p.id}>
                  <button className="linklike" onClick={() => onOpenCase(p.id)}>{p.title}</button> — graded {p.grade_at_creation}
                </li>
              ))}
              {!agenda.potentials.length && <li className="muted">None.</li>}
            </ul>
            <p><b>Overdue:</b></p>
            <ul>
              {agenda.overdueP.map(p => <li key={p.id}>{p.title} — due {fmtDate(p.due)}</li>)}
              {!agenda.overdueP.length && <li className="muted">None.</li>}
            </ul>
          </div>
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
          <MeetingRow key={m.id} m={m} data={data}
            expanded={expandedId === m.id}
            onToggle={() => setExpandedId(expandedId === m.id ? null : m.id)}
            onOpenCase={onOpenCase} onCopy={copyForClaude} onChanged={refreshPast} />
        ))}
      </div>
    </>
  );
}

function MeetingRow({ m, data, expanded, onToggle, onOpenCase, onCopy, onChanged }) {
  const [title, setTitle] = useState(m.title || '');
  const [minutes, setMinutes] = useState(m.minutes || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [askConfirm, confirmDialog] = useConfirm();
  const project = m.project_id ? data.projects.find(p => p.id === m.project_id) : null;
  const label = m.title || (m.kind === 'project' ? (project ? `Project meeting — ${project.title}` : 'Project meeting') : KIND_LABEL.qip);

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
        <span className={`st ${KIND_CLASS[m.kind] || 'st-fix'}`}>{m.kind === 'project' ? 'Project' : 'QIP'}</span>
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
