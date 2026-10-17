import { Link } from "react-router";
import { StepPage } from "../components/StepPage";
import { t } from "../i18n";

/** Never a raw error: a plain message with a way forward. */
export function ErrorPage({ notFound = false }: { notFound?: boolean }) {
  return (
    <main id="main">
      <StepPage title={notFound ? "Page not found" : t("error.generic")}>
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
    </main>
  );
}
