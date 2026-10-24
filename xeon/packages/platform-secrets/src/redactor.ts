import { attempt, err, ok, type Result } from "@xeon/contracts";
import type { RedactionHit, SecretName } from "@xeon/contracts/capabilities";
import type { RegisterKnownError, Redactor } from "@xeon/contracts/services";

// L0.secrets.spec §3.5. docs/design/18-security.md §3.10.4의 규칙 1~3을 옮긴 것이다.
// 마스킹은 보조 수단이다. 등록하지 않은 인코딩이나 조각난 값은 잡지 못한다.
// 등록부는 부모 프로세스 메모리에만 있고 직렬화하지 않는다. 변형 문자열도 값과 같은 수준으로 다룬다.

/** 이 길이보다 짧은 값은 등록하지 않는다(spec §3.5) */
const MIN_KNOWN_BYTES = 8;
/** 변형 문자열이 이보다 짧으면 일반 텍스트에 우연히 맞으므로 등록하지 않는다 */
const MIN_VARIANT_CHARS = 8;

const STRICT_DECODER = new TextDecoder("utf-8", { fatal: true });

/** 유효한 UTF-8일 때만 문자열을 돌려준다. 아니면 문자열 변형(원문, URL, JSON)은 만들지 않는다 */
function decodeStrict(bytes: Uint8Array): string | null {
  const decoded = attempt(() => STRICT_DECODER.decode(bytes));
  return decoded.ok ? decoded.value : null;
}

function toHex(bytes: Uint8Array, upper: boolean): string {
  let out = "";
  for (const b of bytes) {
    const h = b.toString(16).padStart(2, "0");
    out += upper ? h.toUpperCase() : h;
  }
  return out;
}

function toBase64Standard(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function toUrlSafe(standard: string): string {
  return standard.replaceAll("+", "-").replaceAll("/", "_");
}

/**
 * base64 변형. 값 앞에 0~2바이트가 붙어 인코딩되는 경우(예: Basic 인증 `user:<값>`)를 위해
 * 앞 바이트 오프셋 0·1·2의 세 정렬을 만든다. 정렬이 경계 문자에 걸치는 앞뒤 글자는 뺀 안쪽 조각과,
 * 값이 문장 끝에 있을 때를 위한 끝까지 포함한 조각(패딩 있음·없음)을 모두 등록한다.
 */
function base64Variants(value: Uint8Array): readonly string[] {
  const out: string[] = [];
  for (let offset = 0; offset < 3; offset += 1) {
    const padded = new Uint8Array(offset + value.length);
    padded.set(value, offset);
    const standard = toBase64Standard(padded);
    const start = Math.ceil((8 * offset) / 6);
    const interiorEnd = Math.floor((8 * padded.length) / 6);
    for (const alphabet of [standard, toUrlSafe(standard)]) {
      const tail = alphabet.slice(start);
      out.push(tail, tail.replaceAll("=", ""), alphabet.slice(start, interiorEnd));
    }
  }
  return out;
}

function variantsOf(value: Uint8Array): readonly string[] {
  const text = decodeStrict(value);
  const derived: string[] = [toHex(value, false), toHex(value, true), ...base64Variants(value)];
  if (text !== null) {
    const encoded = encodeURIComponent(text);
    derived.push(encoded, encoded.replaceAll("%20", "+"), JSON.stringify(text).slice(1, -1));
  }
  const all = [
    ...(text === null ? [] : [text]),
    ...derived.filter((v) => v.length >= MIN_VARIANT_CHARS),
  ];
  return [...new Set(all)];
}

interface PrefixRule {
  readonly kind: string;
  readonly pattern: RegExp;
}

// 18 §3.10.4 규칙 2. 헬름 전용 helm_dt_ 패턴은 뺀다. 표지에서 해시 앞 8자도 뺀다(spec §3.5).
// 접두 패턴은 더 긴 것(sk-ant-)을 일반 것(sk-)보다 앞에 둔다.
const PREFIX_RULES: readonly PrefixRule[] = [
  { kind: "anthropic_key", pattern: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { kind: "openai_key", pattern: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  { kind: "google_key", pattern: /AIza[0-9A-Za-z_-]{35}/g },
  { kind: "github_pat", pattern: /github_pat_[A-Za-z0-9_]{50,}/g },
  { kind: "github_token", pattern: /ghp_[A-Za-z0-9]{36}/g },
  { kind: "slack_token", pattern: /xox[abposr]-[A-Za-z0-9-]{10,}/g },
  { kind: "aws_access_key", pattern: /AKIA[0-9A-Z]{16}/g },
  { kind: "age_key", pattern: /AGE-SECRET-KEY-1[0-9A-Z]{58}/g },
  {
    kind: "private_key",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  {
    kind: "jwt",
    pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  },
];

// 18 §3.10.4 규칙 3. authorization 값 앞의 Bearer·Basic 같은 방식어는 값 밖에 둔다.
const KV_PATTERN =
  /(api[_-]?key|secret|client[_-]?secret|access[_-]?key|private[_-]?key|token|password|passwd|pass|pwd|dsn|authorization)(\s*[:=]\s*['"]?(?:(?:Bearer|Basic|Token)\s+)?)(?!\/\/)([^\s'"]{8,})/gi;
const USERINFO_PATTERN = /([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)([^\s@/]+)(@)/gi;

const MARKER_START = "[REDACTED:";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function markKnown(name: string): string {
  return `[REDACTED:known:${name}]`;
}

interface KnownEntry {
  readonly name: string;
  /** 같은 값을 두 번 등록하지 않기 위한 식별. 값의 소문자 hex 변형과 같은 문자열이다(등록부 안에서만 쓴다) */
  readonly id: string;
  readonly variants: readonly string[];
}

function bump(hits: Map<string, number>, kind: string, by: number): void {
  if (by > 0) hits.set(kind, (hits.get(kind) ?? 0) + by);
}

function finishHits(hits: ReadonlyMap<string, number>): readonly RedactionHit[] {
  return [...hits].map(([kind, count]) => ({ kind, count }));
}

function maskPrefix(text: string, hits: Map<string, number>): string {
  let current = text;
  for (const rule of PREFIX_RULES) {
    current = current.replace(rule.pattern, () => {
      bump(hits, rule.kind, 1);
      return `${MARKER_START}${rule.kind}]`;
    });
  }
  return current;
}

function maskKv(text: string, hits: Map<string, number>): string {
  const afterPairs = text.replace(
    KV_PATTERN,
    (whole: string, key: string, sep: string, value: string) => {
      if (value.startsWith(MARKER_START)) return whole;
      bump(hits, "kv", 1);
      return `${key}${sep}[REDACTED:kv]`;
    },
  );
  return afterPairs.replace(
    USERINFO_PATTERN,
    (whole: string, head: string, value: string, at: string) => {
      if (value.startsWith(MARKER_START)) return whole;
      bump(hits, "kv", 1);
      return `${head}[REDACTED:kv]${at}`;
    },
  );
}

export interface RedactorImpl extends Redactor {
  /** 등록된 비밀 이름 수. 값은 돌려주지 않는다 */
  knownCount(): number;
}

export function createRedactor(): RedactorImpl {
  // 이름 하나가 값 여러 개를 가질 수 있다(rotate 직후 이전 값 forget 전까지). 항목은 값 변형 묶음이다
  const known = new Map<string, KnownEntry[]>();
  // 긴 변형부터 치환해야 짧은 변형이 긴 변형의 일부를 남기지 않는다
  let ordered: readonly { readonly name: string; readonly variant: string }[] = [];

  function rebuild(): void {
    const flat: { name: string; variant: string }[] = [];
    for (const entries of known.values()) {
      for (const entry of entries) {
        for (const variant of entry.variants) flat.push({ name: entry.name, variant });
      }
    }
    flat.sort((a, b) => b.variant.length - a.variant.length);
    ordered = flat;
  }

  function maskKnown(text: string, hits: Map<string, number>): string {
    let current = text;
    for (const { name, variant } of ordered) {
      if (!current.includes(variant)) continue;
      const parts = current.split(variant);
      bump(hits, `known:${name}`, parts.length - 1);
      current = parts.join(markKnown(name));
    }
    return current;
  }

  function maskString(text: string, hits: Map<string, number>): string {
    return maskKv(maskPrefix(maskKnown(text, hits), hits), hits);
  }

  function walk(value: unknown, hits: Map<string, number>, seen: WeakSet<object>): unknown {
    if (typeof value === "string") return maskString(value, hits);
    if (Array.isArray(value)) {
      if (seen.has(value)) return value;
      seen.add(value);
      const items: readonly unknown[] = value;
      return items.map((item) => walk(item, hits, seen));
    }
    if (isPlainObject(value)) {
      if (seen.has(value)) return value;
      seen.add(value);
      const out: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(value)) {
        out[key] = walk(inner, hits, seen);
      }
      return out;
    }
    return value;
  }

  return {
    registerKnown(name: SecretName, value: Uint8Array): Result<void, RegisterKnownError> {
      if (value.length < MIN_KNOWN_BYTES) {
        return err({ kind: "value_too_short", minBytes: 8 });
      }
      const entries = known.get(name) ?? [];
      const variants = variantsOf(value);
      const id = toHex(value, false);
      if (!entries.some((entry) => entry.id === id)) {
        entries.push({ name, id, variants });
        known.set(name, entries);
        rebuild();
      }
      return ok(undefined);
    },
    forget(name: SecretName): void {
      if (known.delete(name)) rebuild();
    },
    mask(text: string): { readonly text: string; readonly hits: readonly RedactionHit[] } {
      const hits = new Map<string, number>();
      const masked = maskString(text, hits);
      return { text: masked, hits: finishHits(hits) };
    },
    maskDeep<T>(value: T): { readonly value: T; readonly hits: readonly RedactionHit[] } {
      const hits = new Map<string, number>();
      const walked = walk(value, hits, new WeakSet<object>());
      // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- 허용 목록 A4 maskDeep: 문자열만 바꾸고 모양(키, 배열 길이, 비문자열 값)을 그대로 두므로 결과는 T와 같은 모양이다 (eng.typescript.guide TY-06)
      return { value: walked as T, hits: finishHits(hits) };
    },
    containsKnown(text: string): boolean {
      return ordered.some(({ variant }) => text.includes(variant));
    },
    knownCount(): number {
      return known.size;
    },
  };
}
