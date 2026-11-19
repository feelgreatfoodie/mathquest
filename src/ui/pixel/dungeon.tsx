import { PixelArt, type ArtDef } from './PixelArt';
import { PixelIcon } from './icons';

/** An unlit torch: the same 12 by 12 grid as the torch icon, with grey stone in place of the flame. */
const TORCH_OUT: ArtDef = {
  palette: { g: '#64748b', k: '#111827', n: '#92400e' },
  rows: ['............', '............', '............', '.....g......', '....ggg.....', '....kkk.....', '....nnn.....', '....nnn.....', '....nnn.....', '....nnn.....', '....nnn.....', '....kkk.....'],
};

/** The run's progress as a row of torches: a lit torch is a finished question block. Reads as one image to a screen reader. */
export function TorchRow({ done, total = 10, label }: { done: number; total?: number; label: string }) {
  const lit = Math.max(0, Math.min(total, done));
  return (
    <div className="px-torches" role="img" aria-label={label} data-lit={lit}>
      {Array.from({ length: total }, (_, i) =>
        i < lit ? <PixelIcon key={i} name="torch" size={32} className="px-torch is-lit" /> : <PixelArt key={i} def={TORCH_OUT} size={32} className="px-torch" />,
      )}
    </div>
  );
}

/** Purple brick wall, two wall torches and a stone floor. Pure decoration: bands and bricks are CSS, no gradients between colors. */
export function DungeonWalls() {
  return (
    <div className="px-dungeon-scene" aria-hidden="true">
      <span className="px-dungeon-torch is-left"><PixelIcon name="torch" size={48} className="px-flicker" /></span>
      <span className="px-dungeon-torch is-right"><PixelIcon name="torch" size={48} className="px-flicker" /></span>
    </div>
  );
}

/** A chunky hit-point bar: a dark inset with a red fill that drains from the right, drawn in blocks. */
export function HpBar({ fraction, label }: { fraction: number; label?: string }) {
  const f = Math.max(0, Math.min(1, fraction));
  return (
    <div className="hp px-hp" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <div className="hp-fill" style={{ width: `${f * 100}%` }} />
    </div>
  );
}
