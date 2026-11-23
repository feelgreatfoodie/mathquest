import { useEffect } from 'react';
import { KeyGlyph } from './KeyGlyph';

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
  /** The boxes to offer, in order. Defaults to all three; a family that never gives a whole number drops 'w'. */
  fields?: Field[];
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

export function Keypad({ onDigit, onBack, onSubmit, canSubmit = false, showGo = true, field, onField, fields = ['w', 'n', 'd'], disabled }: KeypadProps) {
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
        onField(fields[(fields.indexOf(field) + 1) % fields.length]!);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDigit, onBack, onSubmit, canSubmit, showGo, field, onField, fields, disabled]);

  return (
    <div className="keypad-wrap">
      {field && onField ? (
        <div className="field-row" role="group" aria-label="Which part are you typing?">
          {fields.map((f) => (
            <button
              key={f}
              type="button"
              className={`field-btn px-frame px-btn ${field === f ? 'is-active px-gold' : ''}`}
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
          <button key={d} type="button" className="key px-frame" onClick={() => tapDigit(d)} disabled={disabled}>
            {d}
          </button>
        ))}
        <button type="button" className="key key-back px-frame" onClick={onBack} disabled={disabled} aria-label="Delete">
          <KeyGlyph name="x" />
        </button>
        <button type="button" className="key px-frame" onClick={() => tapDigit(0)} disabled={disabled}>
          0
        </button>
        {showGo ? (
          <button type="button" className="key key-go px-frame px-go" onClick={onSubmit} aria-label="Go" disabled={disabled || !canSubmit}>
            <KeyGlyph name="check" />
          </button>
        ) : (
          <span className="key-spacer" aria-hidden="true" />
        )}
      </div>
    </div>
  );
}
