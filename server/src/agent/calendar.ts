import { gameEnd, gameStart } from '../huddle/catalog.js';
import type { Game } from '../huddle/types.js';
import { gameTitle } from './format.js';

// RFC 5545 invite. iPhone opens it straight into Apple Calendar from iMessage.
export function buildIcs(game: Game, now: Date = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Huddle//Game Day//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${game.id}@huddle`,
    `DTSTAMP:${icsTime(now)}`,
    `DTSTART:${icsTime(gameStart(game))}`,
    `DTEND:${icsTime(gameEnd(game))}`,
    `SUMMARY:${escapeText(`Huddle: ${gameTitle(game)}`)}`,
    `LOCATION:${escapeText(`${game.venue.name}, ${game.venue.address}`)}`,
    `DESCRIPTION:${escapeText(description(game))}`,
    `GEO:${game.venue.lat};${game.venue.lng}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText(`${gameTitle(game)} starts in 1 hour`)}`,
    'TRIGGER:-PT1H',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

// Prefilled "add event" link; works without any Google account access on our side.
export function googleCalendarUrl(game: Game): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `Huddle: ${gameTitle(game)}`,
    dates: `${icsTime(gameStart(game))}/${icsTime(gameEnd(game))}`,
    location: `${game.venue.name}, ${game.venue.address}`,
    details: description(game),
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

export function icsFileName(game: Game): string {
  return `huddle-${game.id}.ics`;
}

function description(game: Game): string {
  return `Watch ${gameTitle(game)} (${game.league}) with your Huddle crew at ${game.venue.name}.`;
}

// 20261011T233000Z
function icsTime(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

// Lines over 75 octets continue on the next line after a space (RFC 5545 3.1).
function fold(line: string): string {
  const parts: string[] = [];
  let rest = line;
  let limit = 75;
  while (Buffer.byteLength(rest) > limit) {
    let cut = limit;
    while (Buffer.byteLength(rest.slice(0, cut)) > limit) cut--;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
    limit = 74; // continuation lines start with a space
  }
  parts.push(rest);
  return parts.join('\r\n ');
}
