import { useEffect, useState, useCallback } from 'react';
import './theme.css';
import { supa, weekStart, REVIEWERS } from './supa';
import { loadAll, setScore, clearScore, setOrgScore, clearOrgScore } from './data';
import { BANDS, CRIT_BY_UNIT, PERIOD, meanGrade, countdown } from './matrixdata';

const REV_KEYS = REVIEWERS; // [{key,name,short}]

// Row/column labels are short jargon (eg. "Term pipeline coverage") — hover
// shows the "on target" descriptor so reviewers know what's being measured.
function critTip(c){
  const onTarget = c.descriptors?.[1];
  return onTarget ? `${c.name} — ${onTarget}` : c.name;
}

// The score picker is position:fixed, so it never moves with page scroll —
// if it opens below the viewport (eg. clicking the last few rows of a long
// table) the 2/3/4 buttons render off-screen and are unreachable. Flip it
// to open upward when there isn't room below.
function pickPos(rect){
  const estHeight = 300; // 4 grade buttons + Clear
  const x = Math.min(rect.left, window.innerWidth - 310);
  const spaceBelow = window.innerHeight - rect.bottom;
  const y = spaceBelow >= estHeight + 10 ? rect.bottom + 6 : Math.max(8, rect.top - estHeight - 6);
  return { x, y };
}

function useGate(){
  const [me, setMe] = useState(() => localStorage.getItem('petxi-me') || '');
  const pick = n => { localStorage.setItem('petxi-me', n); setMe(n); };
  const leave = () => { localStorage.removeItem('petxi-me'); setMe(''); };
  return { me, pick, leave };
}

function Gate({ onPick }){
  return (
    <div className="gate">
      <div className="brand">PET-<em>Xi</em></div>
      <p>Executive Dashboard — who's reviewing?</p>
      <div className="who">
        {REVIEWERS.map(r => (
          <button key={r.key} onClick={()=>onPick(r.name)}>I'm {r.name}</button>
        ))}
      </div>
      <p style={{fontSize:'.72rem',maxWidth:420}}>
        Honour system: pick your name to score as yourself. You can edit only your own
        scores and comments; every change is recorded in Supabase.
      </p>
    </div>
  );
}

export default function App(){
  const { me, pick, leave } = useGate();
  if (!me) return <Gate onPick={pick} />;
  return <Dashboard me={me} onLeave={leave} />;
}

function Dashboard({ me, onLeave }){
  const [tab, setTab] = useState('company');
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [save, setSave] = useState('');
  const week = weekStart();
  const myKey = REVIEWERS.find(r => r.name === me)?.key;

  const refresh = useCallback(async () => {
    try { setData(await loadAll(week)); }
    catch(e){ setErr(e.message || String(e)); }
  }, [week]);
  useEffect(() => { refresh(); }, [refresh]);

  // live updates from the other reviewer
  useEffect(() => {
    const ch = supa.channel('rt')
      .on('postgres_changes', { event:'*', schema:'public', table:'scores' }, refresh)
      .on('postgres_changes', { event:'*', schema:'public', table:'org_scores' }, refresh)
      .subscribe();
    return () => { supa.removeChannel(ch); };
  }, [refresh]);

  if (err) return <div className="wrap"><div className="card">Couldn’t reach Supabase: {err}</div></div>;
  if (!data) return <div className="wrap"><div className="card">Loading the live board…</div></div>;

  async function score(fn, args){
    setSave('Saving…');
    try { await fn({ ...args, reviewer: me }); await refresh(); setSave('Saved ✓'); }
    catch(e){ setSave('Save failed'); setErr(e.message); }
    setTimeout(()=>setSave(''), 1500);
  }

  return (
    <>
      <header>
        <div className="masthead">
          <div className="brand">PET-<em>Xi</em></div>
          <h1>Executive Dashboard — Business Unit Review</h1>
          <div className="whoami">
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
        </div>
      </header>
      <nav className="tabs">
        {[['company','Company Excellence'],['projects','Excellence Projects'],
          ['progress','Weekly Progress'],['discuss','Items to Discuss']].map(([k,l]) => (
          <button key={k} className={tab===k?'active':''} onClick={()=>setTab(k)}>{l}</button>
        ))}
      </nav>
      <div className="wrap">
        {tab==='company' && <Company data={data} me={me} myKey={myKey} onScore={score} />}
        {tab!=='company' && <div className="card"><p className="muted">
          {tab} — ported from the mockup next; the live matrices and scoring are wired first.</p></div>}
      </div>
    </>
  );
}

// ---- Company Excellence: unit matrix + org matrix, both live ----
function Company({ data, me, myKey, onScore }){
  const { units, criteria, ofuncs, ocrit, scores, oscores } = data;
  const critById = Object.fromEntries(criteria.map(c => [c.id, c]));

  const scoreOf = (cid, uid, rk) => {
    const rev = REVIEWERS.find(r=>r.key===rk).name;
    return scores.find(s => s.criterion_id===cid && s.unit_id===uid && s.reviewer===rev)?.score || 0;
  };
  const descFor = (c, uid) => (c.descriptors_by_unit?.[uid]) || c.descriptors;

  const unitMean = uid => {
    const vals = [];
    criteria.filter(c=>!c.unit_id).forEach(c => REVIEWERS.forEach(r=>{ const g=scoreOf(c.id,uid,r.key); if(g)vals.push(g); }));
    (CRIT_BY_UNIT[uid]||[]).forEach(cid => REVIEWERS.forEach(r=>{ const g=scoreOf(cid,uid,r.key); if(g)vals.push(g); }));
    return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : null;
  };

  const [pick, setPick] = useState(null); // {cid,uid,x,y,desc,labels}
  const openPick = (e, c, uid) => {
    const rk = myKey;
    const r = e.currentTarget.getBoundingClientRect();
    const { x, y } = pickPos(r);
    setPick({ cid:c.id, uid, labels:c.labels, desc:descFor(c,uid), x, y });
  };
  const choose = async g => {
    const { cid, uid } = pick;
    if (g===0) await onScore(clearScore, { criterion_id:cid, unit_id:uid });
    else await onScore(setScore, { criterion_id:cid, unit_id:uid, score:g });
    setPick(null);
  };

  const Chip = ({ c, uid, rk }) => {
    const g = scoreOf(c.id, uid, rk);
    const mine = rk === myKey;
    return (
      <button
        className={`chip ${g?('s'+g):'empty'} ${mine?'':'readonly'}`}
        onClick={mine ? (e)=>openPick(e,c,uid) : undefined}
        title={mine ? 'Click to grade' : `${REVIEWERS.find(r=>r.key===rk).name}'s score (read-only)`}>
        {g||'–'}
      </button>
    );
  };

  return (
    <>
      <div className="board">
        <table className="matrix">
          <thead>
            <tr>
              <th className="crit-col" rowSpan={2} style={{verticalAlign:'middle'}}>
                <span className="period-q"><em>{PERIOD.q}</em></span>
                <span className="period-range">{PERIOD.range}</span>
                <span className="period-count">{countdown()}</span>
              </th>
              {units.map(u => {
                const m = unitMean(u.id);
                return <th key={u.id} colSpan={2} className="usep">
                  <span className="unit-name">{u.name}</span>
                  {m!==null && <span className="unit-mean" style={{background:`var(--g${meanGrade(m)})`}}>{m.toFixed(1)}</span>}
                </th>;
              })}
            </tr>
            <tr>
              {units.map(u => REVIEWERS.map(r =>
                <th key={u.id+r.key} className={r.key==='fs'?'usep':''}><span className="sub-head">{r.short}</span></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {BANDS.map(b => (
              <FragmentBand key={b.name} band={b} units={units} critById={critById} Chip={Chip} />
            ))}
            <tr className="band"><td>Unit-critical<span>scored for its own unit only</span></td>
              <td colSpan={units.length*2} style={{background:'var(--ink)'}}/></tr>
            {/* unit-critical rows: one row per criterion, placed in its unit column */}
            {units.flatMap(u => (CRIT_BY_UNIT[u.id]||[]).map(cid => critById[cid]).filter(Boolean).map(c => (
              <tr key={c.id}>
                <td className="crit" title={critTip(c)}>{c.name}</td>
                {units.map(u2 => REVIEWERS.map(r => (
                  <td key={u2.id+r.key} className={r.key==='fs'?'usep':''}>
                    {u2.id===c.unit_id ? <Chip c={c} uid={u2.id} rk={r.key}/> : <span className="na">·</span>}
                  </td>
                )))}
              </tr>
            )))}
          </tbody>
        </table>
      </div>
      <p className="footnote">Live — scores save to Supabase as {me}. Headline = mean of all scored cells. You edit only your own column ({REVIEWERS.find(r=>r.key===myKey).short}); the other is read-only.</p>

      <OrgMatrix ofuncs={ofuncs} ocrit={ocrit} oscores={oscores} me={me} myKey={myKey} onScore={onScore} />

      {pick && (
        <div className="pick" style={{left:pick.x,top:pick.y}} onMouseLeave={()=>setPick(null)}>
          {[1,2,3,4].map(g => (
            <button key={g} onClick={()=>choose(g)}>
              <span className="pd" style={{background:`var(--g${g})`}}>{g}</span>
              <span><span className="pl">{pick.labels[g-1]}</span><br/><span className="pdesc">{pick.desc[g-1]}</span></span>
            </button>
          ))}
          <button onClick={()=>choose(0)}>
            <span className="pd" style={{background:'transparent',border:'1.5px dashed var(--line)',color:'#b6b1a3'}}>–</span>
            <span><span className="pl">Clear</span><br/><span className="pdesc">Remove this score.</span></span>
          </button>
        </div>
      )}
    </>
  );
}

function FragmentBand({ band, units, critById, Chip }){
  return (
    <>
      <tr className="band"><td>{band.name}<span>{band.note}</span></td>
        <td colSpan={units.length*2} style={{background:'var(--ink)'}}/></tr>
      {band.ids.map(id => critById[id]).filter(Boolean).map(c => (
        <tr key={c.id}>
          <td className="crit" title={critTip(c)}>{c.name}</td>
          {units.map(u => (
            <FragCells key={u.id} c={c} u={u} Chip={Chip} />
          ))}
        </tr>
      ))}
    </>
  );
}
function FragCells({ c, u, Chip }){
  return <>
    <td><Chip c={c} uid={u.id} rk="ch"/></td>
    <td className="usep"><Chip c={c} uid={u.id} rk="fs"/></td>
  </>;
}

function OrgMatrix({ ofuncs, ocrit, oscores, me, myKey, onScore }){
  const scoreOf = (fid, cid, rk) => {
    const rev = REVIEWERS.find(r=>r.key===rk).name;
    return oscores.find(s => s.function_id===fid && s.criterion_id===cid && s.reviewer===rev)?.score || 0;
  };
  const rowMean = fid => {
    const vals=[]; ocrit.forEach(c=>REVIEWERS.forEach(r=>{const g=scoreOf(fid,c.id,r.key); if(g)vals.push(g);}));
    return vals.length? vals.reduce((a,b)=>a+b,0)/vals.length : null;
  };
  const [pick,setPick]=useState(null);
  const open=(e,f,c)=>{const r=e.currentTarget.getBoundingClientRect();
    const {x,y}=pickPos(r);
    setPick({fid:f.id,cid:c.id,labels:c.labels,desc:c.descriptors,x,y});};
  const choose=async g=>{const{fid,cid}=pick;
    if(g===0) await onScore(clearOrgScore,{function_id:fid,criterion_id:cid});
    else await onScore(setOrgScore,{function_id:fid,criterion_id:cid,score:g}); setPick(null);};
  const Chip=({f,c,rk})=>{const g=scoreOf(f.id,c.id,rk),mine=rk===myKey;
    return <button className={`chip ${g?('s'+g):'empty'} ${mine?'':'readonly'}`}
      onClick={mine?(e)=>open(e,f,c):undefined}>{g||'–'}</button>;};
  return (
    <>
      <div className="panel-h"><span className="bar" style={{background:'var(--g2)'}}/>Organisation — horizontal functions</div>
      <div className="board">
        <table className="matrix">
          <thead>
            <tr><th className="crit-col" rowSpan={2}/>{ocrit.map(c=>
              <th key={c.id} colSpan={2} className="usep" title={critTip(c)}><span className="unit-name">{c.name}</span></th>)}
              <th rowSpan={2}><span className="sub-head">MEAN</span></th></tr>
            <tr>{ocrit.map(c=>REVIEWERS.map(r=>
              <th key={c.id+r.key} className={r.key==='fs'?'usep':''}><span className="sub-head">{r.short}</span></th>))}</tr>
          </thead>
          <tbody>
            {ofuncs.map(f=>{const m=rowMean(f.id);return(
              <tr key={f.id}><td className="crit" title={f.name}>{f.name}</td>
                {ocrit.map(c=>REVIEWERS.map(r=>
                  <td key={c.id+r.key} className={r.key==='fs'?'usep':''}><Chip f={f} c={c} rk={r.key}/></td>))}
                <td>{m===null?<span className="na">–</span>:
                  <span className="unit-mean" style={{background:`var(--g${meanGrade(m)})`,marginTop:0}}>{m.toFixed(1)}</span>}</td>
              </tr>);})}
          </tbody>
        </table>
      </div>
      {pick&&(<div className="pick" style={{left:pick.x,top:pick.y}} onMouseLeave={()=>setPick(null)}>
        {[1,2,3,4].map(g=>(<button key={g} onClick={()=>choose(g)}>
          <span className="pd" style={{background:`var(--g${g})`}}>{g}</span>
          <span><span className="pl">{pick.labels[g-1]}</span><br/><span className="pdesc">{pick.desc[g-1]}</span></span></button>))}
        <button onClick={()=>choose(0)}><span className="pd" style={{background:'transparent',border:'1.5px dashed var(--line)',color:'#b6b1a3'}}>–</span>
          <span><span className="pl">Clear</span></span></button>
      </div>)}
    </>
  );
}
