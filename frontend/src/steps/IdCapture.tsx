import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Hand, Sun, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api, ApiError, type ExtractResult } from "../api";
import { useDraft } from "../app/draft";
import { useSupport, useSupportActions } from "../app/support";
import { StepPage } from "../components/StepPage";
import { ACCEPTED_TYPES, checkPhoto } from "../features/upload";
import { t } from "../i18n";

type Picked = { file: File; url: string };

export default function IdCapture() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const draft = useDraft();
  const support = useSupport();
  const consent = useQuery({ queryKey: ["consent"], queryFn: api.consent });
  const input = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // The preview URL points at the photo in memory; release it when it's replaced or we leave.
  useEffect(() => () => (picked ? URL.revokeObjectURL(picked.url) : undefined), [picked]);

  const enableScan = useMutation({
    mutationFn: () => api.grantConsent(true),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["consent"] }),
  });

  const typeInstead = (failed = false) => {
    draft.setExtracted(null);
    navigate("/details/confirm", { state: { failed } });
  };

  const failed = (message?: string) => {
    setPicked(null);
    void support.show({ upload_failed: true });
    setProblem(message ?? t("details.failedBody"));
  };

  const extract = useMutation({
    mutationFn: (file: File) => api.extract(file),
    onSuccess: (result: ExtractResult) => {
      setPicked(null);
      if (result.missing.length === Object.keys(result.fields).length) return failed();
      draft.setExtracted(result);
      navigate("/details/confirm");
    },
    onError: (e) => failed(e instanceof ApiError && e.status !== 0 ? e.message : undefined),
  });

  const choose = () => {
    setProblem(null);
    support.setPaused(true); // the picker or camera can take a while; that's not "idle"
    input.current?.click();
  };

  useSupportActions((action) => {
    if (action === "Try again") {
      choose();
      return true;
    }
    if (action === "Type it instead") {
      typeInstead(true);
      return true;
    }
    return false;
  });

  useEffect(() => {
    const resume = () => support.setPaused(false);
    window.addEventListener("focus", resume);
    return () => window.removeEventListener("focus", resume);
  }, [support]);

  if (consent.isPending) return <p aria-live="polite">{t("common.loading")}</p>;
  const scanAllowed = consent.data?.photo_scan === true;

  return (
    <StepPage title={t("details.title")} step={3} back="/chat" lead={<p>{t("details.lead")}</p>}>
      {!scanAllowed && (
        <div className="card stack">
          <p>{t("details.noScan")}</p>
          <div className="row">
            <button type="button" className="btn" onClick={() => typeInstead()}>
              {t("details.type")}
            </button>
            <button type="button" className="btn btn--secondary" disabled={enableScan.isPending} onClick={() => enableScan.mutate()}>
              {t("details.turnOnScan")}
            </button>
          </div>
        </div>
      )}
      {scanAllowed && (
        <input
        ref={input}
        id="id-photo"
        type="file"
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        accept={[...ACCEPTED_TYPES, ".heic", ".heif"].join(",")}
        capture="environment"
        onChange={(e) => {
          support.setPaused(false);
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          const error = checkPhoto(file);
          if (error) return setProblem(error);
          setPicked({ file, url: URL.createObjectURL(file) });
        }}
      />
      )}
      {scanAllowed && !picked && (
        <>
          <div className="id-frame" aria-hidden="true">
            <span>SPECIMEN</span>
          </div>
          <ul className="tips">
            <li>
              <Square aria-hidden="true" size={20} /> {t("details.tip1")}
            </li>
            <li>
              <Sun aria-hidden="true" size={20} /> {t("details.tip2")}
            </li>
            <li>
              <Hand aria-hidden="true" size={20} /> {t("details.tip3")}
            </li>
          </ul>
          {problem && (
            <div className="error-summary" role="alert">
              <h2>{t("details.failedTitle")}</h2>
              <p>{problem}</p>
            </div>
          )}
          <p className="muted small">{t("details.fileNote")}</p>
          <button type="button" className="btn btn--block" onClick={choose}>
            <Camera aria-hidden="true" size={20} /> {t("details.take")}
          </button>
          <button type="button" className="btn btn--secondary btn--block" onClick={() => typeInstead()}>
            {t("details.type")}
          </button>
        </>
      )}
      {scanAllowed && picked && (
        <div className="stack">
          <h2>{t("details.review")}</h2>
          <img className="id-preview" src={picked.url} alt={t("details.preview")} />
          {extract.isPending && (
            <p role="status" className="muted">
              {t("details.reading")}
            </p>
          )}
          <div className="row">
            <button type="button" className="btn" disabled={extract.isPending} onClick={() => extract.mutate(picked.file)}>
              {t("details.use")}
            </button>
            <button type="button" className="btn btn--secondary" disabled={extract.isPending} onClick={choose}>
              {t("details.retake")}
            </button>
          </div>
        </div>
      )}
      <p>
        <Link to="/front-desk">{t("start.frontDesk")}</Link>
      </p>
    </StepPage>
  );
}
