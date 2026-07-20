import { createClient } from '@supabase/supabase-js';
const URL = 'https://bvdgqsqkcujtithyratf.supabase.co';
const KEY = 'sb_publishable_Q5Nm-3xEws76fBQ3DQD2vA_rDw3-jUO';
export const supa = createClient(URL, KEY);

// Monday of the current week (score bucketing)
export function weekStart(d = new Date()) {
  const x = new Date(d);
  const day = x.getDay() || 7;
  x.setDate(x.getDate() - day + 1);
  x.setHours(0,0,0,0);
  return x.toISOString().slice(0,10);
}
export const REVIEWERS = [
  { key: 'ch', name: 'Chris Haresign', short: 'CH' },
  { key: 'fs', name: 'Fleur Sexton',  short: 'FS' },
  { key: 'sb', name: 'SB',            short: 'SB' }, // TODO: full name, waiting on Chris
];
