import { supa, weekStart } from './supa';

// Load the whole matrix structure + this week's scores in one go.
export async function loadAll(week = weekStart()) {
  const [units, criteria, ofuncs, ocrit, scores, oscores, projects] = await Promise.all([
    supa.from('units').select('*').order('sort'),
    supa.from('criteria').select('*').order('sort'),
    supa.from('org_functions').select('*').order('sort'),
    supa.from('org_criteria').select('*').order('sort'),
    supa.from('scores').select('*').eq('week_start', week),
    supa.from('org_scores').select('*').eq('week_start', week),
    supa.from('projects').select('*').order('created_at', { ascending: false }),
  ]);
  const err = [units,criteria,ofuncs,ocrit,scores,oscores,projects].find(r => r.error);
  if (err) throw err.error;
  return {
    units: units.data, criteria: criteria.data,
    ofuncs: ofuncs.data, ocrit: ocrit.data,
    scores: scores.data, oscores: oscores.data, projects: projects.data,
  };
}

// Upsert one unit-matrix score, stamped with the reviewer name.
export async function setScore({ criterion_id, unit_id, score, reviewer, week = weekStart() }) {
  const { error } = await supa.from('scores')
    .upsert({ criterion_id, unit_id, week_start: week, score, reviewer, updated_at: new Date().toISOString() },
            { onConflict: 'criterion_id,unit_id,week_start,reviewer' });
  if (error) throw error;
}
export async function clearScore({ criterion_id, unit_id, reviewer, week = weekStart() }) {
  const { error } = await supa.from('scores').delete()
    .match({ criterion_id, unit_id, week_start: week, reviewer });
  if (error) throw error;
}
export async function setOrgScore({ function_id, criterion_id, score, reviewer, week = weekStart() }) {
  const { error } = await supa.from('org_scores')
    .upsert({ function_id, criterion_id, week_start: week, score, reviewer, updated_at: new Date().toISOString() },
            { onConflict: 'function_id,criterion_id,week_start,reviewer' });
  if (error) throw error;
}
export async function clearOrgScore({ function_id, criterion_id, reviewer, week = weekStart() }) {
  const { error } = await supa.from('org_scores').delete()
    .match({ function_id, criterion_id, week_start: week, reviewer });
  if (error) throw error;
}
export async function addProject(p) {
  const { error } = await supa.from('projects').insert(p);
  if (error) throw error;
}

// Historic means per unit, week by week — the impact-reporting query.
export async function history(unit_id) {
  const { data, error } = await supa.from('scores')
    .select('week_start, score').eq('unit_id', unit_id).order('week_start');
  if (error) throw error;
  const byWeek = {};
  data.forEach(r => { (byWeek[r.week_start] ||= []).push(r.score); });
  return Object.entries(byWeek).map(([week, arr]) =>
    ({ week, mean: arr.reduce((a,b)=>a+b,0)/arr.length }));
}
