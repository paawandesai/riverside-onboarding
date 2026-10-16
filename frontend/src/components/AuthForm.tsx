import { useState, type FormEvent } from "react";
import { api, ApiError } from "../api";

export function AuthForm({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [invite, setInvite] = useState("");
  const [adult, setAdult] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "signup") await api.signup({ email, password, invite_code: invite, adult_attestation: adult });
      else await api.login({ email, password });
      onSignedIn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} aria-labelledby="auth-title" noValidate>
      <h1 id="auth-title">{mode === "signup" ? "Create your account" : "Sign in"}</h1>
      <label htmlFor="email">Email</label>
      <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <label htmlFor="password">Password {mode === "signup" && <span className="hint">(at least 10 characters)</span>}</label>
      <input
        id="password"
        type="password"
        autoComplete={mode === "signup" ? "new-password" : "current-password"}
        required
        minLength={mode === "signup" ? 10 : 1}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {mode === "signup" && (
        <>
          <label htmlFor="invite">Invite code</label>
          <input id="invite" required value={invite} onChange={(e) => setInvite(e.target.value)} />
          <div className="check">
            <input id="adult" type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
            <label htmlFor="adult">I confirm I am 18 or older.</label>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="error">
          <span aria-hidden="true">✖ </span>
          {error}
        </p>
      )}
      <div className="row">
        <button type="submit" disabled={busy || (mode === "signup" && !adult)}>
          {mode === "signup" ? "Create account" : "Sign in"}
        </button>
        <button type="button" className="link" onClick={() => setMode(mode === "signup" ? "login" : "signup")}>
          {mode === "signup" ? "I already have an account" : "Create a new account"}
        </button>
      </div>
    </form>
  );
}
