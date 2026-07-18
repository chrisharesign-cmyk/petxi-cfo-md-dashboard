import { useState } from 'react';
import { supa } from './supa';

// Inline edit-in-place for any Supabase text field. Never local-only —
// every save goes straight through Supabase so the audit trigger captures it.
export default function EditableText({ table, id, field, value, onSaved, placeholder, className, multiline }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const { error } = await supa.from(table).update({ [field]: draft }).eq('id', id);
      if (error) throw error;
      setEditing(false);
      onSaved?.(draft);
    } finally { setBusy(false); }
  };

  const Tag = multiline ? 'div' : 'span';

  if (!editing) {
    return (
      <Tag className={`editable ${className || ''}`} onClick={() => { setDraft(value || ''); setEditing(true); }} title="Click to edit">
        {value || <span className="muted">{placeholder || '— click to add —'}</span>}
      </Tag>
    );
  }
  return (
    <Tag className="editform">
      {multiline
        ? <textarea value={draft} onChange={e => setDraft(e.target.value)} autoFocus rows={3}
            onKeyDown={e => { if (e.key === 'Escape') setEditing(false); }} />
        : <input value={draft} onChange={e => setDraft(e.target.value)} autoFocus
            onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }} />}
      <button disabled={busy} onClick={save}>Save</button>
      <button type="button" onClick={() => setEditing(false)}>Cancel</button>
    </Tag>
  );
}
