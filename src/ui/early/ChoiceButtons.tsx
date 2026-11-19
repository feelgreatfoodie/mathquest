import { UiIcon } from '../sprites';

interface Props {
  choices: number[];
  answer: number;
  /** After a miss: only the correct button is live, and it pulses with an arrow above it. */
  guide: boolean;
  picked: number | null;
  disabled: boolean;
  /** Dot patterns under the numerals, so a kid can match a button by counting. Only a fact on dots shows them. */
  dots: boolean;
  onChoose: (value: number) => void;
}

/** Dots in rows of five, so a kid can match a button by counting. */
function Dots({ n }: { n: number }) {
  const rows: number[] = [];
  for (let i = 0; i < n; i += 5) rows.push(Math.min(5, n - i));
  return (
    <span className="choice-dots" aria-hidden="true">
      {rows.map((c, r) => (
        <span className="choice-dot-row" key={r}>
          {Array.from({ length: c }, (_, i) => <span className="choice-dot" key={i} />)}
        </span>
      ))}
    </span>
  );
}

/** Four big answer buttons, in a row on a tablet and 2 by 2 on a phone. Each shows the numeral, and a dot pattern while the fact is on dots. */
export function ChoiceButtons({ choices, answer, guide, picked, disabled, dots, onChoose }: Props) {
  return (
    <div className="choices" role="group" aria-label="Answers">
      {choices.map((v) => {
        const isAnswer = v === answer;
        const live = guide ? isAnswer : !disabled;
        return (
          <div className="choice-slot" key={v}>
            {guide && isAnswer ? <span className="choice-arrow"><UiIcon name="arrow-down" size={56} /></span> : <span className="choice-arrow" />}
            <button
              type="button"
              className={`choice ${guide && isAnswer ? 'is-guide' : ''} ${picked === v && !isAnswer ? 'is-missed' : ''}`}
              data-answer={isAnswer ? 'true' : 'false'}
              aria-label={String(v)}
              aria-disabled={!live}
              onClick={() => live && onChoose(v)}
            >
              <span className="choice-num">{v}</span>
              {dots ? <Dots n={v} /> : null}
            </button>
          </div>
        );
      })}
    </div>
  );
}
