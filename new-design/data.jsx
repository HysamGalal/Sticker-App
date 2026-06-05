// Sticker album dataset for the prototype.
// All player names and stats are invented placeholders — no real likenesses.
// Country codes are factual 3-letter ISO codes for the host nations + a sampling
// of qualifying nations to make the album feel real without claiming
// affiliation with any official competition product.

const TEAMS = [
  // Hosts
  { code: 'CAN', name: 'Canada',        group: 'A', host: true,  colors: ['#d80027', '#ffffff'] },
  { code: 'MEX', name: 'Mexico',        group: 'A', host: true,  colors: ['#006847', '#ffffff', '#ce1126'] },
  { code: 'USA', name: 'United States', group: 'D', host: true,  colors: ['#0a3161', '#ffffff', '#b31942'] },
  // Selected other nations (placeholder roster — final qualification is invented)
  { code: 'ARG', name: 'Argentina',     group: 'B', colors: ['#74acdf', '#ffffff'] },
  { code: 'BRA', name: 'Brazil',        group: 'B', colors: ['#fedb00', '#009c3b'] },
  { code: 'ESP', name: 'Spain',         group: 'C', colors: ['#aa151b', '#f1bf00'] },
  { code: 'FRA', name: 'France',        group: 'C', colors: ['#0055a4', '#ffffff', '#ef4135'] },
  { code: 'ENG', name: 'England',       group: 'D', colors: ['#ffffff', '#ce1124'] },
  { code: 'GER', name: 'Germany',       group: 'E', colors: ['#000000', '#dd0000', '#ffce00'] },
  { code: 'ITA', name: 'Italy',         group: 'E', colors: ['#008c45', '#ffffff', '#cd212a'] },
  { code: 'POR', name: 'Portugal',      group: 'F', colors: ['#046a38', '#da291c'] },
  { code: 'NED', name: 'Netherlands',   group: 'F', colors: ['#ff6f00', '#ffffff', '#21468b'] },
  { code: 'BEL', name: 'Belgium',       group: 'G', colors: ['#000000', '#fae042', '#ed2939'] },
  { code: 'CRO', name: 'Croatia',       group: 'G', colors: ['#171796', '#ffffff', '#ff0000'] },
  { code: 'URU', name: 'Uruguay',       group: 'H', colors: ['#7cb9e8', '#ffffff'] },
  { code: 'COL', name: 'Colombia',      group: 'H', colors: ['#fcd116', '#003893', '#ce1126'] },
  { code: 'JPN', name: 'Japan',         group: 'I', colors: ['#0a2240', '#bc002d'] },
  { code: 'KOR', name: 'South Korea',   group: 'I', colors: ['#cd2e3a', '#0047a0'] },
  { code: 'MAR', name: 'Morocco',       group: 'J', colors: ['#c1272d', '#006233'] },
  { code: 'SEN', name: 'Senegal',       group: 'J', colors: ['#00853f', '#fdef42', '#e31b23'] },
  { code: 'AUS', name: 'Australia',     group: 'K', colors: ['#012169', '#ffd100'] },
  { code: 'IRN', name: 'Iran',          group: 'K', colors: ['#239f40', '#ffffff', '#da0000'] },
  { code: 'DEN', name: 'Denmark',       group: 'L', colors: ['#c60c30', '#ffffff'] },
  { code: 'SUI', name: 'Switzerland',   group: 'L', colors: ['#d52b1e', '#ffffff'] },
];

// 19 player slots per team + 1 team badge = 20 stickers per team
const STICKERS_PER_TEAM = 20;

// Invented player surnames — international flavor, intentionally not matching
// any real squads. The first sticker for each team is the badge (number 0).
const FAKE_SURNAMES = [
  'Carter', 'Silva',  'Müller',  'Yamada',  'Okafor', 'Lindqvist',
  'Diallo', 'Kovač',  'Antonov', 'Reyes',   'Bauer',  'Costa',
  'Nakamura','Ferrari','Andersen','Otieno', 'Marchetti','Park','Vargas',
];

const POSITIONS = ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW',
                   'MF', 'DF', 'FW', 'MF', 'DF', 'MF', 'FW', 'GK'];

// Deterministic PRNG so refreshing doesn't reshuffle ownership.
function mulberry32(seed) {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Stable hash for sticker ids — used to derive a deterministic "value".
function hashId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Stickermanager-style value: 100 = balanced supply/demand. We invent values
// in the 65-180 range; badges and "captain" positions skew higher (scarcer).
function stickerValue(s) {
  const base = 65 + (hashId(s.id) % 70);           // 65-134
  let v = base;
  if (s.isBadge) v += 30;
  if (s.position === 'GK' && s.number === 1) v += 10;
  if (s.number === 10) v += 15;                    // "playmaker" bias
  return v;
}

// Build the canonical sticker list. Status assigned procedurally:
// ~52% owned (1 copy), ~14% duplicates (2-4 copies), ~34% missing.
function buildStickers() {
  const rng = mulberry32(2026);
  const stickers = [];
  TEAMS.forEach((team, ti) => {
    for (let i = 0; i < STICKERS_PER_TEAM; i++) {
      const isBadge = i === 0;
      const roll = rng();
      let count;
      if (roll < 0.52) count = 1;
      else if (roll < 0.66) count = 2 + Math.floor(rng() * 3); // duplicates
      else count = 0;
      const s = {
        id: `${team.code}-${i}`,
        team: team.code,
        teamIndex: ti,
        number: i,                       // 0 = badge
        isBadge,
        name: isBadge ? `${team.name}` : FAKE_SURNAMES[(i - 1 + ti) % FAKE_SURNAMES.length],
        position: isBadge ? 'BADGE' : POSITIONS[(i - 1) % POSITIONS.length],
        count,
      };
      s.value = stickerValue(s);
      stickers.push(s);
    }
  });
  return stickers;
}

const STICKERS = buildStickers();

// Other "traders" — invented users with overlapping inventories so the
// trade-discovery view has someone to recommend.
// `online` enables Live Swap (instant accept). `address` shown post-accept.
const TRADERS = [
  { id: 'u_marco', name: 'Marco D.',  city: 'Toronto, CA',      rating: 4.9, swaps: 47,  avatar: '#d4564a', online: true,  address: '142 Queen St W, Toronto ON M5H 2N3' },
  { id: 'u_ana',   name: 'Ana P.',    city: 'Mexico City, MX',  rating: 4.8, swaps: 132, avatar: '#3b7a57', online: false, address: 'Av. Insurgentes Sur 1602, 03940 CDMX' },
  { id: 'u_kenji', name: 'Kenji R.',  city: 'Brooklyn, US',     rating: 5.0, swaps: 23,  avatar: '#2c5fa8', online: true,  address: '281 Bedford Ave, Brooklyn NY 11211' },
  { id: 'u_lucia', name: 'Lucía M.',  city: 'Buenos Aires, AR', rating: 4.7, swaps: 89,  avatar: '#c9a227', online: false, address: 'Av. Corrientes 3247, C1193 CABA' },
  { id: 'u_omar',  name: 'Omar K.',   city: 'Casablanca, MA',   rating: 4.9, swaps: 61,  avatar: '#7b4d8c', online: true,  address: 'Bd Mohamed V 142, Casablanca 20250' },
  { id: 'u_sara',  name: 'Sara L.',   city: 'Copenhagen, DK',   rating: 4.8, swaps: 38,  avatar: '#3b6e8c', online: false, address: 'Nørrebrogade 88, 2200 København N' },
];

// Per-trader: which stickers they offer (their dupes) and which they want.
// Generated so the lists overlap meaningfully with the player's collection.
function buildTraderInventories() {
  const rng = mulberry32(7);
  const byCount = STICKERS.reduce((acc, s) => {
    if (s.count >= 2) acc.dupes.push(s);
    if (s.count === 0) acc.missing.push(s);
    return acc;
  }, { dupes: [], missing: [] });

  return TRADERS.map((t, ti) => {
    // What this trader OFFERS = a random subset of OUR missing list (so trades
    // are useful) + some random extras.
    const offers = byCount.missing
      .filter((_, i) => (i + ti) % 3 === 0 || rng() < 0.3)
      .slice(0, 14 + Math.floor(rng() * 8))
      .map((s) => s.id);
    // What they WANT = a subset of our dupes
    const wants = byCount.dupes
      .filter((_, i) => (i + ti * 2) % 3 === 0 || rng() < 0.35)
      .slice(0, 10 + Math.floor(rng() * 6))
      .map((s) => s.id);
    return { ...t, offers, wants };
  });
}

const TRADER_INVENTORIES = buildTraderInventories();

const ACTIVITY = [
  { who: 'Marco D.',  what: 'completed Group F',          when: '2m',   tag: 'milestone' },
  { who: 'Ana P.',    what: 'swapped 4 stickers with Ben K.', when: '11m', tag: 'swap' },
  { who: 'Kenji R.',  what: 'is looking for ARG #07',     when: '23m',  tag: 'want' },
  { who: 'Lucía M.',  what: 'opened 3 new packs',         when: '38m',  tag: 'pack' },
  { who: 'Omar K.',   what: 'completed the album',        when: '1h',   tag: 'milestone' },
  { who: 'Sara L.',   what: 'is offering 12 dupes',       when: '2h',   tag: 'offer' },
];

Object.assign(window, {
  TEAMS, STICKERS, TRADERS, TRADER_INVENTORIES, ACTIVITY, STICKERS_PER_TEAM,
});
