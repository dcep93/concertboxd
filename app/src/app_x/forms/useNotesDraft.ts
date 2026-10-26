import { useEffect, useMemo, useState } from "react";

function draftSession(key: string | null) {
  let initialDraft: string | null = null;
  try {
    if (key) initialDraft = window.localStorage.getItem(key);
  } catch { /* Storage may be blocked; editing still works. */ }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending = false;
  let latest: string | null = null;
  function flush() {
    clearTimeout(timer);
    if (!key || !pending) return;
    pending = false;
    try {
      if (latest === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, latest);
    } catch { /* Quota or privacy settings must not interrupt editing. */ }
  }
  function schedule(value: string | null) {
    if (!key) return;
    clearTimeout(timer);
    latest = value;
    pending = true;
    if (value === null) flush();
    else timer = setTimeout(flush, 300);
  }
  return { initialDraft, schedule, flush };
}

export function useNotesDraft(concertId: string, uid: string | undefined, savedNotes: string) {
  const key = uid ? `concertboxd:public-notes:v1:${JSON.stringify([uid, concertId])}` : null;
  const session = useMemo(() => draftSession(key), [key]);
  const [state, setState] = useState(() => ({ session, value: session.initialDraft }));
  const value = state.session === session ? state.value : session.initialDraft;
  const draft = value === savedNotes ? null : value;
  // Reset during render so a changed identity never displays or writes the old draft.
  if (state.session !== session || state.value !== draft) setState({ session, value: draft });

  useEffect(() => { session.schedule(draft); }, [session, draft]);
  useEffect(() => {
    const onHidden = () => { if (document.visibilityState === "hidden") session.flush(); };
    window.addEventListener("pagehide", session.flush);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pagehide", session.flush);
      document.removeEventListener("visibilitychange", onHidden);
      session.flush();
    };
  }, [session]);

  return {
    notes: draft ?? savedNotes,
    setNotesDraft: (value: string) => setState({ session, value }),
  };
}
