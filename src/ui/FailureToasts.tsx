import { useState, useSyncExternalStore } from 'react';
import { applyUpdate } from '../update';
import { dismissFailure, getFailures, subscribeFailures } from './failures';
import { UiIcon } from './sprites';

/**
 * Shows every unsaved write until the player dismisses it or a retry saves it. A refused write offers Update
 * as well as Try again. `picture` swaps the buttons for icons (the pre-reader cannot read them).
 */
export function FailureToasts({ picture = false }: { picture?: boolean }) {
  const failures = useSyncExternalStore(subscribeFailures, getFailures);
  const [busy, setBusy] = useState<number | null>(null);
  if (!failures.length) return null;
  return (
    <div className="toasts" role="alert" aria-live="assertive">
      {failures.map((f) => (
        <div key={f.id} className="toast">
          <span>{f.message}</span>
          {f.update ? (
            picture ? (
              <button type="button" className="icon-btn" aria-label="Update" onClick={() => void applyUpdate()}><UiIcon name="refresh" size={36} /></button>
            ) : (
              <button type="button" className="btn btn-small" onClick={() => void applyUpdate()}>Update</button>
            )
          ) : null}
          {f.retry ? (
            <button
              type="button"
              className={picture ? 'icon-btn' : 'btn btn-small'}
              aria-label="Try again"
              disabled={busy === f.id}
              onClick={async () => {
                setBusy(f.id);
                try {
                  await f.retry!();
                } finally {
                  setBusy(null);
                }
              }}
            >
              {picture ? <UiIcon name="play" size={36} /> : 'Try again'}
            </button>
          ) : null}
          <button type="button" className={picture ? 'icon-btn' : 'btn btn-ghost btn-small'} aria-label="Dismiss" onClick={() => dismissFailure(f.id)}>
            {picture ? <UiIcon name="close" size={36} /> : 'Dismiss'}
          </button>
        </div>
      ))}
    </div>
  );
}
