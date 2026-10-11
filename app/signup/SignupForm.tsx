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
  const [submitted, setSubmitted] = useState(false);

  const update =
    (key: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement>) => {
      setFields((f) => ({ ...f, [key]: e.target.value }));
      if (errors[key]) setErrors((err) => ({ ...err, [key]: undefined }));
    };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const found = validate(fields);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    // TODO: send `fields` to the backend signup endpoint once it's ready
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className={`${s.card} ${s.success}`}>
        <p className={s.eyebrow}>You&apos;re in</p>
        <h2 className={s.successTitle}>
          Welcome to the team, {fields.firstName.trim()}.
        </h2>
        <p className={s.body}>
          Watch your texts. Your first invite lands before the next kickoff.
        </p>
        <Link href="/" className={s.submit}>
          Back to home
        </Link>
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

      <button type="submit" className={s.submit}>
        Sign up
      </button>
      <p className={s.fine}>
        By signing up you agree to get texts from Huddle about games near you.
        Text &ldquo;stop&rdquo; anytime.
      </p>
    </form>
  );
}
