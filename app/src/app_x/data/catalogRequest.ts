/** Untrusted issue JSON -> a narrow, public-only correction. No code or paths. */
import { createHash } from "node:crypto";
import { isDeepStrictEqual as equal } from "node:util";
import { DateTime } from "luxon";
import { projectRevisions, type CatalogCorrections } from "./catalogCorrections";
import type { TableBackup } from "./migrateTables";
import { timestampISO } from "./model";

type Row = Record<string, any>;
export const catalogTables = ["artists", "venues", "concerts", "schedules"] as const;
export const fields = {
  artists: ["name", "image"], venues: ["name", "timezone", "location", "image"],
  concerts: ["name", "date", "date_precision", "end_date", "venue_id", "artist_id", "supporting_artist_ids", "setlist_fm_url", "purchase_link"],
} as const;
type Table = keyof typeof fields;
export type Operation = { op: "add" | "update"; table: Table; id: string; values: Row; expected?: Row; expected_absent?: string[]; sources: string[] };
export type CatalogRequest = { version: 1; mode: "apply" | "smoke"; request_id: string; public_catalog_only: true; operations: Operation[] };
export const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
export function requireThat(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
function object(value: any): asserts value is Row { requireThat(value && typeof value === "object" && !Array.isArray(value), "Expected object"); }
function keys(value: any, allowed: readonly string[]) {
  object(value); requireThat(Object.keys(value).every(key => allowed.includes(key)), "Unknown request field");
}
function id(value: any) { requireThat(typeof value === "string" && /^[a-z0-9]{6}$/.test(value), "IDs must be six lowercase letters/digits"); }
function text(value: any) {
  requireThat(typeof value === "string" && value.trim().length > 0 && value.length <= 240
    && ![...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    && !/[<>`{}\\]|\$\(|https?:|@/i.test(value), "Invalid public label");
}
export function publicUrl(value: any) {
  requireThat(typeof value === "string" && value.length <= 2048, "Invalid public URL");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Invalid public URL"); }
  requireThat(url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash && !url.port
    && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname) && !/(^|\.)(localhost|local|internal|test|invalid)$/i.test(url.hostname)
    && !/[\s<>`\\]|\$\(/.test(value), "URL must be public HTTPS without credentials, query or fragment");
}
function day(value: any) {
  requireThat(typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && DateTime.fromISO(value, { zone: "UTC" }).isValid, "Invalid calendar date");
}
function values(table: Table, row: any) {
  keys(row, fields[table]);
  for (const [key, value] of Object.entries(row)) {
    if (["image", "purchase_link", "setlist_fm_url"].includes(key)) { if (value !== "") publicUrl(value); }
    else if (key === "timezone") requireThat(typeof value === "string" && value.includes("/") && DateTime.now().setZone(value).isValid, "Invalid IANA timezone");
    else if (["artist_id", "venue_id"].includes(key)) { if (key !== "artist_id" || value !== "") id(value); }
    else if (key === "supporting_artist_ids") {
      requireThat(Array.isArray(value) && value.length <= 100 && new Set(value).size === value.length, "Invalid lineup"); value.forEach(id);
    } else if (key === "date") {
      requireThat(typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[+-]\d{2}:\d{2})$/.test(value)
        && DateTime.fromISO(value, { setZone: true }).isValid, "Date requires valid ISO timestamp and offset");
    } else if (key === "end_date") day(value);
    else if (key === "date_precision") requireThat(value === "day" || value === "time", "Invalid date precision");
    else text(value);
  }
}
export function parseRequest(body: string): CatalogRequest {
  requireThat(typeof body === "string" && Buffer.byteLength(body, "utf8") <= 32768, "Request exceeds 32 KiB");
  // Reject dangerous property names even nested inside an otherwise invalid request.
  let request: any;
  try {
    request = JSON.parse(body, (key, value) => {
      requireThat(!["__proto__", "prototype", "constructor"].includes(key), "Unsafe property"); return value;
    });
  } catch { throw new Error("Unsafe or malformed request JSON"); }
  keys(request, ["version", "mode", "request_id", "public_catalog_only", "operations"]);
  requireThat(request.version === 1 && ["apply", "smoke"].includes(request.mode) && request.public_catalog_only === true, "Unsupported version, mode or missing public-only attestation");
  requireThat(typeof request.request_id === "string" && /^[a-z][a-z0-9-]{5,79}$/.test(request.request_id), "Invalid request ID");
  requireThat(Array.isArray(request.operations) && request.operations.length <= 25
    && (request.mode === "smoke" ? request.operations.length === 0 : request.operations.length > 0), "Invalid operation count");
  const targets = new Set<string>();
  for (const op of request.operations) {
    keys(op, ["op", "table", "id", "values", "expected", "expected_absent", "sources"]);
    requireThat(["add", "update"].includes(op.op) && Object.hasOwn(fields, op.table), "Forbidden operation/table");
    id(op.id); values(op.table, op.values);
    requireThat(Object.keys(op.values).length > 0, "Empty operation");
    const target = `${op.table}/${op.id}`; requireThat(!targets.has(target), "Duplicate target"); targets.add(target);
    requireThat(Array.isArray(op.sources) && op.sources.length > 0 && op.sources.length <= 5, "Public sources required"); op.sources.forEach(publicUrl);
    if (op.op === "add") {
      requireThat(op.expected === undefined && op.expected_absent === undefined, "Add cannot have update preconditions");
      const required = op.table === "concerts" ? ["date", "date_precision", "venue_id"] : op.table === "venues" ? ["name", "timezone"] : ["name"];
      requireThat(required.every(key => Object.hasOwn(op.values, key)), "Missing required public fields");
      if (op.table === "concerts") requireThat(op.values.artist_id || op.values.name, "Concert requires artist or festival name");
    } else {
      values(op.table, op.expected);
      requireThat(Array.isArray(op.expected_absent) && new Set(op.expected_absent).size === op.expected_absent.length
        && op.expected_absent.every((key: string) => fields[op.table as Table].includes(key as never) && !Object.hasOwn(op.expected, key)), "Invalid absent preconditions");
      requireThat(Object.keys(op.values).every(key => Object.hasOwn(op.expected, key) || op.expected_absent.includes(key)), "Every changed field needs a precondition");
    }
  }
  return request;
}

/** Reuse the correction engine but tighten its permissive historical replay behavior. */
export function projectRequest(current: TableBackup, request: CatalogRequest, hash: string, applied: Record<string, string>) {
  const patch: CatalogCorrections = { id: `issue-${request.request_id}`, artists: {}, venues: {}, lineup_additions: [], concert_updates: [], artist_updates: [], venue_updates: [], concert_additions: [] };
  if (Object.hasOwn(applied, patch.id)) return projectRevisions(current, [{ patch, hash }], applied);
  for (const op of request.operations) {
    const row = current[op.table][op.id];
    if (op.op === "add") {
      requireThat(!row, "Add target already exists");
      if (op.table === "concerts") patch.concert_additions!.push({ id: op.id, concert: op.values, sources: op.sources });
      else patch[op.table]![op.id] = op.values;
    } else {
      requireThat(row, "Missing update target");
      requireThat(Object.entries(op.expected!).every(([key, value]) => equal(key === "date" ? timestampISO(row[key]) : row[key], key === "date" ? new Date(value).toISOString() : value))
        && op.expected_absent!.every(key => !Object.hasOwn(row, key)), "Stale expected value");
      const update = { id: op.id, expected: op.expected!, expected_absent: op.expected_absent, changes: op.values, sources: op.sources };
      if (op.table === "concerts") patch.concert_updates.push(update);
      else if (op.table === "artists") patch.artist_updates!.push(update);
      else patch.venue_updates!.push(update);
    }
  }
  const result = projectRevisions(current, [{ patch, hash }], applied);
  for (const op of request.operations) {
    const row = result.prepared[op.table][op.id];
    values(op.table, { ...row, ...(op.table === "concerts" ? { date: timestampISO(row.date).replace(".000Z", "Z") } : {}) });
    if (op.table !== "concerts") continue;
    requireThat(row.artist_id || row.name, "Concert requires artist or festival name");
    const zone = result.prepared.venues[row.venue_id]?.timezone;
    requireThat(zone && DateTime.now().setZone(zone).isValid, "Venue needs a valid timezone");
    const iso = timestampISO(row.date);
    if (row.date_precision === "day") requireThat(iso.endsWith("T00:00:00.000Z"), "Day precision requires UTC midnight");
    const startDay = row.date_precision === "day" ? iso.slice(0, 10) : DateTime.fromISO(iso).setZone(zone).toISODate()!;
    if (row.end_date) requireThat(row.end_date >= startDay, "End date precedes concert");
    const requestedDate = op.values.date;
    if (requestedDate && row.date_precision === "time" && !requestedDate.endsWith("Z")) {
      requireThat(DateTime.fromISO(requestedDate, { setZone: true }).offset === DateTime.fromISO(requestedDate).setZone(zone).offset, "Date offset disagrees with venue timezone");
    }
    const identity = (item: Row) => `${item.venue_id}|${item.artist_id || (item.name || "").trim().toLowerCase()}|${Date.parse(timestampISO(item.date))}`;
    requireThat(!Object.entries(result.prepared.concerts).some(([other, item]) => other !== op.id && identity(item) === identity(row)), "Duplicate event");
  }
  return result;
}
