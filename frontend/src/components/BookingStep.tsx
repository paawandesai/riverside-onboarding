import { useCallback, useEffect, useState } from "react";
import { api, ApiError, track, type Booking, type Slot } from "../api";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function BookingStep({ onConflict }: { onConflict: () => void }) {
  const [visitType, setVisitType] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      Promise.all([api.slots(visitType || undefined), api.myBookings()]).then(
        ([open, mine]) => {
          setSlots(open);
          setBooking(mine[0] ?? null);
        },
        () => setError("We couldn't load open times. Please refresh."),
      ),
    [visitType],
  );

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.slots(visitType || undefined), api.myBookings()]).then(
      ([open, mine]) => {
        if (cancelled) return;
        setSlots(open);
        setBooking(mine[0] ?? null);
      },
      () => !cancelled && setError("We couldn't load open times. Please refresh."),
    );
    return () => {
      cancelled = true;
    };
  }, [visitType]);

  async function book(slot: Slot) {
    setError(null);
    try {
      const b = await api.book(slot.id);
      setBooking(b);
      setMessage(`Booked. Your confirmation code is ${b.confirmation_code}.`);
      track("booking", "booked");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        onConflict();
        track("booking", "conflict");
      }
      setError(err instanceof ApiError ? err.message : "Booking failed. Please try again.");
    }
    await load();
  }

  async function cancel() {
    if (!booking) return;
    await api.cancelBooking(booking.id);
    setBooking(null);
    setMessage("Your appointment was cancelled.");
    track("booking", "cancelled");
    await load();
  }

  return (
    <section aria-labelledby="booking-title">
      <h1 id="booking-title">Choose a time</h1>
      {booking && (
        <div className="confirmation" role="status">
          <h2>
            <span aria-hidden="true">✅ </span>Your appointment
          </h2>
          <p>
            {fmt(booking.slot.starts_at)}, {booking.slot.visit_type === "telehealth" ? "Telehealth" : "In person"} with {booking.slot.clinician_label}
          </p>
          <p>
            Confirmation code: <strong>{booking.confirmation_code}</strong>
          </p>
          <button type="button" className="secondary" onClick={cancel}>
            Cancel appointment
          </button>
          <p className="hint">To reschedule, pick a new time below. Your current appointment is replaced.</p>
        </div>
      )}
      <p aria-live="polite" className="status">
        {message}
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <label htmlFor="filter">Visit type</label>
      <select id="filter" value={visitType} onChange={(e) => setVisitType(e.target.value)}>
        <option value="">Any</option>
        <option value="in_person">In person</option>
        <option value="telehealth">Telehealth</option>
      </select>
      <ul className="slots">
        {slots.slice(0, 12).map((s) => (
          <li key={s.id}>
            <button type="button" className="slot" onClick={() => book(s)}>
              {fmt(s.starts_at)} · {s.visit_type === "telehealth" ? "Telehealth" : "In person"} · {s.clinician_label}
            </button>
          </li>
        ))}
      </ul>
      {slots.length === 0 && <p>No open times right now. Please check back later.</p>}
    </section>
  );
}
