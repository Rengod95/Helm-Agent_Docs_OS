import { err, ok, type Result } from "@xeon/contracts";

// L0.secrets.spec §4.6 2번. SOPS 파일의 키 이름을 평문으로 읽는다. 복호화하지 않고 sops를 부르지도 않는다.
// YAML·JSON은 값이 `ENC[`로 시작하는 문자열인 항목, dotenv는 `KEY=ENC[...]` 줄이다.
// 중첩 키는 `a.b` 형식 경로로 내보낸다.

export type SopsFileFormat = "yaml" | "json" | "dotenv";

export interface SopsKeyListing {
  /** `ENC[` 값을 가진 키 경로. 사전순 */
  readonly keys: readonly string[];
  /** 파일의 sops.lastmodified(epoch ms). 없으면 null */
  readonly lastModified: number | null;
}

export type SopsKeysError =
  | { readonly kind: "unparseable" }
  | { readonly kind: "invalid_key_path" };

const ENCRYPTED_PREFIX = "ENC[";
/** 키 경로의 한 마디로 허용하는 글자. 점·따옴표·대괄호가 든 키는 `--extract` 경로를 모호하게 하므로 목록에서 뺀다 */
const SEGMENT = /^[A-Za-z0-9_-]+$/;

export function formatOfPath(path: string): SopsFileFormat {
  const lower = path.toLowerCase();
  if (lower.endsWith(".json")) return "json";
  const base = lower.slice(lower.lastIndexOf("/") + 1);
  if (base === ".env" || base.startsWith(".env.") || base.endsWith(".env")) return "dotenv";
  return "yaml";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collect(node: Record<string, unknown>, prefix: readonly string[], out: string[]): void {
  for (const [key, value] of Object.entries(node)) {
    if (prefix.length === 0 && key === "sops") continue;
    if (!SEGMENT.test(key)) continue;
    const path = [...prefix, key];
    if (typeof value === "string") {
      if (value.startsWith(ENCRYPTED_PREFIX)) out.push(path.join("."));
    } else if (isRecord(value)) {
      collect(value, path, out);
    }
  }
}

function lastModifiedOf(sops: unknown): number | null {
  if (!isRecord(sops)) return null;
  const raw = sops["lastmodified"];
  if (typeof raw !== "string") return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : ms;
}

function parseDotenv(content: string): SopsKeyListing {
  const keys: string[] = [];
  let lastModified: number | null = null;
  for (const line of content.split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq <= 0 || line.startsWith("#")) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key === "sops_lastmodified") {
      const ms = Date.parse(value);
      lastModified = Number.isNaN(ms) ? null : ms;
      continue;
    }
    // sops_mac 같은 메타데이터 줄도 ENC[로 시작하므로 sops_ 접두를 통째로 건너뛴다
    if (key.startsWith("sops_")) continue;
    if (!SEGMENT.test(key)) continue;
    if (value.startsWith(ENCRYPTED_PREFIX)) keys.push(key);
  }
  return { keys: keys.toSorted(), lastModified };
}

export function parseSopsKeys(
  content: string,
  format: SopsFileFormat,
): Result<SopsKeyListing, SopsKeysError> {
  if (format === "dotenv") return ok(parseDotenv(content));
  let doc: unknown;
  try {
    doc = format === "json" ? JSON.parse(content) : Bun.YAML.parse(content);
  } catch {
    return err({ kind: "unparseable" });
  }
  if (!isRecord(doc)) return err({ kind: "unparseable" });
  const keys: string[] = [];
  collect(doc, [], keys);
  return ok({ keys: keys.toSorted(), lastModified: lastModifiedOf(doc["sops"]) });
}

/** `a.b` 경로를 sops `--extract` 인자(`["a"]["b"]`)로 바꾼다. 마디는 SEGMENT 검사를 통과한 것만 받는다 */
export function extractArgument(keyPath: string): Result<string, SopsKeysError> {
  const parts = keyPath.split(".");
  if (!parts.every((p) => SEGMENT.test(p))) return err({ kind: "invalid_key_path" });
  return ok(parts.map((p) => `["${p}"]`).join(""));
}
