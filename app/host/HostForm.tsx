"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import s from "../signup/signup.module.css";

const SPORTS = [
  { id: "basketball", label: "Basketball" },
  { id: "football", label: "Football" },
  { id: "soccer", label: "Soccer" },
  { id: "baseball", label: "Baseball" },
  { id: "hockey", label: "Hockey" },
];

type Fields = { hostName: string; venueName: string; address: string; sport: string; startsAt: string };
type Errors = Partial<Record<keyof Fields, string>>;
type Created = { event: { venueName: string; address: string }; notified: number };

export default function HostForm() {
  const token = useSearchParams().get("t") ?? "";
  const [fields, setFields] = useState<Fields>({ hostName: "", venueName: "", address: "", sport: "soccer", startsAt: "" });
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);

  // A link from iMessage pre-selects the sport the fan was looking for.
  useEffect(() => {
    if (!token) return;
    fetch(`/api/events/host?t=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (res.ok) setFields((f) => ({ ...f, sport: body.sport.id }));
        else setFormError(body.error ?? "This link didn't work. You can still list your venue.");
      })
      .catch(() => undefined);
  }, [token]);

  const set = (key: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFields((f) => ({ ...f, [key]: e.target.value }));
    if (errors[key]) setErrors((err) => ({ ...err, [key]: undefined }));
  };

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...fields,
          // <input type="datetime-local"> is local time; send it with the offset.
          startsAt: fields.startsAt ? new Date(fields.startsAt).toISOString() : "",
          ...(token ? { t: token } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setCreated(body as Created);
      else if (res.status === 400 && body.fields) setErrors(body.fields as Errors);
      else setFormError(body.error ?? "Something went wrong on our end. Try again in a moment.");
    } catch {
      setFormError("Couldn't reach Huddle. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (created) {
    return (
      <div className={`${s.card} ${s.success}`}>
        <p className={s.eyebrow}>You&apos;re hosting</p>
        <h2 className={s.successTitle}>{created.event.venueName} is live.</h2>
        <p className={s.body}>
          {created.event.address}.{" "}
          {created.notified
            ? `We just texted ${created.notified} fan${created.notified === 1 ? "" : "s"} waiting nearby.`
            : "Fans nearby who ask Huddle for a watch party will see it."}
        </p>
        <Link href="/" className={s.submit}>
          Back to home
        </Link>
      </div>
    );
  }

  const input = (key: keyof Fields, label: string, props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <div className={s.field}>
      <label htmlFor={key}>{label}</label>
      <input
        id={key}
        value={fields[key]}
        onChange={set(key)}
        aria-invalid={!!errors[key]}
        className={errors[key] ? s.invalid : undefined}
        {...props}
      />
      {errors[key] && <span className={s.error}>{errors[key]}</span>}
    </div>
  );

  return (
    <form className={s.card} onSubmit={onSubmit} noValidate>
      {input("hostName", "Your name", { autoComplete: "name" })}
      {input("venueName", "Venue", { placeholder: "e.g. Smithfield Hall" })}
      {input("address", "Venue address", { placeholder: "138 W 25th St, New York", autoComplete: "street-address" })}
      <div className={s.field}>
        <label htmlFor="sport">Sport</label>
        <select id="sport" value={fields.sport} onChange={set("sport")} className={s.select}>
          {SPORTS.map((sp) => (
            <option key={sp.id} value={sp.id}>
              {sp.label}
            </option>
          ))}
        </select>
        {errors.sport && <span className={s.error}>{errors.sport}</span>}
      </div>
      {input("startsAt", "Date and time", { type: "datetime-local" })}
      {formError && (
        <p className={s.error} role="alert">
          {formError}
        </p>
      )}
      <button type="submit" className={s.submit} disabled={submitting}>
        {submitting ? "Listing…" : "List my venue"}
      </button>
    </form>
  );
}
