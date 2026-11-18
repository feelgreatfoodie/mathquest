import { useState, useSyncExternalStore } from 'react';
import { dismissFailure, getFailures, subscribeFailures } from './failures';

/** Shows every unsaved write until the player dismisses it or a retry saves it. */
export function FailureToasts() {
  const failures = useSyncExternalStore(subscribeFailures, getFailures);
  const [busy, setBusy] = useState<number | null>(null);
  if (!failures.length) return null;
  return (
    <div className="toasts" role="alert" aria-live="assertive">
      {failures.map((f) => (
        <div key={f.id} className="toast">
          <span>{f.message}</span>
          {f.retry ? (
            <button
              type="button"
              className="btn btn-small"
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
              Try again
            </button>
          ) : null}
          <button type="button" className="btn btn-ghost btn-small" onClick={() => dismissFailure(f.id)}>Dismiss</button>
        </div>
      ))}
    </div>
  );
}
