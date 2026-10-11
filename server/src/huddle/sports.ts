// Sports a fan can pick when looking for a bar. `query` is what we send to
// Places Text Search; `leagues` ties it to games in data/games.json.
export interface Sport {
  id: string;
  label: string;
  query: string;
  leagues: string[];
  aliases: string[];
}

export const SPORTS: Sport[] = [
  { id: 'basketball', label: 'Basketball', query: 'sports bar basketball', leagues: ['NBA'], aliases: ['nba', 'hoops', 'bball'] },
  { id: 'football', label: 'Football', query: 'sports bar football', leagues: ['NFL'], aliases: ['nfl', 'american football'] },
  { id: 'soccer', label: 'Soccer', query: 'soccer bar', leagues: ['Premier League'], aliases: ['premier league', 'epl', 'futbol', 'fútbol'] },
  { id: 'baseball', label: 'Baseball', query: 'sports bar baseball', leagues: ['MLB'], aliases: ['mlb'] },
  { id: 'hockey', label: 'Hockey', query: 'sports bar hockey', leagues: ['NHL'], aliases: ['nhl'] },
];

export function sportById(id: string): Sport | undefined {
  return SPORTS.find((s) => s.id === id);
}

// "2", "Soccer", "nba", "I want hockey" -> a sport.
export function matchSport(text: string): Sport | undefined {
  const t = text.trim().toLowerCase();
  const n = /^#?(\d)$/.exec(t);
  if (n) return SPORTS[Number(n[1]) - 1];
  return SPORTS.find((s) =>
    [s.id, s.label.toLowerCase(), ...s.aliases].some((w) => new RegExp(`(^|\\W)${w}($|\\W)`, 'i').test(t)),
  );
}
