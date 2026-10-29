import { dirname } from "node:path";
import { assertNever, attemptAsync, type Result } from "@xeon/contracts";
import type {
  HostBinaryItem,
  HostBinaryReport,
  HostConnection,
  WebProviderCapability,
  WebProviderOrigin,
} from "@xeon/contracts/wire";
import {
  toolsWebViewOf,
  type ToolsWebView,
  type WebRecommendation,
  type WebSection,
  type WebToolRow,
} from "@xeon/client/web";
import type { DoctorCommand } from "../cli/command.ts";
import type { EngineHandle } from "../engine.ts";
import { failureOfCaught, type Failure } from "../errors.ts";
import { EXIT, type ExitCode } from "../exit-codes.ts";
import type { CliIo, DoctorProbes } from "../io.ts";
import { CLI_VERSION } from "./version.ts";
import { connectOrReportQuiet, type CommandContext } from "./context.ts";

// L4.cli.spec §3.1 doctor, §4.7.1. 진단 항목: 엔진 조립(FTS5, 데이터 디렉터리), 비밀 저장소(sops·age), 외부 바이너리 점검,
// 서비스 도달, 터미널 능력, 검색 provider 상태 묶음. FTS5 검사는 platform-store 안에만 있어(TC-11) 엔진을 열어 보는 것으로 확인한다 [spec §10 5번 진단 경로의
// 임시 결정: 조립 진입점이 진단 함수를 내기 전까지 CLI가 조립 결과와 wire 조회로 판정한다].

type CheckStatus = "ok" | "warn" | "fail" | "info";

interface DoctorCheck {
  readonly id: string;
  readonly status: CheckStatus;
  readonly message: string;
  readonly fix?: string;
}

/** doctor가 엔진에서 직접 읽는 검색 설정. provider와 순서, 키 플러그인 권장은 `web.providers`의 값과 행이 준다(§4.7.1) */
export interface SearchSettings {
  /** `l2.web.search.searxng.url`. 비어 있으면 어디에도 요청하지 않는다 */
  readonly searxngUrl: string;
}

const DEFAULT_SEARCH_SETTINGS: SearchSettings = {
  searxngUrl: "",
};

export interface SearchStatus {
  /** 줄 1: "검색 provider: …". 웹 provider 목록을 읽지 못했으면 알 수 없다 */
  readonly provider: string;
  /** 줄 2: 설정한 SearXNG 주소의 상태. 주소가 비어 있으면 어디에도 요청하지 않는다 */
  readonly searxng: string;
  /** 줄 3: 키 플러그인 권장, 또는 모두 쓸 수 있다는 말. 웹 provider 목록을 읽지 못했으면 알 수 없다 */
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

/** SearXNG 주소 키를 읽는다. 엔진에 없으면 기본값(빈 주소)이고 `complete`가 거짓이다(L2.web 조립 전의 엔진) */
async function readSearchSettings(
  connection: HostConnection,
): Promise<{ readonly settings: SearchSettings; readonly complete: boolean }> {
  const url = stringOf(await readOne(connection, "l2.web.search.searxng.url"));
  return {
    settings: { searxngUrl: url ?? DEFAULT_SEARCH_SETTINGS.searxngUrl },
    complete: url !== undefined,
  };
}

/**
 * `web.providers`로 웹 provider 목록과 웹 설정 값을 읽는다(M3-REQ-96). 기능이 없거나 요청이 실패하면 undefined다.
 * 실패 원인이 예상 가능한 종류가 아니면 버그이므로 다시 던진다
 */
async function webProvidersOf(handle: EngineHandle): Promise<ToolsWebView | undefined> {
  if (!handle.supports("web.providers")) return undefined;
  const read = await attemptAsync(() => handle.connection.request("web.providers", {}));
  if (!read.ok) {
    const failure = failureOfCaught(read.error.cause);
    if (failure === undefined) throw read.error.cause;
    return undefined;
  }
  return toolsWebViewOf(read.value);
}

/**
 * 설정한 SearXNG 주소 하나를 탐침한다. 자동 감지는 없다(사용자 결정 H1, L2.web.spec §4.8.3): 주소가 비어 있으면 요청을 보내지 않는다
 */
async function probeConfiguredSearxng(
  settings: SearchSettings,
  probes: DoctorProbes,
): Promise<"unset" | "ok" | "json-disabled" | "unreachable"> {
  if (settings.searxngUrl.length === 0) return "unset";
  return probes.probeSearxng(settings.searxngUrl, new AbortController().signal);
}

/** 줄 1. 고정이면 고정한 행(쓸 수 없으면 사유), 자동이면 다음 호출이 쓸 행(`current`)을 보인다 */
function searchLineOf(search: WebSection): string {
  const current = search.rows.find((row) => row.current);
  if (search.provider !== "auto") {
    const head = `검색 provider: ${search.provider} (l2.web.search.provider로 고정)`;
    if (current === undefined) return `${head} — 목록에 없는 provider다`;
    return current.ok ? head : `${head} — ${current.note}`;
  }
  if (current === undefined) return "검색 provider: auto → 쓸 수 있는 provider가 없다";
  return `검색 provider: auto → ${current.displayName} (${current.id})`;
}

/** 줄 3의 항목 하나. 쓸 수 있는 키 플러그인은 항목이 없다. 상태는 괄호 안에, 해결 문구는 `—` 뒤에 적는다 */
function recommendedItemOf(entry: WebRecommendation): string | undefined {
  switch (entry.state) {
    case "ready":
      return undefined;
    case "needs-key":
      return `${entry.label}(키 필요 — ${entry.hint})`;
    case "not-installed":
      return `${entry.label}(설치 필요 — ${entry.hint})`;
    case "unavailable":
      return `${entry.label}(사용 불가 — ${entry.hint})`;
    default:
      return assertNever(entry.state, "WebRecommendation.state");
  }
}

/** 줄 3. 모두 쓸 수 있으면 한 줄로 말하고, 아니면 쓸 수 없는 키 플러그인만 권장한다 */
function recommendedLineOf(recommendations: readonly WebRecommendation[]): string {
  const items = recommendations.flatMap((entry) => {
    const item = recommendedItemOf(entry);
    return item === undefined ? [] : [item];
  });
  if (items.length === 0) {
    const labels = recommendations.map((entry) => entry.label).join(", ");
    return `키 플러그인: ${labels} 모두 쓸 수 있다`;
  }
  return `권장 키 플러그인: ${items.join(", ")}`;
}

/** 검색 provider 상태 세 줄(§4.7.1). 줄 1과 줄 3은 `web.providers`의 view-model에서, 줄 2는 설정한 주소 하나의 탐침에서 나온다 */
export async function describeSearch(
  settings: SearchSettings,
  probes: DoctorProbes,
  web: ToolsWebView | undefined,
  assumedDefaults: boolean,
): Promise<SearchStatus> {
  const verdict = await probeConfiguredSearxng(settings, probes);
  const url = settings.searxngUrl;
  let searxng: string;
  switch (verdict) {
    case "ok":
      searxng = `SearXNG: 설정한 주소가 응답한다 ${url}`;
      break;
    case "json-disabled":
      searxng = `SearXNG: ${url}이(가) 응답했지만 JSON 형식이 꺼져 있다 — 해결: settings.yml의 search.formats에 json을 더한다`;
      break;
    case "unreachable":
      searxng = `SearXNG: ${url}에 응답이 없다 — 해결: 주소와 서버 상태를 확인한다. 그동안 검색은 내장 검색 래퍼로 내려간다`;
      break;
    case "unset":
      searxng =
        "SearXNG: 주소를 설정하지 않았다 (자동 감지는 하지 않는다) — 쓰려면: xeon config set l2.web.search.searxng.url <주소>";
      break;
    default:
      return assertNever(verdict, "SearxngVerdict");
  }

  return {
    provider:
      web === undefined
        ? "검색 provider: 알 수 없다 (엔진에서 provider 목록을 읽지 못했다)"
        : searchLineOf(web.search),
    searxng,
    recommended:
      web === undefined
        ? "키 플러그인: 알 수 없다 (엔진에서 provider 목록을 읽지 못했다)"
        : recommendedLineOf(web.recommendations),
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

/** 바이너리 하나의 점검 결과를 진단 항목으로 바꾼다. 필수는 실패, 선택은 경고다(`HostBinaryItem.need`) */
function binaryCheck(item: HostBinaryItem): DoctorCheck {
  const id = `binary.${item.name}`;
  const status = item.status;
  switch (status.kind) {
    case "ok":
      return {
        id,
        status: "ok",
        message: `외부 바이너리 ${item.name}: ${status.version} (${status.source === "bundled" ? "번들" : "시스템"}) — ${item.usedBy}`,
      };
    case "missing":
      return {
        id,
        status: item.need === "required" ? "fail" : "warn",
        message: `외부 바이너리 ${item.name}: 없다 (${item.need === "required" ? "필수" : "선택"}) — ${item.impact}`,
        fix: status.hint,
      };
    case "too_old":
      return {
        id,
        status: item.need === "required" ? "fail" : "warn",
        message: `외부 바이너리 ${item.name}: 버전이 낮다 (${status.found}, 필요 ${status.required}) — ${item.impact}`,
        fix: `${item.name}을(를) ${status.required} 이상으로 올린다`,
      };
    case "unusable":
      return {
        id,
        status: item.need === "required" ? "fail" : "warn",
        message: `외부 바이너리 ${item.name}: 쓸 수 없다 (${status.reason}) — ${item.impact}`,
        fix: `${item.name} 설치와 실행 권한을 확인한다`,
      };
    default:
      return assertNever(status, "HostBinaryStatus");
  }
}

/**
 * `host.status { includeBinaries: true }`로 외부 바이너리 점검 결과를 받는다(G2-07, L4.host-service.spec HS-69).
 * 점검은 바이너리마다 자식 프로세스를 띄우므로 doctor만 요청한다. 호스트가 이 요청을 모르거나 점검이 실패해도 doctor는 이어 간다
 */
async function binaryChecks(handle: EngineHandle): Promise<{
  readonly checks: readonly DoctorCheck[];
  readonly report: HostBinaryReport | null;
}> {
  if (!handle.supports("host.status")) {
    return {
      checks: [
        {
          id: "binaries",
          status: "info",
          message: "외부 바이너리: 이 엔진은 점검 결과를 알리지 않는다",
        },
      ],
      report: null,
    };
  }
  const status = await attemptAsync(() =>
    handle.connection.request("host.status", { includeBinaries: true }),
  );
  if (!status.ok) {
    const failure = failureOfCaught(status.error.cause);
    if (failure === undefined) throw status.error.cause;
    return {
      checks: [
        {
          id: "binaries",
          status: "warn",
          message: `외부 바이너리: 점검하지 못했다 — ${failure.message}`,
          fix: failure.fix,
        },
      ],
      report: null,
    };
  }
  const report = status.value.binaries;
  if (report === undefined) {
    return {
      checks: [
        {
          id: "binaries",
          status: "info",
          message: "외부 바이너리: 이 엔진은 점검 결과를 싣지 않았다",
        },
      ],
      report: null,
    };
  }
  return { checks: report.items.map(binaryCheck), report };
}

async function engineChecks(handle: EngineHandle): Promise<{
  readonly checks: readonly DoctorCheck[];
  readonly binaries: HostBinaryReport | null;
}> {
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
  const binaries = await binaryChecks(handle);
  checks.push(...binaries.checks);
  const service = await readOne(handle.connection, "l0.process.service.enabled");
  checks.push({
    id: "service",
    status: "info",
    message:
      service === true
        ? "서비스 모드: 설정은 켜져 있다. chat은 아직 서비스에 접속하지 않고 in-process로 동작한다 (xeon service status로 서비스를 확인한다)"
        : "서비스 모드: 사용 안 함 (in-process)",
  });
  return { checks, binaries: binaries.report };
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

const ORIGIN_LABEL: Readonly<Record<WebProviderOrigin, string>> = {
  builtin: "내장",
  plugin: "플러그인",
  detected: "사용자 설정",
};

const CAPABILITY_LABEL: Readonly<Record<WebProviderCapability, string>> = {
  "web.search": "검색",
  "web.browse": "브라우저",
  "web.fetch": "가져오기",
};

/**
 * `웹 provider` 블록의 한 줄. 쓸 수 있으면 `[ok]`, 못 쓰면 `[경고]`다. 상세 문구(`detail`)는 찍지 않는다.
 * 가격표가 오래되었으면 기준일을 붙인다
 */
function webRowLineOf(row: WebToolRow): string {
  const rank = row.rank === null ? "순위 없음" : `순위 ${String(row.rank + 1)}`;
  const parts: string[] = [ORIGIN_LABEL[row.origin], CAPABILITY_LABEL[row.capability], rank];
  if (row.current) parts.push("현재");
  if (row.pinned) parts.push("고정");
  parts.push(row.note);
  if (row.noticePending) parts.push("첫 사용 고지 대기");
  if (row.price !== null && row.price.stale) parts.push(`가격표 오래됨(${row.price.asOf})`);
  return `  ${MARK[row.ok ? "ok" : "warn"]} ${row.id}  ${parts.join(" · ")}`;
}

/** `웹 provider` 블록의 줄들. 검색, 브라우즈, 가져오기 순서로 모든 행을 한 줄씩 보인다 */
function webBlockOf(view: ToolsWebView): readonly string[] {
  const rows = [...view.search.rows, ...view.browse.rows, ...view.fetch.rows];
  if (rows.length === 0) return ["  provider가 없다"];
  return rows.map(webRowLineOf);
}

function formatDoctor(
  version: string,
  checks: readonly DoctorCheck[],
  search: SearchStatus,
  web: ToolsWebView | undefined,
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
  if (web !== undefined) {
    lines.push("웹 provider");
    lines.push(...webBlockOf(web));
  }
  return `${lines.join("\n")}\n`;
}

export async function runDoctor(ctx: CommandContext, command: DoctorCommand): Promise<ExitCode> {
  const { io, deps } = ctx;
  const connected: Result<EngineHandle, Failure> = await connectOrReportQuiet(ctx);
  let checks: DoctorCheck[] = [];
  let binaries: HostBinaryReport | null = null;
  let web: ToolsWebView | undefined;
  let code: ExitCode = EXIT.ok;
  let settings: { readonly settings: SearchSettings; readonly complete: boolean } = {
    settings: DEFAULT_SEARCH_SETTINGS,
    complete: false,
  };
  if (connected.ok) {
    const handle = connected.value;
    try {
      const engine = await engineChecks(handle);
      checks = [...engine.checks];
      binaries = engine.binaries;
      // 필수 바이너리를 쓸 수 없으면 환경 문제로 끝낸다(HS-69). 선택 바이너리만 빠진 것은 경고다
      if (binaries?.ready === false) code = EXIT.environment;
      web = await webProvidersOf(handle);
      settings = await readSearchSettings(handle.connection);
    } finally {
      await handle.shutdown("user");
    }
  } else {
    checks = [...failureChecks(connected.error)];
    code = connected.error.code;
  }
  checks.push(terminalCheck(io, ctx.global.color));
  const search = await describeSearch(
    settings.settings,
    deps.probes,
    web,
    web === undefined || !settings.complete,
  );
  if (command.output === "json") {
    await io.stdout(
      `${JSON.stringify({ version: CLI_VERSION, checks, binaries, search, web: web ?? null }, null, 2)}\n`,
    );
  } else {
    await io.stdout(formatDoctor(CLI_VERSION, checks, search, web));
  }
  return code;
}
