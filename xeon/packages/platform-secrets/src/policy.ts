import { assertNever, attempt } from "@xeon/contracts";
import type { SecretDenyReason, SecretMeta } from "@xeon/contracts/capabilities";
import type { ApprovalEvidence, UseCtx } from "@xeon/contracts/services";

// L0.secrets.spec §4.2. 순서대로 보고 처음 실패에서 멈춘다.

export type PolicyOutcome =
  | { readonly kind: "allow"; readonly approval: ApprovalEvidence | null }
  | { readonly kind: "needs_approval"; readonly approval: "per-session" | "per-use" }
  | { readonly kind: "deny"; readonly reason: SecretDenyReason };

const DAY_MS = 86_400_000;
/** expiring 상태 기준(spec §3.6, 7일 이하) */
const EXPIRING_WINDOW_MS: number = 7 * DAY_MS;

/**
 * 메타 expiresAt(YYYY-MM-DD)의 UTC 0시를 만료 시각으로 본다. 날짜 당일부터 쓸 수 없다.
 * 문서가 당일 포함 여부를 정하지 않아 더 일찍 막히는 쪽을 골랐다.
 */
export function expiryMs(expiresAt: string | null): number | null {
  if (expiresAt === null) return null;
  const ms = Date.parse(`${expiresAt}T00:00:00Z`);
  return Number.isNaN(ms) ? 0 : ms;
}

export function isMetaExpired(meta: Pick<SecretMeta, "expiresAt">, now: number): boolean {
  const at = expiryMs(meta.expiresAt);
  return at !== null && now >= at;
}

export function isMetaExpiring(meta: Pick<SecretMeta, "expiresAt">, now: number): boolean {
  const at = expiryMs(meta.expiresAt);
  return at !== null && now < at && at - now <= EXPIRING_WINDOW_MS;
}

// ── 호스트 일치 ──────────────────────────────────────────────────────────

interface HostPort {
  readonly host: string;
  readonly port: number | null;
}

function normalizeHost(host: string): string {
  const lower = host.toLowerCase();
  return lower.endsWith(".") ? lower.slice(0, -1) : lower;
}

function splitHostPort(entry: string): HostPort {
  if (entry.startsWith("[")) {
    const end = entry.indexOf("]");
    if (end === -1) return { host: normalizeHost(entry), port: null };
    const rest = entry.slice(end + 1);
    const port = rest.startsWith(":") ? Number(rest.slice(1)) : null;
    return { host: normalizeHost(entry.slice(0, end + 1)), port };
  }
  const colon = entry.lastIndexOf(":");
  if (colon !== -1 && entry.indexOf(":") === colon) {
    const port = Number(entry.slice(colon + 1));
    return {
      host: normalizeHost(entry.slice(0, colon)),
      port: Number.isInteger(port) ? port : null,
    };
  }
  return { host: normalizeHost(entry), port: null };
}

function isIpLiteral(host: string): boolean {
  return host.startsWith("[") || host.includes(":") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
}

/**
 * 호스트 일치(spec §4.2): 소문자 비교, `*.example.com`은 한 단계 이상의 하위 도메인만 맞는다
 * (`example.com` 자신은 아니다). IP 리터럴과 localhost는 메타에 그대로 적혀 있을 때만 맞는다.
 * 포트가 메타에 없으면 443만 맞는다(ctx 포트가 null이면 443으로 본다).
 */
export function matchHost(entry: string, host: string, port: number | null): boolean {
  const want = splitHostPort(entry);
  const have: HostPort = { host: normalizeHost(host), port };
  const havePort = have.port ?? 443;
  if (want.port === null ? havePort !== 443 : want.port !== havePort) return false;
  if (want.host.startsWith("*.")) {
    if (isIpLiteral(have.host)) return false;
    const suffix = want.host.slice(1);
    return have.host.length > suffix.length && have.host.endsWith(suffix);
  }
  return want.host === have.host;
}

// ── origin 일치 ──────────────────────────────────────────────────────────

/** `https://host[:port]` 하나를 정규형(소문자 호스트, 기본 포트 생략)으로 바꾼다. https 밖이거나 경로·계정이 있으면 null */
function canonicalOrigin(text: string): string | null {
  const parsed = attempt(() => new URL(text));
  if (!parsed.ok) return null;
  const url = parsed.value;
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") return null;
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") return null;
  return url.origin;
}

/**
 * origin(스킴, 호스트, 포트) 정확 일치(spec §4.3 M4 규칙 1). 대소문자와 기본 포트 표기(`:443`)만 같은 것으로 본다.
 * 와일드카드와 하위 도메인은 맞지 않는다. 해석할 수 없는 쪽이 하나라도 있으면 맞지 않는다.
 */
export function matchOrigin(entry: string, origin: string): boolean {
  const want = canonicalOrigin(entry);
  const have = canonicalOrigin(origin);
  return want !== null && have !== null && want === have;
}

// ── 명령 일치 ────────────────────────────────────────────────────────────

const REGEX_SPECIALS = /[.+?^${}()|[\]\\]/g;
/** `*`가 맞는 글자. 셸 제어 연산자와 치환 기호, 줄바꿈은 제외한다 */
const WILDCARD = "[^;&|<>`$\\n\\r()]*";

/**
 * 명령 패턴(`gh api *`)과 명령줄이 전체 일치하는가. `*`는 셸 제어 문자(`; & | < > ` $ ( )`와 줄바꿈)를
 * 제외한 임의 글자열이다. 승인된 명령 뒤에 다른 명령을 이어 붙이는 것을 막기 위해 문서보다 좁게 잡았다.
 */
export function matchCommand(pattern: string, commandLine: string): boolean {
  const source = pattern
    .split("*")
    .map((part) => part.replace(REGEX_SPECIALS, "\\$&"))
    .join(WILDCARD);
  return new RegExp(`^${source}$`).test(commandLine);
}

/** 도구 이름 패턴. 접미 `*` 와일드카드만 쓴다 */
export function matchTool(pattern: string, purpose: string): boolean {
  if (pattern.endsWith("*")) return purpose.startsWith(pattern.slice(0, -1));
  return pattern === purpose;
}

// ── 판정 ─────────────────────────────────────────────────────────────────

function approvalSufficient(
  required: "per-session" | "per-use",
  evidence: ApprovalEvidence,
  now: number,
): boolean {
  if (evidence.expiresAt !== null && evidence.expiresAt <= now) return false;
  if (required === "per-use") return evidence.scope === "per-use";
  return true;
}

function targetDenial(meta: SecretMeta, ctx: UseCtx): SecretDenyReason | null {
  const target = ctx.target;
  switch (ctx.mode) {
    case "runtime-http":
    case "sentinel": {
      if (target.kind !== "host") return "mode_not_allowed";
      const matched = meta.use.hosts.some((entry) => matchHost(entry, target.host, target.port));
      return matched ? null : "host_mismatch";
    }
    case "browser-input": {
      if (target.kind !== "origin") return "mode_not_allowed";
      const matched = (meta.use.origins ?? []).some((entry) => matchOrigin(entry, target.origin));
      return matched ? null : "origin_mismatch";
    }
    case "env": {
      if (target.kind !== "command") return "mode_not_allowed";
      const matched = (meta.use.commands ?? []).some((pattern) =>
        matchCommand(pattern, target.commandLine),
      );
      return matched ? null : "command_mismatch";
    }
    default:
      return assertNever(ctx.mode, "targetDenial");
  }
}

/**
 * 정책 판정 6단계. 승인이 모자라면 `needs_approval`을 돌려준다(check가 L1에 알린다).
 * lease는 이를 `approval_missing` 거부로 바꾼다. env 모드는 메타가 `none`이어도 per-use 승인을 요구한다.
 */
export function evaluatePolicy(meta: SecretMeta, ctx: UseCtx, now: number): PolicyOutcome {
  if (isMetaExpired(meta, now)) return { kind: "deny", reason: "expired" };
  if (!meta.use.modes.includes(ctx.mode)) return { kind: "deny", reason: "mode_not_allowed" };
  if (!meta.use.tools.some((pattern) => matchTool(pattern, ctx.purpose))) {
    return { kind: "deny", reason: "tool_not_allowed" };
  }
  if (meta.scope.startsWith("project:") && ctx.projectId !== meta.scope.slice("project:".length)) {
    return { kind: "deny", reason: "scope_mismatch" };
  }
  const targetReason = targetDenial(meta, ctx);
  if (targetReason !== null) return { kind: "deny", reason: targetReason };

  const required: "none" | "per-session" | "per-use" =
    ctx.mode === "env" ? "per-use" : meta.approval;
  if (required === "none") return { kind: "allow", approval: null };
  const evidence = ctx.approval;
  if (evidence === null || !approvalSufficient(required, evidence, now)) {
    return { kind: "needs_approval", approval: required };
  }
  return { kind: "allow", approval: evidence };
}
