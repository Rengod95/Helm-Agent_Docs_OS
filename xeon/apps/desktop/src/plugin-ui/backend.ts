import {
  assertNever,
  attempt,
  attemptAsync,
  err,
  ok,
  parse,
  type Result,
} from "@fresnel/contracts";
import { Type } from "typebox";
import { SecretNameSchema, type SecretName } from "@fresnel/contracts/capabilities";
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
  type HostSnapshot,
  type NavigateTarget,
  type SettingRead,
} from "@fresnel/client/views/app";

// Plugin App 다리의 백엔드(`BridgeBackend`)를 엔진 wire 위에 세운다. 화면 하나에 하나씩 만든다.
// 판정은 이미 `decide`가 했으므로 여기서는 허용된 동작을 wire 호출로 옮기고 오류를 다리 오류 이름으로 바꾼다.
// 오류 문장은 고정 글이고, 엔진의 원문 메시지는 어디로도 가지 않는다.

/** 셸이 직접 여는 이동(외부 링크 제외). 외부 링크는 `openExternal`로만 간다 */
type ShellNavigateTarget = Exclude<NavigateTarget, { readonly kind: "external" }>;

/** 플러그인 화면 다리가 부르는 셸 명령. 프레임에 IPC를 주지 않고 앱 본 화면이 대신 부른다(ADR-0021 §3.4.3) */
export type PluginShellCommand =
  | "pick_file_read"
  | "pick_folder_open"
  | "folder_list"
  | "folder_read"
  | "save_file"
  | "notify_os";

/** 셸 기능 입구. 운영은 셸 어댑터와 `createDesktopIpc`가 채운다. 없으면(웹, 시험) 셸 기능 op는 `shell_unavailable`이다 */
export interface PluginShellPort {
  invoke(command: PluginShellCommand, args?: Readonly<Record<string, unknown>>): Promise<unknown>;
  /** 값은 셸 stdin으로만 간다. 호출자(백엔드)가 부른 뒤 `value`를 0으로 덮는다 */
  registerSecret(
    name: SecretName,
    action: "add" | "set",
    value: Uint8Array,
  ): Promise<Result<null, unknown>>;
}

export interface BridgeBackendDeps {
  /** 셸 기능(파일, 알림, 시크릿 등록). 웹 빌드에는 없다 */
  readonly shell?: PluginShellPort | undefined;
  /** 요청마다 지금 연결을 읽는다. 재연결 뒤에도 낡은 연결로 보내지 않는다. 연결이 없으면 요청은 실패한다 */
  readonly connection: () => HostConnection | undefined;
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
  readonly resize: (height: number) => void;
  readonly diagnostic: (line: { readonly op: string; readonly size: number }) => void;
}

/** `ext.ui.post`의 기록 이름. 화면은 글만 주므로 이름은 고정이다(확장 kind `x.<확장>.ui.message`가 된다) */
const POST_NAME = "message";
/** `events` 행 상한. 다리 상한(`UI_LIMITS.eventRows`)과 `thread.read` 상한이 같다 */
const EVENT_ROWS_MAX = UI_LIMITS.eventRows;

const FileReadShape = Type.Object(
  {
    name: Type.String(),
    path: Type.String(),
    size: Type.Integer({ minimum: 0 }),
    encoding: Type.Union([Type.Literal("utf8"), Type.Literal("base64")]),
    content: Type.String(),
  },
  { additionalProperties: false },
);
const PickedFileSchema = Type.Union([Type.Null(), FileReadShape]);
const PickedFolderSchema = Type.Union([
  Type.Null(),
  Type.Object(
    {
      handle: Type.String({ minLength: 1 }),
      path: Type.String({ minLength: 1 }),
      name: Type.String(),
    },
    { additionalProperties: false },
  ),
]);
const FolderListSchema = Type.Object(
  {
    entries: Type.Array(
      Type.Object(
        {
          path: Type.String(),
          name: Type.String(),
          kind: Type.Union([Type.Literal("file"), Type.Literal("dir")]),
          size: Type.Optional(Type.Integer({ minimum: 0 })),
        },
        { additionalProperties: false },
      ),
    ),
    truncated: Type.Boolean(),
  },
  { additionalProperties: false },
);
const PathReplySchema = Type.Union([Type.Null(), Type.String()]);
const NotifyReplySchema = Type.Object(
  { kind: Type.Union([Type.Literal("shown"), Type.Literal("denied"), Type.Literal("failed")]) },
  { additionalProperties: false },
);
/** 셸이 거부하며 준 짧은 코드(`too-large`, `not-text`, `read_failed` 같은 것)만 세부로 옮긴다. 그 밖의 값은 옮기지 않는다 */
const SHELL_CODE = /^[a-z][a-z_-]{0,31}$/u;

function shellFailure(cause: unknown): BackendResult<never> {
  if (typeof cause === "string" && SHELL_CODE.test(cause)) {
    if (cause === "too-large") return fail("too_large");
    // 고른 폴더 밖이거나 이 화면이 고르지 않은 폴더는 거부다
    if (cause === "outside-folder" || cause === "unknown-folder") return fail("denied", cause);
    return fail("failed", cause);
  }
  return fail("failed", "shell");
}

function fail(kind: BridgeError["kind"], detail?: string): BackendResult<never> {
  return err(detail === undefined ? { kind } : { kind, detail });
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
  /** 셸이 폴더 핸들을 묶는 단위. 화면마다 따로라 다른 화면의 핸들은 쓰지 못한다 */
  const scope = `${deps.extension}/${deps.screen}`;
  /** 지금 연결로 wire 호출 하나. 연결이 없으면 `offline`이다 */
  function onWire<T>(run: (connection: HostConnection) => Promise<T>): Promise<BackendResult<T>> {
    const connection = deps.connection();
    if (connection === undefined) return Promise.resolve(fail("failed", "offline"));
    return wire(() => run(connection));
  }
  /** `ext.<확장>.<동사>` 한 번. 대화는 열린 대화로만 싣고 프레임이 준 `threadId`는 버린다 */
  function extension(
    verb: string,
    params: Readonly<Record<string, unknown>>,
  ): Promise<BackendResult<unknown>> {
    const rest = Object.fromEntries(Object.entries(params).filter(([key]) => key !== THREAD_KEY));
    const open = threadOf(deps.openThreadId());
    const sent = open.ok ? { ...rest, [THREAD_KEY]: open.value } : rest;
    return onWire((connection) => connection.requestExtension(deps.extension, verb, sent));
  }

  return {
    requestApproval(threadId, verb, params) {
      // 카드 글은 엔진이 확장 이름과 선언된 동사로 만든다. 프레임이 준 글은 없다. 대화는 열린 대화로만 싣는다
      const open = threadOf(deps.openThreadId());
      if (!open.ok || open.value !== threadId)
        return Promise.resolve(fail("denied", "thread_not_open"));
      return onWire((connection) =>
        connection.request("ext.ui.requestApproval", {
          extension: deps.extension,
          ui: deps.screen,
          threadId: open.value,
          method: verb,
          params,
        }),
      );
    },

    query(verb, params) {
      return extension(verb, params);
    },

    call(verb, params) {
      // 승인이 필요한 메서드는 승인 결과를 받아 실행하는 길이 아직 없어 닫는다(ADR-0021 §6, 2026-11-04 13번 미결). 화면은 `requestApproval`로 카드를 띄울 수 있다.
      // 판정은 `decide`가 이미 했고 여기서 다시 선언을 본다
      if (deps.policy().methods.get(verb)?.approval === true) {
        return Promise.resolve(fail("denied", "approval_required"));
      }
      return extension(verb, params);
    },

    async events(kinds, limit) {
      const open = threadOf(deps.openThreadId());
      if (!open.ok) return ok([]);
      const cap = Math.min(limit, EVENT_ROWS_MAX);
      const read = await onWire((connection) =>
        connection.request("thread.read", { threadId: open.value, limit: cap }),
      );
      if (!read.ok) return read;
      return ok(eventRowsOf(read.value.items, kinds, deps.policy()).slice(0, cap));
    },

    async settings(keys) {
      const defs = await onWire((connection) => connection.request("settings.list", {}));
      if (!defs.ok) return defs;
      const open = threadOf(deps.openThreadId());
      const got = await onWire((connection) =>
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
      const ran = await onWire((connection) =>
        connection.request("command.run", { threadId: open.value, text }),
      );
      if (!ran.ok) return ran;
      return commandResultOf(ran.value);
    },

    post(threadId, text) {
      return onWire((connection) =>
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
      // 외부 링크는 실행기가 확인 줄을 거친 것만 온다(브리지는 이때 `needsShellConfirm`을 참으로 보낸다)
      if (!shellConfirmed) return fail("denied", "not_confirmed");
      const href = target.link.href;
      const opened = await attemptAsync(() => deps.openExternal(href));
      return opened.ok ? ok(null) : fail("failed", "open_external");
    },

    async pickFile() {
      const shell = deps.shell;
      if (shell === undefined) return fail("failed", "shell_unavailable");
      const reply = await attemptAsync(() => shell.invoke("pick_file_read"));
      if (!reply.ok) return shellFailure(reply.error.cause);
      const parsed = parse(PickedFileSchema, reply.value);
      return parsed.ok ? ok(parsed.value) : fail("failed", "shell_reply");
    },

    async pickFolder() {
      const shell = deps.shell;
      if (shell === undefined) return fail("failed", "shell_unavailable");
      // 고른 폴더는 이 화면의 핸들로만 셸이 기억한다. 프레임은 핸들 id로 `listFolder`, `readFolderFile`을 부른다
      const reply = await attemptAsync(() => shell.invoke("pick_folder_open", { scope }));
      if (!reply.ok) return shellFailure(reply.error.cause);
      const parsed = parse(PickedFolderSchema, reply.value);
      if (!parsed.ok) return fail("failed", "shell_reply");
      if (parsed.value === null) return ok(null);
      return ok({ name: parsed.value.name, path: parsed.value.path, folder: parsed.value.handle });
    },

    async listFolder(folder, relative, recursive) {
      const shell = deps.shell;
      if (shell === undefined) return fail("failed", "shell_unavailable");
      const reply = await attemptAsync(() =>
        shell.invoke("folder_list", { scope, handle: folder, path: relative, recursive }),
      );
      if (!reply.ok) return shellFailure(reply.error.cause);
      const parsed = parse(FolderListSchema, reply.value);
      return parsed.ok ? ok(parsed.value) : fail("failed", "shell_reply");
    },

    async readFolderFile(folder, relative) {
      const shell = deps.shell;
      if (shell === undefined) return fail("failed", "shell_unavailable");
      const reply = await attemptAsync(() =>
        shell.invoke("folder_read", { scope, handle: folder, path: relative }),
      );
      if (!reply.ok) return shellFailure(reply.error.cause);
      const parsed = parse(FileReadShape, reply.value);
      return parsed.ok ? ok(parsed.value) : fail("failed", "shell_reply");
    },

    async saveFile(suggestedName, content) {
      const shell = deps.shell;
      if (shell === undefined) return fail("failed", "shell_unavailable");
      const reply = await attemptAsync(() => shell.invoke("save_file", { suggestedName, content }));
      if (!reply.ok) return shellFailure(reply.error.cause);
      const parsed = parse(PathReplySchema, reply.value);
      // 고른 전체 경로를 프레임에 알린다(2026-11-06)
      return parsed.ok
        ? ok({ saved: parsed.value !== null, path: parsed.value })
        : fail("failed", "shell_reply");
    },

    async notify(title, body) {
      const shell = deps.shell;
      if (shell === undefined) return fail("failed", "shell_unavailable");
      const reply = await attemptAsync(() => shell.invoke("notify_os", { title, body }));
      if (!reply.ok) return shellFailure(reply.error.cause);
      const parsed = parse(NotifyReplySchema, reply.value);
      if (!parsed.ok) return fail("failed", "shell_reply");
      if (parsed.value.kind === "denied") return fail("denied", "os_denied");
      return parsed.value.kind === "shown" ? ok({ shown: true }) : fail("failed", "not_shown");
    },

    async writeSetting(key, value) {
      // 정의를 다시 본다: 모르는 키와 비밀 키는 쓰지 않는다(닫힌 쪽). 판정이 이미 선언한 키만 보냈지만 엔진 정의가 정본이다
      const defs = await onWire((connection) => connection.request("settings.list", {}));
      if (!defs.ok) return defs;
      const def = defs.value.defs.find((candidate) => candidate.key === key);
      if (def === undefined || def.secret === true) return fail("denied", "setting_secret");
      const written = await onWire((connection) =>
        connection.request("settings.set", { key, value, scope: "user" }),
      );
      return written.ok ? ok(null) : written;
    },

    async secretExists(secretName) {
      const listed = await onWire((connection) => connection.request("secret.list", {}));
      if (!listed.ok) return listed;
      return ok(listed.value.secrets.some((secret) => secret.name === secretName));
    },

    async registerSecret(secretName, value, overwrite) {
      const shell = deps.shell;
      if (shell === undefined) return fail("failed", "shell_unavailable");
      // 이름은 셸의 이름 검사와 같은 규칙(`SecretNameSchema`)을 한 번 더 통과해야 한다
      const name = parse(SecretNameSchema, secretName);
      if (!name.ok) return fail("args_invalid", "secret_name");
      const bytes = new TextEncoder().encode(value);
      try {
        const sent = await attemptAsync(() =>
          shell.registerSecret(name.value, overwrite ? "set" : "add", bytes),
        );
        // 거부 값에는 셸의 자식 출력 요약이 들어 있을 수 있어 옮기지 않는다. 이름 있는 종류만 고정 글로 돌려준다
        if (!sent.ok || !sent.value.ok) return fail("failed", "secret_register");
        return ok(null);
      } finally {
        bytes.fill(0);
      }
    },

    resize(height) {
      deps.resize(height);
    },

    diagnostic(line) {
      deps.diagnostic(line);
    },
  };
}
