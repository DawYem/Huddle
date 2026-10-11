import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { Fan, Signup } from './types.js';

interface StoreData {
  fans: Fan[];
  signups: Signup[];
  // Keys of reminders already texted, so restarts never double-send.
  remindersSent: string[];
}

// Fans, sign-ups and sent reminders in one JSON file.
// The HTTP server and the agent run as separate processes and share this file,
// so every call re-reads it and writes it back right away. Fine for a demo;
// swap for a real database before many fans are writing at once.
export class Store {
  // `seed` is a seed file's path, or its already-parsed contents.
  constructor(
    private readonly path: string,
    seed?: string | Partial<StoreData>,
  ) {
    if (!existsSync(path)) {
      if (typeof seed === 'string' && existsSync(seed)) copyFileSync(seed, path);
      else if (seed && typeof seed === 'object') {
        this.write({ fans: seed.fans ?? [], signups: seed.signups ?? [], remindersSent: seed.remindersSent ?? [] });
      } else this.write({ fans: [], signups: [], remindersSent: [] });
    }
  }

  fans(): Fan[] {
    return this.read().fans;
  }

  getFan(handle: string): Fan | undefined {
    return this.read().fans.find((f) => f.handle === handle);
  }

  // Creates the fan with safe defaults if they don't exist yet.
  upsertFan(handle: string, changes: Partial<Omit<Fan, 'handle'>> = {}): Fan {
    const data = this.read();
    let fan = data.fans.find((f) => f.handle === handle);
    if (!fan) {
      fan = { handle, is21Plus: false, textedFirst: false, optedOut: false };
      data.fans.push(fan);
    }
    Object.assign(fan, changes);
    this.write(data);
    return fan;
  }

  signups(): Signup[] {
    return this.read().signups;
  }

  signupsFor(handle: string): Signup[] {
    return this.read().signups.filter((s) => s.handle === handle);
  }

  // Returns false when the fan was already signed up.
  addSignup(gameId: string, handle: string, now: Date = new Date()): boolean {
    const data = this.read();
    if (data.signups.some((s) => s.gameId === gameId && s.handle === handle)) return false;
    data.signups.push({ gameId, handle, createdAt: now.toISOString() });
    this.write(data);
    return true;
  }

  reminderSent(key: string): boolean {
    return this.read().remindersSent.includes(key);
  }

  markRemindersSent(keys: string[]): void {
    const data = this.read();
    for (const key of keys) if (!data.remindersSent.includes(key)) data.remindersSent.push(key);
    this.write(data);
  }

  private read(): StoreData {
    const raw = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<StoreData>;
    return { fans: raw.fans ?? [], signups: raw.signups ?? [], remindersSent: raw.remindersSent ?? [] };
  }

  private write(data: StoreData): void {
    // Write then rename, so the other process never reads a half-written file.
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, this.path);
  }
}
