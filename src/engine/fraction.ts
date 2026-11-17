/** Exact fraction arithmetic for kid-sized numbers. All values are non-negative. */

/** A fraction that may be improper (n >= d). */
export interface Frac {
  n: number;
  d: number;
}

/** A mixed number: w + n/d. n may be >= d before normalizing. */
export interface Mixed {
  w: number;
  n: number;
  d: number;
}

export function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

export function toImproper(m: Mixed): Frac {
  return { n: m.w * m.d + m.n, d: m.d };
}

/** Converts to a mixed number with a proper fraction part. Keeps the denominator (no simplifying). */
export function toMixed(f: Frac): Mixed {
  return { w: Math.floor(f.n / f.d), n: f.n % f.d, d: f.d };
}

export function add(a: Frac, b: Frac): Frac {
  if (a.d === b.d) return { n: a.n + b.n, d: a.d };
  return { n: a.n * b.d + b.n * a.d, d: a.d * b.d };
}

export function sub(a: Frac, b: Frac): Frac {
  if (a.d === b.d) return { n: a.n - b.n, d: a.d };
  return { n: a.n * b.d - b.n * a.d, d: a.d * b.d };
}

export function mulWhole(k: number, f: Frac): Frac {
  return { n: k * f.n, d: f.d };
}

export function equalValue(a: Frac, b: Frac): boolean {
  return a.n * b.d === b.n * a.d;
}

/** True when the fraction part of a mixed number is proper (n < d). */
export function isProperMixed(m: Mixed): boolean {
  return m.n < m.d;
}

/** Display form, e.g. "3 2/8", "5/8", "4". */
export function formatMixed(m: Mixed): string {
  if (m.n === 0) return String(m.w);
  if (m.w === 0) return `${m.n}/${m.d}`;
  return `${m.w} ${m.n}/${m.d}`;
}
