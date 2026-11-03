import { attempt, err, ok, type Result } from "@fresnel/contracts";
import type { RedactionHit, SecretName } from "@fresnel/contracts/capabilities";
import type { RegisterKnownError, Redactor } from "@fresnel/contracts/services";

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
  /(api[_-]?key|secret|client[_-]?secret|access[_-]?key|private[_-]?key|token|password|passwd|pass|pwd|dsn|authorization)(['"]?\s*[:=]\s*['"]?(?:(?:Bearer|Basic|Token)\s+)?)(?!\/\/)([^\s'"]{8,})/gi;
const USERINFO_PATTERN = /([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)([^\s@/]+)(@)/gi;

const MARKER_START = "[REDACTED:";

// 객체 키가 민감한지 판정한다. KV_PATTERN의 키 이름과 같은 집합이다. 구분자와 대소문자는 무시한다.
// pass, pwd, dsn은 다른 낱말의 끝(bypass)에 우연히 맞으므로 키 전체가 같을 때만 본다.
const SENSITIVE_KEY_SUFFIXES = [
  "apikey",
  "secret",
  "clientsecret",
  "accesskey",
  "privatekey",
  "token",
  "password",
  "passwd",
  "authorization",
];
const SENSITIVE_KEY_EXACT = new Set(["pass", "pwd", "dsn"]);
/** KV_PATTERN과 같은 최소 값 길이 */
const MIN_KV_VALUE_CHARS = 8;
/** 스트림 마스커가 줄바꿈 없이 이만큼 쌓이면 일부를 내보낸다 */
const STREAM_FLUSH_LIMIT = 4096;
/** 한도에서 내보낼 때 패턴(접두, 키-값)이 끊기지 않도록 남기는 꼬리 길이 */
const STREAM_TAIL_KEEP = 256;

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replaceAll(/[_-]/g, "");
  if (SENSITIVE_KEY_EXACT.has(normalized)) return true;
  return SENSITIVE_KEY_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function prototypeOf(value: object): object | null | undefined {
  const proto: unknown = Object.getPrototypeOf(value);
  return typeof proto === "object" ? proto : undefined;
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

/** 청크 경계에 걸친 값을 가리기 위한 이어 가는 상태. 호출자는 끝에 flush를 한 번 부른다 */
interface StreamMasker {
  push(chunk: string): { readonly text: string; readonly hits: readonly RedactionHit[] };
  flush(): { readonly text: string; readonly hits: readonly RedactionHit[] };
}

export interface RedactorImpl extends Redactor {
  /** 스트림 하나당 마스커 하나. 값이 청크에 걸쳐도 가린다(SEC-03) */
  maskStream(): StreamMasker;
  /** 등록된 시크릿 이름 수. 값은 돌려주지 않는다 */
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

  function maskBytes(view: ArrayBufferView, hits: Map<string, number>): Uint8Array {
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    const text = new TextDecoder().decode(bytes);
    const masked = maskString(text, hits);
    return masked === text ? bytes : new TextEncoder().encode(masked);
  }

  function copyOwn(
    source: object,
    target: object,
    hits: Map<string, number>,
    memo: WeakMap<object, unknown>,
  ): void {
    for (const name of Object.getOwnPropertyNames(source)) {
      const descriptor = Object.getOwnPropertyDescriptor(source, name);
      if (descriptor === undefined || !("value" in descriptor)) continue;
      const inner: unknown = descriptor.value;
      Object.defineProperty(target, name, {
        ...descriptor,
        value: walkEntry(name, inner, hits, memo),
      });
    }
  }

  // 민감한 키 아래의 문자열은 값 모양과 상관없이 가린다(JSON 설정 파일의 등록 안 된 시크릿)
  function walkEntry(
    key: string,
    value: unknown,
    hits: Map<string, number>,
    memo: WeakMap<object, unknown>,
  ): unknown {
    if (typeof value === "string") {
      const masked = maskString(value, hits);
      // 이미 알려진 값이나 패턴으로 가려졌으면 그 표지를 둔다. 아무것도 가려지지 않았을 때만 키로 판정한다
      if (masked !== value || value.length < MIN_KV_VALUE_CHARS || !isSensitiveKey(key)) {
        return masked;
      }
      bump(hits, "kv", 1);
      return `${MARKER_START}kv]`;
    }
    return walk(value, hits, memo);
  }

  function walk(
    value: unknown,
    hits: Map<string, number>,
    memo: WeakMap<object, unknown>,
  ): unknown {
    if (typeof value === "string") return maskString(value, hits);
    if (typeof value !== "object" || value === null) return value;
    if (memo.has(value)) return memo.get(value);
    if (Array.isArray(value)) {
      const out: unknown[] = [];
      memo.set(value, out);
      const items: readonly unknown[] = value;
      for (const item of items) out.push(walk(item, hits, memo));
      return out;
    }
    if (ArrayBuffer.isView(value)) {
      const out = maskBytes(value, hits);
      memo.set(value, out);
      return out;
    }
    if (value instanceof Error) {
      const out = new Error();
      const proto = prototypeOf(value);
      if (proto !== undefined) Object.setPrototypeOf(out, proto);
      memo.set(value, out);
      copyOwn(value, out, hits, memo);
      return out;
    }
    if (value instanceof Map) {
      const out = new Map<unknown, unknown>();
      memo.set(value, out);
      for (const [k, v] of value) out.set(walk(k, hits, memo), walk(v, hits, memo));
      return out;
    }
    if (value instanceof Set) {
      const out = new Set<unknown>();
      memo.set(value, out);
      for (const v of value) out.add(walk(v, hits, memo));
      return out;
    }
    if (isPlainObject(value)) {
      const out: Record<string, unknown> = {};
      memo.set(value, out);
      for (const [key, inner] of Object.entries(value)) {
        out[key] = walkEntry(key, inner, hits, memo);
      }
      return out;
    }
    // 클래스 인스턴스: 프로토타입은 두고 자기 필드만 가린 복사본을 만든다. Date, RegExp, Promise 같은 내장은 그대로 둔다
    if (Object.prototype.toString.call(value) === "[object Object]") {
      const out: object = {};
      Object.setPrototypeOf(out, prototypeOf(value) ?? Object.prototype);
      memo.set(value, out);
      copyOwn(value, out, hits, memo);
      return out;
    }
    return value;
  }

  /**
   * 마스커가 아직 내보내면 안 되는 끝 위치를 구한다. 알려진 값 변형의 앞부분이 pending 끝까지 이어지면
   * 그 변형이 시작하는 위치 앞까지만 내보낸다(변형의 나머지가 다음 청크에 올 수 있다).
   */
  function safeCut(pending: string, wanted: number): number {
    let cut = wanted;
    for (const { variant } of ordered) {
      const from = Math.max(0, cut - variant.length + 1);
      for (let i = from; i < cut; i += 1) {
        const overlap = Math.min(variant.length, pending.length - i);
        if (i + variant.length > cut && pending.startsWith(variant.slice(0, overlap), i)) {
          cut = i;
          break;
        }
      }
    }
    return cut;
  }

  function createStreamMasker(): StreamMasker {
    let pending = "";
    function release(cut: number): { text: string; hits: readonly RedactionHit[] } {
      const hits = new Map<string, number>();
      const text = maskString(pending.slice(0, cut), hits);
      pending = pending.slice(cut);
      return { text, hits: finishHits(hits) };
    }
    return {
      push(chunk) {
        pending += chunk;
        const newline = pending.lastIndexOf("\n");
        let wanted = newline === -1 ? 0 : newline + 1;
        if (wanted === 0 && pending.length > STREAM_FLUSH_LIMIT) {
          wanted = pending.length - STREAM_TAIL_KEEP;
        }
        return release(safeCut(pending, wanted));
      },
      flush() {
        return release(pending.length);
      },
    };
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
      const walked = walk(value, hits, new WeakMap<object, unknown>());
      // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- 허용 목록 A4 maskDeep: 문자열만 바꾸고 모양(키, 배열 길이, 비문자열 값)을 그대로 두므로 결과는 T와 같은 모양이다 (eng.typescript.guide TY-06)
      return { value: walked as T, hits: finishHits(hits) };
    },
    maskStream: createStreamMasker,
    containsKnown(text: string): boolean {
      return ordered.some(({ variant }) => text.includes(variant));
    },
    knownCount(): number {
      return known.size;
    },
  };
}
