import { useState } from 'react';

// Styled stand-ins for window.confirm()/window.prompt() — same modal-backdrop
// pattern used everywhere else in the app, so completing/cancelling/deleting
// doesn't drop into an unstyled browser popup. Both resolve a promise, so
// call sites just `await ask(...)` where they used to call the native fn.

export function useConfirm() {
  const [state, setState] = useState(null); // { message, danger, confirmLabel, resolve }
  const ask = (message, opts = {}) => new Promise(resolve => {
    setState({ message, danger: !!opts.danger, confirmLabel: opts.confirmLabel || 'Confirm', resolve });
  });
  const close = (result) => { state?.resolve(result); setState(null); };
  const dialog = state && (
    <div className="modal-backdrop" onClick={() => close(false)}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <p>{state.message}</p>
        <div className="modal-actions">
          <button onClick={() => close(false)}>Cancel</button>
          <button className={state.danger ? 'danger' : ''} onClick={() => close(true)}>{state.confirmLabel}</button>
        </div>
      </div>
    </div>
  );
  return [ask, dialog];
}

export function usePrompt() {
  const [state, setState] = useState(null); // { message, danger, confirmLabel, placeholder, suggestions, value, resolve }
  const ask = (message, opts = {}) => new Promise(resolve => {
    setState({
      message, danger: !!opts.danger, confirmLabel: opts.confirmLabel || 'Save',
      placeholder: opts.placeholder || '', suggestions: opts.suggestions || null, value: '', resolve,
    });
  });
  const close = (result) => { state?.resolve(result); setState(null); };
  const submit = () => close(state.value.trim() || null);
  const dialog = state && (
    <div className="modal-backdrop" onClick={() => close(null)}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <p>{state.message}</p>
        <input className="formctl" autoFocus placeholder={state.placeholder} value={state.value}
          list={state.suggestions ? 'prompt-suggestions' : undefined}
          onChange={e => setState(s => ({ ...s, value: e.target.value }))}
          onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') close(null); }}
          style={{ width: '100%', margin: '.8rem 0' }} />
        {state.suggestions && (
          <datalist id="prompt-suggestions">{state.suggestions.map(s => <option key={s} value={s} />)}</datalist>
        )}
        <div className="modal-actions">
          <button onClick={() => close(null)}>Cancel</button>
          <button className={state.danger ? 'danger' : ''} onClick={submit}>{state.confirmLabel}</button>
        </div>
      </div>
    </div>
  );
  return [ask, dialog];
}
