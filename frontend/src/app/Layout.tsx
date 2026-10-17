import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CircleHelp, Type, UserRound, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Outlet, useNavigate } from "react-router";
import { api } from "../api";
import { HelpDialog } from "../components/Dialogs";
import { SupportCard } from "../components/SupportCard";
import { track } from "../features/events";
import { t } from "../i18n";
import { useDraft } from "./draft";
import { SupportProvider, stepId, useSupport } from "./support";
import { useLocation } from "react-router";

const TEXT_SIZE_KEY = "text_size"; // a display preference only; nothing personal is stored in the browser

function readTextSize(): boolean {
  try {
    return localStorage.getItem(TEXT_SIZE_KEY) === "large";
  } catch {
    return false;
  }
}

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

export function Layout() {
  return (
    <SupportProvider>
      <Shell />
    </SupportProvider>
  );
}

function Shell() {
  const [helpOpen, setHelpOpen] = useState(false);
  const [large, setLarge] = useState(readTextSize);
  const online = useOnline();
  const support = useSupport();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const draft = useDraft();
  const { pathname } = useLocation();
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, retry: false });
  const signedIn = me.isSuccess;

  useEffect(() => {
    document.documentElement.dataset.textSize = large ? "large" : "normal";
    try {
      localStorage.setItem(TEXT_SIZE_KEY, large ? "large" : "normal");
    } catch {
      /* preference only */
    }
  }, [large]);

  useEffect(() => track(stepId(pathname), "viewed"), [pathname]);

  const saveAndLeave = async () => {
    await api.logout().catch(() => undefined);
    queryClient.clear();
    draft.clear();
    navigate("/saved");
  };

  useEffect(() => {
    support.setGlobalHandler((action) => {
      if (action === "talk_to_person") setHelpOpen(true);
      else if (action === "save_and_leave") void saveAndLeave();
      return true;
    });
  });

  return (
    <>
      <div className="banner" role="note">
        <strong>{t("banner.demo")}</strong> {t("banner.demoDetail")}
      </div>
      {!online && (
        <div className="banner banner--offline" role="status">
          <WifiOff aria-hidden="true" size={18} /> {t("banner.offline")}
        </div>
      )}
      <header className="site-header">
        <Link to="/" className="brand">
          {t("clinic.name")} <span className="muted small">{t("clinic.fictional")}</span>
        </Link>
        <nav aria-label={t("header.menu")} className="header-actions">
          <button type="button" className="btn btn--link" onClick={() => setHelpOpen(true)}>
            <CircleHelp aria-hidden="true" size={20} /> {t("header.help")}
          </button>
          <button type="button" className="btn btn--link" aria-pressed={large} onClick={() => setLarge((v) => !v)}>
            <Type aria-hidden="true" size={20} /> {t("header.textSize")}
          </button>
          {signedIn && me.data.role === "staff" && (
            <Link to="/staff" className="btn btn--link">
              <CalendarDays aria-hidden="true" size={20} /> {t("header.schedule")}
            </Link>
          )}
          {signedIn && me.data.role !== "staff" && (
            <>
              <Link to="/privacy" className="btn btn--link">
                <UserRound aria-hidden="true" size={20} /> {t("header.privacy")}
              </Link>
              <button type="button" className="btn btn--link" onClick={() => void saveAndLeave()}>
                {t("header.saveLater")}
              </button>
            </>
          )}
        </nav>
      </header>
      <main id="main">
        <div className="support-region" aria-live="polite">
          {support.card && <SupportCard content={support.card} onAction={support.act} onDismiss={support.dismiss} />}
        </div>
        <Outlet />
      </main>
      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </>
  );
}
