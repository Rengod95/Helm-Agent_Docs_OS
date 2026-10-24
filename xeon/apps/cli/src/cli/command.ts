import { assertNever, err, ok, parse, type Result } from "@xeon/contracts";
import { SecretNameSchema, type SecretName } from "@xeon/contracts/capabilities";
import {
  ItemIdSchema,
  ThreadIdSchema,
  type ItemId,
  type ThreadId,
} from "@xeon/contracts/conversation";
import { SettingKeySchema, type SettingKey, type SettingScope } from "@xeon/contracts/settings";

// L4.cli.spec §3.2. 명령 모델과 인자 파서. 순수 함수이고 외부 라이브러리를 쓰지 않는다: 비밀 값 argv 금지 같은 규칙을
// 파서 안에 둬야 하기 때문이다.

export type OutputMode = "text" | "json";

export type ChatTarget =
  | { readonly kind: "new" }
  | { readonly kind: "continue" }
  | { readonly kind: "resume"; readonly threadId: ThreadId };

interface SessionOverride {
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
}

type SessionsCommand =
  | {
      readonly kind: "sessions.ls";
      readonly all: boolean;
      readonly limit: number;
      readonly output: OutputMode;
    }
  | { readonly kind: "sessions.show"; readonly threadId: ThreadId; readonly output: OutputMode }
  | { readonly kind: "sessions.fork"; readonly threadId: ThreadId; readonly at: ItemId | null }
  | { readonly kind: "sessions.rm"; readonly threadId: ThreadId; readonly yes: boolean };

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

interface SecretMetaFlags {
  readonly provider?: "sops" | "op" | "bws" | "keychain";
  readonly desc?: string;
  readonly scope?: string;
  readonly hosts?: readonly string[];
  /** ISO 8601 날짜 */
  readonly expires?: string;
}

type SecretCommand =
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

interface ServiceCommand {
  readonly kind: "service";
  /** ensure·launch-mode는 --json만, launch-mode·run은 도움말에 숨긴다 */
  readonly action: "start" | "status" | "stop" | "ensure" | "launch-mode" | "run";
  readonly output: OutputMode;
}
/** @xeon/host의 HostCommand(runHostCommand 입력)와 다른 타입이다. 이름을 나눠 둔다. */
interface CliHostCommand {
  readonly kind: "host";
  readonly stdio: true;
}
interface DoctorCommand {
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

type CliCommand =
  | ChatCommand
  | SessionsCommand
  | ConfigCommand
  | SecretCommand
  | ServiceCommand
  | CliHostCommand
  | DoctorCommand
  | VersionCommand
  | HelpCommand;

export interface GlobalOptions {
  /** `-C <dir>`로 받은 값 또는 "."(현재 폴더). 절대 경로로 바꾸는 일은 runCli가 한다(파서는 순수 함수다) */
  readonly cwd: string;
  readonly color: boolean;
}

type UsageErrorCode =
  | "unknownCommand"
  | "unknownFlag"
  | "missingArgument"
  | "unexpectedArgument"
  | "invalidSettingKey"
  | "invalidOverride"
  | "invalidThreadId"
  | "invalidSecretName"
  | "secretValueInArgv"
  | "conflictingFlags"
  | "jsonRequiresPrint"
  | "inputRequired"
  | "revealRequiresTty";

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

/** 명령 앞뒤 어디에 놓였든 공통 플래그(-h, --no-color, -C)를 모아 둔다 */
interface GlobalAcc {
  help: boolean;
  noColor: boolean;
  cwd: string | null;
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
      fail(usage("conflictingFlags", `${name}을 두 번 이상 썼다`, `${name}은 한 번만 쓸 수 있다`));
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
            `모르는 플래그 ${name}`,
            "xeon --help로 쓸 수 있는 플래그를 확인한다",
          ),
      );
      continue;
    }
    const inline =
      token.startsWith("--") && token.includes("=") ? token.slice(name.length + 1) : null;
    if (spec.value === "none") {
      if (inline !== null) {
        fail(usage("unexpectedArgument", `${name}은 값을 받지 않는다`, `${name}만 쓴다`));
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
        fail(usage("missingArgument", `${name}에 값이 없다`, `${name} <값> 형식으로 쓴다`));
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
      "세션 id 형식이 맞지 않다",
      "xeon sessions ls로 id를 확인한다 (thr_로 시작하는 30자)",
    ),
  );
}

function itemIdOf(text: string): Result<ItemId, UsageError> {
  const parsed = parse(ItemIdSchema, text);
  if (parsed.ok) return ok(parsed.value);
  return err(
    usage(
      "invalidThreadId",
      "항목 id 형식이 맞지 않다",
      "xeon sessions show로 itm_로 시작하는 id를 확인한다",
    ),
  );
}

function settingKeyOf(text: string): Result<SettingKey, UsageError> {
  const parsed = parse(SettingKeySchema, text);
  if (parsed.ok) return ok(parsed.value);
  return err(
    usage(
      "invalidSettingKey",
      `설정 키 형식이 맞지 않다: ${text}`,
      "<층>.<도메인>.<이름> 형식으로 쓴다. xeon config list로 키를 확인한다",
    ),
  );
}

function secretNameOf(text: string): Result<SecretName, UsageError> {
  const parsed = parse(SecretNameSchema, text);
  if (parsed.ok) return ok(parsed.value);
  return err(
    usage(
      "invalidSecretName",
      "비밀 이름 형식이 맞지 않다",
      "소문자로 시작하는 소문자, 숫자, 하이픈 2~64자로 쓴다",
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
        `--scope ${text}은 config 명령에서 받지 않는다`,
        "세션 범위는 chat --set이나 /set으로 바꾼다. 파일 범위는 user, project, local이다",
      ),
    );
  }
  return err(
    usage("unexpectedArgument", "--scope 값이 맞지 않다", "user, project, local 중 하나를 쓴다"),
  );
}

function parseOverride(text: string): Result<SessionOverride, UsageError> {
  const eq = text.indexOf("=");
  if (eq <= 0) {
    return err(usage("invalidOverride", "--set 값에 =가 없다", "--set <키>=<값> 형식으로 쓴다"));
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
        "chat 명령은 위치 인자를 받지 않는다",
        "입력은 -p <입력>으로 준다",
      ),
    );
  }
  if (has(flags, "--continue") && has(flags, "--resume")) {
    return err(
      usage("conflictingFlags", "--continue와 --resume을 함께 쓸 수 없다", "둘 중 하나만 쓴다"),
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
        "stdout이 터미널이 아닌데 입력이 없다",
        "-p <입력>으로 입력을 주거나 stdin으로 넘긴다",
      ),
    );
  } else {
    mode = "interactive";
  }
  const output = outputOf(flags);
  if (output === "json" && mode === "interactive") {
    return err(
      usage("jsonRequiresPrint", "--json은 print 모드에서만 쓴다", "-p <입력>과 함께 쓴다"),
    );
  }
  return ok({ kind: "chat", mode, input, output, target, overrides });
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
            "config set에는 키와 값이 필요하다",
            "xeon config set <키> <값> [--scope user|project|local]",
          ),
        );
      }
      if (extra.length > 0) {
        return err(
          usage(
            "unexpectedArgument",
            "config set에 인자가 너무 많다",
            "값에 공백이 있으면 따옴표로 묶는다",
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
            "config reset에는 키가 필요하다",
            "xeon config reset <키> [--scope …]",
          ),
        );
      }
      if (extra.length > 0) {
        return err(
          usage("unexpectedArgument", "config reset에 인자가 너무 많다", "키 하나만 쓴다"),
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
            "config list는 위치 인자를 받지 않는다",
            "--prefix <접두>를 쓴다",
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
            "config schema는 위치 인자를 받지 않는다",
            "--scope <범위>를 쓴다",
          ),
        );
      }
      const scopeText = valueOf(scanned.value, "--scope");
      if (scopeText === null) {
        return err(
          usage(
            "missingArgument",
            "config schema에는 --scope가 필요하다",
            "xeon config schema --scope managed|user|project|local",
          ),
        );
      }
      const scope = SCHEMA_SCOPES.find((candidate) => candidate === scopeText);
      if (scope === undefined) {
        return err(
          usage(
            "unexpectedArgument",
            "--scope 값이 맞지 않다",
            "managed, user, project, local 중 하나를 쓴다",
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
          "config에는 하위 명령이 필요하다",
          "get, set, reset, list, schema 중 하나를 쓴다",
        ),
      );
    // xeon-disable-next-line xeon/switch-default-never -- 명령줄 인자는 닫히지 않은 문자열이다. 모르는 하위 명령은 사용법 오류 값으로 돌려준다 (eng.typescript.guide TY-14)
    default:
      return err(
        usage(
          "unknownCommand",
          `모르는 명령 config ${action}`,
          "get, set, reset, list, schema 중 하나를 쓴다",
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
            "sessions ls는 위치 인자를 받지 않는다",
            "--all, --limit만 쓴다",
          ),
        );
      }
      const limitText = valueOf(scanned.value, "--limit");
      const limit = limitText === null ? 20 : Number(limitText);
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
        return err(
          usage("unexpectedArgument", "--limit은 1~200 정수여야 한다", "--limit 20처럼 쓴다"),
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
            "sessions show에는 세션 id가 필요하다",
            "xeon sessions show <id>",
          ),
        );
      }
      if (scanned.value.positionals.length > 1) {
        return err(
          usage("unexpectedArgument", "sessions show에 인자가 너무 많다", "id 하나만 쓴다"),
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
            "sessions fork에는 세션 id가 필요하다",
            "xeon sessions fork <id> [--at <항목 id>]",
          ),
        );
      }
      if (scanned.value.positionals.length > 1) {
        return err(
          usage("unexpectedArgument", "sessions fork에 인자가 너무 많다", "id 하나만 쓴다"),
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
            "sessions rm에는 세션 id가 필요하다",
            "xeon sessions rm <id> [--yes]",
          ),
        );
      }
      if (scanned.value.positionals.length > 1) {
        return err(usage("unexpectedArgument", "sessions rm에 인자가 너무 많다", "id 하나만 쓴다"));
      }
      const threadId = threadIdOf(idText);
      if (!threadId.ok) return threadId;
      return ok({
        kind: "sessions.rm",
        threadId: threadId.value,
        yes: has(scanned.value, "--yes"),
      });
    }
    case undefined:
      return err(
        usage(
          "missingArgument",
          "sessions에는 하위 명령이 필요하다",
          "ls, show, fork, rm 중 하나를 쓴다",
        ),
      );
    // xeon-disable-next-line xeon/switch-default-never -- 명령줄 인자는 닫히지 않은 문자열이다. 모르는 하위 명령은 사용법 오류 값으로 돌려준다 (eng.typescript.guide TY-14)
    default:
      return err(
        usage(
          "unknownCommand",
          `모르는 명령 sessions ${action}`,
          "ls, show, fork, rm 중 하나를 쓴다",
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
    "비밀 값을 인자로 받을 수 없다",
    "값 없이 이름만 쓰고, 값은 프롬프트나 stdin으로 넣는다",
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
          "--provider 값이 맞지 않다",
          "sops, op, bws, keychain 중 하나를 쓴다",
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
        "--expires는 YYYY-MM-DD 날짜여야 한다",
        "--expires 2027-01-31처럼 쓴다",
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
            "secret ls는 위치 인자를 받지 않는다",
            "--meta, --usage만 쓴다",
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
            `secret ${action}에는 이름이 필요하다`,
            `xeon secret ${action} <이름>`,
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
            "secret meta에는 이름이 필요하다",
            "xeon secret meta <이름> [--desc …]",
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
            `secret ${action}에는 이름이 필요하다`,
            `xeon secret ${action} <이름>`,
          ),
        );
      }
      if (extra.length > 0 || nameText.includes("=")) {
        return err(
          usage("unexpectedArgument", `secret ${action}에 인자가 너무 많다`, "이름 하나만 쓴다"),
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
                "secret reveal은 터미널에서만 쓸 수 있다",
                "stdin과 stdout이 모두 터미널인 셸에서 실행한다",
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
          "secret에는 하위 명령이 필요하다",
          "ls, add, set, meta, rotate, rm, test, reveal 중 하나를 쓴다",
        ),
      );
    // xeon-disable-next-line xeon/switch-default-never -- 명령줄 인자는 닫히지 않은 문자열이다. 모르는 하위 명령은 사용법 오류 값으로 돌려준다 (eng.typescript.guide TY-14)
    default:
      return err(
        usage(
          "unknownCommand",
          `모르는 명령 secret ${action}`,
          "ls, add, set, meta, rotate, rm, test, reveal 중 하나를 쓴다",
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

function parseService(acc: GlobalAcc, rest: readonly string[]): Result<ServiceCommand, UsageError> {
  const [actionText, ...tail] = rest;
  if (actionText === undefined) {
    return err(
      usage(
        "missingArgument",
        "service에는 하위 명령이 필요하다",
        "start, status, stop 중 하나를 쓴다",
      ),
    );
  }
  const action = SERVICE_ACTIONS.find((candidate) => candidate === actionText);
  if (action === undefined) {
    return err(
      usage(
        "unknownCommand",
        `모르는 명령 service ${actionText}`,
        "start, status, stop 중 하나를 쓴다",
      ),
    );
  }
  const scanned = scanArgs(acc, tail, { "--json": { value: "none" } });
  if (!scanned.ok) return scanned;
  if (scanned.value.positionals.length > 0) {
    return err(
      usage("unexpectedArgument", "service는 위치 인자를 받지 않는다", "--json만 쓸 수 있다"),
    );
  }
  return ok({ kind: "service", action, output: outputOf(scanned.value) });
}

function parseHost(acc: GlobalAcc, rest: readonly string[]): Result<CliHostCommand, UsageError> {
  const scanned = scanArgs(acc, rest, { "--stdio": { value: "none" } });
  if (!scanned.ok) return scanned;
  if (scanned.value.positionals.length > 0) {
    return err(usage("unexpectedArgument", "host는 위치 인자를 받지 않는다", "xeon host --stdio"));
  }
  if (!has(scanned.value, "--stdio")) {
    return err(usage("missingArgument", "host에는 --stdio가 필요하다", "xeon host --stdio"));
  }
  return ok({ kind: "host", stdio: true });
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
      usage("unexpectedArgument", `${kind}는 위치 인자를 받지 않는다`, "--json만 쓸 수 있다"),
    );
  }
  return ok({ kind, output: outputOf(scanned.value) });
}

// ── 진입 ─────────────────────────────────────────────────────────────────

const COMMAND_WORDS: ReadonlySet<string> = new Set([
  "chat",
  "sessions",
  "config",
  "secret",
  "service",
  "host",
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
    case "service":
      return parseService(acc, rest);
    case "host":
      return parseHost(acc, rest);
    case "doctor":
      return parseJsonOnly(acc, "doctor", rest);
    case "version":
      return parseJsonOnly(acc, "version", rest);
    case "help":
      return ok({ kind: "help", topic: rest[0] ?? null });
    // xeon-disable-next-line xeon/switch-default-never -- 명령줄 인자는 닫히지 않은 문자열이다. 모르는 하위 명령은 사용법 오류 값으로 돌려준다 (eng.typescript.guide TY-14)
    default:
      return err(
        usage("unknownCommand", `모르는 명령 ${word}`, "xeon --help로 명령 목록을 확인한다"),
      );
  }
}

/** 순수 함수. argv는 실행 파일 경로를 뺀 인자다. TTY 사실로 모드를 정한다(§4.2). */
export function parseArgv(
  argv: readonly string[],
  terminal: TerminalFacts,
  env: Readonly<Record<string, string | undefined>>,
): Result<ParsedArgv, UsageError> {
  const acc: GlobalAcc = { help: false, noColor: false, cwd: null };
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
        return err(usage("missingArgument", "-C에 폴더가 없다", "-C <폴더> 형식으로 쓴다"));
      }
      acc.cwd = dir;
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
      usage("unknownCommand", `모르는 명령 ${first}`, "xeon --help로 명령 목록을 확인한다"),
    );
  }
  const word = isWord ? first : "chat";
  const rest = isWord ? argv.slice(index + 1) : argv.slice(index);
  const parsed = commandOf(acc, word, rest, terminal);
  const global: GlobalOptions = { cwd: acc.cwd ?? ".", color: colorOf(acc.noColor, env) };
  if (acc.help) return ok({ global, command: { kind: "help", topic: isWord ? word : null } });
  if (!parsed.ok) return parsed;
  return ok({ global, command: parsed.value });
}
