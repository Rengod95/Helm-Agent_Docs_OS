import { t } from "@xeon/client/i18n";
import { assertNever, err, ok, parse, type Result } from "@xeon/contracts";
import { ScheduleIdSchema, SecretNameSchema, type SecretName } from "@xeon/contracts/capabilities";
import {
  ItemIdSchema,
  ThreadIdSchema,
  type ItemId,
  type ThreadId,
} from "@xeon/contracts/conversation";
import { SettingKeySchema, type SettingKey, type SettingScope } from "@xeon/contracts/settings";
import { checkGroupName, type GroupTemplateKind } from "../group/rules.ts";
import { titleProblem } from "../threads.ts";

// L4.cli.spec §3.2. 명령 모델과 인자 파서. 순수 함수이고 외부 라이브러리를 쓰지 않는다: 비밀 값 argv 금지 같은 규칙을
// 파서 안에 둬야 하기 때문이다.

export type OutputMode = "text" | "json";

export type ChatTarget =
  | { readonly kind: "new" }
  | { readonly kind: "continue" }
  | { readonly kind: "resume"; readonly threadId: ThreadId };

export interface SessionOverride {
  readonly key: SettingKey;
  /** 해석 전 값. §4.8 규칙(JSON 우선, 실패하면 문자열)으로 해석한다 */
  readonly raw: string;
}

export interface ChatCommand {
  readonly kind: "chat";
  readonly mode: "interactive" | "print";
  /** print 모드 입력. "-"이면 stdin을 읽은 뒤 채운다 */
  readonly input: string | null;
  readonly output: OutputMode;
  readonly target: ChatTarget;
  readonly overrides: readonly SessionOverride[];
  /** `--safe-mode`: 이번 시작에 외부 확장과 L3 내장 그룹을 싣지 않는다(X.operations.spec §4.6.1) */
  readonly safeMode: boolean;
  /** `--auto-approve`: print 모드에서 도구 승인을 한 번 허용한다. 대화형에서는 쓰지 못한다(L4.cli.spec §4.11 4번) */
  readonly autoApprove: boolean;
}

export type SessionsCommand =
  | {
      readonly kind: "sessions.ls";
      readonly all: boolean;
      readonly limit: number;
      readonly output: OutputMode;
    }
  | { readonly kind: "sessions.show"; readonly threadId: ThreadId; readonly output: OutputMode }
  | { readonly kind: "sessions.fork"; readonly threadId: ThreadId; readonly at: ItemId | null }
  | { readonly kind: "sessions.rm"; readonly threadId: ThreadId; readonly yes: boolean }
  | { readonly kind: "sessions.rename"; readonly threadId: ThreadId; readonly title: string };

type FileScope = Extract<SettingScope, "user" | "project" | "local">;
/** config schema만(L4.host-service.spec §6.2) */
type SchemaScope = Extract<SettingScope, "managed" | "user" | "project" | "local">;

export type ConfigCommand =
  | {
      readonly kind: "config.get";
      readonly keys: readonly SettingKey[];
      readonly output: OutputMode;
    }
  | {
      readonly kind: "config.set";
      readonly key: SettingKey;
      readonly raw: string;
      readonly scope: FileScope;
    }
  | { readonly kind: "config.reset"; readonly key: SettingKey; readonly scope: FileScope }
  | {
      readonly kind: "config.list";
      readonly prefix: string | null;
      readonly includeDeprecated: boolean;
      readonly output: OutputMode;
    }
  | {
      readonly kind: "config.schema";
      readonly scope: SchemaScope;
      readonly out: string | null;
      readonly coreOnly: boolean;
    };

/** `xeon group new <이름> [--drive|--policy] [--dir <폴더>] [--json]`(L3.slots.spec §3.3.6, L4.cli.spec §3.1) */
export interface GroupNewCommand {
  readonly kind: "group.new";
  readonly name: string;
  readonly template: GroupTemplateKind;
  /** `--dir`의 원문. 없으면 null이고 작업 폴더 아래 `<이름>`을 쓴다. 절대 경로로 바꾸는 일은 명령이 한다 */
  readonly dir: string | null;
  readonly output: OutputMode;
}

type TrustScope = "folder" | "parent" | "session";

export type TrustCommand =
  | { readonly kind: "trust.status"; readonly output: OutputMode }
  | {
      readonly kind: "trust.set";
      readonly verdict: "allow" | "deny";
      readonly scope: TrustScope;
    };

/**
 * `schedule add`의 트리거 한 가지. 값은 파싱한 모양이고 wire 모양으로 옮기는 일은 runner가 한다.
 * `expiresInSeconds`는 시계를 읽기 전의 초다(파서는 순수 함수라서 `expiresAtMs`를 만들지 않는다)
 */
export type ScheduleTriggerArg =
  | { readonly kind: "every"; readonly everySeconds: number }
  | { readonly kind: "at"; readonly atMs: number }
  | { readonly kind: "remote" }
  | {
      readonly kind: "watch";
      /** 상대 경로는 작업 폴더 기준이다. runner가 절대 경로로 바꾼다 */
      readonly paths: readonly string[];
      readonly debounceMs: number;
    }
  | {
      readonly kind: "loop";
      readonly intervalSeconds: number;
      readonly maxIterations: number;
      readonly expiresInSeconds: number;
    };

export type ScheduleCommand =
  | {
      readonly kind: "schedule.add";
      readonly prompt: string;
      readonly trigger: ScheduleTriggerArg;
      readonly title: string | null;
      /** 상대 경로는 작업 폴더 기준이다. 없으면 host가 기본 작업 폴더를 고른다 */
      readonly workspace: string | null;
      /** `--disabled`: 만들되 끈 상태로 둔다 */
      readonly disabled: boolean;
    }
  | { readonly kind: "schedule.list"; readonly all: boolean; readonly output: OutputMode }
  | { readonly kind: "schedule.cancel"; readonly scheduleId: string }
  | { readonly kind: "schedule.run"; readonly scheduleId: string };

export interface SecretMetaFlags {
  readonly provider?: "sops" | "op" | "bws" | "keychain";
  readonly desc?: string;
  readonly scope?: string;
  readonly hosts?: readonly string[];
  /** ISO 8601 날짜 */
  readonly expires?: string;
}

export type SecretCommand =
  | {
      readonly kind: "secret.ls";
      readonly meta: boolean;
      readonly usage: boolean;
      readonly output: OutputMode;
    }
  | { readonly kind: "secret.add"; readonly name: SecretName; readonly meta: SecretMetaFlags }
  | { readonly kind: "secret.set"; readonly name: SecretName }
  | { readonly kind: "secret.meta"; readonly name: SecretName; readonly meta: SecretMetaFlags }
  | { readonly kind: "secret.rotate"; readonly name: SecretName }
  | { readonly kind: "secret.rm"; readonly name: SecretName; readonly yes: boolean }
  | { readonly kind: "secret.test"; readonly name: SecretName; readonly output: OutputMode }
  | { readonly kind: "secret.reveal"; readonly name: SecretName };

export interface ServiceCommand {
  readonly kind: "service";
  /** ensure·launch-mode는 --json만, launch-mode·run은 도움말에 숨긴다 */
  readonly action: "start" | "status" | "stop" | "ensure" | "launch-mode" | "run";
  readonly output: OutputMode;
  /** `--safe-mode`. start·ensure·run만. 새로 띄우는 서비스가 안전 모드로 시작한다 */
  readonly safeMode: boolean;
  /** `--listen-tcp <host>:<port>`. start·run만. 서비스가 TCP로도 연다(토큰은 등록 파일에 있다) */
  readonly listenTcp: { readonly host: string; readonly port: number } | null;
  /** `--allow-non-loopback`. 루프백이 아닌 `--listen-tcp` 주소를 허용한다 */
  readonly allowNonLoopback: boolean;
}
/** @xeon/host의 HostCommand(runHostCommand 입력)와 다른 타입이다. 이름을 나눠 둔다. */
interface CliHostCommand {
  readonly kind: "host";
  readonly stdio: true;
}
export interface DoctorCommand {
  readonly kind: "doctor";
  readonly output: OutputMode;
}
interface VersionCommand {
  readonly kind: "version";
  readonly output: OutputMode;
}
interface HelpCommand {
  readonly kind: "help";
  readonly topic: string | null;
}
/** `db export <폴더>`. 엔진을 띄우지 않고 저장소 파일을 내보낸다(L4.cli.spec §4.13). destDir은 작업 폴더 기준 상대 경로일 수 있다 */
export type DbCommand = {
  readonly kind: "db.export";
  readonly destDir: string;
  readonly output: OutputMode;
};

export type CliCommand =
  | ChatCommand
  | SessionsCommand
  | GroupNewCommand
  | ConfigCommand
  | SecretCommand
  | TrustCommand
  | ScheduleCommand
  | ServiceCommand
  | DbCommand
  | CliHostCommand
  | DoctorCommand
  | VersionCommand
  | HelpCommand;

export interface GlobalOptions {
  /** `-C <dir>`로 받은 값 또는 "."(현재 폴더). 절대 경로로 바꾸는 일은 runCli가 한다(파서는 순수 함수다) */
  readonly cwd: string;
  readonly color: boolean;
  /** `--remote <주소>`로 받은 원문. 없으면 null. 문법 검사는 엔진 연결이 한다(HS-87) */
  readonly remote: string | null;
}

type UsageErrorCode =
  | "unknownCommand"
  | "unknownFlag"
  | "missingArgument"
  | "unexpectedArgument"
  | "invalidSettingKey"
  | "invalidOverride"
  | "invalidThreadId"
  | "invalidScheduleId"
  | "invalidSecretName"
  | "secretValueInArgv"
  | "conflictingFlags"
  | "jsonRequiresPrint"
  | "autoApproveRequiresPrint"
  | "inputRequired"
  | "revealRequiresTty"
  | "invalidGroupName";

export interface UsageError {
  readonly code: UsageErrorCode;
  /** 한 줄. 무엇이 잘못됐는가 */
  readonly message: string;
  /** 한 줄. 해결 방법(§4.10) */
  readonly fix: string;
}

export interface TerminalFacts {
  readonly stdinIsTty: boolean;
  readonly stdoutIsTty: boolean;
}

export interface ParsedArgv {
  readonly global: GlobalOptions;
  readonly command: CliCommand;
}

// ── 낮은 수준: 플래그 스캔 ───────────────────────────────────────────────

interface FlagSpec {
  /** "none": 값 없음, "required": 다음 토큰이 값, "optional": 다음 토큰이 `-`로 시작하지 않을 때만 값 */
  readonly value: "none" | "required" | "optional";
  /** 여러 번 쓸 수 있다 */
  readonly repeat?: boolean;
}

type FlagTable = Readonly<Record<string, FlagSpec>>;

const GLOBAL_FLAGS: FlagTable = {
  "-h": { value: "none" },
  "--help": { value: "none" },
  "--no-color": { value: "none" },
  "-C": { value: "required" },
  "--remote": { value: "required" },
};

interface Scanned {
  /** 플래그 → 받은 값들. 값 없는 플래그는 빈 문자열 하나를 가진다 */
  readonly values: ReadonlyMap<string, readonly string[]>;
  /** 값을 받지 못한 optional 플래그 */
  readonly bare: ReadonlySet<string>;
  readonly positionals: readonly string[];
}

function usage(code: UsageErrorCode, message: string, fix: string): UsageError {
  return { code, message, fix };
}

function flagNameOf(token: string): string {
  const eq = token.indexOf("=");
  return token.startsWith("--") && eq > 0 ? token.slice(0, eq) : token;
}

/** 명령 앞뒤 어디에 놓였든 공통 플래그(-h, --no-color, -C, --remote)를 모아 둔다 */
interface GlobalAcc {
  help: boolean;
  noColor: boolean;
  cwd: string | null;
  remote: string | null;
}

/** `--remote`에 주소가 없거나 빈 문자열이다. 빈 주소는 원격을 끄는 것과 헷갈리므로 사용법 오류로 본다 */
function missingRemote(): UsageError {
  return usage(
    "missingArgument",
    t("cli.usage.remote.missing.message"),
    t("cli.usage.remote.missing.fix"),
  );
}

function scanArgs(
  acc: GlobalAcc,
  args: readonly string[],
  table: FlagTable,
  onUnknownFlag?: (name: string) => UsageError | undefined,
): Result<Scanned, UsageError> {
  const specs: FlagTable = { ...GLOBAL_FLAGS, ...table };
  const values = new Map<string, string[]>();
  const bare = new Set<string>();
  const positionals: string[] = [];
  // 첫 오류를 보관하고 끝까지 훑는다: 뒤에 --help가 있으면 오류보다 도움말이 먼저다
  const problem: { current: UsageError | undefined } = { current: undefined };
  const fail = (error: UsageError): void => {
    problem.current ??= error;
  };
  const put = (name: string, value: string): void => {
    const spec = specs[name];
    const list = values.get(name) ?? [];
    if (list.length > 0 && spec?.repeat !== true) {
      fail(
        usage(
          "conflictingFlags",
          t("cli.usage.flag.repeated.message", { name }),
          t("cli.usage.flag.repeated.fix", { name }),
        ),
      );
      return;
    }
    list.push(value);
    values.set(name, list);
  };
  let index = 0;
  while (index < args.length) {
    const token = args[index] ?? "";
    index += 1;
    if (token === "--") {
      positionals.push(...args.slice(index));
      break;
    }
    if (token === "-" || !token.startsWith("-")) {
      positionals.push(token);
      continue;
    }
    const name = flagNameOf(token);
    const spec = specs[name];
    if (spec === undefined) {
      fail(
        onUnknownFlag?.(name) ??
          usage(
            "unknownFlag",
            t("cli.usage.flag.unknown.message", { name }),
            t("cli.usage.flag.unknown.fix"),
          ),
      );
      continue;
    }
    const inline =
      token.startsWith("--") && token.includes("=") ? token.slice(name.length + 1) : null;
    if (spec.value === "none") {
      if (inline !== null) {
        fail(
          usage(
            "unexpectedArgument",
            t("cli.usage.flag.noValue.message", { name }),
            t("cli.usage.flag.noValue.fix", { name }),
          ),
        );
      } else {
        put(name, "");
      }
      continue;
    }
    if (inline !== null) {
      put(name, inline);
      continue;
    }
    const next = args[index];
    const takesNext =
      next !== undefined && (spec.value === "required" || next === "-" || !next.startsWith("-"));
    if (!takesNext) {
      if (spec.value === "required") {
        fail(
          usage(
            "missingArgument",
            t("cli.usage.flag.missingValue.message", { name }),
            t("cli.usage.flag.missingValue.fix", { name }),
          ),
        );
      } else {
        bare.add(name);
        put(name, "");
      }
      continue;
    }
    index += 1;
    put(name, next);
  }
  if (values.has("-h") || values.has("--help")) acc.help = true;
  if (values.has("--no-color")) acc.noColor = true;
  const dir = values.get("-C")?.[0];
  if (dir !== undefined) acc.cwd = dir;
  // `schedule add --remote`는 트리거 플래그라서 공통 플래그가 아니다. 명령이 표를 덮었으면 공통 값을 읽지 않는다
  if (specs["--remote"] === GLOBAL_FLAGS["--remote"]) {
    const remote = values.get("--remote")?.[0];
    if (remote === "") fail(missingRemote());
    else if (remote !== undefined) acc.remote = remote;
  }
  if (problem.current !== undefined) return err(problem.current);
  return ok({ values, bare, positionals });
}

function has(scanned: Scanned, ...names: readonly string[]): boolean {
  return names.some((name) => scanned.values.has(name));
}

function valueOf(scanned: Scanned, ...names: readonly string[]): string | null {
  for (const name of names) {
    const list = scanned.values.get(name);
    const first = list?.[0];
    if (first !== undefined) return first;
  }
  return null;
}

function outputOf(scanned: Scanned): OutputMode {
  return has(scanned, "--json") ? "json" : "text";
}

// ── 값 검사 ──────────────────────────────────────────────────────────────

function threadIdOf(text: string): Result<ThreadId, UsageError> {
  const parsed = parse(ThreadIdSchema, text);
  if (parsed.ok) return ok(parsed.value);
  return err(
    usage(
      "invalidThreadId",
      t("cli.usage.threadId.invalid.message"),
      t("cli.usage.threadId.invalid.fix"),
    ),
  );
}

function itemIdOf(text: string): Result<ItemId, UsageError> {
  const parsed = parse(ItemIdSchema, text);
  if (parsed.ok) return ok(parsed.value);
  return err(
    usage(
      "invalidThreadId",
      t("cli.usage.itemId.invalid.message"),
      t("cli.usage.itemId.invalid.fix"),
    ),
  );
}

function settingKeyOf(text: string): Result<SettingKey, UsageError> {
  const parsed = parse(SettingKeySchema, text);
  if (parsed.ok) return ok(parsed.value);
  return err(
    usage(
      "invalidSettingKey",
      t("cli.usage.settingKey.invalid.message", { text }),
      t("cli.usage.settingKey.invalid.fix"),
    ),
  );
}

function secretNameOf(text: string): Result<SecretName, UsageError> {
  const parsed = parse(SecretNameSchema, text);
  if (parsed.ok) return ok(parsed.value);
  return err(
    usage(
      "invalidSecretName",
      t("cli.usage.secretName.invalid.message"),
      t("cli.usage.secretName.invalid.fix"),
    ),
  );
}

const FILE_SCOPES: readonly FileScope[] = ["user", "project", "local"];
const SCHEMA_SCOPES: readonly SchemaScope[] = ["managed", "user", "project", "local"];

function fileScopeOf(text: string | null): Result<FileScope, UsageError> {
  if (text === null) return ok("user");
  const found = FILE_SCOPES.find((scope) => scope === text);
  if (found !== undefined) return ok(found);
  if (text === "session" || text === "managed") {
    return err(
      usage(
        "conflictingFlags",
        t("cli.usage.scope.notForConfig.message", { text }),
        t("cli.usage.scope.notForConfig.fix"),
      ),
    );
  }
  return err(
    usage(
      "unexpectedArgument",
      t("cli.usage.flagValue.invalid.message", { flag: "--scope" }),
      t("cli.usage.oneOf.fix", { list: "user, project, local" }),
    ),
  );
}

function parseOverride(text: string): Result<SessionOverride, UsageError> {
  const eq = text.indexOf("=");
  if (eq <= 0) {
    return err(
      usage(
        "invalidOverride",
        t("cli.usage.set.noEquals.message"),
        t("cli.usage.set.noEquals.fix"),
      ),
    );
  }
  const key = settingKeyOf(text.slice(0, eq));
  if (!key.ok) return key;
  return ok({ key: key.value, raw: text.slice(eq + 1) });
}

// ── 명령별 파서 ──────────────────────────────────────────────────────────

const CHAT_FLAGS: FlagTable = {
  "-p": { value: "optional" },
  "--print": { value: "optional" },
  "--json": { value: "none" },
  "--continue": { value: "none" },
  "--resume": { value: "required" },
  "--set": { value: "required", repeat: true },
  "--safe-mode": { value: "none" },
  "--auto-approve": { value: "none" },
};

function parseChat(
  acc: GlobalAcc,
  rest: readonly string[],
  terminal: TerminalFacts,
): Result<ChatCommand, UsageError> {
  const scanned = scanArgs(acc, rest, CHAT_FLAGS);
  if (!scanned.ok) return scanned;
  const flags = scanned.value;
  if (flags.positionals.length > 0) {
    return err(
      usage(
        "unexpectedArgument",
        t("cli.usage.chat.positional.message"),
        t("cli.usage.chat.positional.fix"),
      ),
    );
  }
  if (has(flags, "--continue") && has(flags, "--resume")) {
    return err(
      usage(
        "conflictingFlags",
        t("cli.usage.chat.continueResume.message"),
        t("cli.usage.onlyOne.fix"),
      ),
    );
  }
  let target: ChatTarget = { kind: "new" };
  if (has(flags, "--continue")) target = { kind: "continue" };
  const resumeId = valueOf(flags, "--resume");
  if (resumeId !== null) {
    const threadId = threadIdOf(resumeId);
    if (!threadId.ok) return threadId;
    target = { kind: "resume", threadId: threadId.value };
  }
  const overrides: SessionOverride[] = [];
  for (const raw of flags.values.get("--set") ?? []) {
    const parsed = parseOverride(raw);
    if (!parsed.ok) return parsed;
    overrides.push(parsed.value);
  }

  const printFlag = has(flags, "-p", "--print");
  let mode: "interactive" | "print";
  let input: string | null = null;
  if (printFlag) {
    mode = "print";
    const bare = flags.bare.has("-p") || flags.bare.has("--print");
    input = bare ? "-" : (valueOf(flags, "-p", "--print") ?? "");
  } else if (!terminal.stdinIsTty) {
    mode = "print";
    input = "-";
  } else if (!terminal.stdoutIsTty) {
    return err(
      usage(
        "inputRequired",
        t("cli.usage.chat.inputRequired.message"),
        t("cli.usage.chat.inputRequired.fix"),
      ),
    );
  } else {
    mode = "interactive";
  }
  const output = outputOf(flags);
  if (output === "json" && mode === "interactive") {
    return err(
      usage(
        "jsonRequiresPrint",
        t("cli.usage.chat.jsonRequiresPrint.message"),
        t("cli.usage.chat.withPrint.fix"),
      ),
    );
  }
  if (has(flags, "--auto-approve") && mode === "interactive") {
    return err(
      usage(
        "autoApproveRequiresPrint",
        t("cli.usage.chat.autoApprove.message"),
        t("cli.usage.chat.withPrint.fix"),
      ),
    );
  }
  return ok({
    kind: "chat",
    mode,
    input,
    output,
    target,
    overrides,
    safeMode: has(flags, "--safe-mode"),
    autoApprove: has(flags, "--auto-approve"),
  });
}

function parseConfig(acc: GlobalAcc, rest: readonly string[]): Result<ConfigCommand, UsageError> {
  const [action, ...tail] = rest;
  switch (action) {
    case "get": {
      const scanned = scanArgs(acc, tail, { "--json": { value: "none" } });
      if (!scanned.ok) return scanned;
      const keys: SettingKey[] = [];
      for (const text of scanned.value.positionals) {
        const key = settingKeyOf(text);
        if (!key.ok) return key;
        keys.push(key.value);
      }
      return ok({ kind: "config.get", keys, output: outputOf(scanned.value) });
    }
    case "set": {
      const scanned = scanArgs(acc, tail, { "--scope": { value: "required" } });
      if (!scanned.ok) return scanned;
      const [keyText, raw, ...extra] = scanned.value.positionals;
      if (keyText === undefined || raw === undefined) {
        return err(
          usage(
            "missingArgument",
            t("cli.usage.config.setMissing.message"),
            t("cli.usage.config.setMissing.fix"),
          ),
        );
      }
      if (extra.length > 0) {
        return err(
          usage(
            "unexpectedArgument",
            t("cli.usage.tooManyArgs.message", { command: "config set" }),
            t("cli.usage.config.setExtra.fix"),
          ),
        );
      }
      const key = settingKeyOf(keyText);
      if (!key.ok) return key;
      const scope = fileScopeOf(valueOf(scanned.value, "--scope"));
      if (!scope.ok) return scope;
      return ok({ kind: "config.set", key: key.value, raw, scope: scope.value });
    }
    case "reset": {
      const scanned = scanArgs(acc, tail, { "--scope": { value: "required" } });
      if (!scanned.ok) return scanned;
      const [keyText, ...extra] = scanned.value.positionals;
      if (keyText === undefined) {
        return err(
          usage(
            "missingArgument",
            t("cli.usage.config.resetMissing.message"),
            t("cli.usage.config.resetMissing.fix"),
          ),
        );
      }
      if (extra.length > 0) {
        return err(
          usage(
            "unexpectedArgument",
            t("cli.usage.tooManyArgs.message", { command: "config reset" }),
            t("cli.usage.oneKey.fix"),
          ),
        );
      }
      const key = settingKeyOf(keyText);
      if (!key.ok) return key;
      const scope = fileScopeOf(valueOf(scanned.value, "--scope"));
      if (!scope.ok) return scope;
      return ok({ kind: "config.reset", key: key.value, scope: scope.value });
    }
    case "list": {
      const scanned = scanArgs(acc, tail, {
        "--prefix": { value: "required" },
        "--deprecated": { value: "none" },
        "--json": { value: "none" },
      });
      if (!scanned.ok) return scanned;
      if (scanned.value.positionals.length > 0) {
        return err(
          usage(
            "unexpectedArgument",
            t("cli.usage.noPositional.message", { command: "config list" }),
            t("cli.usage.config.listPositional.fix"),
          ),
        );
      }
      return ok({
        kind: "config.list",
        prefix: valueOf(scanned.value, "--prefix"),
        includeDeprecated: has(scanned.value, "--deprecated"),
        output: outputOf(scanned.value),
      });
    }
    case "schema": {
      const scanned = scanArgs(acc, tail, {
        "--scope": { value: "required" },
        "--out": { value: "required" },
        "--core-only": { value: "none" },
      });
      if (!scanned.ok) return scanned;
      if (scanned.value.positionals.length > 0) {
        return err(
          usage(
            "unexpectedArgument",
            t("cli.usage.noPositional.message", { command: "config schema" }),
            t("cli.usage.config.schemaPositional.fix"),
          ),
        );
      }
      const scopeText = valueOf(scanned.value, "--scope");
      if (scopeText === null) {
        return err(
          usage(
            "missingArgument",
            t("cli.usage.config.schemaScopeMissing.message"),
            "xeon config schema --scope managed|user|project|local",
          ),
        );
      }
      const scope = SCHEMA_SCOPES.find((candidate) => candidate === scopeText);
      if (scope === undefined) {
        return err(
          usage(
            "unexpectedArgument",
            t("cli.usage.flagValue.invalid.message", { flag: "--scope" }),
            t("cli.usage.oneOf.fix", { list: "managed, user, project, local" }),
          ),
        );
      }
      return ok({
        kind: "config.schema",
        scope,
        out: valueOf(scanned.value, "--out"),
        coreOnly: has(scanned.value, "--core-only"),
      });
    }
    case undefined:
      return err(
        usage(
          "missingArgument",
          t("cli.usage.subcommandMissing.message", { command: "config" }),
          t("cli.usage.oneOf.fix", { list: "get, set, reset, list, schema" }),
        ),
      );
    // xeon-disable-next-line xeon/switch-default-never -- 명령줄 인자는 닫히지 않은 문자열이다. 모르는 하위 명령은 사용법 오류 값으로 돌려준다 (eng.typescript.guide TY-14)
    default:
      return err(
        usage(
          "unknownCommand",
          t("cli.usage.unknownCommand.message", { command: `config ${action}` }),
          t("cli.usage.oneOf.fix", { list: "get, set, reset, list, schema" }),
        ),
      );
  }
}

const TRUST_SCOPES: readonly TrustScope[] = ["folder", "parent", "session"];

function parseTrust(acc: GlobalAcc, rest: readonly string[]): Result<TrustCommand, UsageError> {
  const [action, ...tail] = rest;
  // `xeon trust --json`처럼 동작 이름 없이 플래그부터 오면 status다
  const bare = action?.startsWith("-") === true;
  if (action === undefined || action === "status" || bare) {
    const scanned = scanArgs(acc, bare ? rest : tail, { "--json": { value: "none" } });
    if (!scanned.ok) return scanned;
    if (scanned.value.positionals.length > 0) {
      return err(
        usage(
          "unexpectedArgument",
          t("cli.usage.noPositional.message", { command: "trust status" }),
          t("cli.usage.jsonOnly.fix"),
        ),
      );
    }
    return ok({ kind: "trust.status", output: outputOf(scanned.value) });
  }
  if (action !== "allow" && action !== "deny") {
    return err(
      usage(
        "unknownCommand",
        t("cli.usage.unknownCommand.message", { command: `trust ${action}` }),
        t("cli.usage.oneOf.fix", { list: "status, allow, deny" }),
      ),
    );
  }
  const scanned = scanArgs(acc, tail, { "--scope": { value: "required" } });
  if (!scanned.ok) return scanned;
  if (scanned.value.positionals.length > 0) {
    return err(
      usage(
        "unexpectedArgument",
        t("cli.usage.noPositional.message", { command: `trust ${action}` }),
        `xeon trust ${action} [--scope folder|parent|session]`,
      ),
    );
  }
  const scopeText = valueOf(scanned.value, "--scope") ?? "folder";
  const scope = TRUST_SCOPES.find((candidate) => candidate === scopeText);
  if (scope === undefined) {
    return err(
      usage(
        "unexpectedArgument",
        t("cli.usage.flagValue.invalid.message", { flag: "--scope" }),
        t("cli.usage.oneOf.fix", { list: "folder, parent, session" }),
      ),
    );
  }
  return ok({ kind: "trust.set", verdict: action, scope });
}

// ── 예약 ─────────────────────────────────────────────────────────────────

type TriggerFlag = "--every" | "--at" | "--remote" | "--watch" | "--loop";

const SCHEDULE_ADD_FLAGS: FlagTable = {
  "--every": { value: "required" },
  "--at": { value: "required" },
  "--remote": { value: "none" },
  "--watch": { value: "required" },
  "--debounce": { value: "required" },
  "--loop": { value: "required" },
  "--max-iterations": { value: "required" },
  "--expires-in": { value: "required" },
  "--title": { value: "required" },
  "--workspace": { value: "required" },
  "--disabled": { value: "none" },
};

/** 트리거 플래그. 정확히 하나를 쓴다 */
const TRIGGER_FLAGS: readonly TriggerFlag[] = ["--every", "--at", "--remote", "--watch", "--loop"];
function scheduleAddUsage(): string {
  return t("cli.usage.schedule.addSyntax");
}
function loopUsage(): string {
  return t("cli.usage.schedule.loopSyntax");
}
const SCHEDULE_MAX_SECONDS = 31536000;
const DEFAULT_DEBOUNCE_MS = 1000;
const DEBOUNCE_MAX_MS = 3600000;
const WATCH_MAX_PATHS = 16;
const WATCH_PATH_MAX = 4096;
const MAX_ITERATIONS_MAX = 10000;

/** 십진 정수 문자열이고 min 이상 max 이하이면 그 값, 아니면 null */
function wholeOf(text: string, min: number, max: number): number | null {
  if (!/^[0-9]+$/.test(text)) return null;
  const value = Number(text);
  return value >= min && value <= max ? value : null;
}

function badNumber(flag: string, min: number, max: number): UsageError {
  return usage(
    "unexpectedArgument",
    t("cli.usage.number.invalid.message", { flag, min: String(min), max: String(max) }),
    t("cli.usage.number.invalid.fix", { flag }),
  );
}

/** 쉼표로 나눈 경로 목록. 빈 경로, 상한을 넘는 개수나 길이는 null */
function watchPathsOf(text: string): readonly string[] | null {
  const paths = text.split(",").map((path) => path.trim());
  if (paths.length > WATCH_MAX_PATHS) return null;
  if (paths.some((path) => path.length === 0 || path.length > WATCH_PATH_MAX)) return null;
  return paths;
}

/** Date.parse가 읽는 시각. 읽지 못하거나 1 미만(1970 이전 포함)이면 null */
function atMsOf(text: string): number | null {
  const ms = Date.parse(text);
  return Number.isInteger(ms) && ms >= 1 ? ms : null;
}

function triggerOf(flags: Scanned, flag: TriggerFlag): Result<ScheduleTriggerArg, UsageError> {
  switch (flag) {
    case "--every": {
      const everySeconds = wholeOf(valueOf(flags, flag) ?? "", 1, SCHEDULE_MAX_SECONDS);
      if (everySeconds === null) return err(badNumber(flag, 1, SCHEDULE_MAX_SECONDS));
      return ok({ kind: "every", everySeconds });
    }
    case "--at": {
      const atMs = atMsOf(valueOf(flags, flag) ?? "");
      if (atMs === null) {
        return err(
          usage(
            "unexpectedArgument",
            t("cli.usage.at.unreadable.message"),
            t("cli.usage.at.unreadable.fix"),
          ),
        );
      }
      return ok({ kind: "at", atMs });
    }
    case "--remote":
      return ok({ kind: "remote" });
    case "--watch": {
      const paths = watchPathsOf(valueOf(flags, flag) ?? "");
      if (paths === null) {
        return err(
          usage(
            "unexpectedArgument",
            t("cli.usage.watch.invalid.message", { max: String(WATCH_MAX_PATHS) }),
            t("cli.usage.watch.invalid.fix"),
          ),
        );
      }
      const debounceText = valueOf(flags, "--debounce");
      const debounceMs =
        debounceText === null ? DEFAULT_DEBOUNCE_MS : wholeOf(debounceText, 0, DEBOUNCE_MAX_MS);
      if (debounceMs === null) return err(badNumber("--debounce", 0, DEBOUNCE_MAX_MS));
      return ok({ kind: "watch", paths, debounceMs });
    }
    case "--loop": {
      const intervalSeconds = wholeOf(valueOf(flags, flag) ?? "", 0, SCHEDULE_MAX_SECONDS);
      if (intervalSeconds === null) return err(badNumber(flag, 0, SCHEDULE_MAX_SECONDS));
      const maxText = valueOf(flags, "--max-iterations");
      const expiresText = valueOf(flags, "--expires-in");
      // 상한 없는 루프는 만들 수 없다(L2.schedule.spec §4.1.2)
      if (maxText === null || expiresText === null) {
        return err(
          usage("missingArgument", t("cli.usage.loop.missingOptions.message"), loopUsage()),
        );
      }
      const maxIterations = wholeOf(maxText, 1, MAX_ITERATIONS_MAX);
      if (maxIterations === null) {
        return err(badNumber("--max-iterations", 1, MAX_ITERATIONS_MAX));
      }
      const expiresInSeconds = wholeOf(expiresText, 1, SCHEDULE_MAX_SECONDS);
      if (expiresInSeconds === null) {
        return err(badNumber("--expires-in", 1, SCHEDULE_MAX_SECONDS));
      }
      return ok({ kind: "loop", intervalSeconds, maxIterations, expiresInSeconds });
    }
    default:
      return assertNever(flag, "TriggerFlag");
  }
}

function parseScheduleAdd(
  acc: GlobalAcc,
  rest: readonly string[],
): Result<ScheduleCommand, UsageError> {
  const scanned = scanArgs(acc, rest, SCHEDULE_ADD_FLAGS);
  if (!scanned.ok) return scanned;
  const flags = scanned.value;
  const triggers = TRIGGER_FLAGS.filter((name) => has(flags, name));
  const [only, ...others] = triggers;
  if (only === undefined) {
    return err(
      usage("missingArgument", t("cli.usage.schedule.triggerMissing.message"), scheduleAddUsage()),
    );
  }
  if (others.length > 0) {
    return err(
      usage(
        "conflictingFlags",
        t("cli.usage.schedule.triggerConflict.message", { triggers: triggers.join(", ") }),
        t("cli.usage.schedule.triggerConflict.fix"),
      ),
    );
  }
  const prompt = flags.positionals.join(" ").trim();
  if (prompt.length === 0) {
    return err(
      usage("missingArgument", t("cli.usage.schedule.promptMissing.message"), scheduleAddUsage()),
    );
  }
  // 트리거에 딸린 값 플래그는 그 트리거와 함께만 쓴다
  if (only !== "--watch" && has(flags, "--debounce")) {
    return err(
      usage("conflictingFlags", t("cli.usage.schedule.debounce.message"), scheduleAddUsage()),
    );
  }
  if (only !== "--loop" && has(flags, "--max-iterations", "--expires-in")) {
    return err(
      usage("conflictingFlags", t("cli.usage.schedule.loopOnly.message"), scheduleAddUsage()),
    );
  }
  const trigger = triggerOf(flags, only);
  if (!trigger.ok) return trigger;

  const titleText = valueOf(flags, "--title");
  const title = titleText === null ? null : titleText.trim();
  if (title !== null) {
    const problem = titleProblem(title);
    if (problem !== null) {
      return err(
        usage(
          title.length === 0 ? "missingArgument" : "unexpectedArgument",
          `--title: ${problem}`,
          t("cli.usage.schedule.title.fix"),
        ),
      );
    }
  }
  const workspace = valueOf(flags, "--workspace");
  if (workspace === "") {
    return err(
      usage(
        "missingArgument",
        t("cli.usage.folderMissing.message", { flag: "--workspace" }),
        t("cli.usage.workspace.folderFix"),
      ),
    );
  }
  return ok({
    kind: "schedule.add",
    prompt,
    trigger: trigger.value,
    title,
    workspace,
    disabled: has(flags, "--disabled"),
  });
}

function parseScheduleList(
  acc: GlobalAcc,
  rest: readonly string[],
): Result<ScheduleCommand, UsageError> {
  const scanned = scanArgs(acc, rest, {
    "--all": { value: "none" },
    "--json": { value: "none" },
  });
  if (!scanned.ok) return scanned;
  if (scanned.value.positionals.length > 0) {
    return err(
      usage(
        "unexpectedArgument",
        t("cli.usage.noPositional.message", { command: "schedule list" }),
        "xeon schedule list [--all] [--json]",
      ),
    );
  }
  return ok({
    kind: "schedule.list",
    all: has(scanned.value, "--all"),
    output: outputOf(scanned.value),
  });
}

/** `schedule cancel|run <id>`의 id 하나를 받는다 */
function scheduleIdArg(
  acc: GlobalAcc,
  action: "cancel" | "run",
  rest: readonly string[],
): Result<string, UsageError> {
  const scanned = scanArgs(acc, rest, {});
  if (!scanned.ok) return scanned;
  const [idText, ...extra] = scanned.value.positionals;
  if (idText === undefined) {
    return err(
      usage(
        "missingArgument",
        t("cli.usage.schedule.idMissing.message", { command: `schedule ${action}` }),
        `xeon schedule ${action} <id>`,
      ),
    );
  }
  if (extra.length > 0) {
    return err(
      usage(
        "unexpectedArgument",
        t("cli.usage.tooManyArgs.message", { command: `schedule ${action}` }),
        t("cli.usage.oneId.fix"),
      ),
    );
  }
  const parsed = parse(ScheduleIdSchema, idText);
  if (!parsed.ok) {
    return err(
      usage(
        "invalidScheduleId",
        t("cli.usage.scheduleId.invalid.message"),
        t("cli.usage.scheduleId.invalid.fix"),
      ),
    );
  }
  return ok(parsed.value);
}

function parseSchedule(
  acc: GlobalAcc,
  rest: readonly string[],
): Result<ScheduleCommand, UsageError> {
  const [action, ...tail] = rest;
  switch (action) {
    case "add":
      return parseScheduleAdd(acc, tail);
    case "list":
      return parseScheduleList(acc, tail);
    case "cancel": {
      const id = scheduleIdArg(acc, "cancel", tail);
      if (!id.ok) return id;
      return ok({ kind: "schedule.cancel", scheduleId: id.value });
    }
    case "run": {
      const id = scheduleIdArg(acc, "run", tail);
      if (!id.ok) return id;
      return ok({ kind: "schedule.run", scheduleId: id.value });
    }
    case undefined:
      return err(
        usage(
          "missingArgument",
          t("cli.usage.subcommandMissing.message", { command: "schedule" }),
          t("cli.usage.oneOf.fix", { list: "add, list, cancel, run" }),
        ),
      );
    // xeon-disable-next-line xeon/switch-default-never -- 명령줄 인자는 닫히지 않은 문자열이다. 모르는 하위 명령은 사용법 오류 값으로 돌려준다 (eng.typescript.guide TY-14)
    default:
      return err(
        usage(
          "unknownCommand",
          t("cli.usage.unknownCommand.message", { command: `schedule ${action}` }),
          t("cli.usage.oneOf.fix", { list: "add, list, cancel, run" }),
        ),
      );
  }
}

function parseSessions(
  acc: GlobalAcc,
  rest: readonly string[],
): Result<SessionsCommand, UsageError> {
  const [action, ...tail] = rest;
  switch (action) {
    case "ls": {
      const scanned = scanArgs(acc, tail, {
        "--all": { value: "none" },
        "--limit": { value: "required" },
        "--json": { value: "none" },
      });
      if (!scanned.ok) return scanned;
      if (scanned.value.positionals.length > 0) {
        return err(
          usage(
            "unexpectedArgument",
            t("cli.usage.noPositional.message", { command: "sessions ls" }),
            t("cli.usage.sessions.ls.positional.fix"),
          ),
        );
      }
      const limitText = valueOf(scanned.value, "--limit");
      const limit = limitText === null ? 20 : Number(limitText);
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
        return err(
          usage(
            "unexpectedArgument",
            t("cli.usage.sessions.limit.message"),
            t("cli.usage.sessions.limit.fix"),
          ),
        );
      }
      return ok({
        kind: "sessions.ls",
        all: has(scanned.value, "--all"),
        limit,
        output: outputOf(scanned.value),
      });
    }
    case "show": {
      const scanned = scanArgs(acc, tail, { "--json": { value: "none" } });
      if (!scanned.ok) return scanned;
      const idText = scanned.value.positionals[0];
      if (idText === undefined) {
        return err(
          usage(
            "missingArgument",
            t("cli.usage.sessionId.missing.message", { command: "sessions show" }),
            "xeon sessions show <id>",
          ),
        );
      }
      if (scanned.value.positionals.length > 1) {
        return err(
          usage(
            "unexpectedArgument",
            t("cli.usage.tooManyArgs.message", { command: "sessions show" }),
            t("cli.usage.oneId.fix"),
          ),
        );
      }
      const threadId = threadIdOf(idText);
      if (!threadId.ok) return threadId;
      return ok({
        kind: "sessions.show",
        threadId: threadId.value,
        output: outputOf(scanned.value),
      });
    }
    case "fork": {
      const scanned = scanArgs(acc, tail, { "--at": { value: "required" } });
      if (!scanned.ok) return scanned;
      const idText = scanned.value.positionals[0];
      if (idText === undefined) {
        return err(
          usage(
            "missingArgument",
            t("cli.usage.sessionId.missing.message", { command: "sessions fork" }),
            t("cli.usage.sessions.forkSyntax"),
          ),
        );
      }
      if (scanned.value.positionals.length > 1) {
        return err(
          usage(
            "unexpectedArgument",
            t("cli.usage.tooManyArgs.message", { command: "sessions fork" }),
            t("cli.usage.oneId.fix"),
          ),
        );
      }
      const threadId = threadIdOf(idText);
      if (!threadId.ok) return threadId;
      const atText = valueOf(scanned.value, "--at");
      let at: ItemId | null = null;
      if (atText !== null) {
        const item = itemIdOf(atText);
        if (!item.ok) return item;
        at = item.value;
      }
      return ok({ kind: "sessions.fork", threadId: threadId.value, at });
    }
    case "rm": {
      const scanned = scanArgs(acc, tail, { "--yes": { value: "none" } });
      if (!scanned.ok) return scanned;
      const idText = scanned.value.positionals[0];
      if (idText === undefined) {
        return err(
          usage(
            "missingArgument",
            t("cli.usage.sessionId.missing.message", { command: "sessions rm" }),
            "xeon sessions rm <id> [--yes]",
          ),
        );
      }
      if (scanned.value.positionals.length > 1) {
        return err(
          usage(
            "unexpectedArgument",
            t("cli.usage.tooManyArgs.message", { command: "sessions rm" }),
            t("cli.usage.oneId.fix"),
          ),
        );
      }
      const threadId = threadIdOf(idText);
      if (!threadId.ok) return threadId;
      return ok({
        kind: "sessions.rm",
        threadId: threadId.value,
        yes: has(scanned.value, "--yes"),
      });
    }
    case "rename": {
      const scanned = scanArgs(acc, tail, {});
      if (!scanned.ok) return scanned;
      const [idText, ...words] = scanned.value.positionals;
      if (idText === undefined) {
        return err(
          usage(
            "missingArgument",
            t("cli.usage.sessions.renameMissing.message"),
            t("cli.usage.sessions.renameSyntax"),
          ),
        );
      }
      const threadId = threadIdOf(idText);
      if (!threadId.ok) return threadId;
      // 제목은 따옴표 없이 여러 낱말로 써도 된다
      const title = words.join(" ").trim();
      const problem = titleProblem(title);
      if (problem !== null) {
        return err(
          usage(
            title.length === 0 ? "missingArgument" : "unexpectedArgument",
            `sessions rename: ${problem}`,
            t("cli.usage.sessions.renameSyntax"),
          ),
        );
      }
      return ok({ kind: "sessions.rename", threadId: threadId.value, title });
    }
    case undefined:
      return err(
        usage(
          "missingArgument",
          t("cli.usage.subcommandMissing.message", { command: "sessions" }),
          t("cli.usage.oneOf.fix", { list: "ls, show, fork, rm, rename" }),
        ),
      );
    // xeon-disable-next-line xeon/switch-default-never -- 명령줄 인자는 닫히지 않은 문자열이다. 모르는 하위 명령은 사용법 오류 값으로 돌려준다 (eng.typescript.guide TY-14)
    default:
      return err(
        usage(
          "unknownCommand",
          t("cli.usage.unknownCommand.message", { command: `sessions ${action}` }),
          t("cli.usage.oneOf.fix", { list: "ls, show, fork, rm, rename" }),
        ),
      );
  }
}

const SECRET_PROVIDERS: readonly NonNullable<SecretMetaFlags["provider"]>[] = [
  "sops",
  "op",
  "bws",
  "keychain",
];

const SECRET_META_FLAGS: FlagTable = {
  "--provider": { value: "required" },
  "--desc": { value: "required" },
  "--scope": { value: "required" },
  "--hosts": { value: "required" },
  "--expires": { value: "required" },
};

/** 값을 argv로 받으려는 시도의 플래그. 오류 문구에 이 플래그의 값을 다시 쓰지 않는다 */
const SECRET_VALUE_FLAGS: readonly string[] = ["--value", "--secret", "--password", "--token"];

function secretValueInArgv(): UsageError {
  return usage(
    "secretValueInArgv",
    t("cli.usage.secret.valueInArgv.message"),
    t("cli.usage.secret.valueInArgv.fix"),
  );
}

function metaFlagsOf(scanned: Scanned): Result<SecretMetaFlags, UsageError> {
  const provider = valueOf(scanned, "--provider");
  let providerValue: SecretMetaFlags["provider"];
  if (provider !== null) {
    providerValue = SECRET_PROVIDERS.find((candidate) => candidate === provider);
    if (providerValue === undefined) {
      return err(
        usage(
          "unexpectedArgument",
          t("cli.usage.flagValue.invalid.message", { flag: "--provider" }),
          t("cli.usage.oneOf.fix", { list: "sops, op, bws, keychain" }),
        ),
      );
    }
  }
  const desc = valueOf(scanned, "--desc");
  const scope = valueOf(scanned, "--scope");
  const hosts = valueOf(scanned, "--hosts");
  const expires = valueOf(scanned, "--expires");
  if (expires !== null && !/^\d{4}-\d{2}-\d{2}$/.test(expires)) {
    return err(
      usage(
        "unexpectedArgument",
        t("cli.usage.secret.expires.message"),
        t("cli.usage.secret.expires.fix"),
      ),
    );
  }
  return ok({
    ...(providerValue === undefined ? {} : { provider: providerValue }),
    ...(desc === null ? {} : { desc }),
    ...(scope === null ? {} : { scope }),
    ...(hosts === null ? {} : { hosts: hosts.split(",").filter((host) => host.length > 0) }),
    ...(expires === null ? {} : { expires }),
  });
}

function parseSecret(
  acc: GlobalAcc,
  rest: readonly string[],
  terminal: TerminalFacts,
): Result<SecretCommand, UsageError> {
  const [action, ...tail] = rest;
  const valueFlagTable: FlagTable = Object.fromEntries(
    SECRET_VALUE_FLAGS.map((flag) => [flag, { value: "optional" } satisfies FlagSpec]),
  );
  // 값 플래그를 먼저 거른다: 스캔 중 오류 문구에 토큰이 들어가는 일을 막는다
  const wantsValue = (scanned: Scanned): boolean =>
    SECRET_VALUE_FLAGS.some((flag) => scanned.values.has(flag));

  switch (action) {
    case "ls": {
      const scanned = scanArgs(acc, tail, {
        "--meta": { value: "none" },
        "--usage": { value: "none" },
        "--json": { value: "none" },
      });
      if (!scanned.ok) return scanned;
      if (scanned.value.positionals.length > 0) {
        return err(
          usage(
            "unexpectedArgument",
            t("cli.usage.noPositional.message", { command: "secret ls" }),
            t("cli.usage.secret.ls.positional.fix"),
          ),
        );
      }
      return ok({
        kind: "secret.ls",
        meta: has(scanned.value, "--meta"),
        usage: has(scanned.value, "--usage"),
        output: outputOf(scanned.value),
      });
    }
    case "add":
    case "set":
    case "rotate": {
      const table: FlagTable =
        action === "add" ? { ...SECRET_META_FLAGS, ...valueFlagTable } : valueFlagTable;
      const scanned = scanArgs(acc, tail, table, (name) =>
        SECRET_VALUE_FLAGS.includes(name) ? secretValueInArgv() : undefined,
      );
      if (!scanned.ok) return scanned;
      if (wantsValue(scanned.value)) return err(secretValueInArgv());
      const [nameText, ...extra] = scanned.value.positionals;
      if (nameText === undefined) {
        return err(
          usage(
            "missingArgument",
            t("cli.usage.secret.nameMissing.message", { command: `secret ${action}` }),
            t("cli.usage.secret.nameSyntax.fix", { action }),
          ),
        );
      }
      if (extra.length > 0 || nameText.includes("=")) return err(secretValueInArgv());
      const name = secretNameOf(nameText);
      if (!name.ok) return name;
      if (action === "add") {
        const meta = metaFlagsOf(scanned.value);
        if (!meta.ok) return meta;
        return ok({ kind: "secret.add", name: name.value, meta: meta.value });
      }
      return ok(
        action === "set"
          ? { kind: "secret.set", name: name.value }
          : { kind: "secret.rotate", name: name.value },
      );
    }
    case "meta": {
      const scanned = scanArgs(acc, tail, SECRET_META_FLAGS);
      if (!scanned.ok) return scanned;
      const [nameText, ...extra] = scanned.value.positionals;
      if (nameText === undefined) {
        return err(
          usage(
            "missingArgument",
            t("cli.usage.secret.nameMissing.message", { command: "secret meta" }),
            t("cli.usage.secret.metaSyntax.fix"),
          ),
        );
      }
      if (extra.length > 0 || nameText.includes("=")) return err(secretValueInArgv());
      const name = secretNameOf(nameText);
      if (!name.ok) return name;
      const meta = metaFlagsOf(scanned.value);
      if (!meta.ok) return meta;
      return ok({ kind: "secret.meta", name: name.value, meta: meta.value });
    }
    case "rm":
    case "test":
    case "reveal": {
      const table: FlagTable =
        action === "rm"
          ? { "--yes": { value: "none" } }
          : action === "test"
            ? { "--json": { value: "none" } }
            : {};
      const scanned = scanArgs(acc, tail, table);
      if (!scanned.ok) return scanned;
      const [nameText, ...extra] = scanned.value.positionals;
      if (nameText === undefined) {
        return err(
          usage(
            "missingArgument",
            t("cli.usage.secret.nameMissing.message", { command: `secret ${action}` }),
            t("cli.usage.secret.nameSyntax.fix", { action }),
          ),
        );
      }
      if (extra.length > 0 || nameText.includes("=")) {
        return err(
          usage(
            "unexpectedArgument",
            t("cli.usage.tooManyArgs.message", { command: `secret ${action}` }),
            t("cli.usage.oneName.fix"),
          ),
        );
      }
      const name = secretNameOf(nameText);
      if (!name.ok) return name;
      switch (action) {
        case "rm":
          return ok({ kind: "secret.rm", name: name.value, yes: has(scanned.value, "--yes") });
        case "test":
          return ok({ kind: "secret.test", name: name.value, output: outputOf(scanned.value) });
        case "reveal":
          if (!terminal.stdinIsTty || !terminal.stdoutIsTty) {
            return err(
              usage(
                "revealRequiresTty",
                t("cli.usage.secret.reveal.message"),
                t("cli.usage.secret.reveal.fix"),
              ),
            );
          }
          return ok({ kind: "secret.reveal", name: name.value });
        default:
          return assertNever(action, "secret rm|test|reveal");
      }
    }
    case undefined:
      return err(
        usage(
          "missingArgument",
          t("cli.usage.subcommandMissing.message", { command: "secret" }),
          t("cli.usage.oneOf.fix", { list: "ls, add, set, meta, rotate, rm, test, reveal" }),
        ),
      );
    // xeon-disable-next-line xeon/switch-default-never -- 명령줄 인자는 닫히지 않은 문자열이다. 모르는 하위 명령은 사용법 오류 값으로 돌려준다 (eng.typescript.guide TY-14)
    default:
      return err(
        usage(
          "unknownCommand",
          t("cli.usage.unknownCommand.message", { command: `secret ${action}` }),
          t("cli.usage.oneOf.fix", { list: "ls, add, set, meta, rotate, rm, test, reveal" }),
        ),
      );
  }
}

const SERVICE_ACTIONS: readonly ServiceCommand["action"][] = [
  "start",
  "status",
  "stop",
  "ensure",
  "launch-mode",
  "run",
];

function isLoopbackHost(host: string): boolean {
  return (
    host === "localhost" || host === "::1" || host === "[::1]" || /^127\.\d+\.\d+\.\d+$/.test(host)
  );
}

function listenAddressOf(text: string): { readonly host: string; readonly port: number } | null {
  const colon = text.lastIndexOf(":");
  if (colon <= 0) return null;
  const port = Number(text.slice(colon + 1));
  if (!Number.isInteger(port) || port < 0 || port > 65_535) return null;
  return { host: text.slice(0, colon), port };
}

function parseService(acc: GlobalAcc, rest: readonly string[]): Result<ServiceCommand, UsageError> {
  const [actionText, ...tail] = rest;
  if (actionText === undefined) {
    return err(
      usage(
        "missingArgument",
        t("cli.usage.subcommandMissing.message", { command: "service" }),
        t("cli.usage.oneOf.fix", { list: "start, status, stop" }),
      ),
    );
  }
  const action = SERVICE_ACTIONS.find((candidate) => candidate === actionText);
  if (action === undefined) {
    return err(
      usage(
        "unknownCommand",
        t("cli.usage.unknownCommand.message", { command: `service ${actionText}` }),
        t("cli.usage.oneOf.fix", { list: "start, status, stop" }),
      ),
    );
  }
  const scanned = scanArgs(acc, tail, {
    "--json": { value: "none" },
    "--safe-mode": { value: "none" },
    "--listen-tcp": { value: "required" },
    "--allow-non-loopback": { value: "none" },
  });
  if (!scanned.ok) return scanned;
  if (scanned.value.positionals.length > 0) {
    return err(
      usage(
        "unexpectedArgument",
        t("cli.usage.noPositional.message", { command: "service" }),
        t("cli.usage.service.flags.fix"),
      ),
    );
  }
  const flags = scanned.value;
  const safeMode = has(flags, "--safe-mode");
  if (safeMode && !["start", "ensure", "run"].includes(action)) {
    return err(
      usage(
        "unexpectedArgument",
        t("cli.usage.service.safeMode.message", { action }),
        t("cli.usage.service.safeMode.fix"),
      ),
    );
  }
  let listenTcp: ServiceCommand["listenTcp"] = null;
  const listen = valueOf(flags, "--listen-tcp");
  if (listen !== null) {
    if (action !== "start" && action !== "run") {
      return err(
        usage(
          "unexpectedArgument",
          t("cli.usage.service.listenTcp.message", { action }),
          t("cli.usage.service.listenTcp.fix"),
        ),
      );
    }
    const parsed = listenAddressOf(listen);
    if (parsed === null) {
      return err(
        usage(
          "unexpectedArgument",
          t("cli.usage.service.listenTcp.notAddress.message", { listen }),
          t("cli.usage.service.listenTcp.notAddress.fix"),
        ),
      );
    }
    if (!has(flags, "--allow-non-loopback") && !isLoopbackHost(parsed.host)) {
      return err(
        usage(
          "unexpectedArgument",
          t("cli.usage.service.listenTcp.notLoopback.message", { host: parsed.host }),
          t("cli.usage.service.listenTcp.notLoopback.fix"),
        ),
      );
    }
    listenTcp = parsed;
  }
  const allowNonLoopback = has(flags, "--allow-non-loopback");
  if (allowNonLoopback && listenTcp === null) {
    return err(
      usage(
        "unexpectedArgument",
        t("cli.usage.service.allowNonLoopback.message"),
        t("cli.usage.service.allowNonLoopback.fix"),
      ),
    );
  }
  return ok({
    kind: "service",
    action,
    output: outputOf(flags),
    safeMode,
    listenTcp,
    allowNonLoopback,
  });
}

function parseHost(acc: GlobalAcc, rest: readonly string[]): Result<CliHostCommand, UsageError> {
  const scanned = scanArgs(acc, rest, { "--stdio": { value: "none" } });
  if (!scanned.ok) return scanned;
  if (scanned.value.positionals.length > 0) {
    return err(
      usage(
        "unexpectedArgument",
        t("cli.usage.noPositional.message", { command: "host" }),
        "xeon host --stdio",
      ),
    );
  }
  if (!has(scanned.value, "--stdio")) {
    return err(
      usage("missingArgument", t("cli.usage.host.stdioMissing.message"), "xeon host --stdio"),
    );
  }
  return ok({ kind: "host", stdio: true });
}

function parseDb(acc: GlobalAcc, rest: readonly string[]): Result<DbCommand, UsageError> {
  const [action, ...tail] = rest;
  switch (action) {
    case "export": {
      const scanned = scanArgs(acc, tail, { "--json": { value: "none" } });
      if (!scanned.ok) return scanned;
      const [destDir, ...extra] = scanned.value.positionals;
      if (destDir === undefined || destDir === "") {
        return err(
          usage(
            "missingArgument",
            t("cli.usage.db.folderMissing.message"),
            t("cli.usage.db.exportSyntax"),
          ),
        );
      }
      if (extra.length > 0) {
        return err(
          usage(
            "unexpectedArgument",
            t("cli.usage.tooManyArgs.message", { command: "db export" }),
            t("cli.usage.oneFolder.fix"),
          ),
        );
      }
      return ok({ kind: "db.export", destDir, output: outputOf(scanned.value) });
    }
    case undefined:
      return err(
        usage(
          "missingArgument",
          t("cli.usage.subcommandMissing.message", { command: "db" }),
          t("cli.usage.db.exportSyntax"),
        ),
      );
    // xeon-disable-next-line xeon/switch-default-never -- 명령줄 인자는 닫히지 않은 문자열이다. 모르는 하위 명령은 사용법 오류 값으로 돌려준다 (eng.typescript.guide TY-14)
    default:
      return err(
        usage(
          "unknownCommand",
          t("cli.usage.unknownCommand.message", { command: `db ${action}` }),
          t("cli.usage.db.exportFix"),
        ),
      );
  }
}

function parseJsonOnly(
  acc: GlobalAcc,
  kind: "doctor" | "version",
  rest: readonly string[],
): Result<DoctorCommand | VersionCommand, UsageError> {
  const scanned = scanArgs(acc, rest, { "--json": { value: "none" } });
  if (!scanned.ok) return scanned;
  if (scanned.value.positionals.length > 0) {
    return err(
      usage(
        "unexpectedArgument",
        t("cli.usage.noPositional.message", { command: kind }),
        t("cli.usage.jsonOnly.fix"),
      ),
    );
  }
  return ok({ kind, output: outputOf(scanned.value) });
}

const GROUP_FLAGS: FlagTable = {
  "--drive": { value: "none" },
  "--policy": { value: "none" },
  "--dir": { value: "required" },
  "--json": { value: "none" },
};

/** 그룹 이름 검사(L3.slots.spec §3.3.4). 형식과 예약 이름을 본다. 설치된 확장과의 충돌은 명령이 본다 */
function groupNameOf(text: string): Result<string, UsageError> {
  const checked = checkGroupName(text);
  if (checked.ok) return ok(text);
  const message =
    checked.error.reason === "reserved"
      ? t("cli.usage.group.reserved.message", { text })
      : t("cli.usage.group.invalidName.message", { text });
  return err(usage("invalidGroupName", message, t("cli.usage.group.nameFormat.fix")));
}

function parseGroup(acc: GlobalAcc, rest: readonly string[]): Result<GroupNewCommand, UsageError> {
  const [action, ...tail] = rest;
  switch (action) {
    case "new": {
      const scanned = scanArgs(acc, tail, GROUP_FLAGS);
      if (!scanned.ok) return scanned;
      const drive = has(scanned.value, "--drive");
      const policy = has(scanned.value, "--policy");
      if (drive && policy) {
        return err(
          usage(
            "conflictingFlags",
            t("cli.usage.group.driveAndPolicy.message"),
            t("cli.usage.group.driveAndPolicy.fix"),
          ),
        );
      }
      const [nameText, ...extra] = scanned.value.positionals;
      if (nameText === undefined) {
        return err(
          usage(
            "missingArgument",
            t("cli.usage.group.nameMissing.message"),
            t("cli.usage.group.newSyntax"),
          ),
        );
      }
      if (extra.length > 0) {
        return err(
          usage(
            "unexpectedArgument",
            t("cli.usage.tooManyArgs.message", { command: "group new" }),
            t("cli.usage.oneName.fix"),
          ),
        );
      }
      const name = groupNameOf(nameText);
      if (!name.ok) return name;
      const dir = valueOf(scanned.value, "--dir");
      if (dir === "") {
        return err(
          usage(
            "missingArgument",
            t("cli.usage.folderMissing.message", { flag: "--dir" }),
            t("cli.usage.flag.folderFormat.fix", { flag: "--dir" }),
          ),
        );
      }
      const template: GroupTemplateKind = drive ? "drive" : policy ? "policy" : "observe";
      return ok({
        kind: "group.new",
        name: name.value,
        template,
        dir,
        output: outputOf(scanned.value),
      });
    }
    case undefined:
      return err(
        usage(
          "missingArgument",
          t("cli.usage.subcommandMissing.message", { command: "group" }),
          t("cli.usage.group.newSyntax"),
        ),
      );
    // xeon-disable-next-line xeon/switch-default-never -- 명령줄 인자는 닫히지 않은 문자열이다. 모르는 하위 명령은 사용법 오류 값으로 돌려준다 (eng.typescript.guide TY-14)
    default:
      return err(
        usage(
          "unknownCommand",
          t("cli.usage.unknownCommand.message", { command: `group ${action}` }),
          t("cli.usage.group.newUse.fix"),
        ),
      );
  }
}

// ── 진입 ─────────────────────────────────────────────────────────────────

const COMMAND_WORDS: ReadonlySet<string> = new Set([
  "chat",
  "sessions",
  "config",
  "secret",
  "trust",
  "schedule",
  "service",
  "db",
  "host",
  "group",
  "doctor",
  "version",
  "help",
]);

function colorOf(noColorFlag: boolean, env: Readonly<Record<string, string | undefined>>): boolean {
  if (noColorFlag) return false;
  if (env["NO_COLOR"] !== undefined) return false;
  return env["TERM"] !== "dumb";
}

function commandOf(
  acc: GlobalAcc,
  word: string,
  rest: readonly string[],
  terminal: TerminalFacts,
): Result<CliCommand, UsageError> {
  switch (word) {
    case "chat":
      return parseChat(acc, rest, terminal);
    case "sessions":
      return parseSessions(acc, rest);
    case "config":
      return parseConfig(acc, rest);
    case "secret":
      return parseSecret(acc, rest, terminal);
    case "trust":
      return parseTrust(acc, rest);
    case "schedule":
      return parseSchedule(acc, rest);
    case "service":
      return parseService(acc, rest);
    case "db":
      return parseDb(acc, rest);
    case "host":
      return parseHost(acc, rest);
    case "group":
      return parseGroup(acc, rest);
    case "doctor":
      return parseJsonOnly(acc, "doctor", rest);
    case "version":
      return parseJsonOnly(acc, "version", rest);
    case "help":
      return ok({ kind: "help", topic: rest[0] ?? null });
    // xeon-disable-next-line xeon/switch-default-never -- 명령줄 인자는 닫히지 않은 문자열이다. 모르는 하위 명령은 사용법 오류 값으로 돌려준다 (eng.typescript.guide TY-14)
    default:
      return err(
        usage(
          "unknownCommand",
          t("cli.usage.unknownCommand.message", { command: word }),
          t("cli.usage.commandList.fix"),
        ),
      );
  }
}

/** 순수 함수. argv는 실행 파일 경로를 뺀 인자다. TTY 사실로 모드를 정한다(§4.2). */
export function parseArgv(
  argv: readonly string[],
  terminal: TerminalFacts,
  env: Readonly<Record<string, string | undefined>>,
): Result<ParsedArgv, UsageError> {
  const acc: GlobalAcc = { help: false, noColor: false, cwd: null, remote: null };
  // 명령 단어 앞에 놓인 공통 플래그를 먼저 읽는다. 명령 단어가 없으면 chat이다
  let index = 0;
  while (index < argv.length) {
    const token = argv[index] ?? "";
    if (token === "--no-color") {
      acc.noColor = true;
    } else if (token === "-h" || token === "--help") {
      acc.help = true;
    } else if (token === "-C") {
      const dir = argv[index + 1];
      if (dir === undefined || dir === "") {
        return err(
          usage(
            "missingArgument",
            t("cli.usage.folderMissing.message", { flag: "-C" }),
            t("cli.usage.flag.folderFormat.fix", { flag: "-C" }),
          ),
        );
      }
      acc.cwd = dir;
      index += 1;
    } else if (token === "--remote") {
      const remote = argv[index + 1];
      if (remote === undefined || remote === "") return err(missingRemote());
      acc.remote = remote;
      index += 1;
    } else {
      break;
    }
    index += 1;
  }
  const first = argv[index];
  const isWord = first !== undefined && !first.startsWith("-");
  if (isWord && !COMMAND_WORDS.has(first)) {
    return err(
      usage(
        "unknownCommand",
        t("cli.usage.unknownCommand.message", { command: first }),
        t("cli.usage.commandList.fix"),
      ),
    );
  }
  const word = isWord ? first : "chat";
  const rest = isWord ? argv.slice(index + 1) : argv.slice(index);
  const parsed = commandOf(acc, word, rest, terminal);
  const global: GlobalOptions = {
    cwd: acc.cwd ?? ".",
    color: colorOf(acc.noColor, env),
    remote: acc.remote,
  };
  if (acc.help) return ok({ global, command: { kind: "help", topic: isWord ? word : null } });
  if (!parsed.ok) return parsed;
  return ok({ global, command: parsed.value });
}
