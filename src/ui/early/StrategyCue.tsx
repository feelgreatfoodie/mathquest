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
