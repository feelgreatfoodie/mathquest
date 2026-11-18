import { useCallback, useEffect, useRef, useState } from 'react';
import { PICTURE_ICONS, PICTURE_LENGTH, pictureCode } from '../../data/deviceKids';
import { UiIcon } from '../sprites';
import { speak } from './useSpeech';

/** Names the voice says for the 9 icons, in order. The screens show no text. */
export const PICTURE_NAMES = ['Cat', 'Dog', 'Fish', 'Bird', 'Frog', 'Bear', 'Rabbit', 'Turtle', 'Owl'] as const;

const INK = '#1f2937';
const eyes = (y = 11, dx = 4) => (
  <>
    <circle cx={12 - dx} cy={y} r="1.3" fill={INK} />
    <circle cx={12 + dx} cy={y} r="1.3" fill={INK} />
  </>
);

/** Nine original animal faces, drawn as SVG shapes. No outside characters. */
export function PictureIcon({ n, size = 64 }: { n: number; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true } as const;
  switch (n) {
    case 0: // cat
      return <svg {...common}><path d="M3 3l5 4h8l5-4v10a9 8 0 0 1-18 0z" fill="#fb923c" stroke="#9a3412" strokeWidth="1.2" strokeLinejoin="round" />{eyes()}<path d="M11 14h2l-1 1.3z" fill="#be185d" /></svg>;
    case 1: // dog
      return <svg {...common}><ellipse cx="4.5" cy="12" rx="3" ry="6" fill="#78350f" /><ellipse cx="19.5" cy="12" rx="3" ry="6" fill="#78350f" /><circle cx="12" cy="12" r="8" fill="#d6a56b" stroke="#78350f" strokeWidth="1.2" />{eyes()}<ellipse cx="12" cy="15" rx="2.2" ry="1.6" fill={INK} /></svg>;
    case 2: // fish
      return <svg {...common}><path d="M3 12l5-4v8z" fill="#0ea5e9" /><ellipse cx="14" cy="12" rx="8" ry="5.5" fill="#38bdf8" stroke="#075985" strokeWidth="1.2" /><circle cx="18" cy="11" r="1.2" fill={INK} /><path d="M14 8v8" stroke="#075985" strokeWidth="1" /></svg>;
    case 3: // bird
      return <svg {...common}><circle cx="12" cy="12" r="8.5" fill="#facc15" stroke="#a16207" strokeWidth="1.2" />{eyes(10.5, 3.6)}<path d="M9.5 13.5h5l-2.5 3z" fill="#f97316" stroke="#9a3412" strokeWidth="0.8" strokeLinejoin="round" /></svg>;
    case 4: // frog
      return <svg {...common}><ellipse cx="12" cy="14" rx="9" ry="7" fill="#4ade80" stroke="#166534" strokeWidth="1.2" /><circle cx="7" cy="7" r="3.2" fill="#4ade80" stroke="#166534" strokeWidth="1.2" /><circle cx="17" cy="7" r="3.2" fill="#4ade80" stroke="#166534" strokeWidth="1.2" /><circle cx="7" cy="7" r="1.2" fill={INK} /><circle cx="17" cy="7" r="1.2" fill={INK} /><path d="M7 16q5 3 10 0" fill="none" stroke="#166534" strokeWidth="1.2" strokeLinecap="round" /></svg>;
    case 5: // bear
      return <svg {...common}><circle cx="5" cy="5" r="3" fill="#92400e" /><circle cx="19" cy="5" r="3" fill="#92400e" /><circle cx="12" cy="13" r="8.5" fill="#b45309" stroke="#451a03" strokeWidth="1.2" />{eyes(11, 3.8)}<ellipse cx="12" cy="16" rx="3.2" ry="2.4" fill="#fcd9a8" /><circle cx="12" cy="15.2" r="1" fill={INK} /></svg>;
    case 6: // rabbit
      return <svg {...common}><ellipse cx="8.5" cy="5" rx="2.2" ry="5" fill="#f3f4f6" stroke="#6b7280" strokeWidth="1" /><ellipse cx="15.5" cy="5" rx="2.2" ry="5" fill="#f3f4f6" stroke="#6b7280" strokeWidth="1" /><circle cx="12" cy="15" r="7" fill="#f3f4f6" stroke="#6b7280" strokeWidth="1.2" />{eyes(14, 3)}<path d="M11 17h2l-1 1.2z" fill="#f472b6" /></svg>;
    case 7: // turtle
      return <svg {...common}><path d="M3 15a9 8 0 0 1 18 0z" fill="#16a34a" stroke="#14532d" strokeWidth="1.2" /><path d="M8 15l1.5-5M16 15l-1.5-5M12 15V9" stroke="#14532d" strokeWidth="1" /><circle cx="21" cy="14" r="2.2" fill="#86efac" stroke="#14532d" strokeWidth="1" /><rect x="6" y="15" width="3" height="3" rx="1" fill="#86efac" /><rect x="15" y="15" width="3" height="3" rx="1" fill="#86efac" /></svg>;
    default: // 8: owl
      return <svg {...common}><path d="M4 4l4 3h8l4-3v11a8 8 0 0 1-16 0z" fill="#9ca3af" stroke="#374151" strokeWidth="1.2" strokeLinejoin="round" /><circle cx="8.5" cy="11" r="3" fill="#fff" stroke="#374151" /><circle cx="15.5" cy="11" r="3" fill="#fff" stroke="#374151" /><circle cx="8.5" cy="11" r="1.2" fill={INK} /><circle cx="15.5" cy="11" r="1.2" fill={INK} /><path d="M11 14h2l-1 2z" fill="#f59e0b" /></svg>;
  }
}

interface Props {
  /** Called with the string the server hashes. Resolve to false when it was refused: the slots shake and clear. */
  onComplete: (code: string) => void | boolean | Promise<void | boolean>;
  /** Leave without signing in (back to the faces). */
  onCancel?: () => void;
  /** The parent screen picks a PIN with this pad: no voice, smaller buttons are allowed (48 px). */
  compact?: boolean;
}

/**
 * The picture PIN pad: 9 animal faces to tap, 4 slots that fill in order, repeats allowed. No text at all. Every button is
 * at least 120 px (compact mode for the parent screen: 56 px). Each tap says the animal. The 4th tap submits 120 ms later,
 * like the digit pad: busy locks the pad, a refusal shakes the slots and clears them.
 */
export function PicturePad({ onComplete, onCancel, compact }: Props) {
  const [picked, setPicked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);
  const busyRef = useRef(false);
  const doneRef = useRef(onComplete);
  doneRef.current = onComplete;

  const tap = useCallback(
    (n: number) => {
      if (busyRef.current) return;
      if (!compact) void speak(PICTURE_NAMES[n]!);
      setPicked((p) => (p.length >= PICTURE_LENGTH ? p : [...p, n]));
    },
    [compact],
  );
  const back = useCallback(() => {
    if (busyRef.current) return;
    setPicked((p) => p.slice(0, -1));
  }, []);

  useEffect(() => {
    if (picked.length !== PICTURE_LENGTH) return;
    const t = setTimeout(async () => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      let refused = false;
      try {
        refused = (await doneRef.current(pictureCode(picked))) === false;
      } catch {
        refused = true;
      }
      busyRef.current = false;
      setBusy(false);
      setPicked([]);
      if (refused) setShake((n) => n + 1);
    }, 120);
    return () => clearTimeout(t);
  }, [picked]);

  const cell = compact ? 56 : 120;
  // The slots only show what was picked (they are not buttons), so they are smaller and four fit the card.
  const slot = compact ? 56 : 80;
  return (
    <div className={`picture-pad ${compact ? 'is-compact' : ''}`} data-testid="picture-pad" aria-busy={busy}>
      <div key={shake} className={`picture-slots ${shake ? 'shake' : ''}`} role="img" aria-label={`${picked.length} of ${PICTURE_LENGTH} pictures`} data-count={picked.length}>
        {Array.from({ length: PICTURE_LENGTH }, (_, i) => (
          <span key={i} className={`picture-slot ${i < picked.length ? 'is-on' : ''}`} data-icon={picked[i] ?? ''} style={{ width: slot, height: slot }}>
            {picked[i] !== undefined ? <PictureIcon n={picked[i]!} size={slot - 16} /> : null}
          </span>
        ))}
      </div>
      <div className="picture-grid" role="group" aria-label="Pictures">
        {Array.from({ length: PICTURE_ICONS }, (_, n) => (
          <button key={n} type="button" className="picture-key" data-icon={n} aria-label={PICTURE_NAMES[n]} disabled={busy} style={{ width: cell, height: cell }} onClick={() => tap(n)}>
            <PictureIcon n={n} size={cell - 24} />
          </button>
        ))}
      </div>
      <div className="picture-actions">
        <button type="button" className="picture-key picture-back" aria-label="Back" disabled={busy || picked.length === 0} style={{ width: cell, height: cell }} onClick={back}>
          <UiIcon name="refresh" size={cell - 56} />
        </button>
        {onCancel ? (
          <button type="button" className="picture-key picture-cancel" aria-label="Not me" disabled={busy} style={{ width: cell, height: cell }} onClick={onCancel}>
            <UiIcon name="close" size={cell - 56} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
