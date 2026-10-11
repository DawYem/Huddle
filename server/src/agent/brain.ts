import { findGame, findTeams, gamesForTeam, gameStart, upcomingGames, type Catalog } from '../huddle/catalog.js';
import type { Store } from '../huddle/store.js';
import type { Fan, Game } from '../huddle/types.js';
import { directionsUrl } from '../maps/directions.js';
import { buildIcs, googleCalendarUrl, icsFileName } from './calendar.js';
import { formatCountdown, formatWhen, gameLine, gameTitle } from './format.js';
import type { PlacesFinder } from './places.js';

export type Reply =
  | { kind: 'text'; text: string }
  | { kind: 'file'; name: string; mimeType: string; data: Buffer };

// What the fan's next short reply ("yes", "2") refers to.
type Pending =
  // Several reminders can land together; YES then covers all of them.
  | { type: 'calendar'; gameIds: string[] }
  | { type: 'join'; gameIds: string[] }
  | { type: 'calendar-pick'; gameIds: string[] };

export interface AgentDeps {
  catalog: Catalog;
  store: Store;
  places: PlacesFinder;
  now?: () => Date;
  log?: (msg: string) => void;
}

const MAX_LISTED = 5;

const HELP = [
  "I'm Huddle. I find you a crew and a spot for game day.",
  'Try:',
  '• "find Knicks" to see games you can join',
  '• "my games" for what you signed up for',
  '• "remind me" for your next game',
  '• "stop" to pause texts, "start" to resume',
].join('\n');

const YES = /^(y|ya|yes|yeah|yep|yup|sure|ok|okay|please|add it|do it)\b/i;
const NO = /^(n|no|nope|nah|no thanks|skip)\b/i;
const STOP = /^(stop|leave|unsubscribe|quit|cancel|end)$/i;
const START = /^(start|unstop|resume)$/i;
const REPORT = /^report\b/i;
const MY_GAMES = /\b(my games|my schedule|upcoming|signed up|what'?s next|whats next|\/games)\b/i;
const REMIND = /\b(remind|reminder|\/remind)\b/i;
const FIND = /\b(find|can'?t find|cant find|looking for|where|watch|game|games|play(ing|s)?)\b/i;
const NUMBER = /^(?:join\s+)?#?(\d{1,2})$/i;

export class HuddleAgent {
  private readonly pending = new Map<string, Pending>();
  private readonly now: () => Date;
  private readonly log: (msg: string) => void;

  constructor(private readonly deps: AgentDeps) {
    this.now = deps.now ?? (() => new Date());
    this.log = deps.log ?? (() => {});
  }

  // Everything the fan texts comes through here.
  async handleMessage(handle: string, rawText: string): Promise<Reply[]> {
    const text = rawText.trim();
    const { store } = this.deps;
    const known = store.getFan(handle);
    // Texting Huddle is the opt-in the landing page promises.
    const fan = store.upsertFan(handle, { textedFirst: true });

    if (STOP.test(text)) {
      store.upsertFan(handle, { optedOut: true });
      this.pending.delete(handle);
      return [say("You're out, no more texts from Huddle. Text START anytime to come back.")];
    }
    if (START.test(text)) {
      store.upsertFan(handle, { optedOut: false });
      return [say("Welcome back! I'll text you before your games again."), say(HELP)];
    }
    if (REPORT.test(text)) {
      this.log(`REPORT from ${handle}: ${text}`);
      return [say("Thanks for telling us. A person on the Huddle team will look at this. If you're in danger, call 911.")];
    }

    const pending = this.pending.get(handle);
    if (pending) {
      const answered = this.answerPending(fan, pending, text);
      if (answered) return answered;
    }

    if (REMIND.test(text)) return this.remindNext(fan);
    if (MY_GAMES.test(text)) return this.listMyGames(fan);
    if (/^(\/?help|hi|hey|hello|menu|\?)$/i.test(text) || !text) {
      return known?.textedFirst ? [say(HELP)] : [say(`Hey${fan.name ? ` ${fan.name}` : ''}! 👋`), say(HELP)];
    }
    if (findTeams(this.deps.catalog, text).length || FIND.test(text)) return this.findGames(fan, text);
    return [say("Sorry, I didn't get that."), say(HELP)];
  }

  // The reminder text for one game. Also offers to add it to the calendar.
  async buildReminder(fan: Fan, game: Game): Promise<Reply[]> {
    const now = this.now();
    const { venue } = game;
    const lines = [
      `⏰ ${gameTitle(game)} is ${formatCountdown(game, now)}`,
      `🗓 ${formatWhen(game)}`,
      `📍 ${venue.name}, ${venue.address}`,
      `Directions: ${directionsUrl({ id: venue.placeId ?? '', lat: venue.lat, lng: venue.lng })}`,
    ];
    const replies = [say(lines.join('\n'))];

    if (!venue.servesFood) {
      replies.push(say(await this.foodText(fan, game)));
    }

    const prev = this.pending.get(fan.handle);
    const offered = prev?.type === 'calendar' ? prev.gameIds.filter((id) => id !== game.id) : [];
    this.pending.set(fan.handle, { type: 'calendar', gameIds: [...offered, game.id] });
    replies.push(
      say(
        offered.length
          ? `Want all ${offered.length + 1} of these games on your calendar? Reply YES or NO.`
          : 'Want it on your calendar? Reply YES or NO.',
      ),
    );
    return replies;
  }

  private answerPending(fan: Fan, pending: Pending, text: string): Reply[] | undefined {
    const { store, catalog } = this.deps;

    if (pending.type === 'calendar') {
      const games = pending.gameIds.map((id) => findGame(catalog, id)).filter((g) => g !== undefined);
      if (YES.test(text) && games.length) {
        this.pending.delete(fan.handle);
        return games.flatMap((g) => this.calendarReplies(g));
      }
      if (NO.test(text)) {
        this.pending.delete(fan.handle);
        return [say("No problem. I'll still remind you before kickoff.")];
      }
      return undefined;
    }

    const n = NUMBER.exec(text);
    if (!n) {
      if (NO.test(text)) {
        this.pending.delete(fan.handle);
        return [say('All good.')];
      }
      return undefined;
    }
    const game = findGame(catalog, pending.gameIds[Number(n[1]) - 1] ?? '');
    if (!game) return [say(`Pick a number from 1 to ${pending.gameIds.length}.`)];

    if (pending.type === 'calendar-pick') {
      this.pending.delete(fan.handle);
      return this.calendarReplies(game);
    }

    const added = store.addSignup(game.id, fan.handle, this.now());
    this.pending.set(fan.handle, { type: 'calendar', gameIds: [game.id] });
    return [
      say(
        added
          ? `You're in for ${gameTitle(game)}, ${formatWhen(game)} at ${game.venue.name}. I'll text you before it starts.`
          : `You're already in for ${gameTitle(game)}.`,
      ),
      say('Want it on your calendar? Reply YES or NO.'),
    ];
  }

  // Feature 1: the fan can't find a game, so give them alternatives.
  private async findGames(fan: Fan, text: string): Promise<Reply[]> {
    const { catalog, store } = this.deps;
    const now = this.now();
    const teams = findTeams(catalog, text);
    const joined = new Set(store.signupsFor(fan.handle).map((s) => s.gameId));

    const teamGames = dedupe(teams.flatMap((t) => gamesForTeam(catalog, t, now))).slice(0, MAX_LISTED);
    if (teamGames.length) {
      this.pending.set(fan.handle, { type: 'join', gameIds: teamGames.map((g) => g.id) });
      return [
        say(
          [
            `Here's what I've got for ${teams.join(' / ')}:`,
            ...teamGames.map((g, i) => gameLine(g, i, joined.has(g.id))),
            'Reply with a number to join that crew.',
          ].join('\n'),
        ),
      ];
    }

    const replies: Reply[] = [
      say(
        teams.length
          ? `No Huddle crews for ${teams.join(' / ')} yet. Here are some other options:`
          : "I couldn't find that game. Here are some other options:",
      ),
    ];

    const others = upcomingGames(catalog, now)
      .filter((g) => !joined.has(g.id))
      .slice(0, 3);
    if (others.length) {
      this.pending.set(fan.handle, { type: 'join', gameIds: others.map((g) => g.id) });
      replies.push(
        say(
          ['Other crews coming up:', ...others.map((g, i) => gameLine(g, i)), 'Reply with a number to join.'].join(
            '\n',
          ),
        ),
      );
    }

    replies.push(say(await this.watchSpotsText(fan)));
    return replies;
  }

  private listMyGames(fan: Fan): Reply[] {
    const { catalog, store } = this.deps;
    const ids = new Set(store.signupsFor(fan.handle).map((s) => s.gameId));
    const games = upcomingGames(catalog, this.now()).filter((g) => ids.has(g.id));
    if (!games.length) {
      return [say('You\'re not signed up for any upcoming games. Text "find" and a team, like "find Knicks".')];
    }
    this.pending.set(fan.handle, { type: 'calendar-pick', gameIds: games.map((g) => g.id) });
    return [
      say(
        [
          'Your games:',
          ...games.map((g, i) => gameLine(g, i)),
          'Reply with a number to add one to your calendar.',
        ].join('\n'),
      ),
    ];
  }

  private async remindNext(fan: Fan): Promise<Reply[]> {
    const { catalog, store } = this.deps;
    const ids = new Set(store.signupsFor(fan.handle).map((s) => s.gameId));
    const next = upcomingGames(catalog, this.now()).find(
      (g) => ids.has(g.id) && gameStart(g) > this.now(),
    );
    if (!next) return this.listMyGames(fan);
    return this.buildReminder(fan, next);
  }

  // Feature 3: the .ics opens in Apple Calendar; the link covers Google Calendar.
  private calendarReplies(game: Game): Reply[] {
    return [
      {
        kind: 'file',
        name: icsFileName(game),
        mimeType: 'text/calendar',
        data: Buffer.from(buildIcs(game, this.now())),
      },
      say(`📅 Tap the invite to add it to Apple Calendar, or use Google Calendar:\n${googleCalendarUrl(game)}`),
    ];
  }

  // Feature 2: venue has no kitchen, so point to food nearby, partner perks first.
  private async foodText(fan: Fan, game: Game): Promise<string> {
    try {
      const spots = await this.deps.places.foodNear(game.venue, fan);
      if (!spots.length) return `${game.venue.name} doesn't serve food, and I couldn't find food spots close by.`;
      return [
        `${game.venue.name} doesn't serve food. Grab a bite nearby:`,
        ...spots.map((s) =>
          [
            `• ${s.name} (${s.distanceMeters} m${s.rating ? `, ${s.rating}★` : ''}${s.openNow ? ', open now' : ''})`,
            s.perk ? `  🎁 Huddle perk: ${s.perk.perk}` : undefined,
            `  ${s.directionsUrl}`,
          ]
            .filter(Boolean)
            .join('\n'),
        ),
      ].join('\n');
    } catch (err) {
      this.log(`food search failed: ${err instanceof Error ? err.message : String(err)}`);
      return `${game.venue.name} doesn't serve food. I couldn't load nearby spots right now, so eat before you go.`;
    }
  }

  private async watchSpotsText(fan: Fan): Promise<string> {
    if (fan.lat === undefined || fan.lng === undefined) {
      return 'Add your location on the Huddle website and I can suggest spots near you too.';
    }
    try {
      const spots = await this.deps.places.watchSpotsNear(fan.lat, fan.lng, fan);
      if (!spots.length) return "I couldn't find spots near you right now.";
      return [
        'Or watch nearby. Call ahead to check they have the game on:',
        ...spots.map((s) => `• ${s.name}: ${s.reason}\n  ${s.directionsUrl}`),
      ].join('\n');
    } catch (err) {
      this.log(`watch spot search failed: ${err instanceof Error ? err.message : String(err)}`);
      return "I couldn't load spots near you right now.";
    }
  }
}

function say(text: string): Reply {
  return { kind: 'text', text };
}

function dedupe(games: Game[]): Game[] {
  return [...new Map(games.map((g) => [g.id, g])).values()];
}
