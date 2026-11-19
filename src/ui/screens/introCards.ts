// The "What is Math Quest?" cards. One real screenshot and one or two sentences each. The images in public/intro/ are made by
// scripts/intro-shots.mjs from a made-up demo family, so they stay current and carry no real name. Plain words, no dashes.

export interface IntroCard {
  id: string;
  /** File in public/intro/. */
  file: string;
  alt: string;
  text: string;
}

export const INTRO_IMAGE = { width: 640, height: 400 } as const;

export const INTRO_CARDS: readonly IntroCard[] = [
  {
    id: 'adventure',
    file: '01-adventure.webp',
    alt: 'A knight faces a slime with a times table question and a number pad below.',
    text: 'Kids play a retro adventure, and every monster is a math fact.',
  },
  {
    id: 'memory',
    file: '02-memory.webp',
    alt: 'A player home screen with a day streak, gems and a week of stars.',
    text: 'It learns what each kid knows, and brings facts back right before they would forget them.',
  },
  {
    id: 'prereaders',
    file: '03-prereaders.webp',
    alt: 'A picture question with dots to count and three big answer buttons.',
    text: 'Pre-readers get pictures and a voice. Older kids type their answers.',
  },
  {
    id: 'grownups',
    file: '04-grownups.webp',
    alt: 'The Grown-ups Learning progress panel with a grid of colored facts.',
    text: 'Grown-ups see exactly which facts are strong and which are weak.',
  },
  {
    id: 'private',
    file: '05-private.webp',
    alt: 'The Grown-ups settings for one player.',
    text: 'Private by design: no ads, no tracking, and your family’s data stays in your account.',
  },
];
