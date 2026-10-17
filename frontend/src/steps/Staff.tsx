import { useQuery } from "@tanstack/react-query";
import { CircleCheck, CircleDashed, FlaskConical } from "lucide-react";
import { useState } from "react";
import { Link, Navigate, Outlet, useParams } from "react-router";
import { type Analytics, api, ApiError, type FieldSource, type ScheduleItem } from "../api";
import { StepPage } from "../components/StepPage";
import { formatLongDay, formatTime } from "../features/format";
import { t } from "../i18n";

/** Staff pages need a staff session; patients are sent back to their own flow. */
export function RequireStaff() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, retry: false });
  if (me.isPending) return <p aria-live="polite">{t("common.loading")}</p>;
  if (me.error instanceof ApiError && me.error.status === 401) return <Navigate to="/account?mode=signin" replace />;
  if (me.data?.role !== "staff") return <p role="alert">{t("staff.onlyStaff")}</p>;
  return <Outlet />;
}

function Status({ done, yes, no }: { done: boolean; yes: string; no: string }) {
  return (
    <span className={done ? "tag" : "tag tag--missing"}>
      {done ? <CircleCheck aria-hidden="true" size={16} /> : <CircleDashed aria-hidden="true" size={16} />} {done ? yes : no}
    </span>
  );
}

function SampleTag() {
  return (
    <span className="tag tag--sample">
      <FlaskConical aria-hidden="true" size={16} /> {t("staff.sample")}
    </span>
  );
}

function visitLine(item: ScheduleItem) {
  const type = item.slot.visit_type === "telehealth" ? t("form.telehealth") : t("form.inPerson");
  return `${formatTime(item.slot.starts_at)} · ${type}, ${item.slot.duration_minutes} min · ${item.slot.clinician_label}`;
}

export function StaffSchedule() {
  const schedule = useQuery({ queryKey: ["staff", "schedule"], queryFn: api.staffSchedule });
  if (schedule.isPending) return <p aria-live="polite">{t("common.loading")}</p>;
  if (schedule.isError) return <p role="alert">{t("error.generic")}</p>;

  const days = new Map<string, ScheduleItem[]>();
  for (const item of schedule.data) {
    const day = formatLongDay(item.slot.starts_at);
    days.set(day, [...(days.get(day) ?? []), item]);
  }

  return (
    <StepPage title={t("staff.title")} lead={<p className="muted">{t("staff.lead")}</p>}>
      {days.size === 0 && <p>{t("staff.none")}</p>}
      {[...days].map(([day, items]) => (
        <section key={day} className="stack" aria-labelledby={`day-${items[0].slot.id}`}>
          <h2 id={`day-${items[0].slot.id}`}>{day}</h2>
          <ul className="staff-list">
            {items.map((item) => (
              <li key={item.confirmation_code} className="card stack">
                <p className="lead">
                  <strong>{item.full_name ?? t("staff.noName")}</strong>
                </p>
                {item.sample && <SampleTag />}
                <p>{visitLine(item)}</p>
                <div className="row">
                  <Status done={item.identity_confirmed} yes={t("staff.detailsReady")} no={t("staff.detailsMissing")} />
                  <Status done={item.assessment_confirmed} yes={t("staff.answersReady")} no={t("staff.answersMissing")} />
                </div>
                <Link to={`/staff/patients/${encodeURIComponent(item.patient_id)}`} className="btn btn--secondary">
                  {t("staff.open")}
                  <span className="visually-hidden">: {item.full_name ?? item.confirmation_code}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </StepPage>
  );
}

const ANSWER_LABELS = [
  ["reason_for_visit", "form.reason"],
  ["symptom_duration", "form.duration"],
  ["visit_type_preference", "form.visitType"],
  ["accessibility_needs", "form.access"],
] as const;

const VISIT_TYPE_LABELS: Record<string, Parameters<typeof t>[0]> = {
  in_person: "form.inPerson",
  telehealth: "form.telehealth",
  no_preference: "form.noPreference",
};

function Source({ source }: { source?: FieldSource }) {
  return source ? <span className="tag">{t(`staff.source.${source}`)}</span> : null;
}

export function StaffIntake() {
  const { patientId = "" } = useParams();
  const intake = useQuery({ queryKey: ["staff", "intake", patientId], queryFn: () => api.staffIntake(patientId), retry: false });
  const back = (
    <Link to="/staff" className="btn btn--link back-link">
      {t("staff.back")}
    </Link>
  );
  if (intake.isPending) return <p aria-live="polite">{t("common.loading")}</p>;
  if (intake.error instanceof ApiError && intake.error.status === 404)
    return (
      <StepPage title={t("staff.patient")}>
        <p>{t("staff.noIntake")}</p>
        {back}
      </StepPage>
    );
  if (intake.isError) return <p role="alert">{t("error.generic")}</p>;

  const data = intake.data;
  const sources = data.field_sources as Partial<Record<"full_name" | "dob" | "address", FieldSource>>;
  return (
    <StepPage title={data.full_name ?? t("staff.patient")}>
      {back}
      {data.sample && <p className="muted">{t("staff.sampleNote")}</p>}
      {data.booking && (
        <section className="card stack" aria-labelledby="staff-visit">
          <h2 id="staff-visit">{t("staff.visit")}</h2>
          <p>
            <strong>{formatLongDay(data.booking.slot.starts_at)}</strong>, {visitLine(data.booking)}
          </p>
          <p className="muted">{t("done.code", { code: data.booking.confirmation_code })}</p>
        </section>
      )}
      <section className="card stack" aria-labelledby="staff-details">
        <h2 id="staff-details">{t("staff.patient")}</h2>
        <dl className="staff-fields">
          <dt>{t("confirm.name")}</dt>
          <dd>
            {data.full_name ?? t("staff.notProvided")} <Source source={sources.full_name} />
          </dd>
          <dt>{t("staff.dob")}</dt>
          <dd>
            {data.dob ?? t("staff.notProvided")} <Source source={sources.dob} />
          </dd>
          <dt>{t("staff.address")}</dt>
          <dd>
            {data.address ?? t("staff.notProvided")} <Source source={sources.address} />
          </dd>
        </dl>
      </section>
      <section className="card stack" aria-labelledby="staff-answers">
        <h2 id="staff-answers">
          {t("staff.answers")} <span className="ai-badge">{t("chat.aiLabel")}</span>
        </h2>
        <p className="muted small">{t("staff.aiNote")}</p>
        <dl className="staff-fields">
          {ANSWER_LABELS.map(([key, label]) => {
            const value = data.assessment?.[key];
            const shown = key === "visit_type_preference" && value ? t(VISIT_TYPE_LABELS[value] ?? "staff.notProvided") : value;
            return [<dt key={`${key}-t`}>{t(label)}</dt>, <dd key={`${key}-d`}>{shown || t("staff.notProvided")}</dd>];
          })}
        </dl>
      </section>
    </StepPage>
  );
}

const PERIODS = [1, 7, 30] as const;
const STEP_LABELS: Record<string, Parameters<typeof t>[0]> = {
  start: "analytics.step.start",
  account: "analytics.step.account",
  consent: "analytics.step.consent",
  chat: "analytics.step.chat",
  details: "analytics.step.details",
  confirm: "analytics.step.confirm",
  book: "analytics.step.book",
  done: "analytics.step.done",
};
const FIELD_LABELS: Record<string, Parameters<typeof t>[0]> = {
  full_name: "analytics.field.full_name",
  dob: "analytics.field.dob",
  address: "analytics.field.address",
};

const percent = (value: number | null | undefined) => (value == null ? t("analytics.none") : `${Math.round(value * 100)}%`);

function duration(seconds: number | null | undefined) {
  if (seconds == null) return t("analytics.none");
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s ? `${m} min ${s} s` : `${m} min`;
}

function Funnel({ data }: { data: Analytics }) {
  return (
    <section className="card stack" aria-labelledby="funnel-heading">
      <h2 id="funnel-heading">{t("analytics.funnel")}</h2>
      <p className="muted small">{t("analytics.funnelNote")}</p>
      {/* Scrolls sideways on narrow screens; focusable so keyboard users can scroll it too (WCAG 2.1.1). */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div className="table-scroll" role="region" aria-label={t("analytics.funnelTable")} tabIndex={0}>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">{t("analytics.step")}</th>
              <th scope="col">{t("analytics.reached")}</th>
              <th scope="col">{t("analytics.ofStart")}</th>
              <th scope="col">{t("analytics.dropOff")}</th>
              <th scope="col">{t("analytics.time")}</th>
            </tr>
          </thead>
          <tbody>
            {data.funnel.map((row) => (
              <tr key={row.step}>
                <th scope="row">{t(STEP_LABELS[row.step] ?? "analytics.none")}</th>
                <td>{row.sessions}</td>
                <td>
                  <span className="meter-cell">
                    <meter min={0} max={1} value={row.share_of_start ?? 0} aria-hidden="true" />
                    {percent(row.share_of_start)}
                  </span>
                </td>
                <td>{percent(row.drop_off)}</td>
                <td>{duration(row.median_seconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">{t("analytics.timeNote")}</p>
    </section>
  );
}

function Ocr({ data }: { data: Analytics }) {
  return (
    <section className="card stack" aria-labelledby="ocr-heading">
      <h2 id="ocr-heading">{t("analytics.ocr")}</h2>
      <p className="muted small">{t("analytics.ocrNote", { count: data.ocr_records })}</p>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div className="table-scroll" role="region" aria-label={t("analytics.ocrTable")} tabIndex={0}>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">{t("analytics.field")}</th>
              <th scope="col">{t("analytics.confirmed")}</th>
              <th scope="col">{t("analytics.corrected")}</th>
              <th scope="col">{t("analytics.typed")}</th>
              <th scope="col">{t("analytics.rate")}</th>
            </tr>
          </thead>
          <tbody>
            {data.ocr.map((row) => (
              <tr key={row.field}>
                <th scope="row">{t(FIELD_LABELS[row.field] ?? "analytics.none")}</th>
                <td>{row.confirmed}</td>
                <td>{row.corrected}</td>
                <td>{row.typed}</td>
                <td>{percent(row.correction_rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function StaffAnalytics() {
  const [days, setDays] = useState<number>(7);
  const analytics = useQuery({ queryKey: ["staff", "analytics", days], queryFn: () => api.staffAnalytics(days) });
  const support = Object.entries(analytics.data?.support_shown ?? {});
  return (
    <StepPage title={t("analytics.title")} lead={<p className="muted">{t("analytics.lead")}</p>}>
      <div className="row" role="group" aria-label={t("analytics.window")}>
        {PERIODS.map((p) => (
          <button key={p} type="button" className="chip" aria-pressed={days === p} onClick={() => setDays(p)}>
            {t("analytics.days", { days: p })}
          </button>
        ))}
      </div>
      <p className="muted small">{t("analytics.demoRetention")}</p>
      {analytics.isPending && <p aria-live="polite">{t("common.loading")}</p>}
      {analytics.isError && <p role="alert">{t("error.generic")}</p>}
      {analytics.data && (
        <>
          <p>{t("analytics.sessions", { count: analytics.data.sessions, date: formatLongDay(analytics.data.since) })}</p>
          <Funnel data={analytics.data} />
          <Ocr data={analytics.data} />
          <section className="card stack" aria-labelledby="support-heading">
            <h2 id="support-heading">{t("analytics.support")}</h2>
            {support.length === 0 ? (
              <p>{t("analytics.supportNone")}</p>
            ) : (
              <ul>
                {support.map(([trigger, count]) => (
                  <li key={trigger}>
                    {trigger.replaceAll("_", " ")}: {count}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </StepPage>
  );
}
