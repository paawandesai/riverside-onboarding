import { defineConfig, devices } from "@playwright/test";
import { randomBytes } from "node:crypto";

// End-to-end tests run the real API (FastAPI + Postgres + Tesseract) serving the built SPA.
// Nothing is mocked except where a test deliberately breaks the network to exercise a failure path.
const PORT = 8010;
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgresql+pg8000://onboarding@localhost:5432/onboarding_e2e";
const PYTHON = process.env.E2E_PYTHON ?? ".venv/bin/python";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"], browserName: "chromium" } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testMatch: /a11y\.spec\.ts/ },
  ],
  webServer: {
    cwd: "../backend",
    // Fresh schema each run, appointment slots seeded, then the API serving ../frontend/dist.
    command: `${PYTHON} -m alembic downgrade base && ${PYTHON} -m alembic upgrade head && ${PYTHON} -m scripts.seed && ${PYTHON} -m uvicorn app.main:app --port ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      APP_ENV: "test",
      DATABASE_URL,
      // Throwaway per-run keys; none are stored anywhere.
      SESSION_SECRET: randomBytes(48).toString("base64url"),
      FIELD_ENCRYPTION_KEY: randomBytes(32).toString("base64").replace(/\+/g, "-").replace(/\//g, "_"),
      INVITE_CODES: "e2e-invite",
      CORS_ORIGINS: `http://localhost:${PORT}`,
      STATIC_DIR: "../frontend/dist",
      DEMO_MODE: "true",
      // No API key: the assistant runs on its rule-based fallback, as in CI.
      ANTHROPIC_RIVERSIDE_API_KEY: "",
      ANTHROPIC_API_KEY: "",
    },
  },
});
