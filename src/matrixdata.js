// Bands group the shared spine for display. IDs must match Supabase criteria.id.
export const BANDS = [
  { name:'Money',    note:'budget · pipeline · profile · cash',       ids:['fin','pipe','prof','debt'] },
  { name:'Delivery', note:'quality · outcomes · compliance · safeguarding', ids:['qual','outc','comp','safe'] },
  { name:'People',   note:'licence ladder — 2 = licensed to deliver', ids:['staf','lead'] },
  { name:'Standing', note:'customers · reputation · data · Xi',        ids:['cust','repu','data','xi'] },
];
// unit_id -> the two critical criteria ids for that unit's column
export const CRIT_BY_UNIT = {
  restart:['rst1','rst2'], schools:['sch1','sch2'], ap:['ap1','ap2'],
  youth:['ys1','ys2'], adult:['as1','as2'],
};
export const PERIOD = { q:'Q4', range:'July – September' };
export function meanGrade(m){ return m<2.0?1 : m<2.5?2 : m<3.0?3 : 4; }
export function countdown(){
  const now=new Date(); let end=new Date(now.getFullYear(),7,31,23,59,59);
  if(now>end) end=new Date(now.getFullYear()+1,7,31,23,59,59);
  const days=Math.ceil((end-now)/86400000), w=Math.floor(days/7), d=days%7, p=[];
  if(w)p.push(w+(w===1?' week':' weeks')); if(d)p.push(d+(d===1?' day':' days'));
  return p.join(' ')+' to effect change';
}
