// The lifetime count of chests opened lives in world/main.openedChests, the only list the save rules allow for it (10 fields, no
// new one). Chests used to put a card id there, and an old bundle still does. A new bundle keeps one marker, "#<n>", in front of
// the old card ids and adds 1 to it for every chest. The count a parent sees is the marker plus the old card ids.

const PREFIX = '#';
/** Most entries the save rules allow in the list. */
export const LEDGER_MAX = 500;

function markerOf(list: readonly string[]): number {
  for (const s of list) {
    if (s.startsWith(PREFIX)) {
      const n = Number(s.slice(PREFIX.length));
      if (Number.isInteger(n) && n >= 0 && n <= 1e9) return n;
    }
  }
  return 0;
}

/** Chests opened over the kid's life: the marker plus the old card ids. */
export function lifetimeChests(list: readonly string[] | undefined | null): number {
  if (!Array.isArray(list)) return 0;
  return markerOf(list) + list.filter((s) => typeof s === 'string' && !s.startsWith(PREFIX)).length;
}

/**
 * The list after one more chest. The marker goes first, and the oldest card ids fold into it when the list would pass
 * LEDGER_MAX, so the count never drops and the save rules never refuse the write.
 */
export function addChest(list: readonly string[]): string[] {
  const ids = list.filter((s) => !s.startsWith(PREFIX));
  let n = markerOf(list) + 1;
  const over = Math.max(0, ids.length + 1 - LEDGER_MAX);
  n += over;
  return [`${PREFIX}${n}`, ...ids.slice(over)];
}
