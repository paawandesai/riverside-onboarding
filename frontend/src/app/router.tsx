import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter } from "react-router";
import { t } from "../i18n";
import { Deleted, FrontDesk, Saved } from "../steps/Simple";
import { Start } from "../steps/Start";
import { ErrorPage } from "./ErrorPage";
import { Layout } from "./Layout";
import { RequireAuth } from "./RequireAuth";

// Every step after the start page loads on demand, keeping the first load small (budget: 170 KB gzip).
const Account = lazy(() => import("../steps/Account").then((m) => ({ default: m.Account })));
const Consent = lazy(() => import("../steps/Consent").then((m) => ({ default: m.Consent })));
const Chat = lazy(() => import("../steps/Chat").then((m) => ({ default: m.Chat })));
const IdCapture = lazy(() => import("../steps/IdCapture"));
const ConfirmDetails = lazy(() => import("../steps/ConfirmDetails").then((m) => ({ default: m.ConfirmDetails })));
const Book = lazy(() => import("../steps/Book"));
const Done = lazy(() => import("../steps/Done").then((m) => ({ default: m.Done })));
const Privacy = lazy(() => import("../steps/Privacy").then((m) => ({ default: m.Privacy })));
const later = (node: ReactNode) => <Suspense fallback={<p aria-live="polite">{t("common.loading")}</p>}>{node}</Suspense>;

export const routes = [
  {
    element: <Layout />,
    errorElement: <ErrorPage />,
    children: [
      { path: "/", element: <Start /> },
      { path: "/account", element: later(<Account />) },
      { path: "/front-desk", element: <FrontDesk /> },
      { path: "/saved", element: <Saved /> },
      { path: "/deleted", element: <Deleted /> },
      {
        element: <RequireAuth />,
        children: [
          { path: "/consent", element: later(<Consent />) },
          { path: "/chat", element: later(<Chat />) },
          { path: "/details", element: later(<IdCapture />) },
          { path: "/details/confirm", element: later(<ConfirmDetails />) },
          { path: "/book", element: later(<Book />) },
          { path: "/done", element: later(<Done />) },
          { path: "/privacy", element: later(<Privacy />) },
        ],
      },
      { path: "*", element: <ErrorPage notFound /> },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
