import { useRef, useState } from "react";
import { useNotesDraft } from "./useNotesDraft";
import { saveLog } from "../data/actions";
import type { UserConcert } from "../data/model";
import type { LogPatch } from "../data/tableActions";
import { errorMessage } from "../components/errors";

type Controls = Omit<LogPatch, "notes">;

export function useLogEditor(concertId: string, uid?: string, log?: UserConcert) {
  const readOnly = !uid || (!!log && log.user_id !== uid);
  const [pending, setPending] = useState<Controls | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<"notes" | "controls" | null>(null);
  const inFlight = useRef(false);
  const savedNotes = log?.notes || "";
  const { notes, setNotesDraft } = useNotesDraft(concertId, readOnly ? undefined : uid, savedNotes);
  const selected = pending?.supporting_artist_ids ?? log?.supporting_artist_ids ?? [];
  const seen = pending?.seen_set_ids ?? log?.seen_set_ids ?? [];
  const ticketStatus = pending?.ticket_status ?? log?.ticket_status ?? "";
  const hidden = pending?.removed ?? log?.removed ?? false;
  const busy = saving !== null;

  if (pending) {
    // Keep the optimistic value until the subscription acknowledges it.
    const remaining = Object.fromEntries(Object.entries(pending).filter(([key, value]) => {
      const stored = log?.[key as keyof Controls] ?? (key === "removed" ? false : key === "ticket_status" ? "" : []);
      return JSON.stringify(stored) !== JSON.stringify(value);
    }));
    if (Object.keys(remaining).length !== Object.keys(pending).length)
      setPending(Object.keys(remaining).length ? remaining : null);
  }

  async function persist(patch: LogPatch, kind: "notes" | "controls") {
    if (readOnly || !uid || inFlight.current) return;
    inFlight.current = true;
    setSaving(kind);
    setError("");
    if (kind === "controls") setPending(previous => ({ ...previous, ...patch }));
    try {
      await saveLog(uid, concertId, patch, patch.removed === false);
    } catch (caught) {
      if (kind === "controls") setPending(null);
      setError(errorMessage(caught));
    } finally {
      inFlight.current = false;
      setSaving(null);
    }
  }
  return { readOnly, notes, setNotesDraft, savedNotes, selected, seen, ticketStatus, hidden, busy, saving, error, persist };
}

export type LogEditing = ReturnType<typeof useLogEditor>;
