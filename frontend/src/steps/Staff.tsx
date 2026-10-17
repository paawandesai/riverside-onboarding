import { useQuery } from "@tanstack/react-query";
import { CircleCheck, CircleDashed } from "lucide-react";
import { Link, Navigate, Outlet, useParams } from "react-router";
import { api, ApiError, type FieldSource, type ScheduleItem } from "../api";
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
