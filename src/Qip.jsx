import { useState } from 'react';
import { REVIEWERS } from './supa';
import { setScore, clearScore, setOrgScore, clearOrgScore } from './data';
import { BANDS, CRIT_BY_UNIT, meanGrade, countdown } from './matrixdata';
import { finalScoreFor } from './util';

// Row/column labels are short jargon (eg. "Term pipeline coverage") — hover
// shows the "on target" descriptor so reviewers know what's being measured.
function critTip(c) {
  const onTarget = c.descriptors?.[1];
  return onTarget ? `${c.name} — ${onTarget}` : c.name;
}

// Plain-English gloss for each horizontal category — the column names are
// short shorthand, so a one-line "what this actually means" sits under each
// one in the matrix header.
const ORG_CRIT_BLURB = {
  capability: 'Do we have enough of the right people, properly trained and available, to deliver what we’ve promised?',
  impact: 'Can we prove, with real evidence, the difference PET-Xi actually makes for learners and employers?',
  service: 'How well do we look after the people and organisations who commission and pay us?',
  systems: 'Do our internal processes and systems actually work day to day, without relying on memory?',
};

// The score picker is position:fixed, so it never moves with page scroll —
// if it opens below the viewport the 2/3/4 buttons render off-screen.
// Flip it to open upward when there isn't room below.
function pickPos(rect) {
  const estHeight = 300, estWidth = 310;
  const x = Math.max(8, Math.min(rect.left, window.innerWidth - estWidth));
  const spaceBelow = window.innerHeight - rect.bottom;
  const y = spaceBelow >= estHeight + 10 ? rect.bottom + 6 : Math.max(8, rect.top - estHeight - 6);
  return { x, y };
}

// Always visible, whatever the grade — a criterion doing well can still
// have an improvement project running. Shows the live-project count (every
// criterion effectively has its own page now); double-click drills in.
function CircleNav({ count, onOpen, label }) {
  return (
    <button className={`circlenav ${count ? 'has-count' : ''}`} onDoubleClick={onOpen}
      title={`${count || 'No'} project${count === 1 ? '' : 's'} running against ${label} — double-click to open its page`}>
      {count || '–'}
    </button>
  );
}

function DotLegend() {
  return (
    <div className="card legend-card">
      <b>The square</b> under "Live Projects", between Chris's and Fleur's scores, is always there — it's the
      number of live projects running against that criterion (or "–" for none). <b>Double-click it</b> to open
      that criterion's own page: root cause analysis, and every project (solution) against it.
    </div>
  );
}

export default function Qip({ data, me, myKey, onScore, canEdit, showAgreed, liveCountByCell, onOpenArea, onOpenCriterion, onOpenCase }) {
  const { units, criteria, ofuncs, ocrit, scores, oscores, period } = data;
  const critById = Object.fromEntries(criteria.map(c => [c.id, c]));

  const scoreOf = (cid, uid, rk) => {
    const rev = REVIEWERS.find(r => r.key === rk).name;
    const row = scores.find(s => s.criterion_id === cid && s.unit_id === uid && s.reviewer === rev);
    return { g: row?.score || 0, snap: row?.descriptor_snapshot };
  };
  const descFor = (c, uid) => (c.descriptors_by_unit?.[uid]) || c.descriptors;

  // Once agreed, a criterion's grade counts twice toward the mean (same
  // weight as two individual reviewer scores would have) rather than
  // silently dropping to one data point just because it's been reconciled.
  const meanContribution = (cid, uid, vals) => {
    const agreed = finalScoreFor(data, { scope: 'unit', unit_id: uid, function_id: null, criterion_id: cid });
    if (agreed) { vals.push(agreed, agreed); return; }
    REVIEWERS.forEach(r => { const { g } = scoreOf(cid, uid, r.key); if (g) vals.push(g); });
  };
  const unitMean = uid => {
    const vals = [];
    criteria.filter(c => !c.unit_id).forEach(c => meanContribution(c.id, uid, vals));
    (CRIT_BY_UNIT[uid] || []).forEach(cid => meanContribution(cid, uid, vals));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };

  const [pick, setPick] = useState(null);
  const openPick = (e, c, uid) => {
    if (!canEdit) return;
    const r = e.currentTarget.getBoundingClientRect();
    const { x, y } = pickPos(r);
    setPick({ cid: c.id, uid, labels: c.labels, desc: descFor(c, uid), x, y });
  };
  const choose = async g => {
    const { cid, uid } = pick;
    if (g === 0) await onScore(clearScore, { criterion_id: cid, unit_id: uid });
    else await onScore(setScore, { criterion_id: cid, unit_id: uid, score: g });
    setPick(null);
  };

  const Chip = ({ c, uid, rk }) => {
    const agreed = showAgreed ? finalScoreFor(data, { scope: 'unit', unit_id: uid, function_id: null, criterion_id: c.id }) : null;
    if (agreed) {
      return <button className={`chip s${agreed}`} disabled title={`Agreed final score: ${agreed}`}>{agreed}</button>;
    }
    const { g, snap } = scoreOf(c.id, uid, rk);
    const mine = rk === myKey;
    const clickable = canEdit && mine;
    return (
      <button
        className={`chip ${g ? ('s' + g) : 'empty'} ${clickable ? '' : 'readonly'}`}
        onClick={clickable ? (e) => openPick(e, c, uid) : undefined}
        title={!canEdit && snap ? `Locked — judged against: ${snap}` : clickable ? 'Click to grade' : `${REVIEWERS.find(r => r.key === rk).name}'s score${canEdit ? ' (read-only)' : ''}`}>
        {g || '–'}
      </button>
    );
  };
  const CircleCell = ({ c, uid }) => (
    <CircleNav count={liveCountByCell[`unit:${uid}:${c.id}`] || 0} label={c.name}
      onOpen={() => onOpenCriterion({ scope: 'unit', unit_id: uid, function_id: null, criterion_id: c.id })} />
  );

  return (
    <>
      <DotLegend />
      <div className="board">
        <table className="matrix">
          <colgroup>
            <col style={{ width: 220 }} />
            {units.flatMap(u => [<col key={u.id + '-ch'} />, <col key={u.id + '-mid'} style={{ width: 60 }} />, <col key={u.id + '-fs'} />])}
          </colgroup>
          <thead>
            <tr>
              <th className="crit-col" rowSpan={2} style={{ verticalAlign: 'middle' }}>
                <span className="period-q"><em>{period?.label?.split(' · ')[0] || period?.id}</em></span>
                <span className="period-range">{period?.label?.split(' · ')[1] || ''}</span>
                <span className="period-count">{countdown()}</span>
              </th>
              {units.map(u => {
                const m = unitMean(u.id);
                return <th key={u.id} colSpan={3} className="usep">
                  <button className="unit-name linklike" onClick={() => onOpenArea({ scope: 'unit', id: u.id })}>{u.name}</button>
                  {m !== null && <span className="unit-mean" style={{ background: `var(--g${meanGrade(m)})` }}>{m.toFixed(1)}</span>}
                </th>;
              })}
            </tr>
            <tr>
              {units.map(u => [
                <th key={u.id + 'ch'}><span className="sub-head">CH</span></th>,
                <th key={u.id + 'mid'} className="live-head"><span className="sub-head">Live<br />Projects</span></th>,
                <th key={u.id + 'fs'} className="usep"><span className="sub-head">FS</span></th>,
              ])}
            </tr>
          </thead>
          <tbody>
            {BANDS.map(b => (
              <FragmentBand key={b.name} band={b} units={units} critById={critById} Chip={Chip} CircleCell={CircleCell} />
            ))}
            <tr className="band"><td>Unit-critical<span>scored for its own unit only</span></td>
              <td colSpan={units.length * 3} style={{ background: 'var(--ink)' }} /></tr>
            {units.flatMap(u => (CRIT_BY_UNIT[u.id] || []).map(cid => critById[cid]).filter(Boolean).map(c => (
              <tr key={c.id}>
                <td className="crit" title={critTip(c)}>{c.name}</td>
                {units.map(u2 => [
                  <td key={u2.id + 'ch'}>{u2.id === c.unit_id ? <Chip c={c} uid={u2.id} rk="ch" /> : <span className="na">·</span>}</td>,
                  <td key={u2.id + 'mid'} className="circle-cell">{u2.id === c.unit_id ? <CircleCell c={c} uid={u2.id} /> : null}</td>,
                  <td key={u2.id + 'fs'} className="usep">{u2.id === c.unit_id ? <Chip c={c} uid={u2.id} rk="fs" /> : <span className="na">·</span>}</td>,
                ])}
              </tr>
            )))}
          </tbody>
        </table>
      </div>
      <p className="footnote">
        {canEdit
          ? <>Live — scores save to Supabase as {me}. Headline = mean of all scored cells. You edit only your own column ({REVIEWERS.find(r => r.key === myKey).short}); the other is read-only.</>
          : <>Locked — {period?.label}. Grades are read-only; the wording shown on hover is what was judged against at lock time.</>}
      </p>

      <OrgMatrix data={data} me={me} myKey={myKey} onScore={onScore} canEdit={canEdit} showAgreed={showAgreed}
        liveCountByCell={liveCountByCell} onOpenArea={onOpenArea} onOpenCriterion={onOpenCriterion} onOpenCase={onOpenCase} />

      {pick && (
        <>
          <div className="pick-backdrop" onClick={() => setPick(null)} />
          <div className="pick" style={{ left: pick.x, top: pick.y }} onMouseLeave={() => setPick(null)}>
            {[1, 2, 3, 4].map(g => (
              <button key={g} onClick={() => choose(g)}>
                <span className="pd" style={{ background: `var(--g${g})` }}>{g}</span>
                <span><span className="pl">{pick.labels[g - 1]}</span><br /><span className="pdesc">{pick.desc[g - 1]}</span></span>
              </button>
            ))}
            <button onClick={() => choose(0)}>
              <span className="pd" style={{ background: 'transparent', border: '1.5px dashed var(--line)', color: '#b6b1a3' }}>–</span>
              <span><span className="pl">Clear</span><br /><span className="pdesc">Remove this score.</span></span>
            </button>
          </div>
        </>
      )}
    </>
  );
}

function FragmentBand({ band, units, critById, Chip, CircleCell }) {
  return (
    <>
      <tr className="band"><td>{band.name}<span>{band.note}</span></td>
        <td colSpan={units.length * 3} style={{ background: 'var(--ink)' }} /></tr>
      {band.ids.map(id => critById[id]).filter(Boolean).map(c => (
        <tr key={c.id}>
          <td className="crit" title={critTip(c)}>{c.name}</td>
          {units.map(u => (
            <FragCells key={u.id} c={c} u={u} Chip={Chip} CircleCell={CircleCell} />
          ))}
        </tr>
      ))}
    </>
  );
}
function FragCells({ c, u, Chip, CircleCell }) {
  return <>
    <td><Chip c={c} uid={u.id} rk="ch" /></td>
    <td className="circle-cell"><CircleCell c={c} uid={u.id} /></td>
    <td className="usep"><Chip c={c} uid={u.id} rk="fs" /></td>
  </>;
}

function OrgMatrix({ data, me, myKey, onScore, canEdit, showAgreed, liveCountByCell, onOpenArea, onOpenCriterion, onOpenCase }) {
  const { ofuncs, ocrit, oscores } = data;
  const scoreOf = (fid, cid, rk) => {
    const rev = REVIEWERS.find(r => r.key === rk).name;
    return oscores.find(s => s.function_id === fid && s.criterion_id === cid && s.reviewer === rev)?.score || 0;
  };
  const rowMean = fid => {
    const vals = [];
    ocrit.forEach(c => {
      const agreed = finalScoreFor(data, { scope: 'org', unit_id: null, function_id: fid, criterion_id: c.id });
      if (agreed) { vals.push(agreed, agreed); return; }
      REVIEWERS.forEach(r => { const g = scoreOf(fid, c.id, r.key); if (g) vals.push(g); });
    });
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const [pick, setPick] = useState(null);
  const open = (e, f, c) => {
    if (!canEdit) return;
    const r = e.currentTarget.getBoundingClientRect();
    const { x, y } = pickPos(r);
    setPick({ fid: f.id, cid: c.id, labels: c.labels, desc: c.descriptors, x, y });
  };
  const choose = async g => {
    const { fid, cid } = pick;
    if (g === 0) await onScore(clearOrgScore, { function_id: fid, criterion_id: cid });
    else await onScore(setOrgScore, { function_id: fid, criterion_id: cid, score: g });
    setPick(null);
  };
  const Chip = ({ f, c, rk }) => {
    const agreed = showAgreed ? finalScoreFor(data, { scope: 'org', unit_id: null, function_id: f.id, criterion_id: c.id }) : null;
    if (agreed) {
      return <button className={`chip s${agreed}`} disabled title={`Agreed final score: ${agreed}`}>{agreed}</button>;
    }
    const g = scoreOf(f.id, c.id, rk), mine = rk === myKey, clickable = canEdit && mine;
    return (
      <button className={`chip ${g ? ('s' + g) : 'empty'} ${clickable ? '' : 'readonly'}`}
        onClick={clickable ? (e) => open(e, f, c) : undefined}>{g || '–'}</button>
    );
  };
  return (
    <>
      <div className="panel-h"><span className="bar" style={{ background: 'var(--g2)' }} />Organisation — horizontal functions</div>
      <div className="board">
        <table className="matrix">
          <colgroup>
            <col style={{ width: 220 }} />
            {ocrit.flatMap(c => [<col key={c.id + '-ch'} />, <col key={c.id + '-mid'} style={{ width: 60 }} />, <col key={c.id + '-fs'} />])}
            <col style={{ width: 90 }} />
          </colgroup>
          <thead>
            <tr><th className="crit-col" rowSpan={3} />{ocrit.map(c =>
              <th key={c.id} colSpan={3} className="usep" title={critTip(c)}><span className="unit-name">{c.name}</span></th>)}
              <th rowSpan={3}><span className="sub-head">MEAN</span></th></tr>
            <tr>{ocrit.map(c =>
              <th key={c.id + 'blurb'} colSpan={3} className="usep cat-blurb">{ORG_CRIT_BLURB[c.id]}</th>)}</tr>
            <tr>{ocrit.map(c => [
              <th key={c.id + 'ch'}><span className="sub-head">CH</span></th>,
              <th key={c.id + 'mid'} className="live-head"><span className="sub-head">Live<br />Projects</span></th>,
              <th key={c.id + 'fs'} className="usep"><span className="sub-head">FS</span></th>,
            ])}</tr>
          </thead>
          <tbody>
            {ofuncs.map(f => {
              const m = rowMean(f.id); return (
                <tr key={f.id}><td className="crit"><button className="linklike" onClick={() => onOpenArea({ scope: 'org', id: f.id })}>{f.name}</button></td>
                  {ocrit.map(c => [
                    <td key={c.id + 'ch'}><Chip f={f} c={c} rk="ch" /></td>,
                    <td key={c.id + 'mid'} className="circle-cell">
                      <CircleNav count={liveCountByCell[`org:${f.id}:${c.id}`] || 0} label={c.name}
                        onOpen={() => onOpenCriterion({ scope: 'org', unit_id: null, function_id: f.id, criterion_id: c.id })} />
                    </td>,
                    <td key={c.id + 'fs'} className="usep"><Chip f={f} c={c} rk="fs" /></td>,
                  ])}
                  <td>{m === null ? <span className="na">–</span> :
                    <span className="unit-mean" style={{ background: `var(--g${meanGrade(m)})`, marginTop: 0 }}>{m.toFixed(1)}</span>}</td>
                </tr>);
            })}
          </tbody>
        </table>
      </div>
      {pick && (<>
        <div className="pick-backdrop" onClick={() => setPick(null)} />
        <div className="pick" style={{ left: pick.x, top: pick.y }} onMouseLeave={() => setPick(null)}>
          {[1, 2, 3, 4].map(g => (<button key={g} onClick={() => choose(g)}>
            <span className="pd" style={{ background: `var(--g${g})` }}>{g}</span>
            <span><span className="pl">{pick.labels[g - 1]}</span><br /><span className="pdesc">{pick.desc[g - 1]}</span></span></button>))}
          <button onClick={() => choose(0)}><span className="pd" style={{ background: 'transparent', border: '1.5px dashed var(--line)', color: '#b6b1a3' }}>–</span>
            <span><span className="pl">Clear</span></span></button>
        </div>
      </>)}
    </>
  );
}
