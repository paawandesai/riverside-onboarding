import { useEffect, useRef, type ReactNode } from "react";
import { Link } from "react-router";
import { t } from "../i18n";

export const TOTAL_STEPS = 5;

type Props = { title: string; step?: number; back?: string; children: ReactNode; lead?: ReactNode };

/** One screen. On arrival, focus moves to the heading and the document title names the step. */
export function StepPage({ title, step, back, lead, children }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = step ? `${t("steps.of", { n: step, total: TOTAL_STEPS })}: ${title}` : `${title} · ${t("clinic.name")}`;
    heading.current?.focus();
  }, [title, step]);
  return (
    <section className="step stack" aria-labelledby="step-title">
      {back && (
        <Link to={back} className="btn btn--link back-link">
          <span aria-hidden="true">‹</span> {t("common.back")}
        </Link>
      )}
      {step && <p className="muted small step-count">{t("steps.of", { n: step, total: TOTAL_STEPS })}</p>}
      <h1 id="step-title" ref={heading} tabIndex={-1}>
        {title}
      </h1>
      {lead}
      {children}
    </section>
  );
}
