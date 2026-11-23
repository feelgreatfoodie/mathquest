/**
 * The clear X and the go check on a keypad, drawn as pixel art on a 7 by 7 grid. Press Start 2P draws a digit 7 pixels
 * tall on an 8 pixel em, so the icon is 7/8 em square: it takes its size and color from the key's font, and it stays the
 * same height as the number glyphs on every keypad (reader, picture player, PIN, lairs, bosses, Adventure).
 */
const ART = {
  x: ['XX...XX', 'XXX.XXX', '.XXXXX.', '..XXX..', '.XXXXX.', 'XXX.XXX', 'XX...XX'],
  check: ['.....XX', '....XXX', '...XXX.', 'XX.XXX.', 'XXXXX..', '.XXX...', '..X....'],
} as const;

export type KeyGlyphName = keyof typeof ART;

/** One path of unit squares per glyph, built once. */
const PATHS: Record<KeyGlyphName, string> = {
  x: toPath(ART.x),
  check: toPath(ART.check),
};

function toPath(rows: readonly string[]): string {
  let d = '';
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === 'X') d += `M${x} ${y}h1v1h-1z`;
  });
  return d;
}

export function KeyGlyph({ name }: { name: KeyGlyphName }) {
  return (
    <svg className="key-glyph" viewBox="0 0 7 7" aria-hidden="true" focusable="false" shapeRendering="crispEdges">
      <path d={PATHS[name]} fill="currentColor" />
    </svg>
  );
}
