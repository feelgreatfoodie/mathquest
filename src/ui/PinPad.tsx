import { useCallback, useEffect, useState } from 'react';
import { Keypad } from './Keypad';

interface PinPadProps {
  title: string;
  subtitle?: string;
  error?: string | null;
  onComplete: (pin: string) => void;
  onCancel?: () => void;
}

export function PinPad({ title, subtitle, error, onComplete, onCancel }: PinPadProps) {
  const [pin, setPin] = useState('');
  const digit = useCallback((d: number) => setPin((p) => (p + d).slice(0, 4)), []);
  useEffect(() => {
    if (pin.length !== 4) return;
    const t = setTimeout(() => {
      onComplete(pin);
      setPin('');
    }, 120);
    return () => clearTimeout(t);
  }, [pin, onComplete]);
  const back = useCallback(() => setPin((p) => p.slice(0, -1)), []);
  const submit = useCallback(() => undefined, []);

  return (
    <div className="screen center">
      <div className="panel pin-panel">
        <h2 className="pixel">{title}</h2>
        {subtitle ? <p className="muted">{subtitle}</p> : null}
        <div className="pin-dots" aria-label={`${pin.length} of 4 digits`}>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={`pin-dot ${i < pin.length ? 'is-on' : ''}`} />
          ))}
        </div>
        {error ? <p className="error">{error}</p> : null}
        <Keypad onDigit={digit} onBack={back} onSubmit={submit} canSubmit={false} />
        {onCancel ? (
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  );
}
