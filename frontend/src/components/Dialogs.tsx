import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { t } from "../i18n";

type DialogProps = { open: boolean; onOpenChange: (open: boolean) => void; title: string; children: ReactNode };

export function Modal({ open, onOpenChange, title, children }: DialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog card stack" aria-describedby={undefined}>
          <Dialog.Title asChild>
            <h2>{title}</h2>
          </Dialog.Title>
          {children}
          <Dialog.Close asChild>
            <button type="button" className="btn btn--link dialog-close" aria-label={t("help.close")}>
              <X aria-hidden="true" size={22} />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function HelpDialog({ open, onOpenChange }: Omit<DialogProps, "title" | "children">) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t("help.title")}>
      <p>{t("help.body", { phone: t("clinic.phone") })}</p>
      <Dialog.Close asChild>
        <button type="button" className="btn btn--secondary">
          {t("help.close")}
        </button>
      </Dialog.Close>
    </Modal>
  );
}

type ConfirmProps = Omit<DialogProps, "children" | "title"> & { body: string; onConfirm: () => void; busy?: boolean };

export function ConfirmDialog({ open, onOpenChange, body, onConfirm, busy }: ConfirmProps) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t("privacy.confirmTitle")}>
      <p>{body}</p>
      <div className="row">
        <button type="button" className="btn btn--danger" onClick={onConfirm} disabled={busy}>
          {t("privacy.confirmYes")}
        </button>
        <Dialog.Close asChild>
          <button type="button" className="btn btn--secondary">
            {t("privacy.cancel")}
          </button>
        </Dialog.Close>
      </div>
    </Modal>
  );
}
