import type { ReactNode } from 'react';
import { Hills, Moon, SkyBands, Stars, Tree } from '../pixel';
import { Sprite } from '../sprites';

/** The title screen scene: night sky, stars, a moon, layered hills with the hero, a slime, a bat and 2 trees. Decoration only. */
export function TitleScene() {
  return (
    <div className="title-scene" aria-hidden="true">
      <SkyBands />
      <Stars />
      <div className="title-moon"><Moon size={72} /></div>
      <Hills />
      <div className="title-cast">
        <Tree className="title-tree" size={80} />
        <Sprite name="knight" size={96} className="title-hero" />
        <Sprite name="slime" size={72} className="title-slime" />
        <Sprite name="bat" size={64} className="title-bat" />
        <Tree className="title-tree" size={64} />
      </div>
    </div>
  );
}

/** The signed-out first screen: the scene behind, the logo and tagline on top, the sign-in card below. */
export function TitleScreen({ children }: { children: ReactNode }) {
  return (
    <div className="title-screen" data-testid="title-screen">
      <TitleScene />
      <header className="title-head">
        <h1 className="px-logo pixel">
          <span>MATH</span>
          <span>QUEST</span>
        </h1>
        <p className="px-tagline pixel">EVERY MONSTER IS A MATH FACT</p>
      </header>
      <div className="title-body">{children}</div>
    </div>
  );
}
