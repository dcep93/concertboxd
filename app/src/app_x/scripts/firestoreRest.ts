/** Administrative one-off tooling. Never imported by the application. */
import { createRequire } from "node:module";
import { Timestamp } from "firebase/firestore";

export type Raw = Record<string, any>;
export type FirestoreDocument = { name: string; fields: Raw; updateTime: string };
export const project = "concertboxd";
export const documentRoot = `projects/${project}/databases/(default)/documents`;
const endpoint = `https://firestore.googleapis.com/v1/${documentRoot}`;

export function decode(value: Raw): any {
  if (value.mapValue) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, child]) => [key, decode(child as Raw)]));
  if (value.arrayValue) return (value.arrayValue.values || []).map(decode);
  if ("timestampValue" in value) {
    const text: string = value.timestampValue;
    const seconds = Math.floor(Date.parse(text) / 1000);
    const nanos = Number((text.match(/\.(\d+)Z$/)?.[1] || "").padEnd(9, "0"));
    return new Timestamp(seconds, nanos);
  }
  if ("integerValue" in value) {
    const number = Number(value.integerValue);
    if (!Number.isSafeInteger(number)) throw new Error("Unsafe integer in backup");
    return number;
  }
  for (const key of ["stringValue", "booleanValue", "doubleValue", "nullValue"]) if (key in value) return value[key];
  throw new Error("Unsupported Firestore value; retain raw backup and review");
}

export function encode(value: any): Raw {
  if (value instanceof Timestamp) return { timestampValue: `${new Date(value.seconds * 1000).toISOString().slice(0, 19)}.${String(value.nanoseconds).padStart(9, "0")}Z` };
  if (value === null) return { nullValue: null };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  if (typeof value === "object") return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, child]) => [key, encode(child)])) } };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number" && Number.isFinite(value)) return Number.isSafeInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  throw new Error("Unsupported value in projection");
}

export function records(docs: FirestoreDocument[]): Raw {
  return Object.fromEntries(docs.map(doc => [doc.name.split("/").at(-1)!, decode({ mapValue: { fields: doc.fields || {} } })]));
}

export function googleAuth(scopes: string[]) {
  const localRequire = createRequire(import.meta.url);
  // Resolve the existing locked dependency through its declaring package (also works with pnpm).
  const require = createRequire(localRequire.resolve("firebase-tools/package.json"));
  const { GoogleAuth } = require("google-auth-library");
  return new GoogleAuth({ scopes });
}

export async function adminRest(scopes = ["https://www.googleapis.com/auth/cloud-platform", "https://www.googleapis.com/auth/firebase"]) {
  // GitHub supplies the existing deployment service account through ADC.
  // No credential contents or access tokens are written to logs or backups.
  const auth = googleAuth(scopes);
  if (await auth.getProjectId() !== project) throw new Error("Deployment credential project does not match concertboxd");
  const token = { access_token: await auth.getAccessToken() };
  if (!token.access_token) throw new Error("No deployment credential available");
  async function request(path: string, body?: Raw, method = body ? "POST" : "GET"): Promise<any> {
    const response = await fetch(endpoint + path, { method, headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new Error(`Firestore HTTP ${response.status}: ${await response.text()}`);
    return response.json();
  }
  async function list(collection: string): Promise<FirestoreDocument[]> {
    const docs: FirestoreDocument[] = [];
    let pageToken = "";
    do {
      const page = await request(`/${collection}?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`);
      docs.push(...(page.documents || []));
      pageToken = page.nextPageToken || "";
    } while (pageToken);
    return docs;
  }
  async function deployedRules(): Promise<string[]> {
    const rulesRoot = "https://firebaserules.googleapis.com/v1/";
    async function read(path: string) {
      if (!path.startsWith(`projects/${project}/`)) throw new Error("Unexpected rules project");
      const response = await fetch(rulesRoot + path, { headers: { Authorization: `Bearer ${token.access_token}` } });
      if (!response.ok) throw new Error(`Cannot verify deployed rules: HTTP ${response.status}`);
      return response.json();
    }
    const release = await read(`projects/${project}/releases/cloud.firestore`);
    const ruleset = await read(release.rulesetName);
    return ruleset.source.files.map((file: { content: string }) => file.content);
  }
  return { request, list, deployedRules };
}
