import { useEffect } from 'react';

export type Field = 'w' | 'n' | 'd';

interface KeypadProps {
  onDigit: (d: number) => void;
  onBack: () => void;
  onSubmit: () => void;
  canSubmit: boolean;
  /** Fraction mode shows the Whole / Top / Bottom selector. */
  field?: Field;
  onField?: (f: Field) => void;
  disabled?: boolean;
}

const FIELD_LABELS: Record<Field, string> = { w: 'Whole', n: 'Top', d: 'Bottom' };

/** Big touch keypad (iPad-first). Also listens for a hardware keyboard. */
export function Keypad({ onDigit, onBack, onSubmit, canSubmit, field, onField, disabled }: KeypadProps) {
  useEffect(() => {
    if (disabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) onDigit(Number(e.key));
      else if (e.key === 'Backspace') onBack();
      else if (e.key === 'Enter' && canSubmit) onSubmit();
      else if (field && onField && (e.key === 'Tab' || e.key === '/' || e.key === ' ')) {
        e.preventDefault();
        const order: Field[] = ['w', 'n', 'd'];
        onField(order[(order.indexOf(field) + 1) % 3]!);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDigit, onBack, onSubmit, canSubmit, field, onField, disabled]);

  return (
    <div className="keypad-wrap">
      {field && onField ? (
        <div className="field-row" role="group" aria-label="Which part are you typing?">
          {(['w', 'n', 'd'] as Field[]).map((f) => (
            <button
              key={f}
              type="button"
              className={`field-btn ${field === f ? 'is-active' : ''}`}
              onClick={() => onField(f)}
              disabled={disabled}
              aria-pressed={field === f}
            >
              {FIELD_LABELS[f]}
            </button>
          ))}
        </div>
      ) : null}
      <div className="keypad">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
          <button key={d} type="button" className="key" onClick={() => onDigit(d)} disabled={disabled}>
            {d}
          </button>
        ))}
        <button type="button" className="key key-back" onClick={onBack} disabled={disabled} aria-label="Delete">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M21 5H9l-6 7 6 7h12z" />
            <path d="M18 9l-6 6M12 9l6 6" />
          </svg>
        </button>
        <button type="button" className="key" onClick={() => onDigit(0)} disabled={disabled}>
          0
        </button>
        <button type="button" className="key key-go" onClick={onSubmit} disabled={disabled || !canSubmit}>
          GO
        </button>
      </div>
    </div>
  );
}
