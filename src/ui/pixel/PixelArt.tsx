/** Draws a grid of palette letters as SVG rects, crisp at any size. The icon set and the title scene share it. */
export interface ArtDef {
  rows: readonly string[];
  palette: Readonly<Record<string, string>>;
}

export function PixelArt({ def, size = 48, className, label }: { def: ArtDef; size?: number; className?: string; label?: string }) {
  const h = def.rows.length;
  const w = def.rows[0]?.length ?? 0;
  const rects: { x: number; y: number; w: number; c: string }[] = [];
  def.rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x]!;
      let run = 1;
      while (row[x + run] === ch) run++;
      const c = def.palette[ch];
      if (c) rects.push({ x, y, w: run, c });
      x += run;
    }
  });
  return (
    <svg
      className={className}
      width={size}
      height={(size * h) / w}
      viewBox={`0 0 ${w} ${h}`}
      shapeRendering="crispEdges"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill={r.c} />
      ))}
    </svg>
  );
}
