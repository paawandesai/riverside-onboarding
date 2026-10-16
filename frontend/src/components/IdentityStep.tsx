import { useRef, useState, type FormEvent } from "react";
import { api, ApiError, track, type ExtractResult, type FieldName } from "../api";

const LABELS: Record<FieldName, string> = { full_name: "Full name", dob: "Date of birth", address: "Home address" };
const FIELDS: FieldName[] = ["full_name", "dob", "address"];

type Props = { onSaved: () => void; onSignal: (signal: "upload_failed" | "ocr_low_confidence") => void };

export function IdentityStep({ onSaved, onSignal }: Props) {
  const [values, setValues] = useState<Record<FieldName, string>>({ full_name: "", dob: "", address: "" });
  const [extracted, setExtracted] = useState<ExtractResult | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setError(null);
    setBusy(true);
    setStatus("Reading your photo…");
    track("identity", "upload_started");
    try {
      const result = await api.extract(file);
      setExtracted(result);
      setValues({
        full_name: result.fields.full_name.value ?? "",
        dob: result.fields.dob.value ?? "",
        address: result.fields.address.value ?? "",
      });
      setStatus(result.message);
      track("identity", result.missing.length === 3 ? "ocr_empty" : "ocr_done");
      if (result.missing.length === 3) onSignal("upload_failed");
      else if (result.needs_review.length || result.missing.length) onSignal("ocr_low_confidence");
    } catch (err) {
      setStatus(null);
      setError(err instanceof ApiError ? err.message : "That upload didn't work.");
      track("identity", "upload_failed");
      onSignal("upload_failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function sourceFor(name: FieldName): string {
    const original = extracted?.fields[name].value;
    if (!original) return "manual";
    return original === values[name] ? "ocr_confirmed" : "ocr_edited";
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    try {
      await api.saveIdentity({ ...values, sources: Object.fromEntries(FIELDS.map((f) => [f, sourceFor(f)])) });
      track("identity", "confirmed");
      onSaved();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(Object.fromEntries(err.fieldErrors.map((f) => [f.field, f.message])));
      } else setError("We couldn't save that. Please try again.");
    }
  }

  function flag(name: FieldName): string | null {
    const f = extracted?.fields[name];
    if (!f) return null;
    if (f.status === "missing") return "Not found in photo. Please fill in.";
    if (f.status === "low_confidence") return "Read from photo. Please check carefully.";
    return "Read from photo. Please confirm.";
  }

  return (
    <section aria-labelledby="identity-title">
      <h1 id="identity-title">Your details</h1>
      <p>Take a photo of your ID to fill this in, or type your details. The photo is read once and then discarded.</p>
      <label htmlFor="id-photo" className="upload">
        <span>📷 Upload a photo of your ID</span>
        <input
          id="id-photo"
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          disabled={busy}
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
        />
      </label>
      <p aria-live="polite" className="status">
        {status}
      </p>
      {error && (
        <p role="alert" className="error">
          <span aria-hidden="true">✖ </span>
          {error}
        </p>
      )}
      <form onSubmit={save} noValidate>
        {FIELDS.map((name) => {
          const note = flag(name);
          const review = extracted?.fields[name].status !== "found" && extracted !== null;
          const errId = `${name}-err`;
          return (
            <div key={name} className={`field ${review ? "field--review" : ""}`}>
              <label htmlFor={name}>{LABELS[name]}</label>
              <input
                id={name}
                type={name === "dob" ? "date" : "text"}
                autoComplete={name === "full_name" ? "name" : name === "dob" ? "bday" : "street-address"}
                value={values[name]}
                required
                aria-invalid={Boolean(fieldErrors[name])}
                aria-describedby={`${name}-note ${errId}`}
                onChange={(e) => setValues({ ...values, [name]: e.target.value })}
              />
              {note && (
                <p id={`${name}-note`} className="hint">
                  <span aria-hidden="true">{review ? "⚠ " : "✓ "}</span>
                  {note}
                </p>
              )}
              {fieldErrors[name] && (
                <p id={errId} className="error">
                  {fieldErrors[name]}
                </p>
              )}
            </div>
          );
        })}
        <button type="submit" disabled={busy || FIELDS.some((f) => !values[f].trim())}>
          These details are correct
        </button>
      </form>
    </section>
  );
}
