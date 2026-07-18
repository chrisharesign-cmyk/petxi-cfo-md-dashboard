import { useEffect, useRef, useState } from 'react';
import { promoteLive, queueProject, startMeeting, endMeeting } from './data';
import { fmtDate, overdueBy, friendlyProjectError } from './util';

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

export default function DiscussTab({ data, me, onRefresh, onOpenCase, onGoToProjects }) {
  const [rowError, setRowError] = useState(null); // { id, msg }
  const [toast, setToast] = useState('');
  const potentials = data.projects
    .filter(p => p.status === 'potential')
    .sort((a, b) => (b.grade_at_creation || 0) - (a.grade_at_creation || 0));
  const waiting = data.projects.filter(p => p.status === 'queued');
  const overdue = data.projects.filter(p => p.due && overdueBy(p.due) && ['live', 'paused'].includes(p.status));

  // The default habit is Rapid Fix, one click. Anything else (Short/Mid/
  // Long term) is picked from the case file, which is why the row itself
  // is clickable — this is the fix for "clicking a project shows nothing".
  const tick = async (p, e) => {
    e.stopPropagation();
    try {
      await promoteLive(p.id, 'rapid', data.period); setRowError(null);
      setToast(`"${p.title}" is now live as Rapid Fix — find it any time in Excellence Projects.`);
      onRefresh();
    } catch (e2) { setRowError({ id: p.id, msg: friendlyProjectError(e2, data, p) }); }
  };
  const lineUp = async (p, e) => {
    e.stopPropagation();
    await queueProject(p.id);
    setToast(`"${p.title}" moved to Excellence Projects, queued — it'll wait there until you promote it to live.`);
    onRefresh();
  };

  return (
    <>
      <div className="panel-h"><span className="bar" style={{ background: 'var(--g4)' }} />Items to Discuss — {potentials.length} potential, worst grade first</div>
      <p className="muted" style={{ marginBottom: '.8rem' }}>
        Click a project to open it — that's where the plan lives, and where you can assign an owner or agree a
        different pace (Short, Mid or Long term instead of the Rapid Fix default). <b>Agree — Rapid Fix</b> here is
        the one-click shortcut for the common case; <b>Line up</b> queues it for later. Either way it leaves this
        list and moves to the{' '}
        {onGoToProjects ? <button className="linklike" onClick={onGoToProjects}>Excellence Projects</button> : 'Excellence Projects'} tab, it isn't deleted.
      </p>
      {toast && <div className="card" style={{ marginBottom: '.8rem', borderColor: 'var(--g2)' }}>{toast}</div>}
      <div className="card">
        {!potentials.length && <p className="muted">Nothing waiting on a decision.</p>}
        {potentials.map(p => (
          <div key={p.id} className="discussrow" style={{ cursor: 'pointer' }} onClick={() => onOpenCase(p.id)}>
            <span className="key-dot s4" style={{ width: '1.4rem', height: '1.4rem', fontSize: '.8rem' }}>{p.grade_at_creation}</span>
            <div style={{ flex: 1 }}>
              <b>{p.title}</b><br />
              <span className="muted">{areaName(p, data)} &gt; {critName(p, data)}{p.owner ? ` · owner ${p.owner}` : ''}</span>
              {p.suggested_solution && <p className="muted" style={{ marginTop: '.3rem' }}>{p.suggested_solution}</p>}
              {rowError?.id === p.id && <p className="muted" style={{ color: 'var(--g4)' }}>{rowError.msg}</p>}
            </div>
            <div style={{ display: 'flex', gap: '.4rem' }}>
              <button onClick={(e) => tick(p, e)} title="Agree this as-is and start it immediately">Agree — Rapid Fix</button>
              <button onClick={(e) => lineUp(p, e)} title="Queue it for later, without starting it yet">Line up</button>
            </div>
          </div>
        ))}
      </div>

      {(waiting.length > 0 || overdue.length > 0) && (
        <div className="card" style={{ marginTop: '1rem' }}>
          {waiting.length > 0 && <p><b>{waiting.length}</b> queued, waiting for a live slot to free up
            {onGoToProjects && <> — <button className="linklike" onClick={onGoToProjects}>view them</button></>}.</p>}
          {overdue.length > 0 && <p><b>{overdue.length}</b> overdue: {overdue.map(p => p.title).join(', ')}</p>}
        </div>
      )}

      <MeetingPanel data={data} me={me} onRefresh={onRefresh} onOpenCase={onOpenCase} />
    </>
  );
}

function MeetingPanel({ data, me, onRefresh, onOpenCase }) {
  const [agenda, setAgenda] = useState(null);
  const [meeting, setMeeting] = useState(null);
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState([]);
  const [supported, setSupported] = useState(true);
  const recRef = useRef(null);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    setSupported(!!SR);
  }, []);

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
    const m = await startMeeting(me, data.period?.id);
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
          setTranscript(t => [...t, { at: new Date().toISOString(), text: ev.results[i][0].transcript, tab: document.title }]);
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
      onRefresh();
    }
  };

  const copyForClaude = () => {
    const prompt = `Write up minutes from this PET-Xi QIP review meeting transcript. Summarise decisions, ` +
      `list any projects promoted to live or queued, and note follow-ups.\n\nTranscript:\n` +
      transcript.map(t => `[${t.at}] ${t.text}`).join('\n');
    navigator.clipboard?.writeText(prompt);
  };

  return (
    <>
      <div className="panel-h" style={{ marginTop: '1.4rem' }}><span className="bar" style={{ background: 'var(--g3)' }} />Meeting</div>
      <div className="card">
        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', marginBottom: '.8rem' }}>
          <button onClick={prepareMeeting}>Prepare meeting</button>
          {!recording
            ? <button onClick={startRec}>● Record</button>
            : <button className="danger" onClick={stopRec}>■ Stop &amp; save</button>}
          <button onClick={copyForClaude} disabled={!transcript.length}>Copy for Claude</button>
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
    </>
  );
}
