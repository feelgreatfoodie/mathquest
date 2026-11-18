// Original 12×12 pixel art for the shop items, same format as SPRITES in sprites.tsx (a letter picks a palette
// color, a dot is clear). Made up for this game: no outside characters or items.
export type ItemSpriteDef = { rows: string[]; palette: Record<string, string> };

const INK = '#111827';

export const ITEM_SPRITES: Record<string, ItemSpriteDef> = {
  'w-sword': {
    palette: { b: '#e5e7eb', B: '#9ca3af', y: '#facc15', n: '#92400e' },
    rows: ['..........bb', '.........bBb', '........bBb.', '.......bBb..', '......bBb...', '.y...bBb....', '..y.bBb.....', '...yBb......', '...yyy......', '..n.yy......', '.nn.........', 'nn..........'],
  },
  'w-wand': {
    palette: { n: '#92400e', y: '#fde047', p: '#c084fc', w: '#ffffff' },
    rows: ['.......w....', '......wyw...', '.....wyyyw..', '......wyw...', '.....nw.....', '....nn......', '...nn.......', '..nn........', '.nn.........', 'nn..........', 'n...........', '............'],
  },
  'w-bow': {
    palette: { n: '#92400e', s: '#f3f4f6', r: '#ef4444' },
    rows: ['.nn.........', '..nn........', '...nn.......', '...nsr......', '...n.sr.....', '...n..sr....', '...n..sr....', '...n.sr.....', '...nsr......', '...nn.......', '..nn........', '.nn.........'],
  },
  'w-hammer': {
    palette: { g: '#9ca3af', G: '#4b5563', n: '#92400e' },
    rows: ['..GGGGGG....', '..GggggGG...', '..GggggGG...', '..GggggGG...', '..GGGGGG....', '....nn......', '....nn......', '....nn......', '....nn......', '....nn......', '....nn......', '....nn......'],
  },
  'w-boomerang': {
    palette: { o: '#f59e0b', O: '#b45309' },
    rows: ['............', '.OO.........', '.OoO........', '..OoO.......', '...OoO......', '....OoO.....', '.....OoO....', '......OoO...', '.......OoOO.', '........OooO', '.........OOO', '............'],
  },
  'g-cape': {
    palette: { r: '#dc2626', R: '#7f1d1d', y: '#facc15' },
    rows: ['............', '...y....y...', '..yRrrrrRy..', '..RrrrrrrR..', '.RrrrrrrrrR.', '.RrrrrrrrrR.', '.RrrrrrrrrR.', 'RrrrrrrrrrrR', 'RrrrrrrrrrrR', 'RrrrrrrrrrrR', 'RRRRRRRRRRRR', '............'],
  },
  'g-helm': {
    palette: { S: '#64748b', s: '#cbd5e1', r: '#dc2626', k: INK },
    rows: ['.....rr.....', '....rrr.....', '...SSSSSS...', '..SssssssS..', '..SsSSSSsS..', '..Ss.kk.sS..', '..Ss.kk.sS..', '..SS....SS..', '............', '............', '............', '............'],
  },
  'g-wizhat': {
    palette: { p: '#7c3aed', P: '#4c1d95', y: '#fde047' },
    rows: ['.......p....', '......pp....', '......pp....', '.....pyp....', '.....ppp....', '....ppppp...', '....pyppp...', '...ppppppp..', '..PPPPPPPPP.', '.PPPPPPPPPPP', '............', '............'],
  },
  'g-dinohood': {
    palette: { g: '#4ade80', G: '#15803d', w: '#ffffff', k: INK, t: '#f8fafc' },
    rows: ['..G..G..G...', '.GgG.GG.GG..', '.GggGggGgG..', 'GgggggggggG.', 'GgwkgggwkgG.', 'Gggggggggg..', 'GgggttttggG.', '.GggggggggG.', '..GGGGGGGG..', '............', '............', '............'],
  },
  'p-beetle': {
    palette: { b: '#2563eb', B: '#1e3a8a', k: INK, w: '#ffffff' },
    rows: ['............', '..k......k..', '...k....k...', '....kwwk....', '...BbbbbB...', '..BbbBBbbB..', '.kBbbBBbbBk.', '.kBbbBBbbBk.', '..BbbBBbbB..', '...BbbBBbB..', '..k.BBBB.k..', '.k........k.'],
  },
  'p-dog': {
    palette: { o: '#d97706', O: '#92400e', w: '#ffffff', k: INK, p: '#f9a8d4' },
    rows: ['............', '.O........O.', '.OO......OO.', '.OoooooooOO.', '..oowooowo..', '..ookooko...', '..oooookoo..', '...opppoo...', '...oowwoo...', '..oooooooo..', '..oo....oo..', '..OO....OO..'],
  },
  'p-owl': {
    palette: { n: '#a16207', N: '#713f12', w: '#ffffff', y: '#fde047', k: INK },
    rows: ['.N........N.', '.NN......NN.', '.NnnnnnnnnN.', '.NnwwnnwwnN.', '.NnwkynkwnN.', '.NnwwnnwwnN.', '..NnnyynnN..', '..NnnnnnnN..', '..NnwwwwnN..', '..NnwwwwnN..', '...NNNNNN...', '...yy..yy...'],
  },
  'p-pup': {
    palette: { r: '#ef4444', R: '#991b1b', y: '#fde047', k: INK, w: '#ffffff' },
    rows: ['..y......y..', '..yy....yy..', '...RrrrrR...', '..RrwkrwkR..', '..RrrrrrrR..', '..RrrkkrrR..', 'R..RrrrrR...', 'RR.RrrrrR.R.', '.RRrrrrrrRR.', '..RrrrrrrR..', '..RR....RR..', '..yy....yy..'],
  },
  'a-key': {
    palette: { y: '#facc15', Y: '#a16207' },
    rows: ['....YYYY....', '...Yyyyyy.Y.', '...Yy..yYY..', '...Yy..yY...', '...YyyyyY...', '....YyyY....', '.....yY.....', '.....yY.....', '.....yYYY...', '.....yyyY...', '.....yY.....', '.....YY.....'],
  },
  'a-boots': {
    palette: { n: '#92400e', N: '#451a03', y: '#facc15', k: INK },
    rows: ['............', '..NNNN......', '..nnnn......', '..nnnn......', '..nyyn......', '..nnnn......', '..nnnnNN....', '..nnnnnnN...', '..nnnnnnnN..', '.NnnnnnnnnN.', '.NNNNNNNNNN.', '............'],
  },
  'a-lantern': {
    palette: { k: '#374151', y: '#fde047', o: '#f59e0b', w: '#ffffff' },
    rows: ['....kkkk....', '...k....k...', '..kkkkkkkk..', '..kyyyyyyk..', '..kywwoyyk..', '..kywooyyk..', '..kyyooyyk..', '..kyyyyyyk..', '..kkkkkkkk..', '............', '............', '............'],
  },
  'a-bridge': {
    palette: { n: '#92400e', N: '#451a03', r: '#d1d5db', b: '#38bdf8' },
    rows: ['............', '............', 'r..........r', 'rr........rr', 'rNNNNNNNNNNr', 'nnnnnnnnnnnn', 'nNnNnNnNnNnN', 'NNNNNNNNNNNN', 'bbbbbbbbbbbb', 'bbbbbbbbbbbb', 'bbbbbbbbbbbb', '............'],
  },
  'c-flag': {
    palette: { n: '#92400e', r: '#ef4444', y: '#facc15' },
    rows: ['..n.........', '..nrrrrr....', '..nrrrrrr...', '..nrryrrrr..', '..nrrrrrr...', '..nrrrrr....', '..n.........', '..n.........', '..n.........', '..n.........', '..n.........', '.nnn........'],
  },
  'c-banner': {
    palette: { n: '#92400e', b: '#3b82f6', B: '#1e3a8a', y: '#facc15' },
    rows: ['nnnnnnnnnnnn', '.bbbbbbbbbb.', '.bbbbyybbbb.', '.bbbyyyybbb.', '.bbbbyybbbb.', '.bbbbbbbbbb.', '.bbbbbbbbbb.', '..bbbbbbbb..', '...bbbbbb...', '....bbbb....', '.....bb.....', '............'],
  },
  'c-tent': {
    palette: { t: '#f59e0b', T: '#b45309', d: '#451a03', n: '#92400e' },
    rows: ['.....nn.....', '....tttt....', '...tttttt...', '..tttttttt..', '..tttddttt..', '.ttttddtttt.', '.ttttddtttt.', 'TttttddttttT', 'TttttddttttT', 'TTTTTddTTTTT', '............', '............'],
  },
  'c-fire': {
    palette: { r: '#ef4444', o: '#f59e0b', y: '#fde047', n: '#92400e', N: '#451a03' },
    rows: ['.....r......', '....rro.....', '....rroo....', '...rrooyo...', '...rooyyo...', '..rrooyyoo..', '..rooyyyoo..', '..roooyooo..', '...NNnnNN...', '..nNNnnNNn..', '.nn..nn..nn.', '............'],
  },
  'g-goldarmor': {
    palette: { y: '#facc15', Y: '#a16207', r: '#dc2626', w: '#fef9c3' },
    rows: ['.y.......y..', '.yy.....yy..', '.yyy...yyy..', '.yyyyyyyyy..', '..yywyywyy..', '..yywwwwyy..', '..yywrrwyy..', '..yyyrryyy..', '..YyyyyyyY..', '..YYyyyyYY..', '...YYYYYY...', '............'],
  },
  'w-crystalstaff': {
    palette: { c: '#67e8f9', C: '#0891b2', w: '#ffffff', n: '#92400e', y: '#facc15' },
    rows: ['.....cc.....', '....cwcC....', '...cwccCC...', '....cccC....', '.....CC.....', '....yyyy....', '.....nn.....', '.....nn.....', '.....nn.....', '.....nn.....', '.....nn.....', '.....nn.....'],
  },
};
