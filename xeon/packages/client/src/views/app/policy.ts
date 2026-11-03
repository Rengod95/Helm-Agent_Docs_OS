import { Type } from "typebox";
import {
  BRIDGE_OPS,
  UI_LIMITS,
  type BridgeError,
  type BridgeOp,
  type BridgeRequest,
} from "@fresnel/contracts/extensions";
import { assertNever, parse } from "@fresnel/contracts";

// Plugin App 다리 판정(ADR-0021 §3.4, §3.4.2, §3.6.5). 요청 하나를 받아 "무엇을 해도 되는가"만 정한다. 순수 함수이고 wire를 부르지 않는다.
// 기본은 거부다. 허용 목록(op), 인자 스키마, 매니페스트 선언(methods, readsRecordKinds), 확장 상태, 열린 대화를 모두 통과한 요청만
// 타입 있는 BridgeAction으로 나온다. 판정의 정본은 엔진이고 이 검사는 같은 검사를 앞에서 한 번 더 하는 것이다(§3.4.2).

/** 프레임이 이름으로 가리킬 수 있는 확장 메서드 선언. 매니페스트 `methods`에서 온다 */
export interface MethodGrant {
  readonly readOnly: boolean;
  readonly approval: boolean;
  /** 매니페스트가 정한 사람 말 라벨. 확인 줄이 날 동사 대신 보인다. 없으면 동사를 보인다 */
  readonly label?: string;
}

/** 요청마다 새로 읽는 판정 맥락. 셸이 확장 상태와 열린 대화를 바꾸면 다음 요청부터 바뀐다 */
export interface BridgePolicyContext {
  /** 확장 이름. 화면 키와 이벤트 kind 접두에 쓴다 */
  readonly extension: string;
  readonly enabled: boolean;
  readonly safeMode: boolean;
  /** 확장의 신뢰 등급. 확인 줄이 배지로 보인다 */
  readonly trust: "builtin" | "user" | "project";
  /** 동사 → 선언. 선언에 없는 동사는 부를 수 없다 */
  readonly methods: ReadonlyMap<string, MethodGrant>;
  /** 매니페스트 `readsRecordKinds` */
  readonly readsRecordKinds: readonly string[];
  /** 설정 키 접두. 예 `["ext.helm.", "l3.helm."]` */
  readonly settingPrefixes: readonly string[];
  /** 매니페스트가 선언한 설정 키. 여기 없는 키는 값을 주지 않고 상태(설정됨/없음)만 준다(B2 후속, 2026-11-04) */
  readonly declaredSettingKeys: ReadonlySet<string>;
  /** 이 확장이 등록한 슬래시 명령 이름(앞 `/` 없음) */
  readonly ownCommands: ReadonlySet<string>;
  /** 신뢰 등급이 `post`를 허용하는가. 기본은 `defaultAllowPost(trust)`다 */
  readonly allowPost: boolean;
  /** 지금 열린 대화. 없으면 undefined. post, requestApproval은 이 대화에만 쓸 수 있다 */
  readonly openThreadId: string | undefined;
}

/** 신뢰 등급별 `post` 기본값. 내장 확장만 대화에 글을 올린다. 사용자·프로젝트 확장은 승인 카드(`requestApproval`)로만 사용자에게 묻는다 */
export function defaultAllowPost(trust: "builtin" | "user" | "project"): boolean {
  return trust === "builtin";
}

/** 코어 이벤트 허용 목록(§3.4 `events`). `turn.*`, `lease.*`는 접두, 나머지는 같은 이름만이다 */
const CORE_EVENT_PREFIXES: readonly string[] = ["turn.", "lease."];
const CORE_EVENT_KINDS: ReadonlySet<string> = new Set(["scope.changed", "scope.handler_failed"]);

const VerbSchema = Type.String({ pattern: "^[a-z][A-Za-z0-9]{0,47}$" });
const ParamsSchema = Type.Optional(Type.Record(Type.String(), Type.Unknown()));
const EventKindSchema = Type.String({ minLength: 1, maxLength: 160 });
const SettingKeySchema = Type.String({ minLength: 1, maxLength: 160 });
const ThreadIdSchema = Type.String({ minLength: 1, maxLength: 128 });

const QueryArgs = Type.Object(
  { verb: VerbSchema, params: ParamsSchema },
  { additionalProperties: false },
);
const EventsArgs = Type.Object(
  {
    kinds: Type.Array(EventKindSchema, { minItems: 1, maxItems: 16 }),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: UI_LIMITS.eventRows })),
  },
  { additionalProperties: false },
);
const SettingsArgs = Type.Object(
  { keys: Type.Array(SettingKeySchema, { minItems: 1, maxItems: 32 }) },
  { additionalProperties: false },
);
const HostArgs = Type.Optional(Type.Object({}, { additionalProperties: false }));
const CallArgs = Type.Object(
  { verb: VerbSchema, params: ParamsSchema },
  { additionalProperties: false },
);
const CommandArgs = Type.Object(
  {
    name: Type.String({ pattern: "^[a-z][a-z0-9-]{0,47}$" }),
    args: Type.Optional(Type.String({ maxLength: 2000 })),
  },
  { additionalProperties: false },
);
const PostArgs = Type.Object(
  { threadId: ThreadIdSchema, text: Type.String({ minLength: 1, maxLength: 20000 }) },
  { additionalProperties: false },
);
const ApprovalArgs = Type.Object(
  {
    threadId: ThreadIdSchema,
    title: Type.String({ minLength: 1, maxLength: 120 }),
    detail: Type.Optional(Type.String({ maxLength: 1000 })),
  },
  { additionalProperties: false },
);
const NavigateArgs = Type.Object(
  {
    target: Type.Union([
      Type.Object(
        { kind: Type.Literal("view"), id: Type.String({ pattern: "^[a-z][a-z0-9-]{0,31}$" }) },
        { additionalProperties: false },
      ),
      Type.Object(
        { kind: Type.Literal("thread"), threadId: ThreadIdSchema },
        { additionalProperties: false },
      ),
      Type.Object(
        { kind: Type.Literal("turn"), threadId: ThreadIdSchema, turnId: ThreadIdSchema },
        { additionalProperties: false },
      ),
      Type.Object({ kind: Type.Literal("extension") }, { additionalProperties: false }),
      Type.Object({ kind: Type.Literal("settings") }, { additionalProperties: false }),
      Type.Object({ kind: Type.Literal("secrets") }, { additionalProperties: false }),
      Type.Object(
        { kind: Type.Literal("external"), url: Type.String({ minLength: 1, maxLength: 2048 }) },
        { additionalProperties: false },
      ),
    ]),
  },
  { additionalProperties: false },
);
const ResizeArgs = Type.Object(
  { height: Type.Integer({ minimum: 0, maximum: 4096 }) },
  { additionalProperties: false },
);
const LogArgs = Type.Object(
  { message: Type.String({ maxLength: 512 }) },
  { additionalProperties: false },
);
const PongArgs = Type.Object({ n: Type.Integer({ minimum: 0 }) }, { additionalProperties: false });

export type NavigateTarget =
  | { readonly kind: "view"; readonly id: string }
  | { readonly kind: "thread"; readonly threadId: string }
  | { readonly kind: "turn"; readonly threadId: string; readonly turnId: string }
  | { readonly kind: "extension" }
  | { readonly kind: "settings" }
  | { readonly kind: "secrets" }
  | { readonly kind: "external"; readonly url: string; readonly link: ExternalLink };

/** 외부 링크를 `new URL`로 정규화한 결과. 확인 줄과 OS 브라우저 열기는 둘 다 `href`만 쓴다 */
export interface ExternalLink {
  readonly href: string;
  /** 사람에게 보일 글. 방향 제어 글자를 뺐다 */
  readonly display: string;
  /** 사용자가 쓴 호스트와 정규화된 호스트가 다르면(국제화 도메인) 퓨니코드 호스트. 같으면 undefined */
  readonly punycodeHost: string | undefined;
}

/** 판정을 통과한 동작. 셸은 이 값만 실행하고 프레임이 보낸 원문 인자는 다시 쓰지 않는다 */
export type BridgeAction =
  | {
      readonly op: "query";
      readonly verb: string;
      readonly params: Readonly<Record<string, unknown>>;
    }
  | { readonly op: "events"; readonly kinds: readonly string[]; readonly limit: number }
  | { readonly op: "settings"; readonly keys: readonly string[] }
  | { readonly op: "host" }
  | {
      readonly op: "call";
      readonly verb: string;
      readonly params: Readonly<Record<string, unknown>>;
      readonly approval: boolean;
    }
  | { readonly op: "command"; readonly name: string; readonly args: string }
  | { readonly op: "post"; readonly threadId: string; readonly text: string }
  | {
      readonly op: "requestApproval";
      readonly threadId: string;
      readonly title: string;
      readonly detail: string;
    }
  | {
      readonly op: "navigate";
      readonly target: NavigateTarget;
      /** 외부 링크는 셸이 확인한 뒤 OS 브라우저로 연다(§3.6.1) */
      readonly needsShellConfirm: boolean;
    }
  | { readonly op: "resize"; readonly height: number }
  | { readonly op: "log"; readonly size: number }
  | { readonly op: "pong"; readonly n: number };

export type Decision =
  | { readonly ok: true; readonly action: BridgeAction }
  | { readonly ok: false; readonly error: BridgeError };

function deny(kind: BridgeError["kind"], detail?: string): Decision {
  return { ok: false, error: detail === undefined ? { kind } : { kind, detail } };
}

/** 인자 검사 실패의 문장. 위치와 키워드만 담고 값은 담지 않는다 */
function argsInvalid(error: {
  readonly issues: readonly { readonly path: string; readonly keyword: string }[];
}): Decision {
  const first = error.issues[0];
  return deny(
    "args_invalid",
    first === undefined ? undefined : `${first.path || "/"} ${first.keyword}`,
  );
}

/** 이벤트 kind가 이 확장이 읽어도 되는 것인가 */
export function eventKindAllowed(kind: string, context: BridgePolicyContext): boolean {
  if (kind.includes("*")) return false;
  if (kind.startsWith(`x.${context.extension}.`) || kind.startsWith(`grp.${context.extension}.`))
    return true;
  if (context.readsRecordKinds.includes(kind)) return true;
  if (CORE_EVENT_KINDS.has(kind)) return true;
  return CORE_EVENT_PREFIXES.some(
    (prefix) => kind.startsWith(prefix) && kind.length > prefix.length,
  );
}

/** 설정 키가 이 확장의 것인가 */
export function settingKeyAllowed(key: string, context: BridgePolicyContext): boolean {
  return context.settingPrefixes.some(
    (prefix) => key.startsWith(prefix) && key.length > prefix.length,
  );
}

// 제어 문자(탭·줄바꿈 포함), 공백, 방향 제어 글자(U+061C, U+200E/F, U+202A-E, U+2066-9)
function hasControlOrSpace(text: string): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}
/** 보이지 않는 글자: 너비 0 공백·이음(U+200B-D), 단어 결합자(U+2060), BOM(U+FEFF), 소프트 하이픈(U+00AD). 글을 가려 다른 글처럼 보이게 한다 */
const INVISIBLE = /[\u00ad\u200b-\u200d\u2060\ufeff]/gu;
const BIDI = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;
const BIDI_PROBE = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

/** 글에서 방향 제어 글자를 뺀다. 확인 줄과 카드에 보일 글에 쓴다 */
export function stripBidi(text: string): string {
  return text.replace(BIDI, "");
}

/** 제어 문자, 방향 제어 글자, 보이지 않는 글자를 뺀다. `keepLayout`이면 줄바꿈과 탭은 남긴다 */
export function stripUnsafeText(text: string, keepLayout: boolean): string {
  let out = "";
  for (const ch of stripBidi(text).replace(INVISIBLE, "")) {
    const code = ch.codePointAt(0) ?? 0;
    const layout = code === 0x0a || code === 0x09;
    const control = code < 0x20 || (code >= 0x7f && code <= 0x9f);
    if (control && !(keepLayout && layout)) continue;
    out += ch;
  }
  return out;
}

/** 외부 링크 주소. `http(s)`만, 계정 정보 없이(§3.6.1). 원문에 제어 문자·공백·방향 제어 글자가 있으면 거부하고, 통과하면 `new URL`의 `href`만 쓴다 */
export function normalizeExternalLink(raw: string): ExternalLink | undefined {
  if (hasControlOrSpace(raw) || BIDI_PROBE.test(raw)) return undefined;
  if (!URL.canParse(raw)) return undefined;
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  if (url.username !== "" || url.password !== "") return undefined;
  const typed = /^https?:\/\/([^/?#:]*)/iu.exec(raw)?.[1]?.toLowerCase();
  const punycodeHost = typed !== undefined && typed !== url.hostname ? url.hostname : undefined;
  return { href: url.href, display: stripBidi(url.href), punycodeHost };
}

const KNOWN_OPS: ReadonlySet<string> = new Set<string>(BRIDGE_OPS);

/** 요청의 `op`가 목록에 있는가. 스키마 검사가 이미 걸렀지만 판정 쪽도 따로 막는다 */
function isKnownOp(op: string): op is BridgeOp {
  return KNOWN_OPS.has(op);
}

/**
 * 요청 하나를 판정한다. 순서는 op 허용 목록, 확장 상태(켜짐, 안전 모드), op별 인자 스키마, 매니페스트 선언, 열린 대화다.
 * `pong`은 확장이 꺼져도 받는다(생존 확인이 끊기지 않게).
 */
export function decide(request: BridgeRequest, context: BridgePolicyContext): Decision {
  if (!isKnownOp(request.op)) return deny("op_not_allowed");
  if (request.op === "pong") {
    const parsed = parse(PongArgs, request.args);
    return parsed.ok
      ? { ok: true, action: { op: "pong", n: parsed.value.n } }
      : argsInvalid(parsed.error);
  }
  if (!context.enabled) return deny("extension_off");
  if (context.safeMode) return deny("safe_mode");

  switch (request.op) {
    case "query": {
      const parsed = parse(QueryArgs, request.args);
      if (!parsed.ok) return argsInvalid(parsed.error);
      const grant = context.methods.get(parsed.value.verb);
      if (grant === undefined) return deny("not_declared");
      // 읽기 길로 쓰기 메서드를 부를 수 없다
      if (!grant.readOnly) return deny("denied", "query_needs_read_only");
      return {
        ok: true,
        action: { op: "query", verb: parsed.value.verb, params: parsed.value.params ?? {} },
      };
    }
    case "events": {
      const parsed = parse(EventsArgs, request.args);
      if (!parsed.ok) return argsInvalid(parsed.error);
      const blocked = parsed.value.kinds.find((kind) => !eventKindAllowed(kind, context));
      if (blocked !== undefined) return deny("not_declared", "event_kind");
      return {
        ok: true,
        action: {
          op: "events",
          kinds: parsed.value.kinds,
          limit: parsed.value.limit ?? UI_LIMITS.eventRows,
        },
      };
    }
    case "settings": {
      const parsed = parse(SettingsArgs, request.args);
      if (!parsed.ok) return argsInvalid(parsed.error);
      if (parsed.value.keys.some((key) => !settingKeyAllowed(key, context))) {
        return deny("not_declared", "setting_key");
      }
      return { ok: true, action: { op: "settings", keys: parsed.value.keys } };
    }
    case "host": {
      const parsed = parse(HostArgs, request.args ?? {});
      return parsed.ok ? { ok: true, action: { op: "host" } } : argsInvalid(parsed.error);
    }
    case "call": {
      const parsed = parse(CallArgs, request.args);
      if (!parsed.ok) return argsInvalid(parsed.error);
      const grant = context.methods.get(parsed.value.verb);
      if (grant === undefined) return deny("not_declared");
      if (grant.readOnly) return deny("denied", "call_needs_write_method");
      return {
        ok: true,
        action: {
          op: "call",
          verb: parsed.value.verb,
          params: parsed.value.params ?? {},
          approval: grant.approval,
        },
      };
    }
    case "command": {
      const parsed = parse(CommandArgs, request.args);
      if (!parsed.ok) return argsInvalid(parsed.error);
      if (!context.ownCommands.has(parsed.value.name)) return deny("not_declared", "command");
      return {
        ok: true,
        action: { op: "command", name: parsed.value.name, args: parsed.value.args ?? "" },
      };
    }
    case "post": {
      const parsed = parse(PostArgs, request.args);
      if (!parsed.ok) return argsInvalid(parsed.error);
      if (!context.allowPost) return deny("denied", "post_not_allowed");
      if (context.openThreadId === undefined || parsed.value.threadId !== context.openThreadId) {
        return deny("denied", "thread_not_open");
      }
      const text = stripUnsafeText(parsed.value.text, true);
      if (text.trim() === "") return deny("args_invalid", "/text empty");
      return { ok: true, action: { op: "post", threadId: parsed.value.threadId, text } };
    }
    case "requestApproval": {
      const parsed = parse(ApprovalArgs, request.args);
      if (!parsed.ok) return argsInvalid(parsed.error);
      if (context.openThreadId === undefined || parsed.value.threadId !== context.openThreadId) {
        return deny("denied", "thread_not_open");
      }
      const title = stripUnsafeText(parsed.value.title, false).trim();
      if (title === "") return deny("args_invalid", "/title empty");
      return {
        ok: true,
        action: {
          op: "requestApproval",
          threadId: parsed.value.threadId,
          title,
          detail: stripUnsafeText(parsed.value.detail ?? "", true),
        },
      };
    }
    case "navigate": {
      const parsed = parse(NavigateArgs, request.args);
      if (!parsed.ok) return argsInvalid(parsed.error);
      const target = parsed.value.target;
      if (target.kind === "external") {
        const link = normalizeExternalLink(target.url);
        if (link === undefined) return deny("args_invalid", "/target/url scheme");
        return {
          ok: true,
          action: {
            op: "navigate",
            target: { kind: "external", url: link.href, link },
            needsShellConfirm: true,
          },
        };
      }
      return { ok: true, action: { op: "navigate", target, needsShellConfirm: false } };
    }
    case "resize": {
      const parsed = parse(ResizeArgs, request.args);
      return parsed.ok
        ? { ok: true, action: { op: "resize", height: parsed.value.height } }
        : argsInvalid(parsed.error);
    }
    case "log": {
      const parsed = parse(LogArgs, request.args);
      // 진단 줄에는 op와 크기만 남긴다. 글 자체는 어디에도 남기지 않는다(§3.6.5)
      return parsed.ok
        ? {
            ok: true,
            action: { op: "log", size: new TextEncoder().encode(parsed.value.message).byteLength },
          }
        : argsInvalid(parsed.error);
    }
    default:
      return assertNever(request.op, "BridgeOp");
  }
}
