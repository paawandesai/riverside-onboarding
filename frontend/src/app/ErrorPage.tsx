import { Link } from "react-router";
import { StepPage } from "../components/StepPage";
import { t } from "../i18n";

/**
 * Never a raw error: a plain message with a way forward.
 * Inside the layout (404) it is just the page; as the router's error screen it replaces the layout,
 * so it brings the demo banner and its own main landmark.
 */
export function ErrorPage({ notFound = false, standalone = false }: { notFound?: boolean; standalone?: boolean }) {
  const page = (
    <StepPage title={notFound ? t("error.notFound") : t("error.generic")}>
      <p>{t("error.staff")}</p>
      <div className="row">
        <Link to="/" className="btn">
          {t("frontDesk.back")}
        </Link>
        <Link to="/front-desk" className="btn btn--secondary">
          {t("start.frontDesk")}
        </Link>
      </div>
    </StepPage>
  );
  if (!standalone) return page;
  return (
    <>
      <div className="banner" role="note">
        <strong>{t("banner.demo")}</strong> {t("banner.demoDetail")}
      </div>
      <main id="main">{page}</main>
    </>
  );
}
