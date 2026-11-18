import { useEffect, useState } from 'react';
import { applyUpdate } from '../update';
import { speak, stopSpeaking, unlockSpeech } from './early/useSpeech';
import { UiIcon } from './sprites';

/**
 * Shown on the home screen when this bundle is older than config/app.minVersion. It starts no new run. It never
 * replaces a round or a save: the summary shows UpdatePrompt after the run is saved. A pre-reader gets one big button with a
 * picture and a voice, no words. Everyone else gets two lines of text and a button.
 */
export function UpdateScreen({ picture }: { picture: boolean }) {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!picture) return;
    void speak('The game has a new version. Tap the big button to get it.');
    return () => stopSpeaking();
  }, [picture]);

  const tap = () => {
    unlockSpeech();
    setBusy(true);
    void applyUpdate();
  };

  if (picture) {
    return (
      <div className="screen center update-screen" data-testid="update-screen">
        <button type="button" className={`play-btn ${busy ? 'blink' : ''}`} aria-label="Get the new version" disabled={busy} onClick={tap}>
          <UiIcon name="refresh" size={150} />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Say it again"
          onClick={() => {
            unlockSpeech();
            void speak('The game has a new version. Tap the big button to get it.');
          }}
        >
          <UiIcon name="speaker" size={44} />
        </button>
      </div>
    );
  }
  return (
    <div className="screen center update-screen" data-testid="update-screen">
      <div className="panel">
        <h1 className="pixel">New version</h1>
        <p>Math Quest has an update. Tap to update, then play.</p>
        <button type="button" className="btn btn-big" disabled={busy} onClick={tap}>
          {busy ? 'Updating…' : 'Update'}
        </button>
      </div>
    </div>
  );
}

/** A strip on the summary screen, after the run is saved: a new version is out. One tap updates. */
export function UpdatePrompt({ picture }: { picture: boolean }) {
  const [busy, setBusy] = useState(false);
  const tap = () => {
    unlockSpeech();
    setBusy(true);
    void applyUpdate();
  };
  return (
    <div className="toasts" data-testid="update-prompt">
      <div className="toast">
        {picture ? (
          <button type="button" className={`icon-btn ${busy ? 'blink' : ''}`} aria-label="Get the new version" disabled={busy} onClick={tap}>
            <UiIcon name="refresh" size={48} />
          </button>
        ) : (
          <>
            <span>New version ready.</span>
            <button type="button" className="btn btn-small" disabled={busy} onClick={tap}>
              {busy ? 'Updating…' : 'Update'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
