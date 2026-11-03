import {
  assertNever,
  attempt,
  attemptAsync,
  err,
  ok,
  parse,
  type Result,
} from "@fresnel/contracts";
import { ThreadIdSchema, type ItemRecord, type ThreadId } from "@fresnel/contracts/conversation";
import { UI_LIMITS, type BridgeError } from "@fresnel/contracts/extensions";
import {
  WireError,
  type CommandRunResult,
  type HostConnection,
  type SettingsGetResult,
  type SettingsListResult,
} from "@fresnel/contracts/wire";
import {
  eventKindAllowed,
  stripUnsafeText,
  type BackendResult,
  type BridgeBackend,
  type BridgePolicyContext,
  type ExternalLink,
  type HostSnapshot,
  type NavigateTarget,
  type SettingRead,
} from "@fresnel/client/views/app";

// Plugin App 다리의 백엔드(`BridgeBackend`)를 엔진 wire 위에 세운다. 화면 하나에 하나씩 만든다.
// 판정은 이미 `decide`가 했으므로 여기서는 허용된 동작을 wire 호출로 옮기고 오류를 다리 오류 이름으로 바꾼다.
// 오류 문장은 고정 글이고, 엔진의 원문 메시지는 어디로도 가지 않는다.

/** 셸이 직접 여는 이동(외부 링크 제외). 외부 링크는 `openExternal`로만 간다 */
type ShellNavigateTarget = Exclude<NavigateTarget, { readonly kind: "external" }>;

export interface BridgeBackendDeps {
  readonly connection: HostConnection;
  /** 확장 이름. `ext.ui.post`의 `extension`에 쓴다 */
  readonly extension: string;
  /** 화면 id(매니페스트 `ui` 항목의 id). `ext.ui.post`의 `ui`에 쓴다 */
  readonly screen: string;
  /** 지금 열린 대화. 없으면 undefined. `post`와 이벤트 읽기는 이 대화에만 한다 */
  readonly openThreadId: () => string | undefined;
  /** 판정 맥락. 이벤트 종류 거름과 매니페스트 설정 키 선언을 여기서 읽는다 */
  readonly policy: () => BridgePolicyContext;
  /** 고정 맥락 읽기(`host`)의 바탕. `threadId`는 `openThreadId`로 덮는다 */
  readonly snapshot: () => HostSnapshot;
  /** 셸이 열 수 있으면 참. 모르는 대상이면 거짓이고 다리는 `navigate_unsupported`로 답한다 */
  readonly navigate: (target: ShellNavigateTarget) => boolean;
  /** OS 브라우저 열기. 호출자는 확인을 받은 링크의 `href`만 넘긴다 */
  readonly openExternal: (href: string) => Promise<void>;
  readonly confirmExternal: (link: ExternalLink) => Promise<boolean>;
  readonly resize: (height: number) => void;
  readonly diagnostic: (line: { readonly op: string; readonly size: number }) => void;
}

/** `ext.ui.post`의 기록 이름. 화면은 글만 주므로 이름은 고정이다(확장 kind `x.<확장>.ui.message`가 된다) */
const POST_NAME = "message";
/** `events` 행 상한. 다리 상한(`UI_LIMITS.eventRows`)과 `thread.read` 상한이 같다 */
const EVENT_ROWS_MAX = UI_LIMITS.eventRows;

function fail(kind: BridgeError["kind"], detail?: string): BackendResult<never> {
  return err(detail === undefined ? { kind } : { kind, detail });
}

/**
 * 프레임이 글을 준 승인 요청(`requestApproval`)은 wire로 잇지 않는다. `ext.ui.requestApproval`은 매니페스트에 선언된 `method`를 요구하는데
 * 다리 `requestApproval`은 제목과 설명만 주고, 프레임이 쓴 글이 표준 승인 카드가 되는 길은 사용자 결정 전에 열지 않는다(작업 보고 [미결]).
 * 승인이 필요한 메서드(`approval: true`) 호출도 승인 뒤 실행하는 길이 정해지지 않아 닫는다
 */
function unavailable(): Promise<BackendResult<never>> {
  return Promise.resolve(fail("failed", "wire_unavailable"));
}

/** 확장 메서드 params의 예약 키. 프레임이 준 값은 버리고 열린 대화로만 채운다 */
const THREAD_KEY = "threadId";

function isExtensionOff(kind: string): boolean {
  return kind.startsWith("ext.") && kind.endsWith(".off");
}

/** wire 오류를 다리 오류 이름으로 바꾼다. 원문 메시지와 세부 값은 버린다 */
function bridgeErrorOf(cause: unknown): BridgeError {
  if (!(cause instanceof WireError)) return { kind: "failed", detail: "wire_failed" };
  const kind = cause.data.kind;
  if (
    kind === "thread.notFound" ||
    kind === "extension.notFound" ||
    kind === "jsonrpc.methodNotFound"
  ) {
    return { kind: "not_declared" };
  }
  if (kind === "extension.safeModeActive") return { kind: "safe_mode" };
  if (kind === "jsonrpc.invalidParams") return { kind: "args_invalid", detail: "params" };
  if (isExtensionOff(kind)) return { kind: "extension_off" };
  return { kind: "failed", detail: "wire_failed" };
}

async function wire<T>(run: () => Promise<T>): Promise<BackendResult<T>> {
  const result = await attemptAsync(run);
  return result.ok ? ok(result.value) : err(bridgeErrorOf(result.error.cause));
}

/** 열린 대화 id를 wire 타입으로 바꾼다. 없거나 모양이 틀리면 대화가 열려 있지 않은 것이다 */
function threadOf(raw: string | undefined): Result<ThreadId, BridgeError> {
  const parsed = raw === undefined ? undefined : parse(ThreadIdSchema, raw);
  return parsed !== undefined && parsed.ok
    ? ok(parsed.value)
    : err({ kind: "denied", detail: "thread_not_open" });
}

/**
 * 설정 키 하나의 행. 값은 매니페스트가 선언했고 비밀이 아닐 때만 실린다. 정의를 모르는 키는 비밀로 본다(닫힌 쪽).
 * 비밀 키는 값이 있는지만 안다. 값 자체(`secret://` 참조 포함)는 이 함수가 옮기지 않는다
 */
function settingRowOf(
  key: string,
  defs: SettingsListResult["defs"],
  effective: SettingsGetResult["settings"],
  policy: BridgePolicyContext,
): SettingRead {
  const def = defs.find((candidate) => candidate.key === key);
  const secret = def === undefined || def.secret === true;
  const setting = effective.find((row) => row.key === key);
  const isSet = setting !== undefined && setting.value !== null && setting.value !== undefined;
  const shown = !secret && policy.declaredSettingKeys.has(key);
  return { key, secret, isSet, value: shown ? setting?.value : undefined };
}

/**
 * 열린 대화의 사용자 항목 가운데 확장 기록만 이벤트 행으로 만든다. 다리가 가진 항목 모양에는 원천 확장 표지가 없어서
 * 종류(`customType`)로만 거른다. 종류는 요청 목록에 있고 `eventKindAllowed`(자기 접두, `readsRecordKinds`, 코어 허용 목록)를
 * 모두 통과해야 한다. 코어 이벤트(`turn.*` 등)는 항목으로 오지 않아 이 길에는 나타나지 않는다 [미결]
 */
function eventRowsOf(
  items: readonly ItemRecord[],
  kinds: readonly string[],
  policy: BridgePolicyContext,
): readonly unknown[] {
  return items.flatMap((item) => {
    if (item.kind !== "custom") return [];
    const message = item.message;
    if (!kinds.includes(message.customType) || !eventKindAllowed(message.customType, policy)) {
      return [];
    }
    return [
      {
        kind: message.customType,
        itemId: item.itemId,
        timestamp: message.timestamp,
        display: message.display,
        content: message.content,
        details: message.details,
      },
    ];
  });
}

/** 확장 명령의 결과를 다리 값으로 바꾼다. 확인이 필요한 셸 실행과 본문 전송은 이 다리에서 하지 않는다 */
function commandResultOf(output: CommandRunResult): BackendResult<unknown> {
  switch (output.status) {
    case "done":
      return ok({ name: output.name, message: output.message, result: output.result });
    case "not_command":
      return fail("not_declared", "command");
    case "expanded":
      return fail("failed", "command_expanded");
    case "needs_confirmation":
      return fail("denied", "shell_confirm");
    default:
      return assertNever(output, "CommandRunResult");
  }
}

export function createBridgeBackend(deps: BridgeBackendDeps): BridgeBackend {
  const { connection } = deps;
  /** `ext.<확장>.<동사>` 한 번. 대화는 열린 대화로만 싣고 프레임이 준 `threadId`는 버린다 */
  function extension(
    verb: string,
    params: Readonly<Record<string, unknown>>,
  ): Promise<BackendResult<unknown>> {
    const rest = Object.fromEntries(Object.entries(params).filter(([key]) => key !== THREAD_KEY));
    const open = threadOf(deps.openThreadId());
    const sent = open.ok ? { ...rest, [THREAD_KEY]: open.value } : rest;
    return wire(() => connection.requestExtension(deps.extension, verb, sent));
  }

  return {
    requestApproval: unavailable,

    query(verb, params) {
      return extension(verb, params);
    },

    call(verb, params) {
      // 승인이 필요한 메서드는 승인 뒤 실행하는 길이 없어 닫는다. 판정은 `decide`가 이미 했고 여기서 다시 선언을 본다
      if (deps.policy().methods.get(verb)?.approval === true) {
        return Promise.resolve(fail("denied", "approval_required"));
      }
      return extension(verb, params);
    },

    async events(kinds, limit) {
      const open = threadOf(deps.openThreadId());
      if (!open.ok) return ok([]);
      const cap = Math.min(limit, EVENT_ROWS_MAX);
      const read = await wire(() =>
        connection.request("thread.read", { threadId: open.value, limit: cap }),
      );
      if (!read.ok) return read;
      return ok(eventRowsOf(read.value.items, kinds, deps.policy()).slice(0, cap));
    },

    async settings(keys) {
      const defs = await wire(() => connection.request("settings.list", {}));
      if (!defs.ok) return defs;
      const open = threadOf(deps.openThreadId());
      const got = await wire(() =>
        connection.request("settings.get", {
          keys: [...keys],
          ...(open.ok ? { threadId: open.value } : {}),
        }),
      );
      if (!got.ok) return got;
      const policy = deps.policy();
      return ok(keys.map((key) => settingRowOf(key, defs.value.defs, got.value.settings, policy)));
    },

    host() {
      return { ...deps.snapshot(), threadId: deps.openThreadId() };
    },

    async command(name, args) {
      const open = threadOf(deps.openThreadId());
      if (!open.ok) return open;
      const tail = stripUnsafeText(args, false).trim();
      const text = tail === "" ? `/${name}` : `/${name} ${tail}`;
      const ran = await wire(() =>
        connection.request("command.run", { threadId: open.value, text }),
      );
      if (!ran.ok) return ran;
      return commandResultOf(ran.value);
    },

    post(threadId, text) {
      return wire(() =>
        connection.request("ext.ui.post", {
          extension: deps.extension,
          ui: deps.screen,
          threadId,
          name: POST_NAME,
          payload: text,
        }),
      );
    },

    async navigate(target, shellConfirmed) {
      if (target.kind !== "external") {
        const moved = attempt(() => deps.navigate(target));
        if (!moved.ok) return fail("failed", "navigate");
        return moved.value ? ok(null) : fail("failed", "navigate_unsupported");
      }
      // 외부 링크는 판정 뒤 `confirmExternal`을 거친 것만 온다(브리지는 이때 `needsShellConfirm`을 참으로 보낸다)
      if (!shellConfirmed) return fail("denied", "not_confirmed");
      const href = target.link.href;
      const opened = await attemptAsync(() => deps.openExternal(href));
      return opened.ok ? ok(null) : fail("failed", "open_external");
    },

    confirmExternal(link) {
      return deps.confirmExternal(link);
    },

    resize(height) {
      deps.resize(height);
    },

    diagnostic(line) {
      deps.diagnostic(line);
    },
  };
}
