import type { Metadata } from "next";
import Link from "next/link";
import SignupForm from "./SignupForm";
import s from "./signup.module.css";

export const metadata: Metadata = {
  title: "Sign up — Huddle",
  description: "Get in the game. Huddle texts you before your team plays.",
};

export default function SignupPage() {
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
        <section className={s.intro}>
          <p className={s.eyebrow}>Sign up</p>
          <h1 className={s.title}>
            Get in the <span className={s.yellow}>game.</span>
          </h1>
          <p className={s.body}>
            Drop your details and Huddle will text you before your team&apos;s
            next match, with a seat saved and a crew waiting.
          </p>
          <ul className={s.points}>
            <li>
              <span>01</span> No app. Everything happens in iMessage.
            </li>
            <li>
              <span>02</span> Free for fans, always.
            </li>
            <li>
              <span>03</span> Text &ldquo;stop&rdquo; anytime to tap out.
            </li>
          </ul>
        </section>

        <SignupForm />
      </main>
    </div>
  );
}
