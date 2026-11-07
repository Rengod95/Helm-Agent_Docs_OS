import { dirname } from "node:path";
import { t } from "@fresnel/client/i18n";
import { assertNever, attemptAsync, type Result } from "@fresnel/contracts";
import type {
  HostBinaryItem,
  HostBinaryReport,
  HostConnection,
  SettingsFileProblem,
  WebProviderCapability,
  WebProviderOrigin,
} from "@fresnel/contracts/wire";
import {
  toolsWebViewOf,
  type ToolsWebView,
  type WebRecommendation,
  type WebSection,
  type WebToolRow,
} from "@fresnel/client/web";
import type { DoctorCommand } from "../cli/command.ts";
import type { EngineHandle } from "../engine.ts";
import { failureOfCaught, type Failure } from "../errors.ts";
import { EXIT, type ExitCode } from "../exit-codes.ts";
import type { CliIo } from "../io.ts";
import { settingsProblemReason, settingsProblemWhere } from "../settings-problem.ts";
import { CLI_VERSION } from "./version.ts";
import { connectOrReportQuiet, type CommandContext } from "./context.ts";

// L4.cli.spec §3.1 doctor, §4.7.1. 진단 항목: 엔진 조립(FTS5, 데이터 디렉터리), 시크릿 저장소(sops·age), 외부 바이너리 점검,
// 서비스 도달, 터미널 기능, 검색 provider 상태 묶음. FTS5 검사는 platform-store 안에만 있어(TC-11) 엔진을 열어 보는 것으로 확인한다 [spec §10 5번 진단 경로의
// 임시 결정: 조립 진입점이 진단 함수를 내기 전까지 CLI가 조립 결과와 wire 조회로 판정한다].

type CheckStatus = "ok" | "warn" | "fail" | "info";

interface DoctorCheck {
  readonly id: string;
  readonly status: CheckStatus;
  readonly message: string;
  readonly fix?: string;
}

export interface SearchStatus {
  /** 줄 1: "검색 provider: …". 웹 provider 목록을 읽지 못했으면 알 수 없다 */
  readonly provider: string;
  /** 줄 2: 키 플러그인 권장, 또는 모두 쓸 수 있다는 말. 웹 provider 목록을 읽지 못했으면 알 수 없다 */
  readonly recommended: string;
  /** 설정을 엔진에서 읽지 못해 기본값으로 판정했다 */
  readonly assumedDefaults: boolean;
}

async function readOne(connection: HostConnection, key: string): Promise<unknown> {
  const read = await attemptAsync(() => connection.request("settings.get", { keys: [key] }));
  return read.ok ? read.value.settings[0]?.value : undefined;
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

/** 줄 1. 고정이면 고정한 행(쓸 수 없으면 사유), 자동이면 다음 호출이 쓸 행(`current`)을 보인다 */
function searchLineOf(search: WebSection): string {
  const current = search.rows.find((row) => row.current);
  if (search.provider !== "auto") {
    const head = t("cli.doctor.search.fixed", { provider: search.provider });
    if (current === undefined) return t("cli.doctor.search.fixedNotListed", { head });
    return current.ok ? head : t("cli.doctor.search.withNote", { head, note: current.note });
  }
  if (current === undefined) return t("cli.doctor.search.autoNone");
  return t("cli.doctor.search.auto", { name: current.displayName, id: current.id });
}

/** 줄 3의 항목 하나. 쓸 수 있는 키 플러그인은 항목이 없다. 상태는 괄호 안에, 해결 문구는 `—` 뒤에 적는다 */
function recommendedItemOf(entry: WebRecommendation): string | undefined {
  switch (entry.state) {
    case "ready":
      return undefined;
    case "needs-key":
      return t("cli.doctor.recommend.needsKey", { label: entry.label, hint: entry.hint });
    case "not-installed":
      return t("cli.doctor.recommend.notInstalled", { label: entry.label, hint: entry.hint });
    case "unavailable":
      return t("cli.doctor.recommend.unavailable", { label: entry.label, hint: entry.hint });
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
    return t("cli.doctor.recommend.allReady", { labels });
  }
  return t("cli.doctor.recommend.list", { items: items.join(", ") });
}

/** 검색 provider 상태 두 줄(§4.7.1). 두 줄 모두 `web.providers`의 view-model에서 나온다. 엔진이 목록을 주지 않으면 알 수 없다 */
export function describeSearch(
  web: ToolsWebView | undefined,
  assumedDefaults: boolean,
): SearchStatus {
  return {
    provider: web === undefined ? t("cli.doctor.search.unknown") : searchLineOf(web.search),
    recommended:
      web === undefined
        ? t("cli.doctor.recommend.unknown")
        : recommendedLineOf(web.recommendations),
    assumedDefaults,
  };
}

function terminalCheck(io: CliIo, color: boolean): DoctorCheck {
  const { terminal, env } = io;
  const locale = `${env["LC_ALL"] ?? ""}${env["LC_CTYPE"] ?? ""}${env["LANG"] ?? ""}`;
  const utf8 = /utf-?8/i.test(locale);
  const columns =
    terminal.columns === null
      ? t("cli.doctor.terminal.columnsUnknown")
      : t("cli.doctor.terminal.columns", { count: String(terminal.columns) });
  const facts = t("cli.doctor.terminal.facts", {
    stdin: terminal.stdinIsTty ? "TTY" : t("cli.doctor.terminal.pipe"),
    stdout: terminal.stdoutIsTty ? "TTY" : t("cli.doctor.terminal.pipe"),
    columns,
    color:
      color && terminal.stdoutIsTty
        ? t("cli.doctor.terminal.colorOn")
        : t("cli.doctor.terminal.colorOff"),
  });
  if (locale.length > 0 && !utf8) {
    return {
      id: "terminal",
      status: "warn",
      message: t("cli.doctor.terminal.nonUtf8", { facts }),
      fix: t("cli.doctor.terminal.nonUtf8Fix"),
    };
  }
  return { id: "terminal", status: "ok", message: t("cli.doctor.terminal.ok", { facts }) };
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
        message: t("cli.doctor.binary.ok", {
          name: item.name,
          version: status.version,
          source:
            status.source === "bundled"
              ? t("cli.doctor.binary.source.bundled")
              : t("cli.doctor.binary.source.system"),
          usedBy: item.usedBy,
        }),
      };
    case "missing":
      return {
        id,
        status: item.need === "required" ? "fail" : "warn",
        message: t("cli.doctor.binary.missing", {
          name: item.name,
          need:
            item.need === "required"
              ? t("cli.doctor.need.required")
              : t("cli.doctor.need.optional"),
          impact: item.impact,
        }),
        fix: status.hint,
      };
    case "too_old":
      return {
        id,
        status: item.need === "required" ? "fail" : "warn",
        message: t("cli.doctor.binary.tooOld", {
          name: item.name,
          found: status.found,
          required: status.required,
          impact: item.impact,
        }),
        fix: t("cli.doctor.binary.tooOldFix", { name: item.name, required: status.required }),
      };
    case "unusable":
      return {
        id,
        status: item.need === "required" ? "fail" : "warn",
        message: t("cli.doctor.binary.unusable", {
          name: item.name,
          reason: status.reason,
          impact: item.impact,
        }),
        fix: t("cli.doctor.binary.unusableFix", { name: item.name }),
      };
    default:
      return assertNever(status, "HostBinaryStatus");
  }
}

/**
 * 설정 파일 항목(`settings.file`). 읽지 못해 비운 파일이 없으면 ok, 있으면 warn이다. 파일 값과 원문은 싣지 않는다(F wire §3.3.1).
 * 파일이 여럿이면 첫 것을 말하고 나머지는 개수로 덧붙인다
 */
function settingsFileCheck(problems: readonly SettingsFileProblem[]): DoctorCheck {
  const first = problems[0];
  if (first === undefined) {
    return { id: "settings.file", status: "ok", message: t("cli.doctor.settingsFile.ok") };
  }
  const message = t("cli.doctor.settingsFile.problem", {
    path: first.path,
    where: settingsProblemWhere(first),
    reason: settingsProblemReason(first),
  });
  const more = problems.length - 1;
  return {
    id: "settings.file",
    status: "warn",
    message:
      more === 0 ? message : `${message} ${t("cli.doctor.settingsFile.more", { count: more })}`,
    fix: t("cli.doctor.settingsFile.fix"),
  };
}

/**
 * `host.status { includeBinaries: true }` 한 번으로 외부 바이너리 점검 결과와 설정 파일 상태를 받는다(G2-07, L4.host-service.spec HS-69).
 * 점검은 바이너리마다 자식 프로세스를 띄우므로 doctor만 요청한다. 호스트가 이 요청을 모르거나 점검이 실패해도 doctor는 이어 간다.
 * 설정 파일 항목은 이 응답이 있을 때만 낸다(오래된 엔진은 생략한다)
 */
async function hostStatusChecks(handle: EngineHandle): Promise<{
  readonly checks: readonly DoctorCheck[];
  readonly report: HostBinaryReport | null;
}> {
  if (!handle.supports("host.status")) {
    return {
      checks: [
        {
          id: "binaries",
          status: "info",
          message: t("cli.doctor.binary.unsupported"),
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
          message: t("cli.doctor.binary.checkFailed", { reason: failure.message }),
          fix: failure.fix,
        },
      ],
      report: null,
    };
  }
  const settings = settingsFileCheck(status.value.settingsProblems ?? []);
  const report = status.value.binaries;
  if (report === undefined) {
    return {
      checks: [
        {
          id: "binaries",
          status: "info",
          message: t("cli.doctor.binary.notIncluded"),
        },
        settings,
      ],
      report: null,
    };
  }
  return { checks: [...report.items.map(binaryCheck), settings], report };
}

async function engineChecks(handle: EngineHandle): Promise<{
  readonly checks: readonly DoctorCheck[];
  readonly binaries: HostBinaryReport | null;
}> {
  const checks: DoctorCheck[] = [
    {
      id: "engine",
      status: "ok",
      message: t("cli.doctor.engine.ok", { transport: handle.transport }),
    },
    {
      id: "state-dir",
      status: "ok",
      message: t("cli.doctor.stateDir", { path: dirname(handle.paths.cliStateFile) }),
    },
  ];
  const secrets = await attemptAsync(() => handle.connection.request("secret.list", {}));
  if (secrets.ok) {
    checks.push({
      id: "secrets",
      status: "ok",
      message: t("cli.doctor.secrets.ok", { count: String(secrets.value.secrets.length) }),
    });
  } else {
    const failure = failureOfCaught(secrets.error.cause);
    if (failure === undefined) throw secrets.error.cause;
    checks.push({
      id: "secrets",
      status: "warn",
      message: t("cli.doctor.secrets.failed", { reason: failure.message }),
      fix: failure.fix,
    });
  }
  const binaries = await hostStatusChecks(handle);
  checks.push(...binaries.checks);
  const service = await readOne(handle.connection, "l0.process.service.enabled");
  checks.push({
    id: "service",
    status: "info",
    message: service === true ? t("cli.doctor.service.enabled") : t("cli.doctor.service.disabled"),
  });
  return { checks, binaries: binaries.report };
}

function failureChecks(failure: Failure): readonly DoctorCheck[] {
  return [
    {
      id: "engine",
      status: "fail",
      message: t("cli.doctor.engine.failed", { reason: failure.message }),
      fix: failure.fix,
    },
  ];
}

/** 줄 머리표. `ok`는 두 로케일이 같아서 카탈로그에 넣지 않는다. 나머지는 쓸 때 현재 로케일로 만든다 */
function markOf(status: CheckStatus): string {
  switch (status) {
    case "ok":
      return "[ok]  ";
    case "warn":
      return t("cli.doctor.mark.warn");
    case "fail":
      return t("cli.doctor.mark.fail");
    case "info":
      return t("cli.doctor.mark.info");
    default:
      return assertNever(status, "CheckStatus");
  }
}

function originLabelOf(origin: WebProviderOrigin): string {
  switch (origin) {
    case "builtin":
      return t("cli.doctor.origin.builtin");
    case "plugin":
      return t("cli.doctor.origin.plugin");
    case "detected":
      return t("cli.doctor.origin.detected");
    default:
      return assertNever(origin, "WebProviderOrigin");
  }
}

function capabilityLabelOf(capability: WebProviderCapability): string {
  switch (capability) {
    case "web.search":
      return t("cli.doctor.capability.search");
    case "web.browse":
      return t("cli.doctor.capability.browse");
    case "web.fetch":
      return t("cli.doctor.capability.fetch");
    default:
      return assertNever(capability, "WebProviderCapability");
  }
}

/**
 * `웹 provider` 블록의 한 줄. 쓸 수 있으면 `[ok]`, 못 쓰면 `[경고]`다. 상세 문구(`detail`)는 찍지 않는다.
 * 가격표가 오래되었으면 기준일을 붙인다
 */
function webRowLineOf(row: WebToolRow): string {
  const rank =
    row.rank === null
      ? t("cli.doctor.web.rankNone")
      : t("cli.doctor.web.rank", { rank: String(row.rank + 1) });
  const parts: string[] = [originLabelOf(row.origin), capabilityLabelOf(row.capability), rank];
  if (row.current) parts.push(t("cli.doctor.web.current"));
  if (row.pinned) parts.push(t("cli.doctor.web.pinned"));
  parts.push(row.note);
  if (row.noticePending) parts.push(t("cli.doctor.web.noticePending"));
  if (row.price !== null && row.price.stale)
    parts.push(t("cli.doctor.web.priceStale", { asOf: row.price.asOf }));
  return `  ${markOf(row.ok ? "ok" : "warn")} ${row.id}  ${parts.join(" · ")}`;
}

/** `웹 provider` 블록의 줄들. 검색, 브라우즈, 가져오기 순서로 모든 행을 한 줄씩 보인다 */
function webBlockOf(view: ToolsWebView): readonly string[] {
  const rows = [...view.search.rows, ...view.browse.rows, ...view.fetch.rows];
  if (rows.length === 0) return [t("cli.doctor.web.none")];
  return rows.map(webRowLineOf);
}

function formatDoctor(
  version: string,
  checks: readonly DoctorCheck[],
  search: SearchStatus,
  web: ToolsWebView | undefined,
): string {
  const lines = [`fresnel doctor (fresnel ${version})`, t("cli.doctor.section.checks")];
  for (const check of checks) {
    lines.push(`  ${markOf(check.status)} ${check.message}`);
    if (check.fix !== undefined) lines.push(`         ${t("cli.errors.fixLabel")} ${check.fix}`);
  }
  lines.push(t("cli.doctor.section.search"));
  lines.push(`  ${search.provider}`);
  lines.push(`  ${search.recommended}`);
  if (search.assumedDefaults) {
    lines.push(t("cli.doctor.search.assumedDefaults"));
  }
  if (web !== undefined) {
    lines.push(t("cli.doctor.section.web"));
    lines.push(...webBlockOf(web));
  }
  return `${lines.join("\n")}\n`;
}

export async function runDoctor(ctx: CommandContext, command: DoctorCommand): Promise<ExitCode> {
  const { io } = ctx;
  const connected: Result<EngineHandle, Failure> = await connectOrReportQuiet(ctx);
  let checks: DoctorCheck[] = [];
  let binaries: HostBinaryReport | null = null;
  let web: ToolsWebView | undefined;
  let code: ExitCode = EXIT.ok;
  if (connected.ok) {
    const handle = connected.value;
    try {
      const engine = await engineChecks(handle);
      checks = [...engine.checks];
      binaries = engine.binaries;
      // 필수 바이너리를 쓸 수 없으면 환경 문제로 끝낸다(HS-69). 선택 바이너리만 빠진 것은 경고다
      if (binaries?.ready === false) code = EXIT.environment;
      web = await webProvidersOf(handle);
    } finally {
      await handle.shutdown("user");
    }
  } else {
    checks = [...failureChecks(connected.error)];
    code = connected.error.code;
  }
  checks.push(terminalCheck(io, ctx.global.color));
  const search = describeSearch(web, web === undefined);
  if (command.output === "json") {
    await io.stdout(
      `${JSON.stringify({ version: CLI_VERSION, checks, binaries, search, web: web ?? null }, null, 2)}\n`,
    );
  } else {
    await io.stdout(formatDoctor(CLI_VERSION, checks, search, web));
  }
  return code;
}
