import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../api";
import { nextPath } from "../app/progress";
import { FieldError } from "../components/Fields";
import { StepPage } from "../components/StepPage";
import { t, type MessageKey } from "../i18n";

const STEP_KEYS: MessageKey[] = ["steps.consent", "steps.chat", "steps.details", "steps.confirm", "steps.book"];

export function Start() {
  const navigate = useNavigate();
  const [adult, setAdult] = useState(false);
  const [error, setError] = useState<string>();
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, retry: false });

  const go = async () => {
    if (me.isSuccess) {
      navigate(nextPath(await api.progress()));
      return;
    }
    if (!adult) {
      setError(t("start.adultError"));
      document.getElementById("adult")?.focus();
      return;
    }
    navigate("/account", { state: { adult: true } });
  };

  return (
    <StepPage title={t("start.title")} lead={<p className="lead">{t("start.time")}</p>}>
      <ol className="step-list">
        {STEP_KEYS.map((k, i) => (
          <li key={k}>
            <span className="step-num" aria-hidden="true">
              {i + 1}
            </span>
            {t(k)}
          </li>
        ))}
      </ol>
      <p className="card">{t("start.ai")}</p>
      {!me.isSuccess && (
        <div className="field">
          <FieldError id="adult-error" message={error} />
          <label className="check" htmlFor="adult">
            <input
              id="adult"
              type="checkbox"
              checked={adult}
              aria-describedby={error ? "adult-error" : undefined}
              aria-invalid={error ? true : undefined}
              onChange={(e) => {
                setAdult(e.target.checked);
                setError(undefined);
              }}
            />
            <span>{t("start.adult")}</span>
          </label>
        </div>
      )}
      <button type="button" className="btn btn--block" onClick={() => void go()}>
        {t("start.go")}
      </button>
      <p className="muted">
        {t("start.person")} <Link to="/front-desk">{t("start.frontDesk")}</Link>
      </p>
    </StepPage>
  );
}
