"use client";

import { useState } from "react";
import Link from "next/link";
import s from "./signup.module.css";

type Fields = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
};

type Errors = Partial<Record<keyof Fields, string>>;

const EMPTY: Fields = { firstName: "", lastName: "", phone: "", email: "" };

// What POST /api/fans returns. The site proxies /api to the server (next.config.ts).
type SignupResult = {
  textedHuddle: boolean;
  huddleNumber: string | null;
};

// "+16282647648" -> "(628) 264-7648"; other countries stay in + format.
function displayNumber(e164: string): string {
  const us = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return us ? `(${us[1]}) ${us[2]}-${us[3]}` : e164;
}

const FIRST_TEXT = "Hi Huddle";

// Opens Messages to the fan's Huddle number with the first text ready to send.
// iPhone and Mac read the body after "&"; Android after "?".
function smsLink(number: string): string {
  const apple = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
  return `sms:${number}${apple ? "&" : "?"}body=${encodeURIComponent(FIRST_TEXT)}`;
}

function validate(f: Fields): Errors {
  const errors: Errors = {};
  if (!f.firstName.trim()) errors.firstName = "Enter your first name.";
  if (!f.lastName.trim()) errors.lastName = "Enter your last name.";
  const digits = f.phone.replace(/\D/g, "");
  if (!digits) errors.phone = "Enter your phone number.";
  else if (digits.length < 10 || digits.length > 15)
    errors.phone = "Enter a valid phone number.";
  if (!f.email.trim()) errors.email = "Enter your email.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim()))
    errors.email = "Enter a valid email.";
  return errors;
}

export default function SignupForm() {
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<SignupResult | null>(null);

  const update =
    (key: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement>) => {
      setFields((f) => ({ ...f, [key]: e.target.value }));
      if (errors[key]) setErrors((err) => ({ ...err, [key]: undefined }));
    };

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const found = validate(fields);
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/fans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setResult(body as SignupResult);
      } else if (res.status === 400 && body.fields) {
        // The server's checks are stricter (e.g. it needs a dialable number).
        setErrors(body.fields as Errors);
      } else if (res.status === 429) {
        setFormError("Too many tries. Wait a minute and try again.");
      } else {
        setFormError("Something went wrong on our end. Try again in a moment.");
      }
    } catch {
      setFormError("Couldn't reach Huddle. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    const smsHref = result.huddleNumber ? smsLink(result.huddleNumber) : null;
    return (
      <div className={`${s.card} ${s.success}`}>
        <p className={s.eyebrow}>You&apos;re in</p>
        <h2 className={s.successTitle}>
          Welcome to the team, {fields.firstName.trim()}.
        </h2>
        {result.textedHuddle ? (
          <p className={s.body}>
            Watch your texts. Your first invite lands before the next kickoff.
          </p>
        ) : (
          <p className={s.body}>
            One last step: text Huddle from this phone
            {result.huddleNumber ? ` at ${displayNumber(result.huddleNumber)}` : ""}. Huddle
            only texts people who texted it first, so say hi and we&apos;ll
            take it from there.
          </p>
        )}
        {smsHref && !result.textedHuddle ? (
          <a href={smsHref} className={s.submit}>
            Text Huddle
          </a>
        ) : (
          <Link href="/" className={s.submit}>
            Back to home
          </Link>
        )}
      </div>
    );
  }

  const field = (
    key: keyof Fields,
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement>,
  ) => (
    <div className={s.field}>
      <label htmlFor={key}>{label}</label>
      <input
        id={key}
        name={key}
        value={fields[key]}
        onChange={update(key)}
        aria-invalid={!!errors[key]}
        aria-describedby={errors[key] ? `${key}-error` : undefined}
        className={errors[key] ? s.invalid : undefined}
        {...props}
      />
      {errors[key] && (
        <span id={`${key}-error`} className={s.error}>
          {errors[key]}
        </span>
      )}
    </div>
  );

  return (
    <form className={s.card} onSubmit={onSubmit} noValidate>
      <div className={s.row}>
        {field("firstName", "First name", { autoComplete: "given-name" })}
        {field("lastName", "Last name", { autoComplete: "family-name" })}
      </div>
      {field("phone", "Phone number", {
        type: "tel",
        autoComplete: "tel",
        inputMode: "tel",
        placeholder: "(404) 555-0123",
      })}
      {field("email", "Email", {
        type: "email",
        autoComplete: "email",
        placeholder: "you@example.com",
      })}

      {formError && (
        <p className={s.error} role="alert">
          {formError}
        </p>
      )}
      <button type="submit" className={s.submit} disabled={submitting}>
        {submitting ? "Signing up…" : "Sign up"}
      </button>
      <p className={s.fine}>
        By signing up you agree to get texts from Huddle about games near you.
        Text &ldquo;stop&rdquo; anytime.
      </p>
    </form>
  );
}
