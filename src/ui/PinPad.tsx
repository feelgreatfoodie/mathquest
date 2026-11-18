import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Keypad } from './Keypad';

interface PinPadProps {
  title: string;
  subtitle?: string;
  /** Rendered under the title, above the dots (the kid sign-in name field). */
  header?: ReactNode;
  /** Rendered under the keypad (the "Parent" link). */
  footer?: ReactNode;
  error?: string | null;
  /**
   * Called once, 120 ms after the 4th digit. Return a promise to hold the dots and disable the keypad until it
   * settles. Resolving to false (or rejecting) means the PIN was refused: the dots shake and clear.
   */
  onComplete: (pin: string) => void | boolean | Promise<void | boolean>;
  onCancel?: () => void;
  /** Render only the contents, for use inside another card (the landing tabs). */
  embedded?: boolean;
  /** Rendered above the title (the landing tab list). */
  top?: ReactNode;
}

export function PinPad({ title, subtitle, header, footer, error, onComplete, onCancel, embedded, top }: PinPadProps) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);
  const busyRef = useRef(false);
  const digit = useCallback((d: number) => {
    if (busyRef.current) return;
    setPin((p) => (p + d).slice(0, 4));
  }, []);
  const back = useCallback(() => {
    if (busyRef.current) return;
    setPin((p) => p.slice(0, -1));
  }, []);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  useEffect(() => {
    if (pin.length !== 4) return;
    const t = setTimeout(async () => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      let refused = false;
      try {
        refused = (await onCompleteRef.current(pin)) === false;
      } catch {
        refused = true;
      }
      busyRef.current = false;
      setBusy(false);
      setPin('');
      if (refused) setShake((n) => n + 1);
    }, 120);
    return () => clearTimeout(t);
  }, [pin]);

  const content = (
    <>
      {top}
      <h2 className="pixel">{title}</h2>
      {subtitle ? <p className="muted">{subtitle}</p> : null}
      {header}
      <div key={shake} className={`pin-dots ${shake ? 'shake' : ''}`} aria-label={`${pin.length} of 4 digits`}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`pin-dot ${i < pin.length ? 'is-on' : ''}`} />
        ))}
      </div>
      {busy ? (
        <p className="muted pin-checking" role="status">
          <span className="spinner" aria-hidden="true" /> Checking…
        </p>
      ) : error ? (
        <p className="error">{error}</p>
      ) : null}
      <Keypad onDigit={digit} onBack={back} showGo={false} disabled={busy} />
      {footer}
      {onCancel ? (
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      ) : null}
    </>
  );
  if (embedded) return content;
  return (
    <div className="screen center">
      <div className="panel pin-panel">{content}</div>
    </div>
  );
}
