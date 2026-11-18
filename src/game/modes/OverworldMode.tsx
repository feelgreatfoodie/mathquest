import { lazy, Suspense } from 'react';
import type { GameModeProps } from './types';

// The map, the renderer and the sprites load only when a kid opens Adventure, so the Dungeon and the picture run
// ship no Overworld code. The service worker precaches the chunk with the rest of the build.
const Overworld = lazy(() => import('../overworld/Overworld'));

export function OverworldMode(props: GameModeProps) {
  return (
    <Suspense fallback={<div className="screen center"><p className="pixel blink">Loading adventure…</p></div>}>
      <Overworld {...props} />
    </Suspense>
  );
}
