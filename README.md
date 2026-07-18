# PET-Xi Executive Dashboard (live build)

Vite + React app wired to Supabase project `bvdgqsqkcujtithyratf` (petxi-exec-dashboard, eu-west-2).

## Run locally
    npm install
    npm run dev      # opens on localhost, talks straight to Supabase

## Deploy to Netlify
Point the existing `petxi-cfoandmd-dashboard` site at this repo:
- Build command: `npm run build`
- Publish directory: `dist`
Or drag the `dist/` folder (after `npm run build`) onto app.netlify.com/drop.

## How it works
- No login: `Gate` asks "I'm Chris Haresign / I'm Fleur Sexton" and stores the choice.
- Every score upserts to `scores` / `org_scores` stamped with your reviewer NAME.
- You can edit only your own column; the other reviewer's is read-only in the UI.
- Every insert/update/delete is captured in `audit_log` via database triggers — the
  integrity record, since name-pick isn't real auth.
- `history()` in data.js returns weekly means per unit — the impact-reporting query.

## Keys
Supabase URL + publishable key are in `src/supa.js` (publishable key is safe in client code;
RLS governs access).

## Still to port from the mockup (petxi-cfoandmd-dashboard.netlify.app)
- Projects tab (unit>criterion area, impact-of-fix, auto target dates, filters, add form)
- Items to Discuss (3/4 cells -> recovery routes + create-project)
- Weekly Progress
- Meeting recorder + Copy-for-Claude
The mockup HTML has all of these working client-side; they need moving into React
components and, for projects, wiring to the `projects` table (already exists).
