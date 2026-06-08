'use strict';

/**
 * Tennis player name lookup table.
 * Maps last names (as they appear in pp-mcp data) to full names.
 * Covers ATP top 150 + WTA top 100 + common names at Grand Slams.
 *
 * This is the bridge between pp-mcp's last-name-only tennis data and
 * SportScore's full-name API slugs.
 *
 * @type {Object<string, string>}
 * @constant
 */

const PLAYER_NAMES = {
  // ATP - top players
  djokovic: 'Novak Djokovic',
  alcaraz: 'Carlos Alcaraz',
  sinner: 'Jannik Sinner',
  medvedev: 'Daniil Medvedev',
  zverev: 'Alexander Zverev',
  tsitsipas: 'Stefanos Tsitsipas',
  rune: 'Holger Rune',
  rublev: 'Andrey Rublev',
  hurkacz: 'Hubert Hurkacz',
  'auger-aliassime': 'Felix Auger-Aliassime',
  aliassime: 'Felix Auger-Aliassime',
  fritz: 'Taylor Fritz',
  fonseca: 'Joao Fonseca',
  ruud: 'Casper Ruud',
  'de-minaur': 'Alex De Minaur',
  deminaur: 'Alex De Minaur',
  dimitrov: 'Grigor Dimitrov',
  paul: 'Tommy Paul',
  khachanov: 'Karen Khachanov',
  bublik: 'Alexander Bublik',
  tiafoe: 'Frances Tiafoe',
  shelton: 'Ben Shelton',
  musetti: 'Lorenzo Musetti',
  jarry: 'Nicolas Jarry',
  tabilo: 'Alejandro Tabilo',
  navone: 'Mariano Navone',
  etcheverry: 'Tomas Martin Etcheverry',
  cerundolo: 'Francisco Cerundolo',
  'diaz-acosta': 'Facundo Diaz Acosta',
  struff: 'Jan-Lennard Struff',
  korda: 'Sebastian Korda',
  mannarino: 'Adrian Mannarino',
  banez: 'Roberto Bautista Agut',
  'bautista-agut': 'Roberto Bautista Agut',
  monfils: 'Gael Monfils',
  gasquet: 'Richard Gasquet',
  wawrinka: 'Stan Wawrinka',
  nadal: 'Rafael Nadal',
  murray: 'Andy Murray',
  thiem: 'Dominic Thiem',
  berrettini: 'Matteo Berrettini',
  shapovalov: 'Denis Shapovalov',
  kyrgios: 'Nick Kyrgios',
  nishikori: 'Kei Nishikori',
  raonic: 'Milos Raonic',
  cilic: 'Marin Cilic',
  delbonis: 'Federico Delbonis',
  fognini: 'Fabio Fognini',
  basilashvili: 'Nikoloz Basilashvili',
  mcenroe: 'John McEnroe',
  moutet: 'Corentin Moutet',
  humbert: 'Ugo Humbert',
  fils: 'Arthur Fils',
  'van-de-zandschulp': 'Botic Van De Zandschulp',
  vandeschulp: 'Botic Van De Zandschulp',
  griekspoor: 'Tallon Griekspoor',
  sonego: 'Lorenzo Sonego',
  'davidovich-fokina': 'Alejandro Davidovich Fokina',
  arnaldi: 'Matteo Arnaldi',
  safiullin: 'Roman Safiullin',
  zvonareva: 'Vera Zvonareva',
  kecmanovic: 'Miomir Kecmanovic',
  lavrinenko: 'unknown',
  nguyen: 'unknown',

  // ATP - other common names
  mcdonald: 'Mackenzie McDonald',
  wolf: 'J.J. Wolf',
  nakashima: 'Brandon Nakashima',
  koepfer: 'Dominik Koepfer',
  hanfmann: 'Yannick Hanfmann',
  ophoff: 'unknown',
  pepper: 'unknown',
  sock: 'Jack Sock',
  isner: 'John Isner',
  anderson: 'Kevin Anderson',
  opelka: 'Reilly Opelka',
  brooksby: 'Jenson Brooksby',
  kozlova: 'Kateryna Kozlova',
  mensik: 'Jakub Mensik',
  michalski: 'Daniel Michalski',
  muller: 'Alexandre Muller',
  cachin: 'Pedro Cachin',
  coria: 'Federico Coria',
  'carballes-baena': 'Roberto Carballes Baena',
  cazaux: 'Arthur Cazaux',
  halys: 'Quentin Halys',
  lorenzi: 'Paolo Lorenzi',
  mager: 'Gianluca Mager',
  passaro: 'Francesco Passaro',
  piros: 'Zsombor Piros',
  rodionov: 'Jurij Rodionov',
  sweeting: 'unknown',
  vavassori: 'Andrea Vavassori',
  zeppieri: 'Giulio Zeppieri',
  ddokic: 'unknown',
  ngounoue: 'unknown',
  spizzichino: 'unknown',
  pigato: 'unknown',
  serafini: 'unknown',
  maestrelli: 'unknown',

  // WTA - top players
  swiatek: 'Iga Swiatek',
  sabalenka: 'Aryna Sabalenka',
  gauff: 'Coco Gauff',
  rybakina: 'Elena Rybakina',
  pegula: 'Jessica Pegula',
  jabeur: 'Ons Jabeur',
  sakkari: 'Maria Sakkari',
  kvitova: 'Petra Kvitova',
  osaka: 'Naomi Osaka',
  kenin: 'Sofia Kenin',
  andreescu: 'Bianca Andreescu',
  konta: 'Johanna Konta',
  muguruza: 'Garbine Muguruza',
  halep: 'Simona Halep',
  kerber: 'Angelique Kerber',
  williams: 'Serena Williams',
  'williams-v': 'Venus Williams',
  azarenka: 'Victoria Azarenka',
  svitolina: 'Elina Svitolina',
  bencic: 'Belinda Bencic',
  kostyuk: 'Marta Kostyuk',
  cirstea: 'Sorana Cirstea',
  xiyu: 'Wang Xiyu',
  kalinina: 'Anhelina Kalinina',
  potapova: 'Anastasia Potapova',
  kalinskaya: 'Anna Kalinskaya',
  samsonova: 'Liudmila Samsonova',
  kudermetova: 'Veronika Kudermetova',
  kasatkina: 'Daria Kasatkina',
  ostapenko: 'Jelena Ostapenko',
  pliskova: 'Karolina Pliskova',
  muchova: 'Karolina Muchova',
  'haddad-maia': 'Beatriz Haddad Maia',
  keys: 'Madison Keys',
  stephens: 'Sloane Stephens',
  collins: 'Danielle Collins',
  aniesimova: 'Amanda Anisimova',
  fernandez: 'Leylah Fernandez',
  raducanu: 'Emma Raducanu',
  xia: 'Wang Xiyu',
  shnaider: 'Diana Shnaider',
  chwalinska: 'unknown',
  parry: 'Diane Parry',
  mmoh: 'unknown',
  smith: 'unknown',
  teunissen: 'unknown',
  smit: 'unknown',

  // WTA - other common
  linette: 'Magda Linette',
  boulter: 'Katie Boulter',
  burrage: 'Jodie Burrage',
  dart: 'Harriet Dart',
  watson: 'Heather Watson',
  vondrousova: 'Marketa Vondrousova',
  kontaveit: 'Anett Kontaveit',
  badosa: 'Paula Badosa',
  tauson: 'Clara Tauson',
  tomljanovic: 'Ajla Tomljanovic',
  riske: 'Alison Riske',
  roland: 'unknown',
  townsend: 'Taylor Townsend',
  dolehide: 'Caroline Dolehide',
  navarro: 'Emma Navarro',
  stevens: 'unknown',
  uchiijima: 'unknown',
  hontama: 'unknown',
  bektas: 'Emina Bektas',
  brengle: 'Madison Brengle',
  marino: 'Rebecca Marino',
  stakusic: 'unknown',
  zhao: 'unknown',
  sun: 'unknown',
  wei: 'unknown',
  gao: 'unknown',
  wushuang: 'unknown',
  schmiedlova: 'Anna Karolina Schmiedlova',
  sramkova: 'Rebecca Sramkova',
  martincova: 'Tereza Martincova',
  niemeier: 'Jule Niemeier',
  friedsam: 'Anna-Lena Friedsam',
  lis: 'unknown',
  korpatsch: 'Tamara Korpatsch',
  kolodziejova: 'unknown',
  birrell: 'Kimberly Birrell',
  saville: 'Daria Saville',
  sharma: 'unknown',
  aiava: 'Destanee Aiava',
  gadecki: 'unknown',
  hon: 'unknown',
  bucsa: 'Cristina Bucsa',
  'sorribes-tormo': 'Sara Sorribes Tormo',
  podoroska: 'Nadia Podoroska',
  errani: 'Sara Errani',
  paolini: 'Jasmine Paolini',
  cocciaretto: 'Elisabetta Cocciaretto',
  trevisan: 'Martina Trevisan',
  bronzetti: 'Lucia Bronzetti',
  stefanini: 'unknown',
  pigossi: 'Laura Pigossi',
  alves: 'unknown',
  ce: 'unknown',
  selcinkaya: 'unknown',
  cengiz: 'unknown',
  okamura: 'unknown',
  shinikova: 'unknown',
  karatancheva: 'unknown',
  yankova: 'unknown',
  tomanova: 'unknown',
  naydenova: 'unknown',
  ivanova: 'unknown',
  kovaleva: 'unknown',
  andreeva: 'Mirra Andreeva',
  timofeeva: 'unknown',
  avanesyan: 'Elina Avanesyan',
  mertens: 'Elise Mertens'
};

/**
 * Resolve a player name (last name or partial) to a full name.
 * Returns the full name if found, or the input if not.
 *
 * @param {string} name - Player last name or partial name to resolve
 * @returns {string|null} Full player name if found in lookup table, null if input is empty
 */
function resolvePlayerName(name) {
  if (!name) return null;
  const key = name
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
  return PLAYER_NAMES[key] || PLAYER_NAMES[name.trim().toLowerCase()] || null;
}

/**
 * Get the SportScore slug for a player name.
 *
 * @param {string} name - Player name to convert into a URL-safe slug
 * @returns {string|null} URL-safe slug for SportScore API, or null if input is empty
 */
function getNameSlug(name) {
  const full = resolvePlayerName(name);
  if (full && full !== 'unknown') {
    return full
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-');
  }
  // Try direct slug from last name
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^\w-]/g, '')
    .replace(/\s+/g, '-');
  return slug || null;
}

module.exports = { resolvePlayerName, getNameSlug, PLAYER_NAMES };
