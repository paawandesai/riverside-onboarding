import { HeartHandshake } from "lucide-react";
import type { SupportContent } from "../api";
import { t } from "../i18n";

type Props = { content: SupportContent; onAction: (action: string) => void; onDismiss: () => void };

export function SupportCard({ content, onAction, onDismiss }: Props) {
  return (
    <aside className="support stack" aria-labelledby="support-title" data-trigger={content.trigger}>
      <h2 id="support-title">
        <HeartHandshake aria-hidden="true" size={22} />
        {content.title}
      </h2>
      <p>{content.body}</p>
      <div className="row">
        {content.actions.map((a, i) => (
          <button key={a} type="button" className={i === 0 ? "btn" : "btn btn--secondary"} onClick={() => onAction(a)}>
            {a}
          </button>
        ))}
        <button type="button" className="btn btn--link" onClick={onDismiss}>
          {t("common.dismiss")}
        </button>
      </div>
    </aside>
  );
}
