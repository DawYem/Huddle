import { findGame, gameStart, type Catalog } from '../huddle/catalog.js';
import type { Store } from '../huddle/store.js';
import type { Fan, Game } from '../huddle/types.js';

export interface DueReminder {
  fan: Fan;
  game: Game;
  // Every window this send covers, so a late sign-up doesn't get a 24h and a 2h text back to back.
  keys: string[];
}

// Matches the landing page playbook: a text the day before and one 2 hours out.
export const DEFAULT_WINDOWS_HOURS = [24, 2];

export function reminderKey(gameId: string, handle: string, windowHours: number): string {
  return `${gameId}|${handle}|${windowHours}h`;
}

export function dueReminders(
  store: Store,
  catalog: Catalog,
  now: Date,
  windowsHours: number[] = DEFAULT_WINDOWS_HOURS,
): DueReminder[] {
  const fans = new Map(store.fans().map((f) => [f.handle, f]));
  const due: DueReminder[] = [];

  for (const signup of store.signups()) {
    const fan = fans.get(signup.handle);
    const game = findGame(catalog, signup.gameId);
    // Only text fans who texted Huddle first and haven't said stop.
    if (!fan || !game || !fan.textedFirst || fan.optedOut) continue;

    const msUntil = gameStart(game).getTime() - now.getTime();
    if (msUntil <= 0) continue;

    const open = windowsHours.filter((h) => msUntil <= h * 3_600_000).sort((a, b) => a - b);
    if (!open.length) continue;
    // The tightest window is the one that matters right now.
    if (store.reminderSent(reminderKey(game.id, fan.handle, open[0]))) continue;

    due.push({ fan, game, keys: open.map((h) => reminderKey(game.id, fan.handle, h)) });
  }
  return due;
}
