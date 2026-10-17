import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { api, ApiError, type Conflict, type Slot } from "../api";
import { useSupport, useSupportActions } from "../app/support";
import { StepPage } from "../components/StepPage";
import { dayKey, formatDay, formatLongDay, formatTime } from "../features/format";
import { t } from "../i18n";

type VisitFilter = "in_person" | "telehealth" | "any";
const FILTERS: [VisitFilter, string][] = [
  ["in_person", t("form.inPerson")],
  ["telehealth", t("form.telehealth")],
  ["any", t("form.noPreference")],
];
const MAX_DAYS = 7;

export default function Book() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const support = useSupport();
  const intake = useQuery({ queryKey: ["intake"], queryFn: api.intake, retry: false });
  const preference = intake.data?.assessment?.visit_type_preference as VisitFilter | undefined;
  const [filter, setFilter] = useState<VisitFilter | null>(null);
  const visit = filter ?? (preference === "in_person" || preference === "telehealth" ? preference : "any");
  const slots = useQuery({ queryKey: ["slots", visit], queryFn: () => api.slots(visit === "any" ? undefined : visit) });
  const mine = useQuery({ queryKey: ["bookings"], queryFn: api.myBookings });
  const [day, setDay] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [conflict, setConflict] = useState<{ time: string; takenId: number; alternatives: number[] } | null>(null);
  const [conflicts, setConflicts] = useState(0);
  const [noChoice, setNoChoice] = useState(false);
  const message = useRef<HTMLDivElement>(null);

  const byDay = useMemo(() => {
    const groups = new Map<string, Slot[]>();
    for (const s of slots.data ?? []) {
      const k = dayKey(s.starts_at);
      groups.set(k, [...(groups.get(k) ?? []), s]);
    }
    return [...groups.entries()].slice(0, MAX_DAYS);
  }, [slots.data]);
  const activeDay = day && byDay.some(([k]) => k === day) ? day : (byDay[0]?.[0] ?? null);
  const daySlots = byDay.find(([k]) => k === activeDay)?.[1] ?? [];

  const book = useMutation({
    mutationFn: (slotId: number) => api.book(slotId),
    onSuccess: async () => {
      await Promise.all(["progress", "bookings", "slots"].map((k) => queryClient.invalidateQueries({ queryKey: [k] })));
      navigate("/done");
    },
    onError: async (e, slotId) => {
      if (!(e instanceof ApiError) || e.status !== 409) return;
      const body = e.body as Conflict;
      const taken = slots.data?.find((s) => s.id === slotId);
      const alternatives = body.alternatives.map((a) => a.id);
      setConflict({ time: taken ? formatTime(taken.starts_at) : "", takenId: slotId, alternatives });
      setSelected(null);
      if (body.alternatives[0]) setDay(dayKey(body.alternatives[0].starts_at));
      const count = conflicts + 1;
      setConflicts(count);
      await queryClient.invalidateQueries({ queryKey: ["slots"] });
      requestAnimationFrame(() => message.current?.focus());
      if (count >= 2) void support.show({ booking_conflicts: count });
    },
  });

  useSupportActions((action) => action === "See other times");

  const current = mine.data?.[0];

  return (
    <StepPage
      title={t("book.title")}
      step={5}
      back="/details/confirm"
      lead={<p className="muted">{t("book.visit", { minutes: daySlots[0]?.duration_minutes ?? 40, address: t("clinic.address") })}</p>}
    >
      {current && (
        <p className="card">
          {t("book.current", { when: `${formatLongDay(current.slot.starts_at)}, ${formatTime(current.slot.starts_at)}` })}
        </p>
      )}
      <fieldset className="field">
        <legend>{t("book.visitType")}</legend>
        <div className="chips">
          {FILTERS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className="chip"
              aria-pressed={visit === value}
              onClick={() => {
                setFilter(value);
                setSelected(null);
                setConflict(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>
      {slots.isPending && <p aria-live="polite">{t("common.loading")}</p>}
      {slots.isError && (
        <p role="alert">
          {t("error.generic")}{" "}
          <button type="button" className="btn btn--link" onClick={() => void slots.refetch()}>
            {t("common.tryAgain")}
          </button>
        </p>
      )}
      {slots.isSuccess && byDay.length === 0 && <p>{t("book.noneAtAll")}</p>}
      {conflict && (
        <div ref={message} tabIndex={-1} className="error-summary" role="alert">
          <p>
            <strong>{t("book.taken", { time: conflict.time })}</strong>
          </p>
          <p>{t("book.takenAlternatives")}</p>
        </div>
      )}
      {byDay.length > 0 && (
        <>
          <fieldset className="field">
            <legend>{t("book.day")}</legend>
            <div className="chips">
              {byDay.map(([k, list]) => (
                <button
                  key={k}
                  type="button"
                  className="chip"
                  aria-pressed={k === activeDay}
                  onClick={() => {
                    setDay(k);
                    setSelected(null);
                  }}
                >
                  {formatDay(list[0].starts_at)}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="field">
            <legend>{t("book.times", { day: daySlots[0] ? formatLongDay(daySlots[0].starts_at) : "" })}</legend>
            {daySlots.length === 0 && <p>{t("book.none")}</p>}
            <div className="chips times">
              {daySlots.map((s) => {
                const highlighted = conflict?.alternatives.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={`chip ${highlighted ? "chip--highlight" : ""}`}
                    aria-pressed={selected === s.id}
                    aria-describedby={highlighted ? "closest-note" : undefined}
                    onClick={() => {
                      setSelected(s.id);
                      setNoChoice(false);
                    }}
                  >
                    {formatTime(s.starts_at)}
                    <span className="visually-hidden">
                      {" "}
                      {s.visit_type === "telehealth" ? t("form.telehealth") : t("form.inPerson")}, {t("book.with", { clinician: s.clinician_label })}
                    </span>
                  </button>
                );
              })}
            </div>
            {conflict && (
              <span id="closest-note" className="visually-hidden">
                {t("book.takenAlternatives")}
              </span>
            )}
          </fieldset>
          {noChoice && (
            <p className="error-text" role="alert">
              {t("book.chooseTime")}
            </p>
          )}
          <button
            type="button"
            className="btn btn--block"
            disabled={book.isPending}
            onClick={() => (selected ? book.mutate(selected) : setNoChoice(true))}
          >
            {book.isPending ? t("book.booking") : t("book.book")}
          </button>
          {book.isError && !(book.error instanceof ApiError && book.error.status === 409) && <p role="alert">{book.error.message}</p>}
        </>
      )}
    </StepPage>
  );
}
