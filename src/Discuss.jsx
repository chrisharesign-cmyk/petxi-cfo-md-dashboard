import { useEffect, useRef, useState } from 'react';
import { promoteLive, queueProject, startMeeting, endMeeting, loadMeetings } from './data';
import { fmtDate, overdueBy, friendlyProjectError } from './util';

const INITIAL_SHOWN = 8;

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

const SORTS = {
  'Worst grade first': (a, b) => (b.grade_at_creation || 0) - (a.grade_at_creation || 0),
  'Oldest first': (a, b) => new Date(a.created_at) - new Date(b.created_at),
  'Newest first': (a, b) => new Date(b.created_at) - new Date(a.created_at),
};

export default function DiscussTab({ data, me, onRefresh, onOpenCase, onGoToProjects }) {
  const [rowError, setRowError] = useState(null); // { id, msg }
  const [toast, setToast] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [sortKey, setSortKey] = useState('Worst grade first');
  const potentials = data.projects
    .filter(p => p.status === 'potential')
    .sort(SORTS[sortKey]);
  const shown = showAll ? potentials : potentials.slice(0, INITIAL_SHOWN);
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
      <MeetingPanel data={data} me={me} onRefresh={onRefresh} onOpenCase={onOpenCase} />

      <div className="panel-h" style={{ marginTop: '1.4rem', justifyContent: 'space-between' }}>
        <span><span className="bar" style={{ background: 'var(--g4)' }} />Items to Discuss — {potentials.length} potential</span>
        <select className="formctl" value={sortKey} onChange={e => setSortKey(e.target.value)}>
          {Object.keys(SORTS).map(k => <option key={k} value={k}>{k}</option>)}
        </select>
      </div>
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
        {shown.map(p => (
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
        {potentials.length > INITIAL_SHOWN && (
          <button className="linklike" style={{ marginTop: '.6rem' }} onClick={() => setShowAll(s => !s)}>
            {showAll ? 'Show fewer' : `Show all ${potentials.length}`}
          </button>
        )}
      </div>

      {(waiting.length > 0 || overdue.length > 0) && (
        <div className="card" style={{ marginTop: '1rem' }}>
          {waiting.length > 0 && <p><b>{waiting.length}</b> queued, waiting for a live slot to free up
            {onGoToProjects && <> — <button className="linklike" onClick={onGoToProjects}>view them</button></>}.</p>}
          {overdue.length > 0 && <p><b>{overdue.length}</b> overdue: {overdue.map(p => p.title).join(', ')}</p>}
        </div>
      )}
    </>
  );
}

function MeetingPanel({ data, me, onRefresh, onOpenCase }) {
  const [agenda, setAgenda] = useState(null);
  const [meeting, setMeeting] = useState(null);
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState([]);
  const [supported, setSupported] = useState(true);
  const [past, setPast] = useState([]);
  const [showPast, setShowPast] = useState(null); // meeting id being viewed, or null
  const recRef = useRef(null);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    setSupported(!!SR);
  }, []);

  useEffect(() => { loadMeetings().then(setPast).catch(() => {}); }, []);

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
      loadMeetings().then(setPast).catch(() => {});
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
      <div className="panel-h" style={{ marginTop: '1.4rem' }}><span className="bar" style={{ background: 'var(--g3)' }} />Meeting</div>
      <div className="card">
        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', marginBottom: '.8rem' }}>
          <button onClick={prepareMeeting}>Prepare meeting</button>
          {!recording
            ? <button onClick={startRec}>● Record</button>
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

        {past.length > 0 && (
          <div style={{ marginTop: '1rem', borderTop: '1px solid var(--line-soft)', paddingTop: '.8rem' }}>
            <h4>Past meetings ({past.length})</h4>
            {past.map(m => (
              <div key={m.id} style={{ marginTop: '.4rem' }}>
                <button className="linklike" onClick={() => setShowPast(showPast === m.id ? null : m.id)}>
                  {new Date(m.started_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  {' '}— {(m.transcript || []).length} line{(m.transcript || []).length === 1 ? '' : 's'}
                  {m.attendees?.length ? ` — ${m.attendees.join(', ')}` : ''}
                </button>
                {showPast === m.id && (
                  <div style={{ marginTop: '.3rem', marginLeft: '1rem' }}>
                    <button className="linklike" onClick={() => copyForClaude(m.transcript || [])} disabled={!m.transcript?.length}>
                      Copy for Claude
                    </button>
                    <div style={{ maxHeight: 180, overflowY: 'auto', marginTop: '.3rem' }}>
                      {(m.transcript || []).map((t, i) => <p key={i} className="muted" style={{ fontSize: '.76rem' }}>{t.text}</p>)}
                      {!m.transcript?.length && <p className="muted">No transcript captured — Chrome/Edge speech recognition may not have been available.</p>}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
