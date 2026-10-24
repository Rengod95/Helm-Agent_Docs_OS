import { dirname } from "node:path";
import { attemptAsync, type Result } from "@xeon/contracts";
import type { HostConnection } from "@xeon/contracts/wire";
import type { DoctorCommand } from "../cli/command.ts";
import type { EngineHandle } from "../engine.ts";
import { failureOfCaught, type Failure } from "../errors.ts";
import { EXIT, type ExitCode } from "../exit-codes.ts";
import type { CliIo, DoctorProbes } from "../io.ts";
import { CLI_VERSION } from "./version.ts";
import { connectOrReportQuiet, type CommandContext } from "./context.ts";

// L4.cli.spec §3.1 doctor, §4.7.1. 진단 항목: 엔진 조립(FTS5, 데이터 디렉터리), 비밀 저장소(sops·age), 서비스 도달, 터미널 능력,
// 검색 provider 상태 묶음. FTS5 검사는 platform-store 안에만 있어(TC-11) 엔진을 열어 보는 것으로 확인한다 [spec §10 5번 진단 경로의
// 임시 결정: 조립 진입점이 진단 함수를 내기 전까지 CLI가 조립 결과와 wire 조회로 판정한다].

type CheckStatus = "ok" | "warn" | "fail" | "info";

interface DoctorCheck {
  readonly id: string;
  readonly status: CheckStatus;
  readonly message: string;
  readonly fix?: string;
}

/** SearXNG 후보 주소(L2.web.spec §4.8.3). 설정 주소가 비어 있고 감지가 켜졌을 때 순서대로 본다 */
export const SEARXNG_CANDIDATES: readonly string[] = [
  "http://127.0.0.1:8888",
  "http://127.0.0.1:8080",
  "http://localhost:8888",
  "http://localhost:8080",
];

/** 키 플러그인 권장 목록(ADR-0005 §3.1 ④). providerId는 L2.web.spec §4.8의 `plugin:<이름>`이다 */
const RECOMMENDED: readonly {
  readonly label: string;
  readonly plugin: string;
  readonly secret: string;
}[] = [
  { label: "Exa", plugin: "web-exa", secret: "exa-api-key" },
  { label: "Brave", plugin: "web-brave", secret: "brave-api-key" },
];

export interface SearchSettings {
  readonly provider: string;
  readonly searxngUrl: string;
  readonly detect: boolean;
  readonly pluginOrder: readonly string[];
}

const DEFAULT_SEARCH_SETTINGS: SearchSettings = {
  provider: "auto",
  searxngUrl: "",
  detect: true,
  pluginOrder: [],
};

export interface SearchStatus {
  /** 줄 1: 지금 쓰는 web.search provider */
  readonly provider: string;
  /** 줄 2: SearXNG 감지 결과 */
  readonly searxng: string;
  /** 줄 3: 등록하지 않은 키 플러그인 권장 */
  readonly recommended: string;
  /** 설정을 엔진에서 읽지 못해 기본값으로 판정했다 */
  readonly assumedDefaults: boolean;
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

async function readOne(connection: HostConnection, key: string): Promise<unknown> {
  const read = await attemptAsync(() => connection.request("settings.get", { keys: [key] }));
  return read.ok ? read.value.settings[0]?.value : undefined;
}

/** 검색 설정 네 키를 읽는다. 하나라도 엔진에 없으면 그 키는 기본값이다(L2.web 조립 전의 엔진) */
async function readSearchSettings(
  connection: HostConnection,
): Promise<{ readonly settings: SearchSettings; readonly complete: boolean }> {
  const [provider, url, detect, order] = await Promise.all([
    readOne(connection, "l2.web.search.provider"),
    readOne(connection, "l2.web.search.searxng.url"),
    readOne(connection, "l2.web.search.searxng.detect"),
    readOne(connection, "l2.web.search.pluginOrder"),
  ]);
  const plugins = Array.isArray(order)
    ? order.filter((entry): entry is string => typeof entry === "string")
    : undefined;
  const complete =
    stringOf(provider) !== undefined &&
    stringOf(url) !== undefined &&
    typeof detect === "boolean" &&
    plugins !== undefined;
  return {
    settings: {
      provider: stringOf(provider) ?? DEFAULT_SEARCH_SETTINGS.provider,
      searxngUrl: stringOf(url) ?? DEFAULT_SEARCH_SETTINGS.searxngUrl,
      detect: typeof detect === "boolean" ? detect : DEFAULT_SEARCH_SETTINGS.detect,
      pluginOrder: plugins ?? DEFAULT_SEARCH_SETTINGS.pluginOrder,
    },
    complete,
  };
}

/** 감지 결과. 후보 순서를 지켜 첫 성공을 고른다 */
async function detectSearxng(
  settings: SearchSettings,
  probes: DoctorProbes,
): Promise<{ readonly found: string | null; readonly jsonDisabled: string | null }> {
  const targets =
    settings.searxngUrl.length > 0
      ? [settings.searxngUrl]
      : settings.detect
        ? SEARXNG_CANDIDATES
        : [];
  const signal = new AbortController().signal;
  const verdicts = await Promise.all(targets.map((url) => probes.probeSearxng(url, signal)));
  let found: string | null = null;
  let jsonDisabled: string | null = null;
  verdicts.forEach((verdict, index) => {
    const url = targets[index];
    if (url === undefined) return;
    if (verdict === "ok" && found === null) found = url;
    if (verdict === "json-disabled" && jsonDisabled === null) jsonDisabled = url;
  });
  return { found, jsonDisabled };
}

/** 검색 provider 상태 세 줄(§4.7.1). 값은 키 이름과 참조 문자열뿐이다 */
export async function describeSearch(
  settings: SearchSettings,
  probes: DoctorProbes,
  assumedDefaults: boolean,
): Promise<SearchStatus> {
  const detected = await detectSearxng(settings, probes);
  let provider: string;
  if (settings.provider !== "auto")
    provider = `${settings.provider} (l2.web.search.provider로 고정)`;
  else if (settings.pluginOrder[0] !== undefined)
    provider = `auto → ${settings.pluginOrder[0]} (키 플러그인)`;
  else if (detected.found !== null) provider = `auto → searxng (${detected.found})`;
  else provider = "auto → 내장 검색 래퍼 (builtin-wrapper)";

  let searxng: string;
  if (detected.found !== null) searxng = `SearXNG: 감지됨 ${detected.found}`;
  else if (detected.jsonDisabled !== null) {
    searxng = `SearXNG: ${detected.jsonDisabled}에서 감지했지만 JSON 형식이 꺼져 있다 — 해결: settings.yml의 search.formats에 json을 더한다`;
  } else {
    searxng =
      "SearXNG: 없음 — 해결: xeon config set l2.web.search.searxng.url <주소> (감지 후보 http://127.0.0.1:8888 등)";
  }

  const missing = RECOMMENDED.filter(
    (entry) =>
      !settings.pluginOrder.some((id) => id === entry.plugin || id === `plugin:${entry.plugin}`),
  );
  const recommended =
    missing.length === 0
      ? "키 플러그인: Exa, Brave 모두 등록됨"
      : `권장 키 플러그인: ${missing.map((entry) => entry.label).join(", ")} — 키 등록: ${missing
          .map((entry) => `xeon secret add ${entry.secret}`)
          .join(", ")}`;
  return {
    provider: `검색 provider: ${provider}`,
    searxng,
    recommended,
    assumedDefaults,
  };
}

function terminalCheck(io: CliIo, color: boolean): DoctorCheck {
  const { terminal, env } = io;
  const locale = `${env["LC_ALL"] ?? ""}${env["LC_CTYPE"] ?? ""}${env["LANG"] ?? ""}`;
  const utf8 = /utf-?8/i.test(locale);
  const columns = terminal.columns === null ? "폭 알 수 없음" : `${String(terminal.columns)}열`;
  const facts = `stdin ${terminal.stdinIsTty ? "TTY" : "파이프"}, stdout ${terminal.stdoutIsTty ? "TTY" : "파이프"}, ${columns}, 색 ${color && terminal.stdoutIsTty ? "사용" : "끔"}`;
  if (locale.length > 0 && !utf8) {
    return {
      id: "terminal",
      status: "warn",
      message: `터미널: ${facts}. 로케일이 UTF-8이 아니다`,
      fix: "LANG을 UTF-8 로케일로 맞춘다 (예: ko_KR.UTF-8). 한글이 깨질 수 있다",
    };
  }
  return { id: "terminal", status: "ok", message: `터미널: ${facts}` };
}

async function engineChecks(handle: EngineHandle): Promise<readonly DoctorCheck[]> {
  const checks: DoctorCheck[] = [
    {
      id: "engine",
      status: "ok",
      message: `엔진을 열었다 (${handle.transport}). 세션 저장소와 FTS5를 쓸 수 있다`,
    },
    {
      id: "state-dir",
      status: "ok",
      message: `상태 디렉터리: ${dirname(handle.paths.cliStateFile)}`,
    },
  ];
  const secrets = await attemptAsync(() => handle.connection.request("secret.list", {}));
  if (secrets.ok) {
    checks.push({
      id: "secrets",
      status: "ok",
      message: `비밀 저장소: 사용할 수 있다 (등록 ${String(secrets.value.secrets.length)}개)`,
    });
  } else {
    const failure = failureOfCaught(secrets.error.cause);
    if (failure === undefined) throw secrets.error.cause;
    checks.push({
      id: "secrets",
      status: "warn",
      message: `비밀 저장소: ${failure.message}`,
      fix: failure.fix,
    });
  }
  const service = await readOne(handle.connection, "l0.process.service.enabled");
  checks.push({
    id: "service",
    status: "info",
    message:
      service === true
        ? "서비스 모드: 설정은 켜져 있지만 이 버전은 in-process로 동작한다 (서비스는 M3)"
        : "서비스 모드: 사용 안 함 (in-process)",
  });
  return checks;
}

function failureChecks(failure: Failure): readonly DoctorCheck[] {
  return [
    {
      id: "engine",
      status: "fail",
      message: `엔진을 열 수 없다: ${failure.message}`,
      fix: failure.fix,
    },
  ];
}

const MARK: Readonly<Record<CheckStatus, string>> = {
  ok: "[ok]  ",
  warn: "[경고]",
  fail: "[실패]",
  info: "[참고]",
};

function formatDoctor(
  version: string,
  checks: readonly DoctorCheck[],
  search: SearchStatus,
): string {
  const lines = [`xeon doctor (xeon ${version})`, "진단"];
  for (const check of checks) {
    lines.push(`  ${MARK[check.status]} ${check.message}`);
    if (check.fix !== undefined) lines.push(`         해결: ${check.fix}`);
  }
  lines.push("검색 provider");
  lines.push(`  ${search.provider}`);
  lines.push(`  ${search.searxng}`);
  lines.push(`  ${search.recommended}`);
  if (search.assumedDefaults) {
    lines.push("  (엔진에서 검색 설정을 읽지 못해 기본 설정으로 판정했다)");
  }
  return `${lines.join("\n")}\n`;
}

export async function runDoctor(ctx: CommandContext, command: DoctorCommand): Promise<ExitCode> {
  const { io, deps } = ctx;
  const connected: Result<EngineHandle, Failure> = await connectOrReportQuiet(ctx);
  let checks: DoctorCheck[] = [];
  let code: ExitCode = EXIT.ok;
  let settings: { readonly settings: SearchSettings; readonly complete: boolean } = {
    settings: DEFAULT_SEARCH_SETTINGS,
    complete: false,
  };
  if (connected.ok) {
    const handle = connected.value;
    try {
      checks = [...(await engineChecks(handle))];
      settings = await readSearchSettings(handle.connection);
    } finally {
      await handle.shutdown("user");
    }
  } else {
    checks = [...failureChecks(connected.error)];
    code = connected.error.code;
  }
  checks.push(terminalCheck(io, ctx.global.color));
  const search = await describeSearch(settings.settings, deps.probes, !settings.complete);
  if (command.output === "json") {
    await io.stdout(`${JSON.stringify({ version: CLI_VERSION, checks, search }, null, 2)}\n`);
  } else {
    await io.stdout(formatDoctor(CLI_VERSION, checks, search));
  }
  return code;
}
