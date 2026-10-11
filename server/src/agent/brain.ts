import { findGame, findTeams, gamesForTeam, gameStart, upcomingGames, type Catalog } from '../huddle/catalog.js';
import { eventLine, eventsNear, joinedText, type NearbyEvent } from '../huddle/community.js';
import { extractLatLng, type LatLng } from '../huddle/mapsLink.js';
import { matchSport, SPORTS, sportById, type Sport } from '../huddle/sports.js';
import type { Store } from '../huddle/store.js';
import type { Fan, Game } from '../huddle/types.js';
import { directionsUrl } from '../maps/directions.js';
import { buildIcs, googleCalendarUrl, icsFileName } from './calendar.js';
import { formatCountdown, formatWhen, gameLine, gameTitle } from './format.js';
import type { PlacesFinder } from './places.js';

export type Reply =
  | { kind: 'text'; text: string }
  | { kind: 'file'; name: string; mimeType: string; data: Buffer }
  // A native iMessage poll; the transport falls back to a numbered list.
  | { kind: 'poll'; title: string; options: string[] };

// What the fan's next short reply ("yes", "2") refers to.
type Pending =
  // Several reminders can land together; YES then covers all of them.
  | { type: 'calendar'; gameIds: string[] }
  | { type: 'join'; gameIds: string[] }
  | { type: 'calendar-pick'; gameIds: string[] }
  // Asked which sport; `at` is set when the fan already sent a location.
  | { type: 'sport'; at?: LatLng }
  // Sport chosen; waiting for a location (link, pin, or typed place).
  | { type: 'location'; sport: string }
  // No bars found: "join a community watch event?" then "are you hosting one?"
  | { type: 'community-join'; sport: string; at: LatLng }
  | { type: 'community-pick'; sport: string; at: LatLng; eventIds: string[] }
  | { type: 'community-host'; sport: string; at: LatLng };

export interface AgentDeps {
  catalog: Catalog;
  store: Store;
  places: PlacesFinder;
  // Private Safari link where the fan grants location access. Undefined when
  // links aren't configured; the fan can still text a place or share a pin.
  locationLink?: (fan: Fan, sport: Sport) => string | undefined;
  // "List your venue" page for hosts, prefilled with sport and area.
  hostLink?: (fan: Fan, sport: Sport, at: LatLng) => string | undefined;
  // How long to keep looking for an event before queueing the fan.
  queueWaitMs?: number;
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
  '• "bars near me" to find a spot for any sport',
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
// "hi", "Hi Huddle" (the website pre-fills this), "hey huddle!", "/help".
const GREETING = /^(\/?help|menu|\?|(hi|hey|hello|yo|sup)(\s+huddle)?[!.]*)$/i;
const BARS = /\b(bars?|pubs?|spots?|near me|nearby|around me|close by|sports bar)\b/i;
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
    const known = await store.getFan(handle);
    // Texting Huddle is the opt-in the landing page promises.
    const fan = await store.upsertFan(handle, { textedFirst: true });

    if (STOP.test(text)) {
      await store.upsertFan(handle, { optedOut: true });
      this.pending.delete(handle);
      return [say("You're out, no more texts from Huddle. Text START anytime to come back.")];
    }
    if (START.test(text)) {
      await store.upsertFan(handle, { optedOut: false });
      return [say("Welcome back! I'll text you before your games again."), say(HELP)];
    }
    if (REPORT.test(text)) {
      this.log(`REPORT from ${handle}: ${text}`);
      return [say("Thanks for telling us. A person on the Huddle team will look at this. If you're in danger, call 911.")];
    }

    // A question texted by the website API (no bars near the shared location).
    // It replaces whatever the agent was waiting for (usually the location
    // the fan just shared through the link).
    if (fan.prompt?.type === 'community-join') {
      const { sport, lat, lng } = fan.prompt;
      this.pending.set(handle, { type: 'community-join', sport, at: { lat, lng } });
      await store.upsertFan(handle, { prompt: undefined });
    }

    const pending = this.pending.get(handle);
    if (pending?.type === 'community-join' || pending?.type === 'community-pick' || pending?.type === 'community-host') {
      const answered = await this.answerCommunity(fan, pending, text);
      if (answered) return answered;
    } else if (pending?.type === 'sport' || pending?.type === 'location') {
      const answered = await this.answerBarsFlow(fan, pending, text);
      if (answered) return answered;
    } else if (pending) {
      const answered = await this.answerPending(fan, pending, text);
      if (answered) return answered;
    }

    if (BARS.test(text)) return this.startBarsFlow(fan, text);
    if (REMIND.test(text)) return this.remindNext(fan);
    if (MY_GAMES.test(text)) return this.listMyGames(fan);
    if (GREETING.test(text) || !text) {
      return known?.textedFirst ? [say(HELP)] : [say(`Hey${fan.name ? ` ${fan.name}` : ''}! 👋`), say(HELP)];
    }
    if (findTeams(this.deps.catalog, text).length || FIND.test(text)) return this.findGames(fan, text);
    return [say("Sorry, I didn't get that."), say(HELP)];
  }

  // A location arrived outside text: an iMessage pin, a Maps link card, or the
  // Safari link (which the API answers itself). Saves it and continues the flow.
  async handleLocation(handle: string, at: LatLng): Promise<Reply[]> {
    const fan = await this.deps.store.upsertFan(handle, { textedFirst: true, lat: at.lat, lng: at.lng });
    const pending = this.pending.get(handle);
    const sport = pending?.type === 'location' ? sportById(pending.sport) : undefined;
    if (sport) return this.barsReply(fan, sport, at);
    this.pending.set(handle, { type: 'sport', at });
    return [say('Got your location 📍'), sportPoll()];
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

  // "bars near me" / "soccer bar near Penn Station": sport first, then location.
  private async startBarsFlow(fan: Fan, text: string): Promise<Reply[]> {
    const sport = matchSport(text);
    if (!sport) {
      this.pending.set(fan.handle, { type: 'sport' });
      return [sportPoll()];
    }
    // "soccer bar near Penn Station" -> look up "Penn Station" right away.
    const typed = /\b(near|in|around|at)\s+(.{3,})$/i.exec(text.trim());
    if (typed) return this.answerBarsFlow(fan, { type: 'location', sport: sport.id }, typed[2]) as Promise<Reply[]>;
    return this.askLocation(fan, sport);
  }

  private async answerBarsFlow(
    fan: Fan,
    pending: Extract<Pending, { type: 'sport' | 'location' }>,
    text: string,
  ): Promise<Reply[] | undefined> {
    // Let the fan bail out to other commands mid-flow.
    if (NO.test(text) || MY_GAMES.test(text) || REMIND.test(text) || GREETING.test(text)) {
      this.pending.delete(fan.handle);
      return undefined;
    }
    if (pending.type === 'sport') {
      const sport = matchSport(text);
      if (!sport) return [say(`Pick one: ${SPORTS.map((s, i) => `${i + 1}. ${s.label}`).join('  ')}`)];
      return pending.at ? this.barsReply(fan, sport, pending.at) : this.askLocation(fan, sport);
    }
    const sport = sportById(pending.sport)!;
    const at = extractLatLng(text);
    if (at) return this.barsReply(fan, sport, at);
    try {
      const near = fan.lat !== undefined && fan.lng !== undefined ? { lat: fan.lat, lng: fan.lng } : undefined;
      const place = await this.deps.places.geocode(text, near);
      if (!place) return [say(`I couldn't find "${text}". Try a neighborhood, a street, or a landmark.`)];
      return this.barsReply(fan, sport, place, place.label);
    } catch (err) {
      this.log(`geocode failed: ${err instanceof Error ? err.message : String(err)}`);
      return [say("I couldn't look that place up right now. Try again in a minute.")];
    }
  }

  private askLocation(fan: Fan, sport: Sport): Reply[] {
    this.pending.set(fan.handle, { type: 'location', sport: sport.id });
    const link = this.deps.locationLink?.(fan, sport);
    return [
      say(
        [
          `${sport.label} it is. Where are you?`,
          link ? `📍 Tap to share your location: ${link}` : undefined,
          `${link ? 'Or t' : 'T'}ext a neighborhood or address, or share your location pin (+ → Location).`,
        ]
          .filter(Boolean)
          .join('\n'),
      ),
    ];
  }

  private async barsReply(fan: Fan, sport: Sport, at: LatLng, label?: string): Promise<Reply[]> {
    this.pending.delete(fan.handle);
    await this.deps.store.upsertFan(fan.handle, { lat: at.lat, lng: at.lng });
    try {
      const { text, count } = await this.deps.places.barsNear(at.lat, at.lng, sport, fan);
      if (!count) {
        // Nothing nearby: offer a community watch party instead.
        this.pending.set(fan.handle, { type: 'community-join', sport: sport.id, at });
        return [
          say(
            `I couldn't find ${sport.label.toLowerCase()} bars near ${label ?? 'you'}. Want to join a community watch event near you? Reply YES or NO.`,
          ),
        ];
      }
      return [say(label ? `Near ${label}:\n${text}` : text)];
    } catch (err) {
      this.log(`bar search failed: ${err instanceof Error ? err.message : String(err)}`);
      return [say("I couldn't load bars right now. Try again in a minute.")];
    }
  }

  // Community watch events, step by step:
  //  join?  YES -> pick a nearby event, or wait in the queue
  //         NO  -> hosting?  YES -> "list your venue" link
  //                          NO  -> nothing left to offer, say goodbye
  private async answerCommunity(
    fan: Fan,
    pending: Extract<Pending, { type: 'community-join' | 'community-pick' | 'community-host' }>,
    text: string,
  ): Promise<Reply[] | undefined> {
    const { store } = this.deps;
    const sport = sportById(pending.sport)!;

    if (pending.type === 'community-pick') {
      const n = NUMBER.exec(text);
      if (!n) {
        if (NO.test(text)) return this.askHosting(fan, sport, pending.at);
        return undefined;
      }
      const eventId = pending.eventIds[Number(n[1]) - 1];
      if (!eventId) return [say(`Pick a number from 1 to ${pending.eventIds.length}.`)];
      const event = await store.joinEvent(eventId, fan.handle);
      this.pending.delete(fan.handle);
      if (!event) return [say('That event was just taken down. Text "bars near me" to look again.')];
      await store.removeFromWaitlist([fan.handle]);
      return [say(joinedText(event))];
    }

    const yes = YES.test(text);
    const no = NO.test(text);
    if (!yes && !no) return [say('Reply YES or NO.')];

    if (pending.type === 'community-host') {
      this.pending.delete(fan.handle);
      if (no) {
        return [say("No problem. That's every option I've got for now. Text \"bars near me\" anytime to search again.")];
      }
      const link = this.deps.hostLink?.(fan, sport, pending.at);
      return [
        say(
          link
            ? `Awesome! List your venue here so fans nearby can join you:\n${link}\nAnyone waiting for a ${sport.label.toLowerCase()} watch party near you gets a text when it's live.`
            : "Hosting isn't set up yet. Check back soon!",
        ),
      ];
    }

    // community-join
    if (no) return this.askHosting(fan, sport, pending.at);

    const found = await this.findEvents(pending.at, sport.id);
    if (found.length) return this.offerEvents(fan, sport, pending.at, found, `${sport.label} watch parties near you:`);

    // Give a just-listed event a few seconds to show up, then queue the fan.
    await sleep(this.deps.queueWaitMs ?? 3000);
    const late = await this.findEvents(pending.at, sport.id);
    if (late.length) return this.offerEvents(fan, sport, pending.at, late, `Found one! ${sport.label} watch parties near you:`);

    this.pending.delete(fan.handle);
    await store.addToWaitlist({
      handle: fan.handle,
      sport: sport.id,
      lat: pending.at.lat,
      lng: pending.at.lng,
      since: this.now().toISOString(),
    });
    return [
      say(
        `No ${sport.label.toLowerCase()} watch parties near you yet. You're in the queue ⏳ I'll text you the moment someone hosts one nearby.`,
      ),
    ];
  }

  private offerEvents(fan: Fan, sport: Sport, at: LatLng, found: NearbyEvent[], heading: string): Reply[] {
    this.pending.set(fan.handle, { type: 'community-pick', sport: sport.id, at, eventIds: found.map((n) => n.event.id) });
    return [say([heading, ...found.map((n, i) => eventLine(n, i)), 'Reply with a number to join.'].join('\n'))];
  }

  private async findEvents(at: LatLng, sport: string): Promise<NearbyEvent[]> {
    return eventsNear(await this.deps.store.events(), at, sport, this.now());
  }

  private askHosting(fan: Fan, sport: Sport, at: LatLng): Reply[] {
    this.pending.set(fan.handle, { type: 'community-host', sport: sport.id, at });
    return [say(`Are you hosting a ${sport.label.toLowerCase()} watch event? Reply YES or NO.`)];
  }

  private async answerPending(fan: Fan, pending: Pending, text: string): Promise<Reply[] | undefined> {
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

    // Handled by answerBarsFlow / answerCommunity.
    if (pending.type !== 'join' && pending.type !== 'calendar-pick') return undefined;

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

    const added = await store.addSignup(game.id, fan.handle, this.now());
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
    const joined = new Set((await store.signupsFor(fan.handle)).map((s) => s.gameId));

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

  private async listMyGames(fan: Fan): Promise<Reply[]> {
    const { catalog, store } = this.deps;
    const ids = new Set((await store.signupsFor(fan.handle)).map((s) => s.gameId));
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
    const ids = new Set((await store.signupsFor(fan.handle)).map((s) => s.gameId));
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

// A numbered list rather than a native iMessage poll: spectrum-ts 12.10.1
// can't resolve votes on our polls (it reads back an empty title and drops
// the poll_option), so taps never reached the agent.
function sportPoll(): Reply {
  const list = SPORTS.map((s, i) => `${i + 1}. ${s.label}`).join('\n');
  return say(`Which sport are you watching?\n${list}\nReply with a number or the sport.`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function say(text: string): Reply {
  return { kind: 'text', text };
}

function dedupe(games: Game[]): Game[] {
  return [...new Map(games.map((g) => [g.id, g])).values()];
}
