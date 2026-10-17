import { HeartHandshake } from "lucide-react";
import { useEffect, useRef } from "react";
import type { SupportAction, SupportContent } from "../api";
import { t } from "../i18n";

type Props = {
  content: SupportContent;
  onAction: (action: SupportAction) => void;
  onDismiss: () => void;
};

export function SupportCard({ content, onAction, onDismiss }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  // Urgent content (crisis lines) is announced at once and gets focus, not left in a polite queue.
  useEffect(() => {
    if (content.urgent) heading.current?.focus();
  }, [content]);
  return (
    <aside
      className="support stack"
      aria-labelledby="support-title"
      data-trigger={content.trigger}
      role={content.urgent ? "alert" : undefined}
    >
      <h2 id="support-title" ref={heading} tabIndex={-1}>
        <HeartHandshake aria-hidden="true" size={22} />
        {content.title}
      </h2>
      <p>{content.body}</p>
      <div className="row">
        {content.actions.map((a, i) => (
          <button key={a.id} type="button" className={i === 0 ? "btn" : "btn btn--secondary"} onClick={() => onAction(a.id)}>
            {a.label}
          </button>
        ))}
        <button type="button" className="btn btn--link" onClick={onDismiss}>
          {t("common.dismiss")}
        </button>
      </div>
    </aside>
  );
}
