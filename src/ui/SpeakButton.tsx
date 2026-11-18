import { canHear, speak, unlockSpeech } from './early/useSpeech';
import { UiIcon } from './sprites';

/** A speaker that reads `text` aloud on tap. Readers get audio only when they ask for it; this is that ask. */
export function SpeakButton({ text, label = 'Read it to me', size = 36, className = '' }: { text: string; label?: string; size?: number; className?: string }) {
  if (!canHear()) return null;
  return (
    <button
      type="button"
      className={`icon-btn speak-btn ${className}`}
      aria-label={label}
      onClick={() => {
        unlockSpeech();
        void speak(text, { hear: true });
      }}
    >
      <UiIcon name="speaker" size={size} />
    </button>
  );
}
