import { useEffect, useState } from 'react';
import { applyUpdate } from '../update';
import { speak, stopSpeaking, unlockSpeech } from './early/useSpeech';
import { UiIcon } from './sprites';

/**
 * Shown instead of the app when this bundle is older than config/app.minVersion. It blocks every run and every
 * write, so an old bundle never plays a run that cannot be saved. A pre-reader gets one big button with a
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
