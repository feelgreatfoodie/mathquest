// Modern pixel tokens. This table is the source for the --px-* variables in styles.css (tokens.test.ts checks they match)
// and for the contrast test: every text and fill pair listed in PAIRS must reach 4.5:1.

export interface Fill {
  fill: string;
  dark: string;
  text: string;
}

export const EDGE = '#0d1020';
export const EDGE_TITLE = '#0f1230';

/** Fill, darker shade and the text color that goes on it. */
export const FILLS = {
  neutral: { fill: '#2c3354', dark: '#1c2036', text: '#f8fafc' },
  gold: { fill: '#fbbf24', dark: '#b45309', text: '#1a1300' },
  go: { fill: '#22c55e', dark: '#15803d', text: '#052e16' },
  stone: { fill: '#94a3b8', dark: '#64748b', text: '#141726' },
} as const satisfies Record<string, Fill>;

/** One accent for each area of the game. Home uses the gold fill. */
export const AREAS = {
  home: FILLS.gold,
  dungeon: { fill: '#6d28d9', dark: '#4c1d95', text: '#f8fafc' },
  adventure: { fill: '#15803d', dark: '#14532d', text: '#f8fafc' },
  lightning: { fill: '#0369a1', dark: '#0c4a6e', text: '#f8fafc' },
} as const satisfies Record<string, Fill>;

/** Flat stepped bands from the top of the sky down. No gradients. */
export const SKY = ['#0f1230', '#151a44', '#1c2259', '#27307a', '#35409a'] as const;
export const HILLS = ['#1e3a2f', '#166534', '#15803d'] as const;

export const TITLE = {
  gold: '#fbbf24',
  shadow1: '#92400e',
  shadow2: '#0f1230',
  tagline: '#fde68a',
} as const;

/**
 * style-3, the Grown-ups area. Color has meaning: green is strong, amber needs work, grey is not started. Each level has a fill
 * and the text on it. The five levels follow the mastery levels 0 to 4 of the grids (lv0 to lv4 in styles.css).
 */
export const STATUS = {
  notStarted: { fill: '#3a3d4d', text: '#e5e7f0' },
  needsWork: { fill: '#d97706', text: '#1a1300' },
  needsWorkNear: { fill: '#fbbf24', text: '#1a1300' },
  strong: { fill: '#4ade80', text: '#052e16' },
  strongest: { fill: '#22c55e', text: '#052e16' },
} as const;

/** The Grown-ups light theme. It only recolors the Grown-ups area; kid screens stay on the dark pixel look. */
export const GROWNUPS_LIGHT = {
  bg: '#f4f5fb',
  bg2: '#e8eaf5',
  panel: '#ffffff',
  panel2: '#eceefa',
  line: '#9aa1c2',
  text: '#141726',
  muted: '#4a5070',
  gold: '#8a4b00',
  good: '#166534',
  bad: '#b91c1c',
  info: '#1d4ed8',
} as const;

export const FONTS = {
  display: "'Press Start 2P', ui-monospace, monospace",
  body: "'Atkinson Hyperlegible', system-ui, -apple-system, sans-serif",
} as const;

/** Smallest touch targets in px. */
export const TARGET = { min: 48, prereader: 120 } as const;

export const MIN_CONTRAST = 4.5;

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a #rrggbb color: ${hex}`);
  const n = parseInt(m[1]!, 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export interface Pair {
  name: string;
  fg: string;
  bg: string;
}

/** Every text and fill pair the pixel parts use. */
export const PAIRS: readonly Pair[] = [
  ...Object.entries(FILLS).map(([k, f]) => ({ name: `${k} text on fill`, fg: f.text, bg: f.fill })),
  ...Object.entries(FILLS).map(([k, f]) => ({ name: `${k} text on dark shade (pressed)`, fg: f.text, bg: f.dark })).filter((p) => p.name.startsWith('neutral')),
  ...Object.entries(AREAS).map(([k, f]) => ({ name: `${k} text on area fill`, fg: f.text, bg: f.fill })),
  { name: 'muted text on panel', fg: '#b6bdd8', bg: '#232842' },
  { name: 'body text on panel', fg: '#f8fafc', bg: '#232842' },
  { name: 'logo gold on sky top', fg: TITLE.gold, bg: SKY[0] },
  { name: 'logo gold on sky band 2', fg: TITLE.gold, bg: SKY[1] },
  { name: 'tagline on sky top', fg: TITLE.tagline, bg: SKY[0] },
  { name: 'tagline on sky band 2', fg: TITLE.tagline, bg: SKY[1] },
  { name: 'white on sky band 3', fg: '#f8fafc', bg: SKY[2] },
  // style-3: status colors and the Grown-ups light theme
  ...Object.entries(STATUS).map(([k, s]) => ({ name: `status ${k} text on fill`, fg: s.text, bg: s.fill })),
  { name: 'light theme text on panel', fg: GROWNUPS_LIGHT.text, bg: GROWNUPS_LIGHT.panel },
  { name: 'light theme text on page', fg: GROWNUPS_LIGHT.text, bg: GROWNUPS_LIGHT.bg },
  { name: 'light theme text on inset', fg: GROWNUPS_LIGHT.text, bg: GROWNUPS_LIGHT.bg2 },
  { name: 'light theme muted on panel', fg: GROWNUPS_LIGHT.muted, bg: GROWNUPS_LIGHT.panel },
  { name: 'light theme muted on page', fg: GROWNUPS_LIGHT.muted, bg: GROWNUPS_LIGHT.bg },
  { name: 'light theme muted on inset', fg: GROWNUPS_LIGHT.muted, bg: GROWNUPS_LIGHT.bg2 },
  { name: 'light theme gold on panel', fg: GROWNUPS_LIGHT.gold, bg: GROWNUPS_LIGHT.panel },
  { name: 'light theme good on panel', fg: GROWNUPS_LIGHT.good, bg: GROWNUPS_LIGHT.panel },
  { name: 'light theme bad on panel', fg: GROWNUPS_LIGHT.bad, bg: GROWNUPS_LIGHT.panel },
  { name: 'light theme info on panel', fg: GROWNUPS_LIGHT.info, bg: GROWNUPS_LIGHT.panel },
  { name: 'dark theme muted on panel', fg: '#b6bdd8', bg: '#232842' },
];
