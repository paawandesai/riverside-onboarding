import type { UseFormRegister } from "react-hook-form";
import { t } from "../i18n";
import { FieldError, ProvenanceTag, type Provenance } from "./Fields";

type DobFields = { month: string; day: string; year: string };

type Props = { register: UseFormRegister<DobFields & Record<string, string>>; error?: string; provenance: Provenance };

/** Month / Day / Year as three numeric text inputs (US order). No dropdowns, no date picker. */
export function DateOfBirthInput({ register, error, provenance }: Props) {
  const ocr = provenance === "ocr" ? "input--ocr" : "";
  const describedBy = ["dob-hint", provenance ? "dob-prov" : "", error ? "dob-error" : ""].filter(Boolean).join(" ");
  return (
    <fieldset className="field" aria-describedby={describedBy} id="dob">
      <legend>{t("confirm.dob")}</legend>
      <span id="dob-hint" className="hint">
        {t("confirm.dobHint")}
      </span>
      {provenance && (
        <span id="dob-prov">
          <ProvenanceTag kind={provenance} />
        </span>
      )}
      <FieldError id="dob-error" message={error} />
      <div className="dob-row">
        {(
          [
            ["month", "confirm.month", "bday-month", 2],
            ["day", "confirm.day", "bday-day", 2],
            ["year", "confirm.year", "bday-year", 4],
          ] as const
        ).map(([name, label, autoComplete, size]) => (
          <div key={name} className={`field dob-${name}`}>
            <label htmlFor={`dob-${name}`}>{t(label)}</label>
            <input
              id={`dob-${name}`}
              className={`input ${ocr}`}
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={size}
              autoComplete={autoComplete}
              aria-invalid={error ? true : undefined}
              {...register(name)}
            />
          </div>
        ))}
      </div>
    </fieldset>
  );
}
