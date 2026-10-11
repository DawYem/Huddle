import { readFileSync } from 'node:fs';
import type { Game, Perk } from './types.js';

export interface Catalog {
  games: Game[];
  // Full team name -> lowercase aliases fans might type.
  teams: Record<string, string[]>;
  perks: Perk[];
}

export function loadCatalog(gamesPath: string, perksPath: string): Catalog {
  const g = JSON.parse(readFileSync(gamesPath, 'utf8')) as { games: Game[]; teams: Record<string, string[]> };
  const p = JSON.parse(readFileSync(perksPath, 'utf8')) as { perks: Perk[] };
  return { games: g.games, teams: g.teams, perks: p.perks };
}

export function gameStart(game: Game): Date {
  return new Date(game.startsAt);
}

export function gameEnd(game: Game): Date {
  return new Date(gameStart(game).getTime() + game.durationMinutes * 60_000);
}

// Games that haven't finished yet, soonest first.
export function upcomingGames(catalog: Catalog, now: Date): Game[] {
  return catalog.games
    .filter((g) => gameEnd(g) > now)
    .sort((a, b) => gameStart(a).getTime() - gameStart(b).getTime());
}

export function gamesForTeam(catalog: Catalog, team: string, now: Date): Game[] {
  return upcomingGames(catalog, now).filter((g) => g.home === team || g.away === team);
}

// Teams named in free text, matched on whole words so "united" doesn't match "unitedly".
export function findTeams(catalog: Catalog, text: string): string[] {
  const haystack = ` ${normalize(text)} `;
  return Object.entries(catalog.teams)
    .filter(([name, aliases]) =>
      [name, ...aliases].some((alias) => haystack.includes(` ${normalize(alias)} `)),
    )
    .map(([name]) => name);
}

export function findGame(catalog: Catalog, id: string): Game | undefined {
  return catalog.games.find((g) => g.id === id);
}

export function perkFor(catalog: Catalog, placeId: string): Perk | undefined {
  return catalog.perks.find((p) => p.placeId === placeId);
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
