import { useEffect, useRef, useState } from 'react';
import { loadDocuments, uploadDocument, deleteDocument, documentUrl } from './data';
import { useConfirm } from './Dialogs';

export default function ProjectDocuments({ projectId, me }) {
  const [docs, setDocs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null); // doc being previewed, or null
  const [askConfirm, confirmDialog] = useConfirm();
  const fileRef = useRef(null);

  const refresh = () => loadDocuments(projectId).then(setDocs).catch(e => setError(e.message));
  useEffect(() => { refresh(); }, [projectId]);

  const onPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.type !== 'application/pdf') { setError('PDFs only, for now.'); return; }
    setBusy(true); setError('');
    try { await uploadDocument(projectId, file, me); refresh(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const remove = async (doc) => {
    const ok = await askConfirm(`Delete "${doc.filename}"? This can't be undone.`, { confirmLabel: 'Delete document', danger: true });
    if (!ok) return;
    try { await deleteDocument(doc); refresh(); }
    catch (err) { setError(err.message); }
  };

  return (
    <div style={{ marginTop: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h4 style={{ margin: 0 }}>Documents {docs.length > 0 && `(${docs.length})`}</h4>
        <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? 'Uploading…' : '+ Add PDF'}
        </button>
        <input ref={fileRef} type="file" accept="application/pdf" onChange={onPick} style={{ display: 'none' }} />
      </div>
      {error && <p className="muted" style={{ color: 'var(--g4)' }}>{error}</p>}
      {!docs.length && <p className="muted">No documents yet — e.g. the policy or spec this project produced.</p>}
      {docs.map(d => (
        <div key={d.id} className="docrow">
          <button className="linklike" onClick={() => setPreview(d)}>{d.filename}</button>
          <span className="muted">
            {' '}· {d.uploaded_by || 'unknown'} · {new Date(d.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
          <a className="linklike" href={documentUrl(d.storage_path)} download={d.filename} onClick={e => e.stopPropagation()}>download</a>
          <button className="linklike" onClick={() => remove(d)}>delete</button>
        </div>
      ))}

      {preview && (
        <div className="modal-backdrop" onClick={() => setPreview(null)}>
          <div className="modal" style={{ maxWidth: '90vw', width: 800, height: '85vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
            <button className="modalclose" onClick={() => setPreview(null)}>×</button>
            <h3 style={{ marginBottom: '.6rem' }}>{preview.filename}</h3>
            <iframe title={preview.filename} src={documentUrl(preview.storage_path)} style={{ flex: 1, border: '1px solid var(--line)', borderRadius: 8 }} />
          </div>
        </div>
      )}
      {confirmDialog}
    </div>
  );
}
