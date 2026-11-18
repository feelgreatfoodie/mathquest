import { useEffect } from 'react';

export type Field = 'w' | 'n' | 'd';

interface KeypadProps {
  onDigit: (d: number) => void;
  onBack: () => void;
  /** Run and fraction screens have a GO key. PIN screens omit both and sign in on the 4th digit. */
  onSubmit?: () => void;
  canSubmit?: boolean;
  showGo?: boolean;
  /** Fraction mode shows the Whole / Top / Bottom selector. */
  field?: Field;
  onField?: (f: Field) => void;
  disabled?: boolean;
}

const FIELD_LABELS: Record<Field, string> = { w: 'Whole', n: 'Top', d: 'Bottom' };

/** Big touch keypad (iPad-first). Also listens for a hardware keyboard. */
/** A key pressed while a text field has focus belongs to that field, not to the keypad. */
function fromTextField(e: KeyboardEvent): boolean {
  const t = e.target;
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLElement && t.isContentEditable);
}

/** iOS leaves the keyboard open over the keypad until the focused field blurs. */
function closeKeyboard() {
  const a = document.activeElement;
  if (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement) a.blur();
}

export function Keypad({ onDigit, onBack, onSubmit, canSubmit = false, showGo = true, field, onField, disabled }: KeypadProps) {
  const tapDigit = (d: number) => {
    closeKeyboard();
    onDigit(d);
  };
  useEffect(() => {
    if (disabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (fromTextField(e)) return;
      if (/^[0-9]$/.test(e.key)) onDigit(Number(e.key));
      else if (e.key === 'Backspace') onBack();
      else if (e.key === 'Enter' && showGo && canSubmit) onSubmit?.();
      else if (field && onField && (e.key === 'Tab' || e.key === '/' || e.key === ' ')) {
        e.preventDefault();
        const order: Field[] = ['w', 'n', 'd'];
        onField(order[(order.indexOf(field) + 1) % 3]!);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDigit, onBack, onSubmit, canSubmit, showGo, field, onField, disabled]);

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
          <button key={d} type="button" className="key" onClick={() => tapDigit(d)} disabled={disabled}>
            {d}
          </button>
        ))}
        <button type="button" className="key key-back" onClick={onBack} disabled={disabled} aria-label="Delete">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M21 5H9l-6 7 6 7h12z" />
            <path d="M18 9l-6 6M12 9l6 6" />
          </svg>
        </button>
        <button type="button" className="key" onClick={() => tapDigit(0)} disabled={disabled}>
          0
        </button>
        {showGo ? (
          <button type="button" className="key key-go" onClick={onSubmit} disabled={disabled || !canSubmit}>
            GO
          </button>
        ) : (
          <span className="key-spacer" aria-hidden="true" />
        )}
      </div>
    </div>
  );
}
