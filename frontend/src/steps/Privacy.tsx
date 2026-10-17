import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../api";
import { useDraft } from "../app/draft";
import { ConfirmDialog } from "../components/Dialogs";
import { StepPage } from "../components/StepPage";
import { t, type MessageKey } from "../i18n";

type Action = "withdraw" | "data" | "account";
const BODY: Record<Action, MessageKey> = {
  withdraw: "privacy.confirmWithdraw",
  data: "privacy.confirmData",
  account: "privacy.confirmAccount",
};

export function Privacy() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const draft = useDraft();
  const consent = useQuery({ queryKey: ["consent"], queryFn: api.consent });
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, retry: false });
  const shared = me.data?.shared_login ?? false;
  const [confirming, setConfirming] = useState<Action | null>(null);

  const forget = (to: string) => {
    queryClient.clear();
    draft.clear();
    navigate(to);
  };

  const remove = useMutation({
    mutationFn: async (action: Action) => {
      if (action === "withdraw") await api.revokeConsent();
      else if (action === "data") await api.deleteData();
      else await api.deleteAccount();
    },
    onSuccess: () => forget("/deleted"),
  });
  const photo = useMutation({
    mutationFn: (on: boolean) => api.setPhotoConsent(on),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["consent"] }),
  });
  const signOut = async () => {
    await api.logout().catch(() => undefined);
    forget("/saved");
  };

  const c = consent.data;
  return (
    <StepPage title={t("privacy.title")}>
      {c && (
        <div className="card stack">
          <p>{c.active ? t("privacy.consentOn", { version: c.version ?? "" }) : t("privacy.consentOff")}</p>
          {c.active && (
            <>
              <p>{c.photo_scan ? t("privacy.photoOn") : t("privacy.photoOff")}</p>
              <button type="button" className="btn btn--secondary" disabled={photo.isPending} onClick={() => photo.mutate(!c.photo_scan)}>
                {c.photo_scan ? t("privacy.photoToggleOff") : t("privacy.photoToggleOn")}
              </button>
            </>
          )}
        </div>
      )}
      <p className="muted small">{t("privacy.anthropicNote")}</p>
      <div className="stack">
        {c?.active && (
          <button type="button" className="btn btn--danger btn--block" onClick={() => setConfirming("withdraw")}>
            {t("privacy.withdraw")}
          </button>
        )}
        <button type="button" className="btn btn--danger btn--block" onClick={() => setConfirming("data")}>
          {t("privacy.deleteData")}
        </button>
        {shared ? (
          <p className="muted small">{t("privacy.sharedLogin")}</p>
        ) : (
          <button type="button" className="btn btn--danger btn--block" onClick={() => setConfirming("account")}>
            {t("privacy.deleteAccount")}
          </button>
        )}
        <button type="button" className="btn btn--secondary btn--block" onClick={() => void signOut()}>
          {t("privacy.signOut")}
        </button>
      </div>
      {remove.isError && <p role="alert">{t("error.generic")}</p>}
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        body={confirming ? t(BODY[confirming]) : ""}
        busy={remove.isPending}
        onConfirm={() => confirming && remove.mutate(confirming)}
      />
    </StepPage>
  );
}
