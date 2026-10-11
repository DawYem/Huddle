import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import s from "../signup/signup.module.css";
import HostForm from "./HostForm";

export const metadata: Metadata = {
  title: "List your venue — Huddle",
  description: "Host a community watch event and fans nearby can join you.",
};

export default function HostPage() {
  return (
    <div className={s.page}>
      <header className={s.nav}>
        <Link href="/" className={s.logo}>
          HUDDLE<span className={s.yellow}>.</span>
        </Link>
      </header>
      <main className={s.main}>
        <section className={s.intro}>
          <p className={s.eyebrow}>List your venue</p>
          <h1 className={s.title}>
            Host the <span className={s.yellow}>watch party.</span>
          </h1>
          <p className={s.body}>
            Tell fans where and when. Anyone nearby waiting for a watch party
            gets a text from Huddle and can join you.
          </p>
          <ul className={s.points}>
            <li>
              <span>01</span> Public places only: bars, restaurants, fan clubs.
            </li>
            <li>
              <span>02</span> Never a private home.
            </li>
          </ul>
        </section>
        <Suspense fallback={<div className={s.card} />}>
          <HostForm />
        </Suspense>
      </main>
    </div>
  );
}
