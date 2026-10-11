"use client";

import { useEffect, useRef, useState } from "react";
import s from "./Splash.module.css";

const LETTERS = ["H", "U", "D", "D", "L", "E", "."];

// Timing (ms)
const START_DELAY = 250;
const ENTRY = 420; // drop-in to the first bounce
const HOP = 230; // each bounce between letters
const HOLD = 650; // pause on the finished wordmark
const FLY_DURATION = 650;

// Exact quadratic easings, so each bounce traces a true parabola
const EASE_OUT = "cubic-bezier(0.33, 0.67, 0.67, 1)";
const EASE_IN = "cubic-bezier(0.33, 0, 0.67, 0.33)";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Play once per page load, not again on client-side navigation back home
let played = false;

// Each ball is drawn in a -50..50 box. `rest` is its half-height relative to
// a full circle, so flatter balls still land on the baseline.
const BALLS = [
  {
    name: "soccer",
    rest: 1,
    art: (
      <>
        <circle r="46" className={s.ballBody} />
        <polygon
          points="0,-14 13.3,-4.3 8.2,11.3 -8.2,11.3 -13.3,-4.3"
          className={s.patch}
        />
        <path d="M0 -14V-28 M13.3 -4.3L26.6 -8.7 M8.2 11.3L16.5 22.7 M-8.2 11.3L-16.5 22.7 M-13.3 -4.3L-26.6 -8.7" />
        <path d="M-18.7 -42L0 -28L18.7 -42 M34.2 -30.8L26.6 -8.7L45.7 4.8 M39.8 23L16.5 22.7L9.6 45 M-9.6 45L-16.5 22.7L-39.8 23 M-45.7 4.8L-26.6 -8.7L-34.2 -30.8" />
      </>
    ),
  },
  {
    name: "football",
    rest: 0.56,
    art: (
      <>
        <path
          d="M-48 0C-30 -34 30 -34 48 0C30 34 -30 34 -48 0Z"
          className={s.ballBody}
        />
        <path d="M-30 -19Q-25 0 -30 19 M30 -19Q25 0 30 19" />
        <path d="M-13 0H13 M-8 -5V5 M0 -5V5 M8 -5V5" />
      </>
    ),
  },
  {
    name: "tennis",
    rest: 1,
    art: (
      <>
        <circle r="46" className={s.ballBody} />
        <path d="M-32 -33C-12 -14 -12 14 -32 33 M32 -33C12 -14 12 14 32 33" />
      </>
    ),
  },
  {
    name: "basketball",
    rest: 1,
    art: (
      <>
        <circle r="46" className={s.ballBody} />
        <path d="M0 -46V46 M-46 0H46 M-33 -32C-17 -14 -17 14 -33 32 M33 -32C17 -14 17 14 33 32" />
      </>
    ),
  },
];

const LAST_BALL_KEY = "huddle-splash-ball";

// Random ball, never the same one as the previous load. Cached so React's
// dev-mode double effect doesn't roll twice.
let picked: number | null = null;

function pickBall() {
  if (picked !== null) return picked;
  // Preview a specific ball with ?ball=football (or soccer, tennis, basketball)
  const forced = BALLS.findIndex(
    (b) => b.name === new URLSearchParams(location.search).get("ball"),
  );
  if (forced !== -1) return (picked = forced);
  let last = -1;
  try {
    last = Number(localStorage.getItem(LAST_BALL_KEY) ?? -1);
  } catch {
    // storage blocked: any ball will do
  }
  const options = BALLS.map((_, i) => i).filter((i) => i !== last);
  picked = options[Math.floor(Math.random() * options.length)];
  try {
    localStorage.setItem(LAST_BALL_KEY, String(picked));
  } catch {
    // storage blocked: next load just picks freely
  }
  return picked;
}

export default function Splash() {
  const [leaving, setLeaving] = useState(false);
  const [done, setDone] = useState(() => played);
  const [ball, setBall] = useState(0);
  const wordRef = useRef<HTMLDivElement>(null);
  const ballXRef = useRef<HTMLDivElement>(null);
  const ballYRef = useRef<HTMLDivElement>(null);
  const ballFadeRef = useRef<HTMLDivElement>(null);
  const ballSpinRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (played) return;
    const logo = document.querySelector<HTMLElement>("[data-logo]");
    const root = document.documentElement;
    let cancelled = false;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDone(true);
      return;
    }

    root.style.overflow = "hidden";
    if (logo) logo.style.opacity = "0";

    // Chosen on the client so server and client markup match; the ball is
    // hidden until the animation starts, so the swap is never visible
    const pick = pickBall();
    setBall(pick);

    (async () => {
      await document.fonts.ready;
      await wait(START_DELAY);
      const word = wordRef.current;
      const ballX = ballXRef.current;
      const ballY = ballYRef.current;
      const ballFade = ballFadeRef.current;
      const ballSpin = ballSpinRef.current;
      if (cancelled || !word || !ballX || !ballY || !ballFade || !ballSpin) {
        return;
      }

      // Measure where each letter sits so the ball lands on it
      const letters = [...word.querySelectorAll<HTMLElement>("[data-letter]")];
      const fontSize = parseFloat(getComputedStyle(word).fontSize);
      const box = word.getBoundingClientRect();
      const xs = letters.map((l) => {
        const r = l.getBoundingClientRect();
        return r.left - box.left + r.width / 2;
      });

      const radius = fontSize * 0.18;
      // ball centre resting on the baseline
      const floor = fontSize * 0.9 - radius * BALLS[pick].rest;
      const hop = fontSize * 0.55;
      const landAt = (i: number) => ENTRY + HOP * i;
      const total = landAt(xs.length - 1);

      ballX.style.visibility = "visible";

      ballX.animate(
        [
          { transform: `translateX(${xs[0] - fontSize * 1.4}px)`, offset: 0 },
          ...xs.map((x, i) => ({
            transform: `translateX(${x}px)`,
            offset: landAt(i) / total,
          })),
        ],
        { duration: total, fill: "forwards" },
      );

      const yFrames: Keyframe[] = [
        {
          transform: `translateY(${floor - fontSize * 1.3}px)`,
          offset: 0,
          easing: EASE_IN,
        },
      ];
      xs.forEach((_, i) => {
        yFrames.push({
          transform: `translateY(${floor}px)`,
          offset: landAt(i) / total,
          easing: EASE_OUT,
        });
        if (i < xs.length - 1) {
          yFrames.push({
            transform: `translateY(${floor - hop}px)`,
            offset: (landAt(i) + HOP / 2) / total,
            easing: EASE_IN,
          });
        }
      });
      ballY.animate(yFrames, { duration: total, fill: "forwards" });

      // Half a turn per hop, so every landing is flat side down
      ballSpin.animate(
        [
          { transform: "rotate(-120deg)", offset: 0 },
          ...xs.map((_, i) => ({
            transform: `rotate(${i * 180}deg)`,
            offset: landAt(i) / total,
          })),
        ],
        { duration: total, fill: "forwards" },
      );

      // Each landing stamps a letter up out of the ground
      letters.forEach((letter, i) => {
        letter.animate(
          [
            { opacity: 0, transform: "translateY(12%) scale(0.7, 0.15)" },
            { opacity: 1, transform: "translateY(-4%) scale(0.96, 1.08)", offset: 0.55 },
            { opacity: 1, transform: "none" },
          ],
          { duration: 380, delay: landAt(i), easing: "ease-out", fill: "both" },
        );
      });

      // On the last bounce the ball becomes the period
      ballFade.animate(
        [
          { opacity: 1, transform: "scale(1)" },
          { opacity: 0, transform: "scale(0.4)" },
        ],
        { duration: 180, delay: total, easing: "ease-in", fill: "forwards" },
      );

      await wait(total + HOLD);
      if (cancelled) return;

      setLeaving(true);
      if (logo) {
        const from = word.getBoundingClientRect();
        const to = logo.getBoundingClientRect();
        const dx = to.left + to.width / 2 - (from.left + from.width / 2);
        const dy = to.top + to.height / 2 - (from.top + from.height / 2);
        const scale = to.width / from.width;
        await word.animate(
          [
            { transform: "translate(0, 0) scale(1)" },
            { transform: `translate(${dx}px, ${dy}px) scale(${scale})` },
          ],
          {
            duration: FLY_DURATION,
            easing: "cubic-bezier(0.7, 0, 0.2, 1)",
            fill: "forwards",
          },
        ).finished;
      }
      await wait(100);
      if (!cancelled) setDone(true);
    })();

    return () => {
      cancelled = true;
      root.style.overflow = "";
      if (logo) logo.style.opacity = "";
    };
  }, []);

  useEffect(() => {
    if (!done) return;
    played = true;
    document.documentElement.style.overflow = "";
    const logo = document.querySelector<HTMLElement>("[data-logo]");
    if (logo) logo.style.opacity = "";
  }, [done]);

  if (done) return null;

  return (
    <div
      className={`${s.overlay} ${leaving ? s.leaving : ""}`}
      role="status"
      aria-label="Loading Huddle"
    >
      <div ref={wordRef} className={s.word}>
        {LETTERS.map((l, i) => (
          <span
            key={i}
            data-letter
            className={`${s.letter} ${l === "." ? s.period : ""}`}
          >
            {l}
          </span>
        ))}

        <div ref={ballXRef} className={s.ballTrack} aria-hidden>
          <div ref={ballYRef}>
            <div ref={ballFadeRef}>
              <svg ref={ballSpinRef} viewBox="-50 -50 100 100" className={s.ball}>
                {BALLS[ball].art}
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
