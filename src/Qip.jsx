import { useState } from 'react';
import { REVIEWERS } from './supa';
import { setScore, clearScore, setOrgScore, clearOrgScore, unitCellKey, orgCellKey } from './data';
import { BANDS, CRIT_BY_UNIT, meanGrade, countdown } from './matrixdata';
import { STATUS_CLASS, gradeMovement } from './util';

// Row/column labels are short jargon (eg. "Term pipeline coverage") — hover
// shows the "on target" descriptor so reviewers know what's being measured.
function critTip(c) {
  const onTarget = c.descriptors?.[1];
  return onTarget ? `${c.name} — ${onTarget}` : c.name;
}

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

// A cell can hold more than one open project now — show a plain dot for
// one, a small count badge for several (opens the first; the rest are in
// the Excellence Projects list for that area).
function ProjectDot({ projects, onOpenCase }) {
  if (!projects?.length) return null;
  const primary = projects[0];
  const shapeCls = `${STATUS_CLASS[primary.status]} ${primary.status === 'live' ? 'solid' : primary.status === 'paused' ? 'striped' : 'hollow'}`;
  if (projects.length === 1) {
    return (
      <button className={`pdot ${shapeCls}`}
        title={`${primary.title} — ${primary.status}`} onClick={(e) => { e.stopPropagation(); onOpenCase(primary.id); }} />
    );
  }
  return (
    <button className={`pdot pdot-count ${shapeCls}`}
      title={`${projects.length} open projects here — click to open "${primary.title}"`}
      onClick={(e) => { e.stopPropagation(); onOpenCase(primary.id); }}>
      {projects.length}
    </button>
  );
}

// Informal re-read of a project's criterion, shown ghosted since it hasn't
// gone through a formal SAR lock — a preview of where the grade is heading.
function GhostGrade({ project, onOpenCase }) {
  const movement = project && gradeMovement(project);
  if (!movement) return null;
  return (
    <button className={`ghostgrade ${movement.improved ? 'up' : 'down'}`}
      title={`${project.title} — current read ${movement.to} (was ${movement.from} at creation)`}
      onClick={(e) => { e.stopPropagation(); onOpenCase(project.id); }}>
      {movement.to}
    </button>
  );
}

function DotLegend() {
  return (
    <div className="card legend-card">
      <b>Reading the dots:</b> a dot on a score chip means a project's open against that cell —
      <span className="legend-dot solid" /><b>solid</b> = live,
      <span className="legend-dot striped" /><b>hatched</b> = on hold,
      <span className="legend-dot hollow" /><b>hollow</b> = queued or still being discussed.
      More than one open project shows as a number instead. Click a dot to open the case file.
      A <b>ghosted number</b> next to a chip is an informal re-read since this SAR locked — a preview
      of where the grade's heading, ahead of the next official one.
    </div>
  );
}

export default function Qip({ data, me, myKey, onScore, canEdit, projectsByCell, onOpenArea, onOpenCase }) {
  const { units, criteria, ofuncs, ocrit, scores, oscores, period } = data;
  const critById = Object.fromEntries(criteria.map(c => [c.id, c]));

  const scoreOf = (cid, uid, rk) => {
    const rev = REVIEWERS.find(r => r.key === rk).name;
    const row = scores.find(s => s.criterion_id === cid && s.unit_id === uid && s.reviewer === rev);
    return { g: row?.score || 0, snap: row?.descriptor_snapshot };
  };
  const descFor = (c, uid) => (c.descriptors_by_unit?.[uid]) || c.descriptors;

  const unitMean = uid => {
    const vals = [];
    criteria.filter(c => !c.unit_id).forEach(c => REVIEWERS.forEach(r => { const { g } = scoreOf(c.id, uid, r.key); if (g) vals.push(g); }));
    (CRIT_BY_UNIT[uid] || []).forEach(cid => REVIEWERS.forEach(r => { const { g } = scoreOf(cid, uid, r.key); if (g) vals.push(g); }));
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
    const { g, snap } = scoreOf(c.id, uid, rk);
    const mine = rk === myKey;
    const clickable = canEdit && mine;
    const projects = projectsByCell[unitCellKey(uid, c.id)] || [];
    return (
      <span className="chipwrap">
        <button
          className={`chip ${g ? ('s' + g) : 'empty'} ${clickable ? '' : 'readonly'}`}
          onClick={clickable ? (e) => openPick(e, c, uid) : undefined}
          title={!canEdit && snap ? `Locked — judged against: ${snap}` : clickable ? 'Click to grade' : `${REVIEWERS.find(r => r.key === rk).name}'s score${canEdit ? ' (read-only)' : ''}`}>
          {g || '–'}
        </button>
        <GhostGrade project={projects[0]} onOpenCase={onOpenCase} />
        <ProjectDot projects={projects} onOpenCase={onOpenCase} />
      </span>
    );
  };

  return (
    <>
      <DotLegend />
      <div className="board">
        <table className="matrix">
          <colgroup>
            <col style={{ width: 220 }} />
            {units.flatMap(u => [<col key={u.id + '-ch'} />, <col key={u.id + '-fs'} />])}
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
                return <th key={u.id} colSpan={2} className="usep">
                  <button className="unit-name linklike" onClick={() => onOpenArea({ scope: 'unit', id: u.id })}>{u.name}</button>
                  {m !== null && <span className="unit-mean" style={{ background: `var(--g${meanGrade(m)})` }}>{m.toFixed(1)}</span>}
                </th>;
              })}
            </tr>
            <tr>
              {units.map(u => REVIEWERS.map(r =>
                <th key={u.id + r.key} className={r.key === 'fs' ? 'usep' : ''}><span className="sub-head">{r.short}</span></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {BANDS.map(b => (
              <FragmentBand key={b.name} band={b} units={units} critById={critById} Chip={Chip} />
            ))}
            <tr className="band"><td>Unit-critical<span>scored for its own unit only</span></td>
              <td colSpan={units.length * 2} style={{ background: 'var(--ink)' }} /></tr>
            {units.flatMap(u => (CRIT_BY_UNIT[u.id] || []).map(cid => critById[cid]).filter(Boolean).map(c => (
              <tr key={c.id}>
                <td className="crit" title={critTip(c)}>{c.name}</td>
                {units.map(u2 => REVIEWERS.map(r => (
                  <td key={u2.id + r.key} className={r.key === 'fs' ? 'usep' : ''}>
                    {u2.id === c.unit_id ? <Chip c={c} uid={u2.id} rk={r.key} /> : <span className="na">·</span>}
                  </td>
                )))}
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
      <DotLegend />

      <OrgMatrix data={data} me={me} myKey={myKey} onScore={onScore} canEdit={canEdit}
        projectsByCell={projectsByCell} onOpenArea={onOpenArea} onOpenCase={onOpenCase} />

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

function FragmentBand({ band, units, critById, Chip }) {
  return (
    <>
      <tr className="band"><td>{band.name}<span>{band.note}</span></td>
        <td colSpan={units.length * 2} style={{ background: 'var(--ink)' }} /></tr>
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
function FragCells({ c, u, Chip }) {
  return <>
    <td><Chip c={c} uid={u.id} rk="ch" /></td>
    <td className="usep"><Chip c={c} uid={u.id} rk="fs" /></td>
  </>;
}

function OrgMatrix({ data, me, myKey, onScore, canEdit, projectsByCell, onOpenArea, onOpenCase }) {
  const { ofuncs, ocrit, oscores } = data;
  const scoreOf = (fid, cid, rk) => {
    const rev = REVIEWERS.find(r => r.key === rk).name;
    return oscores.find(s => s.function_id === fid && s.criterion_id === cid && s.reviewer === rev)?.score || 0;
  };
  const rowMean = fid => {
    const vals = []; ocrit.forEach(c => REVIEWERS.forEach(r => { const g = scoreOf(fid, c.id, r.key); if (g) vals.push(g); }));
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
    const g = scoreOf(f.id, c.id, rk), mine = rk === myKey, clickable = canEdit && mine;
    const projects = projectsByCell[orgCellKey(f.id, c.id)] || [];
    return (
      <span className="chipwrap">
        <button className={`chip ${g ? ('s' + g) : 'empty'} ${clickable ? '' : 'readonly'}`}
          onClick={clickable ? (e) => open(e, f, c) : undefined}>{g || '–'}</button>
        <GhostGrade project={projects[0]} onOpenCase={onOpenCase} />
        <ProjectDot projects={projects} onOpenCase={onOpenCase} />
      </span>
    );
  };
  return (
    <>
      <div className="panel-h"><span className="bar" style={{ background: 'var(--g2)' }} />Organisation — horizontal functions</div>
      <div className="board">
        <table className="matrix">
          <colgroup>
            <col style={{ width: 220 }} />
            {ocrit.flatMap(c => [<col key={c.id + '-ch'} />, <col key={c.id + '-fs'} />])}
            <col style={{ width: 90 }} />
          </colgroup>
          <thead>
            <tr><th className="crit-col" rowSpan={2} />{ocrit.map(c =>
              <th key={c.id} colSpan={2} className="usep" title={critTip(c)}><span className="unit-name">{c.name}</span></th>)}
              <th rowSpan={2}><span className="sub-head">MEAN</span></th></tr>
            <tr>{ocrit.map(c => REVIEWERS.map(r =>
              <th key={c.id + r.key} className={r.key === 'fs' ? 'usep' : ''}><span className="sub-head">{r.short}</span></th>))}</tr>
          </thead>
          <tbody>
            {ofuncs.map(f => {
              const m = rowMean(f.id); return (
                <tr key={f.id}><td className="crit"><button className="linklike" onClick={() => onOpenArea({ scope: 'org', id: f.id })}>{f.name}</button></td>
                  {ocrit.map(c => REVIEWERS.map(r =>
                    <td key={c.id + r.key} className={r.key === 'fs' ? 'usep' : ''}><Chip f={f} c={c} rk={r.key} /></td>))}
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
