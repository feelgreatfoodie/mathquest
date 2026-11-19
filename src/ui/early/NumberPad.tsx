import { UiIcon } from '../sprites';

interface Props {
  /** Keys run from 0 to this number (10; 20 once add20 is on). */
  max: number;
  /** The number typed so far, or null. */
  value: number | null;
  disabled: boolean;
  /** A number key was tapped. The caller says the number out loud, unless muted. */
  onKey: (n: number) => void;
  onClear: () => void;
  onOk: () => void;
}

/** A big number pad for facts the kid knows: every key is 120 px or more, and there are no choices to guess from. */
export function NumberPad({ max, value, disabled, onKey, onClear, onOk }: Props) {
  return (
    <div className="numpad" role="group" aria-label="Number pad" data-max={max}>
      {Array.from({ length: max + 1 }, (_, n) => (
        <button
          key={n}
          type="button"
          className={`numpad-key ${value === n ? 'is-set' : ''}`}
          aria-label={String(n)}
          aria-pressed={value === n}
          disabled={disabled}
          onClick={() => onKey(n)}
        >
          {n}
        </button>
      ))}
      <button type="button" className="numpad-key numpad-clear" aria-label="Clear" disabled={disabled || value === null} onClick={onClear}>
        <UiIcon name="close" size={56} />
      </button>
      <button type="button" className="numpad-key numpad-ok" aria-label="OK" disabled={disabled || value === null} onClick={onOk}>
        <UiIcon name="check" size={64} />
      </button>
    </div>
  );
}
