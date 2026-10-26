import type { LogPatch } from '../../data/tableActions';
export type FixtureSave = {
  uid: string; concertId: string; patch: LogPatch;
  resolve: () => void; reject: (error: Error) => void;
};
export async function saveLog(uid: string, concertId: string, patch: LogPatch) {
  await new Promise<void>((resolve, reject) => {
    window.dispatchEvent(new CustomEvent<FixtureSave>('fixture-save', {
      detail: { uid, concertId, patch, resolve, reject },
    }));
  });
}
