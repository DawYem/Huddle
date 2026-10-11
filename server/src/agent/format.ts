import { gameStart } from '../huddle/catalog.js';
import type { Game } from '../huddle/types.js';

export function gameTitle(game: Game): string {
  return `${game.home} vs ${game.away}`;
}

// "Sun, Oct 11, 7:30 PM EDT", always in the venue's zone.
export function formatWhen(game: Game): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: game.timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(gameStart(game));
}

// "in 45 minutes", "in 2 hours", "in 3 days".
export function formatCountdown(game: Game, now: Date): string {
  const minutes = Math.round((gameStart(game).getTime() - now.getTime()) / 60_000);
  if (minutes <= 0) return 'now';
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `in ${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `in ${days} days`;
}

// One numbered line per game, used whenever the fan can reply with a number.
export function gameLine(game: Game, index: number, joined = false): string {
  return `${index + 1}. ${gameTitle(game)} (${game.league}), ${formatWhen(game)} at ${game.venue.name}${joined ? ' ✅ joined' : ''}`;
}
