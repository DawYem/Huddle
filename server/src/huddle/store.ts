import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { CommunityEvent, Crew, Fan, Signup, WaitlistEntry } from './types.js';

export interface StoreData {
  fans: Fan[];
  signups: Signup[];
  // Keys of reminders already texted, so restarts never double-send.
  remindersSent: string[];
  // Fan-hosted watch parties, listed from the website.
  events: CommunityEvent[];
  // Fans waiting for a community event near them.
  waitlist: WaitlistEntry[];
  // Fans matched into groups at a bar.
  crews: Crew[];
}

// Where the data lives. The file works for one machine; Redis is shared by the
// Vercel API and the iMessage agent.
export interface StoreBackend {
  load(): Promise<Partial<StoreData> | undefined>;
  save(data: StoreData): Promise<void>;
}

function complete(d: Partial<StoreData> = {}): StoreData {
  return {
    fans: d.fans ?? [],
    signups: d.signups ?? [],
    remindersSent: d.remindersSent ?? [],
    events: d.events ?? [],
    waitlist: d.waitlist ?? [],
    crews: d.crews ?? [],
  };
}

export class FileBackend implements StoreBackend {
  // `seed` is a seed file's path, or its already-parsed contents.
  constructor(
    private readonly path: string,
    seed?: string | Partial<StoreData>,
  ) {
    if (existsSync(path)) return;
    if (typeof seed === 'string' && existsSync(seed)) copyFileSync(seed, path);
    else this.writeSync(complete(typeof seed === 'object' ? seed : {}));
  }

  async load() {
    return JSON.parse(readFileSync(this.path, 'utf8')) as Partial<StoreData>;
  }

  async save(data: StoreData) {
    this.writeSync(data);
  }

  private writeSync(data: StoreData) {
    // Write then rename, so the other process never reads a half-written file.
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, this.path);
  }
}

// Upstash Redis over its REST API (what Vercel's Redis integration provides).
// The whole store is one JSON value: simple, and plenty for this app's size.
export class RedisBackend implements StoreBackend {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly seed?: Partial<StoreData>,
    private readonly key = 'huddle:store',
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async load() {
    const { result } = (await this.command(['GET', this.key])) as { result: string | null };
    if (result) return JSON.parse(result) as Partial<StoreData>;
    return this.seed;
  }

  async save(data: StoreData) {
    await this.command(['SET', this.key, JSON.stringify(data)]);
  }

  private async command(args: string[]): Promise<unknown> {
    const res = await this.fetchFn(this.url.replace(/\/$/, ''), {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Redis returned ${res.status}: ${await res.text()}`);
    return res.json();
  }
}

// Fans, sign-ups, reminders, community events and the waitlist.
// Every call re-reads the data and writes it straight back, so separate
// processes (the API and the agent) always see each other's changes.
export class Store {
  private readonly backend: StoreBackend;
  // Serializes this process's read-modify-write cycles.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(backend: StoreBackend);
  constructor(path: string, seed?: string | Partial<StoreData>);
  constructor(backendOrPath: StoreBackend | string, seed?: string | Partial<StoreData>) {
    this.backend = typeof backendOrPath === 'string' ? new FileBackend(backendOrPath, seed) : backendOrPath;
  }

  async fans(): Promise<Fan[]> {
    return (await this.read()).fans;
  }

  async getFan(handle: string): Promise<Fan | undefined> {
    return (await this.read()).fans.find((f) => f.handle === handle);
  }

  // Creates the fan with safe defaults if they don't exist yet.
  upsertFan(handle: string, changes: Partial<Omit<Fan, 'handle'>> = {}): Promise<Fan> {
    return this.update((data) => {
      let fan = data.fans.find((f) => f.handle === handle);
      if (!fan) {
        fan = { handle, is21Plus: false, textedFirst: false, optedOut: false };
        data.fans.push(fan);
      }
      Object.assign(fan, changes);
      return { ...fan };
    });
  }

  async signups(): Promise<Signup[]> {
    return (await this.read()).signups;
  }

  async signupsFor(handle: string): Promise<Signup[]> {
    return (await this.read()).signups.filter((s) => s.handle === handle);
  }

  // Returns false when the fan was already signed up.
  addSignup(gameId: string, handle: string, now: Date = new Date()): Promise<boolean> {
    return this.update((data) => {
      if (data.signups.some((s) => s.gameId === gameId && s.handle === handle)) return false;
      data.signups.push({ gameId, handle, createdAt: now.toISOString() });
      return true;
    });
  }

  async reminderSent(key: string): Promise<boolean> {
    return (await this.read()).remindersSent.includes(key);
  }

  markRemindersSent(keys: string[]): Promise<void> {
    return this.update((data) => {
      for (const key of keys) if (!data.remindersSent.includes(key)) data.remindersSent.push(key);
    });
  }

  async events(): Promise<CommunityEvent[]> {
    return (await this.read()).events;
  }

  addEvent(event: CommunityEvent): Promise<void> {
    return this.update((data) => {
      data.events.push(event);
    });
  }

  // Returns the updated event, or undefined if it doesn't exist.
  joinEvent(eventId: string, handle: string): Promise<CommunityEvent | undefined> {
    return this.update((data) => {
      const event = data.events.find((e) => e.id === eventId);
      if (!event) return undefined;
      if (!event.attendees.includes(handle)) event.attendees.push(handle);
      return { ...event, attendees: [...event.attendees] };
    });
  }

  async waitlist(): Promise<WaitlistEntry[]> {
    return (await this.read()).waitlist;
  }

  // One entry per fan; a newer request replaces the older one.
  addToWaitlist(entry: WaitlistEntry): Promise<void> {
    return this.update((data) => {
      data.waitlist = data.waitlist.filter((w) => w.handle !== entry.handle);
      data.waitlist.push(entry);
    });
  }

  removeFromWaitlist(handles: string[]): Promise<void> {
    return this.update((data) => {
      data.waitlist = data.waitlist.filter((w) => !handles.includes(w.handle));
    });
  }

  async crew(id: string): Promise<Crew | undefined> {
    return (await this.read()).crews.find((c) => c.id === id);
  }

  // Puts the fan in an open crew via `pick` (or a new one from `create`).
  // Atomic, so two fans picking the same bar at once land in the same crew.
  joinCrew(pick: (crews: Crew[]) => Crew | undefined, create: () => Crew, member: Crew['members'][number]): Promise<Crew> {
    return this.update((data) => {
      let crew = pick(data.crews);
      if (!crew) {
        crew = create();
        data.crews.push(crew);
      }
      if (!crew.members.some((m) => m.handle === member.handle)) crew.members.push(member);
      return { ...crew, members: [...crew.members] };
    });
  }

  private async read(): Promise<StoreData> {
    await this.queue;
    return complete(await this.backend.load());
  }

  private update<T>(fn: (data: StoreData) => T): Promise<T> {
    const run = this.queue.then(async () => {
      const data = complete(await this.backend.load());
      const result = fn(data);
      await this.backend.save(data);
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}
