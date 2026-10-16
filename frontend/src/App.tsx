import { useCallback, useEffect, useState } from "react";
import { api, track, type SupportContent } from "./api";
import { AuthForm } from "./components/AuthForm";
import { BookingStep } from "./components/BookingStep";
import { ChatStep } from "./components/ChatStep";
import { ConsentStep } from "./components/ConsentStep";
import { IdentityStep } from "./components/IdentityStep";
import { PrivacyPanel } from "./components/PrivacyPanel";
import { SupportCard } from "./components/SupportCard";
import { useIdleTrigger } from "./useIdle";

type Step = "loading" | "auth" | "consent" | "identity" | "assessment" | "booking";
const STEPS: { id: Step; label: string }[] = [
  { id: "consent", label: "Consent" },
  { id: "identity", label: "Your details" },
  { id: "assessment", label: "About your visit" },
  { id: "booking", label: "Book" },
];
const IDLE_THRESHOLD = 45;

async function sessionStep(): Promise<Step> {
  try {
    await api.me();
  } catch {
    return "auth";
  }
  try {
    return (await api.consent()).active ? "identity" : "consent";
  } catch {
    return "consent";
  }
}

export default function App() {
  const [step, setStep] = useState<Step>("loading");
  const [support, setSupport] = useState<SupportContent | null>(null);
  const [idleDismissedOn, setIdleDismissedOn] = useState<Step | null>(null);

  const resume = useCallback(() => {
    void sessionStep().then(setStep);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void sessionStep().then((s) => !cancelled && setStep(s));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (step !== "loading") track(step, "viewed");
  }, [step]);

  const showSupport = useCallback(async (signals: Record<string, number | boolean>) => {
    try {
      const { content } = await api.support(signals);
      if (content) setSupport(content);
    } catch {
      /* support content is best-effort */
    }
  }, []);

  const working = step === "identity" || step === "assessment" || step === "booking";
  useIdleTrigger(IDLE_THRESHOLD, working && !support && idleDismissedOn !== step, (idle) => void showSupport({ idle_seconds: idle }));

  const dismiss = () => {
    if (support?.trigger === "long_pause") setIdleDismissedOn(step);
    setSupport(null);
  };

  const onSupportAction = (action: string) => {
    if (action === "Type my details instead" || action === "Review highlighted fields") setSupport(null);
    if (action === "Show open times") setSupport(null);
    if (action === "Continue" || action === "Skip this question") dismiss();
  };

  const stepIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <>
      <div className="banner" role="note">
        <strong>Demo, synthetic data only.</strong> Do not enter real personal or health information.
      </div>
      <header>
        <p className="brand">Maple Grove Community Health (fictional)</p>
        {stepIndex >= 0 && (
          <nav aria-label="Sign-up progress">
            <ol className="steps">
              {STEPS.map((s, i) => (
                <li key={s.id} aria-current={s.id === step ? "step" : undefined} className={i < stepIndex ? "done" : ""}>
                  <span aria-hidden="true">{i < stepIndex ? "✓" : i + 1}</span> {s.label}
                  {i < stepIndex && <span className="visually-hidden"> (completed)</span>}
                </li>
              ))}
            </ol>
          </nav>
        )}
      </header>
      <main>
        {support && <SupportCard content={support} onAction={onSupportAction} onDismiss={dismiss} />}
        {step === "loading" && <p aria-live="polite">Loading…</p>}
        {step === "auth" && <AuthForm onSignedIn={resume} />}
        {step === "consent" && <ConsentStep onConsented={() => setStep("identity")} />}
        {step === "identity" && (
          <IdentityStep onSaved={() => setStep("assessment")} onSignal={(signal) => void showSupport({ [signal]: true })} />
        )}
        {step === "assessment" && (
          <ChatStep onDone={() => setStep("booking")} onSupport={setSupport} onOpenScheduling={() => setStep("booking")} />
        )}
        {step === "booking" && <BookingStep onConflict={() => void showSupport({ booking_conflict: true })} />}
        {stepIndex >= 0 && (
          <PrivacyPanel
            onRevoked={() => {
              setSupport(null);
              setStep("consent");
            }}
            onDeleted={() => {
              setSupport(null);
              setStep("auth");
            }}
          />
        )}
      </main>
    </>
  );
}
