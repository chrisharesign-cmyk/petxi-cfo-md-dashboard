import { useEffect, useState, useCallback } from 'react';
import './theme.css';
import { supa, REVIEWERS } from './supa';
import { loadAll, lockPeriod, spoolProjects, addProject, promoteLive, projectCellKey, OPEN_STATUSES } from './data';
import { nextPeriod, friendlyProjectError, autoTarget } from './util';
import Qip from './Qip';
import ProjectsTab from './Projects';
import DiscussTab from './Discuss';
import ActivityTab from './Activity';
import MeetingsTab from './Meetings';
import AreaPage from './AreaPage';
import CaseFile from './CaseFile';

function useGate() {
  const [me, setMe] = useState(() => localStorage.getItem('petxi-me') || '');
  const pick = n => { localStorage.setItem('petxi-me', n); setMe(n); };
  const leave = () => { localStorage.removeItem('petxi-me'); setMe(''); };
  return { me, pick, leave };
}

function Gate({ onPick }) {
  return (
    <div className="gate">
      <div className="brand">PET-<em>Xi</em></div>
      <p>Quality Improvement Plan — who's reviewing?</p>
      <div className="who">
        {REVIEWERS.map(r => (
          <button key={r.key} onClick={() => onPick(r.name)}>I'm {r.name}</button>
        ))}
      </div>
      <p style={{ fontSize: '.72rem', maxWidth: 420 }}>
        Honour system: pick your name to score as yourself. You can edit only your own
        scores and comments; every change is recorded in Supabase.
      </p>
    </div>
  );
}

export default function App() {
  const { me, pick, leave } = useGate();
  if (!me) return <Gate onPick={pick} />;
  return <Dashboard me={me} onLeave={leave} />;
}

function Dashboard({ me, onLeave }) {
  const [tab, setTab] = useState('qip');
  const [periodId, setPeriodId] = useState(null);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [save, setSave] = useState('');
  const [lockDialog, setLockDialog] = useState(null); // null | 'confirm' | 'working' | { cells }
  const [spoolMsg, setSpoolMsg] = useState('');
  const [spooling, setSpooling] = useState(false);
  const [areaView, setAreaView] = useState(null);
  const [caseFileId, setCaseFileId] = useState(null);
  const myKey = REVIEWERS.find(r => r.name === me)?.key;

  const refresh = useCallback(async () => {
    try {
      const d = await loadAll(periodId || 'FY26Q4');
      setData(d);
      if (!periodId) setPeriodId(d.period?.id || 'FY26Q4');
    } catch (e) { setErr(e.message || String(e)); }
  }, [periodId]);
  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const ch = supa.channel('rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scores' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'org_scores' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sar_periods' }, refresh)
      .subscribe();
    return () => { supa.removeChannel(ch); };
  }, [refresh]);

  if (err) return <div className="wrap"><div className="card">Couldn't reach Supabase: {err}</div></div>;
  if (!data) return <div className="wrap"><div className="card">Loading the live board…</div></div>;

  const locked = !!data.period?.locked_at;
  const canEdit = !locked;
  const hasOpenPeriod = data.periods.some(p => !p.locked_at);

  async function score(fn, args) {
    setSave('Saving…');
    try { await fn({ ...args, reviewer: me, period_id: periodId }); await refresh(); setSave('Saved ✓'); }
    catch (e) { setSave('Save failed'); setErr(e.message); }
    setTimeout(() => setSave(''), 1500);
  }

  async function doLock() {
    setLockDialog('working');
    try {
      const res = await lockPeriod(periodId, me);
      if (res.blocked) setLockDialog({ cells: res.cells });
      else { setLockDialog(null); await refresh(); }
    } catch (e) { setErr(e.message); setLockDialog(null); }
  }

  async function doSpool() {
    setSpooling(true); setSpoolMsg('');
    try {
      const res = await spoolProjects(periodId);
      setSpoolMsg(res.created ? `${res.created} new project${res.created === 1 ? '' : 's'} spooled to Items to Discuss` : 'Nothing new — every 3/4 already has an open project');
      await refresh();
    } catch (e) { setErr(e.message); }
    finally { setSpooling(false); setTimeout(() => setSpoolMsg(''), 4000); }
  }

  async function startNextPeriod() {
    const np = nextPeriod(data.period);
    const { error } = await supa.from('sar_periods').insert(np);
    if (error) { setErr(error.message); return; }
    setPeriodId(np.id);
  }

  const projectsByCell = {};
  const rank = { live: 0, paused: 1, queued: 2, potential: 3 };
  data.projects.forEach(p => {
    if (!OPEN_STATUSES.includes(p.status)) return;
    const key = projectCellKey(p);
    if (!projectsByCell[key] || rank[p.status] < rank[projectsByCell[key].status]) projectsByCell[key] = p;
  });
  const potentialCount = data.projects.filter(p => p.status === 'potential').length;

  return (
    <>
      <header>
        <div className="masthead">
          <div className="brand">PET-<em>Xi</em></div>
          <h1>Quality Improvement Plan</h1>
          <div className="whoami">
            <select className="periodsel" value={periodId || ''} onChange={e => { setPeriodId(e.target.value); setAreaView(null); }}>
              {data.periods.map(p => <option key={p.id} value={p.id}>{p.label}{p.locked_at ? ' (locked)' : ''}</option>)}
            </select>
            <span>Reviewing as <b>{me}</b></span>
            <span className="savechip">{save}</span>
            <button onClick={onLeave}>Switch</button>
          </div>
        </div>
        <div className="scale-key">
          <div className="key-item"><span className="key-dot s1">1</span> Mastery — exceeding, building capability</div>
          <div className="key-item"><span className="key-dot s2">2</span> On target / Licensed — no intervention</div>
          <div className="key-item"><span className="key-dot s3">3</span> Escalate — senior intervention this week</div>
          <div className="key-item"><span className="key-dot s4">4</span> Critical — in ICU, run under direct control</div>
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '.6rem' }}>
            {spoolMsg && <span className="lockchip">{spoolMsg}</span>}
            {!canEdit ? (
              <span className="lockchip">🔒 Locked by {data.period.locked_by} · {new Date(data.period.locked_at).toLocaleDateString('en-GB')}</span>
            ) : periodId === data.periods.find(p => !p.locked_at)?.id ? (
              <>
                <button className="lockbtn spool" disabled={spooling} onClick={doSpool} title="Scan current grades for any 3 or 4 and create a project for it, with a suggested solution — doesn't freeze anyone's scoring">
                  {spooling ? 'Spooling…' : 'Spool projects'}
                </button>
                <button className="lockbtn" onClick={() => setLockDialog('confirm')}>Lock this SAR</button>
              </>
            ) : null}
          </span>
        </div>
      </header>
      <nav className="tabs">
        {[['qip', 'SAR'], ['discuss', `Items to Discuss${potentialCount ? ` (${potentialCount})` : ''}`], ['projects', 'Excellence Projects'], ['meetings', 'Meetings'], ['activity', 'This Week']].map(([k, l]) => (
          <button key={k} className={tab === k ? 'active' : ''} onClick={() => { setTab(k); setAreaView(null); }}>{l}</button>
        ))}
      </nav>
      <div className="wrap">
        {locked && !hasOpenPeriod && (
          <div className="card" style={{ marginBottom: '1rem' }}>
            <p>This period is locked and no new period has started yet.</p>
            <button onClick={startNextPeriod}>Start {nextPeriod(data.period).label}</button>
          </div>
        )}
        {areaView
          ? <AreaPage scope={areaView.scope} id={areaView.id} data={data} onBack={() => setAreaView(null)} onOpenCase={setCaseFileId} />
          : <>
            {tab === 'qip' && <Qip data={data} me={me} myKey={myKey} onScore={score} canEdit={canEdit}
              projectsByCell={projectsByCell} onOpenArea={setAreaView} onOpenCase={setCaseFileId} />}
            {tab === 'projects' && <ProjectsTab data={data} me={me} onRefresh={refresh} onOpenCase={setCaseFileId} />}
            {tab === 'discuss' && <DiscussTab data={data} me={me} onRefresh={refresh} onOpenCase={setCaseFileId} onGoToProjects={() => setTab('projects')} onGoToMeetings={() => setTab('meetings')} />}
            {tab === 'meetings' && <MeetingsTab data={data} me={me} onOpenCase={setCaseFileId} />}
            {tab === 'activity' && <ActivityTab data={data} onOpenCase={setCaseFileId} />}
          </>}
      </div>
      {caseFileId && <CaseFile projectId={caseFileId} me={me} data={data} onClose={() => setCaseFileId(null)} onRefresh={refresh} />}
      {lockDialog && <LockDialog state={lockDialog} data={data} onConfirm={doLock} onClose={() => setLockDialog(null)} onResolve={refresh} />}
    </>
  );
}

function LockDialog({ state, data, onConfirm, onClose, onResolve }) {
  if (state === 'working') return <div className="modal-backdrop"><div className="modal">Locking…</div></div>;
  if (state === 'confirm') return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Lock this SAR?</h3>
        <p className="muted">This is the final step, not the routine one — use "Spool projects" for generating
          projects while you're still scoring. Locking freezes every grade for <b>both</b> reviewers this period,
          including Fleur's. After locking, no cell is clickable and the wording each grade was judged against is
          snapshotted permanently. This cannot be undone — the next period opens fresh drafts.</p>
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="danger" onClick={onConfirm}>Yes, lock it</button>
        </div>
      </div>
    </div>
  );
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Can't lock yet — {state.cells.length} cell{state.cells.length === 1 ? '' : 's'} graded 4 with no live project</h3>
        <p className="muted">A 4 needs an immediate project. Resolve each one below, then try locking again.</p>
        <ul className="blocklist">
          {state.cells.map(c => <BlockerRow key={c.key} cell={c} data={data} onResolve={onResolve} />)}
        </ul>
        <div className="modal-actions">
          <button onClick={onClose}>Close</button>
          <button onClick={onConfirm}>Try locking again</button>
        </div>
      </div>
    </div>
  );
}

function BlockerRow({ cell, data, onResolve }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const existing = data.projects.find(p => projectCellKey(p) === cell.key && OPEN_STATUSES.includes(p.status));
  const critName = cell.scope === 'unit'
    ? data.criteria.find(c => c.id === cell.criterion_id)?.name
    : data.ocrit.find(c => c.id === cell.criterion_id)?.name;
  const areaName = cell.scope === 'unit'
    ? data.units.find(u => u.id === cell.unit_id)?.name
    : data.ofuncs.find(f => f.id === cell.function_id)?.name;
  const act = async () => {
    setBusy(true); setError('');
    try {
      // A 4 blocking the lock needs action right now — defaults to Rapid Fix.
      if (existing) await promoteLive(existing.id, 'rapid', data.period);
      else await addProject({
        title: `${critName} — ${areaName}`, scope: cell.scope,
        unit_id: cell.scope === 'unit' ? cell.unit_id : null,
        function_id: cell.scope === 'org' ? cell.function_id : null,
        criterion_id: cell.criterion_id, status: 'live', grade_at_creation: 4,
        pace: 'rapid', due: autoTarget('rapid', data.period),
      });
      await onResolve();
    } catch (e) { setError(friendlyProjectError(e, data, { scope: cell.scope, unit_id: cell.unit_id, function_id: cell.function_id, criterion_id: cell.criterion_id })); }
    finally { setBusy(false); }
  };
  return (
    <li>
      <b>{areaName}</b> — {critName} (graded 4){error && <div className="muted" style={{ color: 'var(--g4)' }}>{error}</div>}
      <button disabled={busy} onClick={act}>{existing ? 'Promote to live' : 'Create & make live'}</button>
    </li>
  );
}
