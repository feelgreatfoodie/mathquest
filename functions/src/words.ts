// Word lists for suggestUsername: color + animal + 2 digits, for example "bluefox42". All lowercase letters, so a
// suggestion always fits the username shape. The longest is 6 + 8 + 2 = 16 characters. Never a person's name.
// Every word is short, friendly and not on the reserved list in reserved.ts (a unit test checks all combinations).

export const COLORS = ['red', 'blue', 'green', 'gold', 'pink', 'teal', 'lime', 'plum', 'rose', 'sky', 'mint', 'rust', 'navy', 'ruby', 'sand', 'jade', 'coral', 'amber', 'ivory', 'violet'] as const;

export const ANIMALS = [
  'fox', 'owl', 'bear', 'wolf', 'otter', 'panda', 'tiger', 'koala', 'lynx', 'hawk', 'seal', 'duck', 'frog', 'crab', 'moose', 'bunny',
  'whale', 'eagle', 'zebra', 'llama', 'gecko', 'finch', 'robin', 'heron', 'newt', 'bison', 'camel', 'badger', 'beaver', 'dolphin',
] as const;
