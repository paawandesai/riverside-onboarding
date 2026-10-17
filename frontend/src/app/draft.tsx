import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { AssessmentFields, ChatTurn, ExtractResult } from "../api";

/**
 * In-memory working state shared between steps (chat transcript, what OCR read).
 * Deliberately not persisted to localStorage/sessionStorage: it can contain personal data.
 */
type Draft = {
  transcript: ChatTurn[];
  setTranscript: (t: ChatTurn[]) => void;
  fields: AssessmentFields;
  setFields: (f: AssessmentFields) => void;
  extracted: ExtractResult | null;
  setExtracted: (e: ExtractResult | null) => void;
  clear: () => void;
};

const DraftContext = createContext<Draft | null>(null);

export function DraftProvider({ children }: { children: ReactNode }) {
  const [transcript, setTranscript] = useState<ChatTurn[]>([]);
  const [fields, setFields] = useState<AssessmentFields>({});
  const [extracted, setExtracted] = useState<ExtractResult | null>(null);
  const value = useMemo(
    () => ({
      transcript,
      setTranscript,
      fields,
      setFields,
      extracted,
      setExtracted,
      clear: () => {
        setTranscript([]);
        setFields({});
        setExtracted(null);
      },
    }),
    [transcript, fields, extracted],
  );
  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

export function useDraft(): Draft {
  const ctx = useContext(DraftContext);
  if (!ctx) throw new Error("useDraft outside DraftProvider");
  return ctx;
}
