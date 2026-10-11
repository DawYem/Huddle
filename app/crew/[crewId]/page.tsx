import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import s from "./crew.module.css";

export const metadata: Metadata = {
  title: "Your crew — Huddle",
  description: "Your Huddle crew, meetup spot and time for the next game.",
  // Invite-only: keep crew pages out of search engines
  robots: { index: false, follow: false },
};

// Demo data until the backend provides real crews. A fan only reaches this
// page through the link Huddle texts them after they accept an invite:
//   /crew/<crewId>?name=<first name>
// Any crew ID not listed here 404s.
const CREWS: Record<
  string,
  {
    match: {
      home: string;
      away: string;
      kickoff: string;
      meet: string;
      venue: string;
      address: string;
      distance: string;
      table: string;
    };
    members: { name: string; vibe: string; note: string }[];
  }
> = {
  "ars-che-7k2x9q": {
    match: {
      home: "Arsenal",
      away: "Chelsea",
      kickoff: "Sat · 11:00 AM",
      meet: "10:45 AM",
      venue: "The Halftime Tap",
      address: "Peachtree St NE, Midtown Atlanta",
      distance: "0.8 mi",
      table: "Crew table 4, by the big screen",
    },
    members: [
      { name: "Jordan M.", vibe: "Die-hard", note: "Season ticket holder, knows every chant" },
      { name: "Aisha K.", vibe: "Die-hard", note: "Hasn't missed a match since 2014" },
      { name: "Dev O.", vibe: "Casual", note: "Here for the vibes and the wings" },
      { name: "Riley T.", vibe: "First timer", note: "New to Atlanta, new to Arsenal" },
    ],
  },
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default async function CrewPage({
  params,
  searchParams,
}: {
  params: Promise<{ crewId: string }>;
  searchParams: Promise<{ name?: string }>;
}) {
  const { crewId } = await params;
  const crew = CREWS[crewId];
  if (!crew) notFound();

  const { match: MATCH, members: MEMBERS } = crew;
  const { name } = await searchParams;
  const you = name?.trim() || "You";

  return (
    <div className={s.page}>
      <header className={s.nav}>
        <Link href="/" className={s.logo}>
          HUDDLE<span className={s.yellow}>.</span>
        </Link>
        <Link href="/" className={s.back}>
          ← Back to home
        </Link>
      </header>

      <main className={s.main}>
        <p className={s.eyebrow}>Your crew</p>
        <h1 className={s.title}>
          You&apos;re on the <span className={s.yellow}>team sheet.</span>
        </h1>

        <div className={s.pass}>
          <div className={s.passTop}>
            <div className={s.passMeta}>
              <span>Huddle crew pass</span>
              <span>Confirmed</span>
            </div>
            <h2 className={s.match}>
              {MATCH.home} vs {MATCH.away}
            </h2>
            <dl className={s.details}>
              <div>
                <dt>Kickoff</dt>
                <dd>{MATCH.kickoff}</dd>
              </div>
              <div>
                <dt>Meet at</dt>
                <dd>{MATCH.meet}</dd>
              </div>
              <div>
                <dt>Venue</dt>
                <dd>{MATCH.venue}</dd>
              </div>
              <div>
                <dt>Distance</dt>
                <dd>{MATCH.distance}</dd>
              </div>
            </dl>
            <p className={s.address}>
              {MATCH.address} · {MATCH.table}
            </p>
          </div>

          <div className={s.passBottom}>
            <div className={s.crewHead}>
              <span className={s.label}>Your crew</span>
              <span className={s.count}>{MEMBERS.length + 1} fans</span>
            </div>
            <ul className={s.members}>
              <li className={s.member}>
                <span className={`${s.avatar} ${s.avatarYou}`}>
                  {you === "You" ? "You" : initials(you)}
                </span>
                <div>
                  <p className={s.memberName}>
                    {you === "You" ? "You" : `${you} (you)`}
                  </p>
                  <p className={s.memberNote}>Just joined</p>
                </div>
                <span className={s.vibe}>New signing</span>
              </li>
              {MEMBERS.map((m) => (
                <li key={m.name} className={s.member}>
                  <span className={s.avatar}>{initials(m.name)}</span>
                  <div>
                    <p className={s.memberName}>{m.name}</p>
                    <p className={s.memberNote}>{m.note}</p>
                  </div>
                  <span className={s.vibe}>{m.vibe}</span>
                </li>
              ))}
            </ul>
            <p className={s.chat}>
              Your crew chat opens in iMessage 2 hours before kickoff.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
