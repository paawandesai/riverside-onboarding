import { AlertCircle, ScanLine } from "lucide-react";
import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { t } from "../i18n";

export type Provenance = "ocr" | "missing" | null;

export function ProvenanceTag({ kind }: { kind: Provenance }) {
  if (kind === "ocr")
    return (
      <span className="tag">
        <ScanLine aria-hidden="true" size={16} />
        {t("confirm.fromPhoto")}
      </span>
    );
  if (kind === "missing")
    return (
      <span className="tag tag--missing">
        <AlertCircle aria-hidden="true" size={16} />
        {t("confirm.couldntRead")}
      </span>
    );
  return null;
}

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="error-text">
      <AlertCircle aria-hidden="true" size={18} />
      <span>{message}</span>
    </p>
  );
}

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  provenance?: Provenance;
  multiline?: false;
  extra?: ReactNode;
};

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { id, label, hint, error, provenance = null, className, extra, ...rest },
  ref,
) {
  const describedBy = [hint && `${id}-hint`, provenance && `${id}-prov`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && (
        <span id={`${id}-hint`} className="hint">
          {hint}
        </span>
      )}
      {provenance && (
        <span id={`${id}-prov`}>
          <ProvenanceTag kind={provenance} />
        </span>
      )}
      <FieldError id={`${id}-error`} message={error} />
      <input
        ref={ref}
        id={id}
        className={`input ${provenance === "ocr" ? "input--ocr" : ""} ${className ?? ""}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...rest}
      />
      {extra}
    </div>
  );
});

export type ErrorItem = { field: string; message: string };

/** Error summary at the top of a form; each entry links to its field. */
export function ErrorSummary({ errors }: { errors: ErrorItem[] }) {
  if (!errors.length) return null;
  return (
    <div className="error-summary" role="alert" aria-labelledby="error-summary-title">
      <h2 id="error-summary-title">{t("common.errorSummary")}</h2>
      <ul>
        {errors.map((e) => (
          <li key={e.field}>
            <a href={`#${e.field}`}>{e.message}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}
