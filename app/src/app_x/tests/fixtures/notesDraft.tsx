import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useLogEditor } from '../../forms/useLogEditor';
import { LogEditor } from '../../forms/LogEditor';
import { normalizeLog } from '../../data/model';
import type { UserConcert } from '../../data/model';
import type { FixtureSave } from './notesDraft.actions';

function Editor({ concertId, uid, log }: { concertId: string; uid?: string; log: UserConcert }) {
  const editor = useLogEditor(concertId, uid, log);
  return <><LogEditor editor={editor} /><output aria-label="Save error">{editor.error}</output></>;
}
export function Fixture() {
  const [uid, setUid] = useState('owner');
  const [concertId, setConcertId] = useState('a');
  const [mounted, setMounted] = useState(true);
  const [mode, setMode] = useState('success');
  const [pending, setPending] = useState<FixtureSave | null>(null);
  const [logs, setLogs] = useState<Record<string, UserConcert>>({});
  const owner = uid || 'owner';
  const id = `${owner}_${concertId}`;
  const log = logs[id] ?? normalizeLog(id, {
    user_id: owner, concert_id: concertId, notes: `${owner} ${concertId} published`,
  });
  function complete(save: FixtureSave) {
    const key = `${save.uid}_${save.concertId}`;
    setLogs(previous => ({ ...previous, [key]: normalizeLog(key, {
      ...previous[key], user_id: save.uid, concert_id: save.concertId, ...save.patch,
    }) }));
    save.resolve();
    setPending(null);
  }
  useEffect(() => {
    const onSave = (event: Event) => {
      const save = (event as CustomEvent<FixtureSave>).detail;
      if (mode === 'failure') save.reject(new Error('Fixture save failed'));
      else if (mode === 'delayed') setPending(save);
      else complete(save);
    };
    window.addEventListener('fixture-save', onSave);
    return () => window.removeEventListener('fixture-save', onSave);
  }, [mode]);
  return <>
    <label>Account<select aria-label="Account" value={uid} onChange={event => setUid(event.target.value)}>
      <option value="owner">Owner</option><option value="other">Other</option><option value="">Guest</option>
    </select></label>
    <label>Concert<select aria-label="Concert" value={concertId} onChange={event => setConcertId(event.target.value)}>
      <option value="a">A</option><option value="b">B</option>
    </select></label>
    <label>Save mode<select aria-label="Save mode" value={mode} onChange={event => setMode(event.target.value)}>
      <option value="success">Success</option><option value="failure">Failure</option><option value="delayed">Delayed</option>
    </select></label>
    <label>Show editor<input type="checkbox" checked={mounted} onChange={event => setMounted(event.target.checked)} /></label>
    {pending && <button onClick={() => complete(pending)}>Complete save</button>}
    <output aria-label="Published notes">{log.notes}</output>
    {mounted && <Editor concertId={concertId} uid={uid || undefined} log={log} />}
  </>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>);
