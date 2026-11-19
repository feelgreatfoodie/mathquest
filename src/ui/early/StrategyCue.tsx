import { Sprite } from '../sprites';
import type { StrategyCue as Cue } from '../../engine/support';
import type { IconId, Visual } from '../../engine/problems';

/** One ten-frame: the first number as circles, the second as squares, and the empty cells as highlighted gaps. */
function MakeTenFrame({ a, b }: { a: number; b: number }) {
  return (
    <div className="tenframes" role="img" aria-label={`${a} and ${b} in a ten frame`}>
      <div className="tenframe">
        {Array.from({ length: 10 }, (_, i) => {
          const kind = i < a ? 'is-on is-circle' : i < a + b ? 'is-on is-square' : 'is-gap';
          return <span key={i} className={`tf-cell ${kind}`} />;
        })}
      </div>
    </div>
  );
}

/** One ten-frame for a missing addend: `a` circles, the gap up to `total` highlighted (numbered while counting), the rest empty. */
export function GapFrame({ a, total, count = 0, fill = false }: { a: number; total: number; count?: number; fill?: boolean }) {
  return (
    <div className="tenframes" role="img" aria-label={`${a} filled, ${total - a} missing, in a ten frame`} data-gap-frame="true">
      <div className="tenframe">
        {Array.from({ length: 10 }, (_, i) => {
          const inGap = i >= a && i < total;
          const counted = inGap && i - a < count;
          const kind = i < a ? 'is-on is-circle' : inGap ? (fill ? 'is-on is-square' : 'is-gap') : '';
          return (
            <span key={i} className={`tf-cell ${kind}`}>
              {counted ? <span className="tf-num">{i - a + 1}</span> : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** A strategy instead of full dots: a double, a ten-frame with the gap, or the bigger number plus a few dots to count on. */
export function StrategyCueView({ cue, visual, icon }: { cue: Cue; visual: Visual; icon: IconId }) {
  if (cue.kind === 'make10') {
    return (
      <div className="cue cue-make10" data-cue="make10">
        <MakeTenFrame a={visual.a} b={visual.b} />
        <span className="cue-text">{cue.text}</span>
      </div>
    );
  }
  if (cue.kind === 'split10') {
    return (
      <div className="cue cue-split10" data-cue="split10">
        <GapFrame a={cue.big ?? 0} total={10} />
        <span className="cue-text">{cue.text}</span>
      </div>
    );
  }
  if (cue.kind === 'neardouble') {
    return (
      <div className="cue cue-neardouble" data-cue="neardouble">
        <span className="cue-text cue-text-big">{cue.text}</span>
      </div>
    );
  }
  if (cue.kind === 'double') {
    return (
      <div className="cue cue-double" data-cue="double">
        <span className="cue-text cue-text-big">{cue.text}</span>
      </div>
    );
  }
  return (
    <div className="cue cue-counton" data-cue="counton">
      <span className="cue-big">{cue.big}</span>
      <span className="og-op" aria-hidden="true">+</span>
      <span className="cue-small" role="img" aria-label={`${cue.small} ${icon}`}>
        {Array.from({ length: cue.small ?? 0 }, (_, i) => <Sprite key={i} name={icon} size={64} />)}
      </span>
    </div>
  );
}
