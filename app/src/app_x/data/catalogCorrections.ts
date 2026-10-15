/** Reviewed catalog-only patches. Never modify personal records. */
import { isDeepStrictEqual as equal } from "node:util";
import { Timestamp } from "firebase/firestore";
import { cleanSchema } from "./cleanSchema";
import { timestampISO } from "./model";
import { validateTableSize, type TableBackup } from "./migrateTables";
import { tableNames } from "./tables";

type Row = Record<string, any>;
type CatalogUpdate = { id: string; expected: Row; expected_absent?: string[]; changes: Row; sources: string[] };
export type CatalogCorrections = {
  id: string;
  artists: Record<string, Row>;
  venues?: Record<string, Row>;
  concert_additions?: { id: string; concert: Row; schedule?: Row; sources: string[] }[];
  lineup_additions: { concert_id: string; artist_id: string; set_id: string; set: Row; sources: string[] }[];
  concert_updates: CatalogUpdate[];
  artist_updates?: CatalogUpdate[];
  venue_updates?: CatalogUpdate[];
};

export function projectCorrections(current: TableBackup, patch: CatalogCorrections): TableBackup {
  const next: TableBackup = { ...current, artists: { ...current.artists }, venues: { ...current.venues }, concerts: { ...current.concerts }, schedules: { ...current.schedules } };
  for (const [id, value] of Object.entries(patch.artists)) {
    if (next.artists[id] && !Object.entries(value).every(([key, field]) => equal(next.artists[id][key], field))) throw new Error(`Conflicting artist ${id}`);
    next.artists[id] ||= value;
  }
  for (const [id, value] of Object.entries(patch.venues || {})) {
    if (next.venues[id] && !equal(next.venues[id], value)) throw new Error(`Conflicting venue ${id}`);
    next.venues[id] ||= value;
  }
  for (const { id, concert, schedule, sources } of patch.concert_additions || []) {
    if (!/^[a-z0-9]{6}$/.test(id) || !sources.length || !concert.date) throw new Error(`Invalid concert addition ${id}`);
    const value: Row = { ...concert, date: Timestamp.fromDate(new Date(concert.date)) };
    if (next.concerts[id]) {
      if (!equal(next.concerts[id], value) || !equal(next.schedules[id], schedule)) throw new Error(`Conflicting concert ${id}`);
      continue;
    }
    if (next.schedules[id]) throw new Error(`Orphan schedule ${id}`);
    if (Object.values(next.concerts).some(row => row.name === value.name && row.artist_id === value.artist_id
      && row.venue_id === value.venue_id && Date.parse(timestampISO(row.date)) === value.date.toMillis()))
      throw new Error(`Concert already exists: ${id}`);
    next.concerts[id] = value;
    if (schedule) next.schedules[id] = schedule;
  }
  for (const addition of patch.lineup_additions) {
    const { concert_id: id, artist_id: artist, set_id: setId, set } = addition;
    const concert = next.concerts[id];
    const schedule = next.schedules[id];
    if (!concert || !schedule || !next.artists[artist] || set.artist_id !== artist || !addition.sources.length) throw new Error(`Invalid lineup addition ${id}`);
    if (schedule.sets[setId] && !equal(schedule.sets[setId], set)) throw new Error(`Conflicting set ${id}/${setId}`);
    if (!schedule.sets[setId] && Object.values(schedule.sets).some((row: any) => row.artist_id === artist && row.day === set.day)) throw new Error(`Artist already scheduled: ${id}/${artist}`);
    next.concerts[id] = { ...concert, supporting_artist_ids: [...new Set([...(concert.supporting_artist_ids || []), artist])] };
    next.schedules[id] = { ...schedule, sets: { ...schedule.sets, [setId]: set } };
  }
  for (const [table, updates] of [
    ["concerts", patch.concert_updates], ["artists", patch.artist_updates || []], ["venues", patch.venue_updates || []],
  ] as const) for (const update of updates) {
    const row = next[table][update.id];
    if (!row || !update.sources.length) throw new Error(`Missing ${table} record or source: ${update.id}`);
    const same = (key: string, value: unknown) => table === "concerts" && key === "date" ? Date.parse(timestampISO(row.date)) === Date.parse(value as string) : equal(row[key], value);
    if (Object.entries(update.changes).every(([key, value]) => same(key, value))) continue;
    if (update.expected_absent?.some(key => Object.hasOwn(row, key))) throw new Error(`${table} record edited since research: ${update.id}`);
    if (!Object.entries(update.expected).every(([key, value]) => same(key, value))) throw new Error(`${table} record edited since research: ${update.id}`);
    const changes = { ...update.changes };
    if (table === "concerts" && typeof changes.date === "string") changes.date = Timestamp.fromDate(new Date(changes.date));
    next[table][update.id] = { ...row, ...changes };
  }
  if (!equal(cleanSchema(next), next)) throw new Error("Catalog correction violates clean schema");
  for (const name of tableNames) validateTableSize(next[name]);
  return next;
}

export type CatalogRevision = { patch: CatalogCorrections; hash: string };

/** Skip receipts before projecting: subsequent edits must survive redeployments. */
export function projectRevisions(current: TableBackup, revisions: CatalogRevision[], applied: Record<string, string>) {
  let prepared = current;
  const receipts = { ...applied };
  const pending: CatalogRevision[] = [];
  const ids = new Set<string>();
  for (const revision of revisions) {
    const { patch, hash } = revision;
    if (!patch.id || ids.has(patch.id)) throw new Error(`Duplicate or empty catalog revision: ${patch.id}`);
    ids.add(patch.id);
    if (Object.hasOwn(applied, patch.id)) {
      if (applied[patch.id] !== hash) throw new Error("Previously applied patch changed; create a new reviewed revision");
      continue;
    }
    prepared = projectCorrections(prepared, patch);
    receipts[patch.id] = hash;
    pending.push(revision);
  }
  return { prepared, receipts, pending };
}
