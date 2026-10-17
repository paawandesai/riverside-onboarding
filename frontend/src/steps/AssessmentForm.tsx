import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import type { AssessmentFields } from "../api";
import { ErrorSummary, FieldError } from "../components/Fields";
import { t } from "../i18n";

const schema = z.object({
  reason_for_visit: z.string().trim().min(2, { error: t("form.reasonError") }).max(300),
  symptom_duration: z.string().trim().max(300),
  visit_type_preference: z.enum(["in_person", "telehealth", "no_preference"]),
  accessibility_needs: z.string().trim().max(300),
});
export type AssessmentValues = z.infer<typeof schema>;

type Props = { initial: AssessmentFields; onSubmit: (v: AssessmentValues) => Promise<void>; busy?: boolean };

/** The form path: a first-class alternative to chat, and the fallback when the assistant is down. */
export function AssessmentForm({ initial, onSubmit, busy }: Props) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AssessmentValues>({
    resolver: zodResolver(schema),
    // Anything already said in the chat carries over, so nobody types it twice.
    defaultValues: {
      reason_for_visit: initial.reason_for_visit ?? "",
      symptom_duration: initial.symptom_duration ?? "",
      visit_type_preference: initial.visit_type_preference ?? "no_preference",
      accessibility_needs: initial.accessibility_needs ?? "",
    },
  });
  const summary = Object.entries(errors).map(([field, e]) => ({ field, message: e?.message ?? "" }));
  return (
    <form className="stack card" noValidate onSubmit={(e) => void handleSubmit(onSubmit)(e)} aria-labelledby="assessment-form-title">
      <h2 id="assessment-form-title">{t("form.title")}</h2>
      <ErrorSummary errors={summary} />
      <div className="field">
        <label htmlFor="reason_for_visit">{t("form.reason")}</label>
        <span id="reason-hint" className="hint">
          {t("form.reasonHint")}
        </span>
        <FieldError id="reason-error" message={errors.reason_for_visit?.message} />
        <textarea
          id="reason_for_visit"
          className="input"
          aria-describedby={errors.reason_for_visit ? "reason-hint reason-error" : "reason-hint"}
          aria-invalid={errors.reason_for_visit ? true : undefined}
          {...register("reason_for_visit")}
        />
      </div>
      <div className="field">
        <label htmlFor="symptom_duration">{t("form.duration")}</label>
        <input id="symptom_duration" className="input" {...register("symptom_duration")} />
      </div>
      <fieldset className="field">
        <legend>{t("form.visitType")}</legend>
        {(
          [
            ["in_person", "form.inPerson"],
            ["telehealth", "form.telehealth"],
            ["no_preference", "form.noPreference"],
          ] as const
        ).map(([value, key]) => (
          <label key={value} className="check">
            <input type="radio" value={value} {...register("visit_type_preference")} />
            <span>{t(key)}</span>
          </label>
        ))}
      </fieldset>
      <div className="field">
        <label htmlFor="accessibility_needs">{t("form.access")}</label>
        <span id="access-hint" className="hint">
          {t("form.accessHint")}
        </span>
        <input id="accessibility_needs" className="input" aria-describedby="access-hint" {...register("accessibility_needs")} />
      </div>
      <button type="submit" className="btn btn--block" disabled={busy}>
        {t("common.continue")}
      </button>
    </form>
  );
}
