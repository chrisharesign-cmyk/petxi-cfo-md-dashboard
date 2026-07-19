import { useState } from 'react';
import { supa } from './supa';

// Inline edit for a value nested inside a criteria/org_criteria row's array
// or jsonb column (descriptors, descriptors_by_unit, likely_cause_by_unit,
// solution_by_unit, and their _by_function equivalents). PostgREST can't
// patch a single array slot or jsonb key server-side, so every save writes
// the FULL replacement value for that column — buildNewValue computes it
// client-side from the row already held in `data`, and the caller (which
// knows the shape) supplies that function.
//
// View and edit modes share one type scale (the .longtext class in
// theme.css) so switching between them doesn't change font size, line
// height or width — that mismatch was the root of the "text looks fine in
// the editor but wraps oddly when viewing" report.
export default function EditableCriterionField({ table, id, column, value, buildNewValue, onSaved, placeholder, multiline = true, tag = 'div', renderValue, rows = 9 }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setBusy(true); setError('');
    try {
      const newFull = buildNewValue(draft);
      const { error: err } = await supa.from(table).update({ [column]: newFull }).eq('id', id);
      if (err) throw err;
      setEditing(false);
      onSaved?.();
    } catch (e) { setError(e.message || String(e)); }
    finally { setBusy(false); }
  };

  const Tag = tag;

  if (!editing) {
    return (
      <Tag className={multiline && !renderValue ? 'editable longtext' : 'editable'}
        onClick={() => { setDraft(value || ''); setEditing(true); }} title="Click to edit">
        {value
          ? (renderValue ? renderValue(value) : value)
          : <span className="muted">{placeholder || '— click to add —'}</span>}
      </Tag>
    );
  }
  return (
    <Tag className="editform" style={{ display: 'block' }}>
      {multiline
        ? <textarea className="formctl longtext-area" value={draft} onChange={e => setDraft(e.target.value)} autoFocus rows={rows}
            onKeyDown={e => { if (e.key === 'Escape') setEditing(false); }} />
        : <input className="formctl" value={draft} onChange={e => setDraft(e.target.value)} autoFocus style={{ width: '100%' }}
            onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }} />}
      <div style={{ marginTop: '.4rem', display: 'flex', gap: '.5rem' }}>
        <button className="btn primary" disabled={busy} onClick={save}>Save</button>
        <button className="btn" type="button" onClick={() => setEditing(false)}>Cancel</button>
      </div>
      {error && <span className="muted" style={{ color: 'var(--g4)', display: 'block', width: '100%', marginTop: '.3rem' }}>{error}</span>}
    </Tag>
  );
}
