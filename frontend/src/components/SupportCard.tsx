import type { SupportContent } from "../api";

type Props = { content: SupportContent; onAction?: (action: string) => void; onDismiss?: () => void };

export function SupportCard({ content, onAction, onDismiss }: Props) {
  return (
    <aside
      className={`support ${content.urgent ? "support--urgent" : ""}`}
      role={content.urgent ? "alert" : "status"}
      aria-labelledby="support-title"
      data-trigger={content.trigger}
    >
      <h2 id="support-title">
        <span aria-hidden="true">{content.urgent ? "⚠️ " : "💬 "}</span>
        {content.title}
      </h2>
      <p>{content.body}</p>
      <div className="row">
        {content.actions.map((a) => (
          <button key={a} type="button" className="secondary" onClick={() => onAction?.(a)}>
            {a}
          </button>
        ))}
        {onDismiss && !content.urgent && (
          <button type="button" className="link" onClick={onDismiss}>
            Dismiss
          </button>
        )}
      </div>
    </aside>
  );
}
