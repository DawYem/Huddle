import s from "./page.module.css";
import Splash from "./Splash";

const ticker = [
  "Crews forming near you",
  "Arsenal · Sat 11:00",
  "Hawks · Sun 18:00",
  "United · Sun 9:30",
  "No app · Just iMessage",
];

const playbook = [
  {
    time: "T-24H",
    title: "The invite",
    body: "Your team plays tomorrow. Huddle texts you a spot nearby and how many fans are going.",
  },
  {
    time: "T-2H",
    title: "The crew chat",
    body: "You join a group chat with your 4 to 6 fans and a reminder of where to meet.",
  },
  {
    time: "Kickoff",
    title: "The game",
    body: "Halftime prediction polls, and confetti on every phone when your team scores.",
  },
  {
    time: "Full time",
    title: "The rematch",
    body: "Huddle asks if you want the same crew next week. One reply keeps the team together.",
  },
];

const stats = [
  {
    value: "4-6",
    label: "Fans per crew",
    body: "Small enough to actually talk. Matched on team and vibe, from die-hard to casual.",
  },
  {
    value: "0",
    label: "Apps to download",
    body: "Huddle is a contact in your phone. Everything happens in iMessage.",
  },
  {
    value: "$0",
    label: "For fans",
    body: "No subscription stack. Filter for free spots, no-minimum spots or alcohol-free spots.",
  },
];

const rules = [
  { title: "Opt-in only.", body: "Huddle only texts people who texted it first." },
  { title: "Groups, not DMs.", body: "You meet fans as a crew, never one-on-one." },
  {
    title: "Public spots only.",
    body: "Listed bars, restaurants and fan clubs. Never private homes.",
  },
  {
    title: "Tap out anytime.",
    body: "Text “leave”, “stop” or “report” whenever you need to.",
  },
];

const crew = ["JM", "AK", "DO", "RT"];

const SMS_HREF = "sms:[YOUR NUMBER]";

function Logo({ target = false }: { target?: boolean }) {
  return (
    <a href="#" className={s.logo} data-logo={target || undefined}>
      HUDDLE<span className={s.yellow}>.</span>
    </a>
  );
}

export default function Home() {
  const tickerItems = [...ticker, ...ticker];

  return (
    <>
      <Splash />
      <div className={s.ticker} aria-label={ticker.join(", ")}>
        <div className={s.tickerTrack} aria-hidden>
          {tickerItems.map((t, i) => (
            <span key={i} className={s.tickerItem}>
              {i % ticker.length === 0 && <span className={s.dot} />}
              {t}
            </span>
          ))}
        </div>
      </div>

      <header className={s.nav}>
        <div className={`${s.container} ${s.navInner}`}>
          <Logo target />
          <nav className={s.navLinks}>
            <a href="#playbook">The playbook</a>
            <a href="#venues">Venues</a>
            <a href={SMS_HREF} className={s.btnOutline}>
              Get in the game
            </a>
          </nav>
        </div>
      </header>

      <main>
        <section className={`${s.container} ${s.hero}`}>
          <h1 className={s.heroTitle}>
            Game day is a <span className={s.yellow}>team sport.</span>
          </h1>
          <p className={s.heroSub}>
            Huddle texts you before your team plays and puts you at a table
            with a small crew of fans nearby. You just show up.
          </p>

          <div className={s.scoreboard}>
            <div className={s.scoreHead}>
              <span>Home</span>
              <span className={s.live}>
                <span className={s.liveDot} />
                Live
              </span>
              <span>Away</span>
            </div>
            <div className={s.scoreRow}>
              <div className={s.team}>
                <span className={`${s.score} ${s.yellow}`}>5</span>
                <span className={s.teamName}>You + your crew</span>
              </div>
              <span className={s.colon}>:</span>
              <div className={s.team}>
                <span className={`${s.score} ${s.scoreDim}`}>0</span>
                <span className={`${s.teamName} ${s.teamDim}`}>
                  Watching alone
                </span>
              </div>
            </div>
          </div>

          <div className={s.heroCtas}>
            <a href={SMS_HREF} className={s.btnPrimary}>
              Text [your number]
            </a>
            <a href="#playbook" className={s.btnGhost}>
              See the playbook
            </a>
          </div>
        </section>

        <section className={`${s.container} ${s.invite}`}>
          <div className={s.inviteCopy}>
            <p className={s.eyebrow}>Your invite</p>
            <h2 className={s.h2}>
              A seat saved. A
              <br />
              crew waiting.
            </h2>
            <p className={s.body}>
              Every invite is a ticket: the game, a spot near you that&apos;s
              showing it, and the fans you&apos;ll be sitting with. Reply
              &ldquo;I&apos;m in&rdquo; and you&apos;re on the team sheet.
            </p>
          </div>

          <div className={s.pass}>
            <div className={s.passTop}>
              <div className={s.passMeta}>
                <span>Huddle crew pass</span>
                <span>Example</span>
              </div>
              <h3 className={s.passTitle}>Arsenal vs [Opponent]</h3>
              <dl className={s.passGrid}>
                <div>
                  <dt>Kickoff</dt>
                  <dd>Sat · 11:00</dd>
                </div>
                <div>
                  <dt>Venue</dt>
                  <dd>[Venue name]</dd>
                </div>
                <div>
                  <dt>Distance</dt>
                  <dd>0.8 mi</dd>
                </div>
                <div>
                  <dt>Meet</dt>
                  <dd>10:45</dd>
                </div>
              </dl>
            </div>
            <div className={s.passBottom}>
              <span className={s.passLabel}>Your crew</span>
              <div className={s.avatars}>
                {crew.map((c) => (
                  <span key={c} className={s.avatar}>
                    {c}
                  </span>
                ))}
                <span className={`${s.avatar} ${s.avatarYou}`}>You</span>
              </div>
              <span className={s.reply}>Reply &ldquo;I&apos;m in&rdquo;</span>
            </div>
          </div>
        </section>

        <section id="playbook" className={s.playbook}>
          <div className={s.container}>
            <div className={s.playbookHead}>
              <h2 className={s.h2Lg}>The game-day playbook</h2>
              <p className={s.bodySm}>
                Huddle runs the clock. You get a text at each moment that
                matters, and nothing in between.
              </p>
            </div>
            <ol className={s.steps}>
              {playbook.map((p) => (
                <li key={p.time}>
                  <span className={s.stepTime}>{p.time}</span>
                  <h3 className={s.stepTitle}>{p.title}</h3>
                  <p className={s.stepBody}>{p.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className={`${s.container} ${s.stats}`}>
          {stats.map((st) => (
            <div key={st.label} className={s.statCard}>
              <span className={s.statValue}>{st.value}</span>
              <h3 className={s.statLabel}>{st.label}</h3>
              <p className={s.stepBody}>{st.body}</p>
            </div>
          ))}
        </section>

        <section id="venues" className={s.venues}>
          <div className={`${s.container} ${s.venuesInner}`}>
            <div>
              <p className={s.eyebrow}>For venues · Cox Business</p>
              <h2 className={s.h2}>
                The game&apos;s on your screen. The crews are on us.
              </h2>
              <p className={s.body}>
                Post what you&apos;re showing, hold a few crew tables, and fill
                seats on slow nights. Free for venues on Cox Business TV.
              </p>
            </div>
            <a href="#" className={s.btnPrimary}>
              List your venue
            </a>
          </div>
        </section>

        <section className={`${s.container} ${s.rules}`}>
          <h2 className={s.h2}>House rules</h2>
          <ol className={s.rulesGrid}>
            {rules.map((r, i) => (
              <li key={r.title}>
                <span className={s.ruleNum}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <p>
                  <strong>{r.title}</strong> {r.body}
                </p>
              </li>
            ))}
          </ol>
        </section>

        <section className={s.cta}>
          <div className={s.container}>
            <h2 className={s.ctaTitle}>Stop watching alone.</h2>
            <p className={s.ctaSub}>
              Text Huddle your team and neighborhood. Your first invite comes
              before the next kickoff.
            </p>
            <a href={SMS_HREF} className={s.btnDark}>
              Text [your number]
            </a>
          </div>
        </section>
      </main>

      <footer className={`${s.container} ${s.footer}`}>
        <Logo />
        <span>Built for the Cox Enterprises social good track.</span>
      </footer>
    </>
  );
}
