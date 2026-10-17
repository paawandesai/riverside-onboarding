import "./app/cspNonce";
import "@fontsource/atkinson-hyperlegible-next/latin-400.css";
import "@fontsource/atkinson-hyperlegible-next/latin-700.css";
import "@fontsource/literata/latin-600.css";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { Providers } from "./app/Providers";
import { createRouter } from "./app/router";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";

function App() {
  const [router] = useState(createRouter);
  return <RouterProvider router={router} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Providers>
      <App />
    </Providers>
  </StrictMode>,
);
