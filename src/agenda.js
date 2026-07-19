import { unitCellKey, orgCellKey, projectCellKey, worstGrades } from './data';
import { daysInStage, overdueBy } from './util';

// The live QIP-meeting agenda, computed fresh off already-loaded `data` —
// nothing here is stored, so it's always current up to the moment you open
// it. Every grade-3/4 cell gets sorted into "solutions needed" (no live
// project against it yet — the case for starting one) or "progress update"
// (a live project already exists — check how it's going).
export function qipAgenda(data) {
  const { criteria, ocrit, units, ofuncs, scores, oscores, projects } = data;
  const critById = Object.fromEntries(criteria.map(c => [c.id, c]));
  const ocritById = Object.fromEntries(ocrit.map(c => [c.id, c]));
  const unitById = Object.fromEntries(units.map(u => [u.id, u]));
  const funcById = Object.fromEntries(ofuncs.map(f => [f.id, f]));
  const active = projects.filter(p => !p.archived_at);

  const newProjects = active.filter(p => !p.discussed_at)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const worst = worstGrades(scores, oscores);
  const liveByCell = {};
  active.filter(p => p.status === 'live').forEach(p => {
    (liveByCell[projectCellKey(p)] ||= []).push(p);
  });

  const bucket = grade => {
    const solutions = [], progress = [];
    Object.entries(worst).filter(([, w]) => w.grade === grade).forEach(([key, w]) => {
      const area = w.scope === 'unit' ? unitById[w.unit_id] : funcById[w.function_id];
      const crit = w.scope === 'unit' ? critById[w.criterion_id] : ocritById[w.criterion_id];
      const entry = { ...w, key, areaName: area?.name || w.unit_id || w.function_id, critName: crit?.name || w.criterion_id };
      const liveProjects = liveByCell[key];
      if (liveProjects?.length) progress.push({ ...entry, projects: liveProjects });
      else solutions.push(entry);
    });
    const byArea = (a, b) => a.areaName.localeCompare(b.areaName);
    return { solutions: solutions.sort(byArea), progress: progress.sort(byArea) };
  };

  return { newProjects, grade4: bucket(4), grade3: bucket(3) };
}

// Flattens a qipAgenda's grade-3/4 cells into the rows meeting_criteria
// should snapshot when a QIP meeting starts.
export function agendaCriteriaRows(agenda) {
  const rows = [];
  [4, 3].forEach(grade => {
    const b = grade === 4 ? agenda.grade4 : agenda.grade3;
    [...b.solutions, ...b.progress].forEach(w => rows.push({
      scope: w.scope, unit_id: w.unit_id ?? null, function_id: w.function_id ?? null,
      criterion_id: w.criterion_id, grade_at_meeting: grade,
    }));
  });
  return rows;
}

// The live agenda for one Project meeting — a meeting-ready summary of a
// single project's case file, not stored either.
export function projectAgenda(project, data) {
  if (!project) return null;
  const area = project.scope === 'unit'
    ? data.units.find(u => u.id === project.unit_id)
    : data.ofuncs.find(f => f.id === project.function_id);
  const crit = project.scope === 'unit'
    ? data.criteria.find(c => c.id === project.criterion_id)
    : data.ocrit.find(c => c.id === project.criterion_id);
  const unitOrFn = project.scope === 'unit' ? project.unit_id : project.function_id;
  const descArr = project.scope === 'unit'
    ? (crit?.descriptors_by_unit?.[unitOrFn] || crit?.descriptors)
    : (crit?.descriptors_by_function?.[unitOrFn] || crit?.descriptors);
  return {
    project, area, crit,
    excellenceText: descArr?.[0],
    progressRag: project.progress_rag,
    daysAtStage: daysInStage(project.status_changed_at),
    overdue: project.due ? overdueBy(project.due) : false,
  };
}
