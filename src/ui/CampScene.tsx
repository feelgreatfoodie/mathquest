import type { ReactNode } from 'react';
import type { KidGame } from '../engine/models';
import { CampRow } from './CampRow';
import { HeroFigure } from './HeroFigure';
import { Hills, PixelIcon, SkyBands, Stars, Tree } from './pixel';

/** The camp: night sky, hills, the hero with the camp items the kid owns, a chest. Children overlay the scene (the name and level). */
export function CampScene({ game, children, size = 150, className }: { game: KidGame; children?: ReactNode; size?: number; className?: string }) {
  return (
    <div className={`px-camp${className ? ` ${className}` : ''}`} data-testid="camp-scene">
      <SkyBands />
      <Stars />
      <Hills />
      <div className="px-camp-cast">
        <Tree size={Math.round(size * 0.5)} className="px-camp-tree" />
        <HeroFigure game={game} size={size} className="bob" />
        <CampRow game={game} size={Math.round(size * 0.4)} />
        <PixelIcon name="chest" size={Math.round(size * 0.36)} className="px-camp-chest" />
      </div>
      {children}
    </div>
  );
}

