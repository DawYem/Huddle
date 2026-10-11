"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import s from "../signup/signup.module.css";

type Bar = { name: string; address?: string; reason: string; directionsUrl: string };
type Result = { sport: { label: string }; texted: boolean; bars: Bar[] };

type State =
  | { step: "checking" }
  | { step: "ready"; sport: string }
  | { step: "locating" }
  | { step: "done"; result: Result }
  | { step: "error"; message: string };

const LOCATION_ERRORS: Record<number, string> = {
  1: "Location is off for this site. Allow it in your browser settings, or text Huddle a neighborhood instead.",
  2: "Couldn't get your location. Try again, or text Huddle a neighborhood instead.",
  3: "Getting your location took too long. Try again.",
};

export default function LocateCard() {
  const token = useSearchParams().get("t") ?? "";
  const [state, setState] = useState<State>({ step: "checking" });

  // Check the link before asking for location, so an expired link says so.
  useEffect(() => {
    if (!token) {
      setState({ step: "error", message: "This link is missing its code. Text Huddle for a new one." });
      return;
    }
    fetch(`/api/locate?t=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        setState(
          res.ok
            ? { step: "ready", sport: body.sport.label }
            : { step: "error", message: body.error ?? "This link didn't work. Text Huddle for a new one." },
        );
      })
      .catch(() => setState({ step: "error", message: "Couldn't reach Huddle. Check your connection." }));
  }, [token]);

  // Safari shows its "Allow location" prompt here, after the tap.
  const share = () => {
    if (!("geolocation" in navigator)) {
      setState({ step: "error", message: "This browser can't share location. Text Huddle a neighborhood instead." });
      return;
    }
    setState({ step: "locating" });
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          const res = await fetch("/api/locate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ t: token, lat: coords.latitude, lng: coords.longitude }),
          });
          const body = await res.json().catch(() => ({}));
          setState(
            res.ok
              ? { step: "done", result: body as Result }
              : { step: "error", message: body.error ?? "Something went wrong. Try again." },
          );
        } catch {
          setState({ step: "error", message: "Couldn't reach Huddle. Check your connection." });
        }
      },
      (err) => setState({ step: "error", message: LOCATION_ERRORS[err.code] ?? LOCATION_ERRORS[2] }),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 },
    );
  };

  if (state.step === "done") {
    const { result } = state;
    return (
      <div className={`${s.card} ${s.success}`}>
        <p className={s.eyebrow}>{result.sport.label} near you</p>
        <p className={s.body}>
          {result.texted ? "We also texted these to you in iMessage. " : ""}
          Call ahead to check they&apos;re showing your game.
        </p>
        {result.bars.length === 0 && (
          <p className={s.body}>
            No {result.sport.label.toLowerCase()} bars nearby.{" "}
            {result.texted
              ? "Check iMessage: reply YES to join a community watch event near you."
              : "Text Huddle YES to join a community watch event near you."}
          </p>
        )}
        {result.bars.map((b) => (
          <div key={b.directionsUrl} className={s.field}>
            <strong>{b.name}</strong>
            <span className={s.fine}>{b.reason}</span>
            <a href={b.directionsUrl} className={s.back}>
              Directions →
            </a>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={s.card}>
      {state.step === "error" ? (
        <p className={s.error} role="alert">
          {state.message}
        </p>
      ) : (
        <p className={s.body}>
          {state.step === "ready" ? `Find ${state.sport.toLowerCase()} spots near you.` : "One moment…"}
        </p>
      )}
      <button
        type="button"
        className={s.submit}
        onClick={share}
        disabled={state.step !== "ready" && state.step !== "error"}
      >
        {state.step === "locating" ? "Finding spots…" : "Share my location"}
      </button>
      <p className={s.fine}>Your browser will ask to allow location. Tap Allow.</p>
    </div>
  );
}
