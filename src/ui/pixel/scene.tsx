import { HILLS, SKY } from './tokens';
import { PixelArt, type ArtDef } from './PixelArt';

/** Pieces of the pixel scenes: stepped sky, stars, a moon, stepped hills and trees. Flat rectangles only. */

export function SkyBands({ className }: { className?: string }) {
  const step = 100 / SKY.length;
  const stops = SKY.map((c, i) => `${c} ${i * step}% ${(i + 1) * step}%`).join(', ');
  return <div className={`px-sky${className ? ` ${className}` : ''}`} style={{ backgroundImage: `linear-gradient(to bottom, ${stops})` }} aria-hidden="true" />;
}

// Fixed star spots (x%, y% of the sky, size in px), so the sky never changes between renders.
const STARS: readonly [number, number, number][] = [
  [6, 8, 4], [14, 22, 4], [22, 6, 8], [31, 16, 4], [40, 9, 4], [47, 27, 4], [58, 5, 8], [66, 18, 4],
  [74, 10, 4], [83, 24, 8], [91, 7, 4], [96, 19, 4], [10, 35, 4], [36, 33, 4], [62, 34, 4], [88, 38, 4],
];

export function Stars() {
  return (
    <div className="px-stars" aria-hidden="true">
      {STARS.map(([x, y, s], i) => (
        <i key={i} className={i % 3 === 0 ? 'px-twinkle' : undefined} style={{ left: `${x}%`, top: `${y}%`, width: s, height: s }} />
      ))}
    </div>
  );
}

const MOON: ArtDef = {
  palette: { m: '#fef3c7', c: '#fcd34d' },
  rows: ['....mmmm....', '..mmmmmmmm..', '.mmmmcmmmmm.', '.mmmmmmmmcm.', 'mmcmmmmmmmmm', 'mmmmmmmmmmmm', 'mmmmmmcmmmmm', 'mmmmmmmmmmcm', '.mmcmmmmmmm.', '.mmmmmmmmmm.', '..mmmmmmmm..', '....mmmm....'],
};

export function Moon({ size = 72 }: { size?: number }) {
  return <PixelArt def={MOON} size={size} className="px-moon" />;
}

const TREE: ArtDef = {
  palette: { g: '#15803d', G: '#14532d', n: '#92400e' },
  rows: ['.....gg.....', '....gggg....', '...gggggg...', '..gggggggg..', '....gggg....', '...gggggg...', '..gggggGGg..', '.gggggGGGgg.', '....gggg....', '.....nn.....', '.....nn.....', '.....nn.....'],
};

export function Tree({ size = 72, className }: { size?: number; className?: string }) {
  return <PixelArt def={TREE} size={size} {...(className ? { className } : {})} />;
}

/** One hill layer as stepped rectangles 8 units wide on a 240 unit grid. base and amp are in units of height 80. */
export function HillLayer({ color, base, amp, phase }: { color: string; base: number; amp: number; phase: number }) {
  const cols = 30;
  const rects = Array.from({ length: cols }, (_, i) => {
    const top = Math.round(base - amp * (0.5 + 0.5 * Math.sin(i / 4.2 + phase)));
    const snapped = Math.round(top / 4) * 4;
    return <rect key={i} x={i * 8} y={snapped} width={8} height={80 - snapped} fill={color} />;
  });
  return (
    <svg className="px-hill" viewBox="0 0 240 80" preserveAspectRatio="none" shapeRendering="crispEdges" aria-hidden="true">
      {rects}
    </svg>
  );
}

export function Hills() {
  return (
    <div className="px-hills" aria-hidden="true">
      <HillLayer color={HILLS[0]} base={40} amp={20} phase={0} />
      <HillLayer color={HILLS[1]} base={52} amp={16} phase={2} />
      <HillLayer color={HILLS[2]} base={64} amp={12} phase={4} />
    </div>
  );
}
