import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import s from "../signup/signup.module.css";
import LocateCard from "./LocateCard";

export const metadata: Metadata = {
  title: "Find a spot — Huddle",
  description: "Share your location and Huddle texts you sports bars nearby.",
};

export default function LocatePage() {
  return (
    <div className={s.page}>
      <header className={s.nav}>
        <Link href="/" className={s.logo}>
          HUDDLE<span className={s.yellow}>.</span>
        </Link>
      </header>
      <main className={s.main}>
        <section className={s.intro}>
          <p className={s.eyebrow}>Find a spot</p>
          <h1 className={s.title}>
            Where are you <span className={s.yellow}>watching?</span>
          </h1>
          <p className={s.body}>
            Share your location once and Huddle texts you sports bars nearby.
            Your location is only used for this search.
          </p>
        </section>
        <Suspense fallback={<div className={s.card} />}>
          <LocateCard />
        </Suspense>
      </main>
    </div>
  );
}
