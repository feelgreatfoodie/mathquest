/** Tiles a second on a map. Fast Boots walk 1.5 times as fast, in the regions and in the lairs. The question clock runs only while a question shows, so speed never reaches timing. */
export const SPEED = 4;
export const BOOT_SPEED = 6;

export function walkSpeed(boots: boolean): number {
  return boots ? BOOT_SPEED : SPEED;
}
