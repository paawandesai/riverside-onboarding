import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bot, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { api, ApiError, type AssessmentFields, CHAT_HISTORY_TURNS, type ChatTurn } from "../api";
import { useDraft } from "../app/draft";
import { useSupport, useSupportActions } from "../app/support";
import { StepPage } from "../components/StepPage";
import { t } from "../i18n";
import { AssessmentForm, type AssessmentValues } from "./AssessmentForm";

const QUICK = ["chat.quick.checkup", "chat.quick.symptom", "chat.quick.followup"] as const;

function mergeFields(prev: AssessmentFields, next: AssessmentFields): AssessmentFields {
  const merged = { ...prev };
  for (const [k, v] of Object.entries(next) as [keyof AssessmentFields, string | null][]) {
    if (v) (merged as Record<string, string>)[k] = v;
  }
  return merged;
}

export function Chat() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const draft = useDraft();
  const support = useSupport();
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => abort.current?.abort(), []);

  // If the assistant extracted no reason (for example it was down), the patient's own words carry over.
  const ownWords = draft.transcript
    .filter((turn) => turn.role === "user")
    .map((turn) => turn.content)
    .join("\n");
  const formInitial = {
    ...draft.fields,
    reason_for_visit: draft.fields.reason_for_visit || ownWords || null,
  };

  const save = useMutation({
    mutationFn: (fields: AssessmentValues | AssessmentFields) =>
      api.saveAssessment({
        reason_for_visit: fields.reason_for_visit || null,
        symptom_duration: fields.symptom_duration || null,
        visit_type_preference: fields.visit_type_preference ?? null,
        accessibility_needs: fields.accessibility_needs || null,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["progress"] });
      navigate("/details");
    },
  });

  const openForm = (focus = true) => {
    setShowForm(true);
    if (focus) requestAnimationFrame(() => formRef.current?.querySelector("textarea")?.focus());
  };

  const send = async (turns: ChatTurn[]) => {
    draft.setTranscript(turns);
    setPending(true);
    setFailure(null);
    abort.current = new AbortController();
    try {
      // The server only reads the last 20 turns; sending just those keeps long chats under the body limit.
      const result = await api.chat(turns.slice(-CHAT_HISTORY_TURNS), abort.current.signal);
      // The signature lets the server check this reply really came from it when the history is sent back.
      draft.setTranscript([...turns, { role: "assistant", content: result.reply, sig: result.reply_sig }]);
      draft.setFields(mergeFields(draft.fields, result.fields));
      setNotice(result.notice);
      if (result.support) support.present(result.support);
    } catch (e) {
      if (abort.current?.signal.aborted) return;
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        // Signed out, or consent was withdrawn elsewhere: go back to the step that fixes it.
        navigate(e.status === 401 ? "/account?mode=signin" : "/consent");
        return;
      }
      // Never a silent failure: say so here, open the form so the step can still be finished, and offer support.
      setFailure(e instanceof ApiError && e.status === 429 ? t("chat.tooFast") : t("chat.failed"));
      openForm(false);
      void support.show({ llm_unavailable: true });
    } finally {
      setPending(false);
    }
  };

  const submit = (content: string) => {
    const trimmed = content.trim();
    if (!trimmed || pending) return;
    setText("");
    void send([...draft.transcript, { role: "user", content: trimmed }]);
  };

  useSupportActions((action) => {
    if (action === "try_again") {
      void send(draft.transcript);
      return true;
    }
    if (action === "use_form") {
      openForm();
      return true;
    }
    return false;
  });

  const hasUserTurn = draft.transcript.some((m) => m.role === "user");
  const canContinue = Boolean(draft.fields.reason_for_visit);

  return (
    <StepPage title={t("chat.title")} step={2} back="/consent">
      <div className="chat-log" role="log" aria-live="polite" aria-label={t("chat.title")}>
        <Bubble who="assistant" content={t("chat.greeting")} />
        {draft.transcript.map((m, i) => (
          <Bubble key={i} who={m.role} content={m.content} />
        ))}
      </div>
      {pending && (
        <p className="muted typing" role="status">
          {t("chat.thinking")}
        </p>
      )}
      {notice && <p className="muted small">{notice}</p>}
      {failure && (
        <div className="card stack" role="alert">
          <p>{failure}</p>
          <div className="row">
            <button type="button" className="btn" disabled={pending} onClick={() => void send(draft.transcript)}>
              {t("common.tryAgain")}
            </button>
          </div>
        </div>
      )}
      {!hasUserTurn && (
        <div className="chips">
          {QUICK.map((k) => (
            <button key={k} type="button" className="chip" onClick={() => submit(t(k))}>
              {t(k)}
            </button>
          ))}
        </div>
      )}
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          submit(text);
        }}
      >
        <label htmlFor="chat-input" className="composer-label">
          {t("chat.message")}
        </label>
        <textarea
          id="chat-input"
          className="input"
          aria-describedby="chat-hint"
          rows={2}
          maxLength={1000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit(text);
            }
          }}
        />
        <button type="submit" className="btn" disabled={pending || !text.trim()} aria-label={t("chat.send")}>
          <Send aria-hidden="true" size={20} />
        </button>
        <p id="chat-hint" className="muted small composer-hint">
          {t("chat.hint")}
        </p>
      </form>
      {canContinue && !showForm && (
        <div className="card stack">
          <h2>{t("chat.noted")}</h2>
          <p className="muted small">
            <Bot aria-hidden="true" size={16} /> {t("chat.aiLabel")}: {draft.fields.reason_for_visit}
            {draft.fields.symptom_duration ? ` · ${draft.fields.symptom_duration}` : ""}
          </p>
          <button type="button" className="btn btn--block" disabled={save.isPending} onClick={() => save.mutate(draft.fields)}>
            {t("chat.done")}
          </button>
        </div>
      )}
      {save.isError && <p role="alert">{t("error.generic")}</p>}
      {!showForm ? (
        <button type="button" className="btn btn--link" onClick={() => openForm()}>
          {t("chat.useForm")}
        </button>
      ) : (
        <div ref={formRef}>
          <AssessmentForm
            initial={formInitial}
            busy={save.isPending}
            onSubmit={async (v) => void (await save.mutateAsync(v).catch(() => undefined))}
          />
        </div>
      )}
    </StepPage>
  );
}

function Bubble({ who, content }: { who: ChatTurn["role"]; content: string }) {
  const ai = who === "assistant";
  return (
    <div className={`bubble ${ai ? "bubble--ai" : "bubble--user"}`}>
      <p className="bubble-who small">
        {ai ? (
          <>
            <span className="ai-badge">{t("chat.aiLabel")}</span> {t("chat.assistant")}
          </>
        ) : (
          t("chat.you")
        )}
      </p>
      {/* Plain text only: model output is never rendered as HTML or links. */}
      <p className="bubble-text">{content}</p>
    </div>
  );
}
