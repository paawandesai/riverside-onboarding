import { useQuery } from "@tanstack/react-query";
import { CalendarPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import { StepPage } from "../components/StepPage";
import { formatLongDay, formatTime } from "../features/format";
import { bookingIcs } from "../features/ics";
import { t } from "../i18n";

export function Done() {
  const bookings = useQuery({
    queryKey: ["bookings"],
    queryFn: api.myBookings,
  });
  const intake = useQuery({
    queryKey: ["intake"],
    queryFn: api.intake,
    retry: false,
  });
  const booking = bookings.data?.[0];
  const [icsUrl, setIcsUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!booking) return;
    const url = URL.createObjectURL(
      new Blob([bookingIcs(booking, t("clinic.name"), t("clinic.address"))], {
        type: "text/calendar",
      }),
    );
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the object URL must be created and revoked with the booking
    setIcsUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [booking]);

  if (bookings.isPending) return <p aria-live="polite">{t("common.loading")}</p>;
  if (!booking)
    return (
      <StepPage title={t("book.title")}>
        <Link to="/book" className="btn">
          {t("book.title")}
        </Link>
      </StepPage>
    );

  // The summary's first line is its "non-binding" header, shown separately below as the AI note.
  const summaryLines = (intake.data?.assessment_summary?.split("\n") ?? []).filter((l) => l.includes(":"));

  return (
    <StepPage title={t("done.title")}>
      <div className="card stack">
        <p className="lead">
          <strong>
            {formatLongDay(booking.slot.starts_at)} · {formatTime(booking.slot.starts_at)}
          </strong>
        </p>
        <p>
          {booking.slot.visit_type === "telehealth" ? t("form.telehealth") : t("form.inPerson")}, {booking.slot.duration_minutes} min ·{" "}
          {t("book.with", { clinician: booking.slot.clinician_label })}
        </p>
        <p>{t("clinic.address")}</p>
        <p className="muted">{t("done.code", { code: booking.confirmation_code })}</p>
        <div className="row">
          {icsUrl && (
            <a className="btn btn--secondary" href={icsUrl} download="maple-grove-visit.ics">
              <CalendarPlus aria-hidden="true" size={20} /> {t("done.calendar")}
            </a>
          )}
          <Link to="/book" className="btn btn--link">
            {t("done.change")}
          </Link>
        </div>
      </div>
      <section className="stack" aria-labelledby="bring-title">
        <h2 id="bring-title">{t("done.bring")}</h2>
        <ul>
          <li>{t("done.bring1")}</li>
          <li>{t("done.bring2")}</li>
          <li>{t("done.bring3")}</li>
        </ul>
      </section>
      {summaryLines.length > 0 && (
        <section className="card stack" aria-labelledby="told-title">
          <h2 id="told-title">
            {t("done.told")} <span className="ai-badge">{t("chat.aiLabel")}</span>
          </h2>
          <ul>
            {summaryLines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
          <p className="muted small">{t("done.aiNote")}</p>
        </section>
      )}
      <Link to="/privacy" className="btn btn--secondary">
        {t("done.manage")}
      </Link>
      <p className="muted small">{t("done.photo")}</p>
    </StepPage>
  );
}
