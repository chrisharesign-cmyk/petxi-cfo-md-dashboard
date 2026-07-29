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
// `blind: true` — this reviewer can't see anyone else's scores (or the
// Agreed column) on the SAR matrix until they've scored every cell
// themselves, so they're not anchored by scores already on the board while
// still forming their own independent read.
export const REVIEWERS = [
  { key: 'ch', name: 'Chris Haresign', short: 'CH' },
  { key: 'fs', name: 'Fleur Sexton',  short: 'FS' },
  { key: 'sb', name: 'Sarah Beavan',  short: 'SB' },
  { key: 'jh', name: 'Josh Hill',     short: 'JH', blind: true },
  { key: 'sz', name: 'Sandra Zubyte', short: 'SZ', blind: true },
];
