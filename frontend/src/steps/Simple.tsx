import { Link } from "react-router";
import { StepPage } from "../components/StepPage";
import { t } from "../i18n";

export function FrontDesk() {
  return (
    <StepPage title={t("frontDesk.title")}>
      <p>{t("frontDesk.body", { phone: t("clinic.phone") })}</p>
      <Link to="/" className="btn btn--secondary">
        {t("frontDesk.back")}
      </Link>
    </StepPage>
  );
}

export function Saved() {
  return (
    <StepPage title={t("saved.title")}>
      <p>{t("saved.body")}</p>
      <Link to="/account?mode=signin" className="btn">
        {t("account.signIn")}
      </Link>
    </StepPage>
  );
}

export function Deleted() {
  return (
    <StepPage title={t("privacy.doneTitle")}>
      <p>{t("privacy.doneBody")}</p>
      <p className="muted">{t("privacy.anthropicNote")}</p>
      <Link to="/" className="btn btn--secondary">
        {t("privacy.startAgain")}
      </Link>
    </StepPage>
  );
}
