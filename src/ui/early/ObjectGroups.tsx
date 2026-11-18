import { Sprite, UiIcon } from '../sprites';
import type { IconId, Visual } from '../../engine/problems';

interface Props {
  visual: Visual;
  size?: number;
  /** Icons numbered so far during a count-up (1-based; the first `count` counted icons show a number). */
  count?: number;
  /** Subtraction after a miss: cross out the `b` icons that are taken away. */
  crossOut?: boolean;
}

function Group({ icon, n, size, from, count, crossed }: { icon: IconId; n: number; size: number; from: number; count: number; crossed: number }) {
  // Rows of 5.
  const rows: number[][] = [];
  for (let i = 0; i < n; i += 5) rows.push(Array.from({ length: Math.min(5, n - i) }, (_, k) => i + k));
  return (
    <div className="og-group" role="img" aria-label={`${n} ${icon}`} style={{ minWidth: size * 5 + 8 * 4 }}>
      {rows.length === 0 ? <span className="og-empty" style={{ width: size, height: size }} aria-label="none" /> : null}
      {rows.map((row, r) => (
        <div className="og-row" key={r}>
          {row.map((i) => {
            const gone = i >= n - crossed;
            const counted = !gone && from + i < count;
            return (
              <span key={i} className={`og-item ${counted ? 'is-counted' : ''} ${gone ? 'is-gone' : ''}`} style={{ width: size, height: size }}>
                <Sprite name={icon} size={size} />
                {counted ? <span className="og-num">{from + i + 1}</span> : null}
                {gone ? <span className="og-cross" aria-hidden="true" /> : null}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Group A, a big operator, group B. All icons are the same picture. */
export function ObjectGroups({ visual, size = 52, count = 0, crossOut = false }: Props) {
  const sub = visual.op === '−';
  return (
    <div className="object-groups">
      <Group icon={visual.icon} n={visual.a} size={size} from={0} count={count} crossed={sub && crossOut ? visual.b : 0} />
      <span className="og-op" aria-hidden="true">{visual.op}</span>
      <div className={sub && crossOut ? 'og-faded' : ''}>
        <Group icon={visual.icon} n={visual.b} size={size} from={sub ? 0 : visual.a} count={sub ? 0 : count} crossed={0} />
      </div>
    </div>
  );
}

export { UiIcon };
