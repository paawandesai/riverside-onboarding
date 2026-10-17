import { useQuery } from "@tanstack/react-query";
import { Navigate, Outlet } from "react-router";
import { api, ApiError } from "../api";
import { t } from "../i18n";

/** Steps after sign-up need a session; without one, go to sign in. */
export function RequireAuth() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, retry: false });
  if (me.isPending) return <p aria-live="polite">{t("common.loading")}</p>;
  if (me.error instanceof ApiError && me.error.status === 401) return <Navigate to="/account?mode=signin" replace />;
  if (me.isError) return <p role="alert">{t("error.generic")}</p>;
  return <Outlet />;
}

/** The intake steps need consent to the current notice; without it, show the notice first. */
export function RequireConsent() {
  const progress = useQuery({
    queryKey: ["progress"],
    queryFn: api.progress,
    retry: false,
  });
  if (progress.isPending) return <p aria-live="polite">{t("common.loading")}</p>;
  if (progress.error instanceof ApiError && progress.error.status === 401) return <Navigate to="/account?mode=signin" replace />;
  if (progress.isError) return <p role="alert">{t("error.generic")}</p>;
  if (!progress.data.consent) return <Navigate to="/consent" replace />;
  return <Outlet />;
}
