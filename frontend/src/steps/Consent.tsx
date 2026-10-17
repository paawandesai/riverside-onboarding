import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../api";
import { StepPage } from "../components/StepPage";
import { t } from "../i18n";

export function Consent() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const text = useQuery({ queryKey: ["consent-text"], queryFn: api.consentText, staleTime: Infinity });
  const [photo, setPhoto] = useState(false);
  const grant = useMutation({
    mutationFn: () => api.grantConsent(photo),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["progress"] });
      await queryClient.invalidateQueries({ queryKey: ["consent"] });
      navigate("/chat");
    },
  });

  return (
    <StepPage title={t("consent.title")} step={1} back="/">
      {text.isPending && <p aria-live="polite">{t("common.loading")}</p>}
      {text.isError && (
        <p role="alert">
          {t("error.generic")}{" "}
          <button type="button" className="btn btn--link" onClick={() => void text.refetch()}>
            {t("common.tryAgain")}
          </button>
        </p>
      )}
      {text.data && (
        <>
          <ul className="consent-points">
            {text.data.points.map((p) => (
              <li key={p}>
                <Check aria-hidden="true" size={20} />
                <span>{p}</span>
              </li>
            ))}
          </ul>
          <details className="card">
            <summary>{t("consent.full")}</summary>
            <div className="stack">
              {text.data.details.map((d) => (
                <p key={d}>{d}</p>
              ))}
              <p className="muted small">Version {text.data.version}</p>
            </div>
          </details>
          <div className="card">
            <div className="check">
              <input
                id="photo-scan"
                type="checkbox"
                role="switch"
                checked={photo}
                aria-describedby="photo-scan-hint"
                onChange={(e) => setPhoto(e.target.checked)}
              />
              <div>
                <label htmlFor="photo-scan">
                  <strong>{t("consent.photoLabel")}</strong>
                </label>
                <p id="photo-scan-hint" className="muted small">
                  {t("consent.photoHint")}
                </p>
              </div>
            </div>
          </div>
          {grant.isError && <p role="alert">{t("error.generic")}</p>}
          <button type="button" className="btn btn--block" disabled={grant.isPending} onClick={() => grant.mutate()}>
            {t("consent.agree")}
          </button>
          <Link to="/front-desk" className="btn btn--secondary btn--block">
            {t("consent.decline")}
          </Link>
        </>
      )}
    </StepPage>
  );
}
