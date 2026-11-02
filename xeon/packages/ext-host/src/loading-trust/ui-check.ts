// Plugin UI 검사(X.loading-trust.spec §4.3.4, ADR-0021 §3.2~§3.6). 매니페스트 `ui`의 화면 파일(native)과 Plugin App 선언(app)을
// LoaderFs로 실제 확인하고, 항목마다 상태(`ok`, `invalid`, `disabled`)와 진단을 정한다. 항목 하나의 오류는 그 항목만 바꾸고
// 확장의 로드는 막지 않는다(실패 격리). 매니페스트 모양 오류는 `validateUi`가 이미 매니페스트 거부로 잡으므로 여기서 다시 보지 않는다.
import { join } from "node:path";
import { attemptAsync, err, ok, parseJson, type Result } from "@fresnel/contracts";
import {
  BRIDGE_VERSION,
  isEntryInsideRoot,
  validateUiTree,
  type AppDecl,
  type ExtensionName,
  type LoaderFs,
  type Placement,
  type UiContribution,
  type UiDecl,
  type UiMode,
  type UiNode,
} from "@fresnel/contracts/extensions";
import { eachInOrder } from "../primitives/sequence.ts";
import { kindOf, within } from "./app-files.ts";
import type { UiDiagnosticCode } from "./pipeline.ts";
import { satisfiesRange } from "./semver.ts";
import type { InstallSource } from "./trust/levels.ts";

/** 호스트가 싣는 위젯 카탈로그 버전(ADR-0021 §3.4.1, v1 초안). `ui.widgets` 범위가 이 값을 포함해야 native 화면을 그린다 */
export const HOST_WIDGETS_VERSION: string = "1.0.0";

/** 호스트 다리 API 버전. contracts의 `BRIDGE_VERSION`(정수 1)을 SemVer로 쓴다(ADR-0021 §3.4.2) */
export const HOST_BRIDGE_VERSION: string = `${String(BRIDGE_VERSION)}.0.0`;

/** 화면 JSON 파일 하나의 크기 상한(1 MiB). 넘으면 `ui_limit`다 */
export const UI_FILE_MAX_BYTES: number = 1_048_576;

/** 화면 앱 정책(`x.ui.apps`, `x.ui.allowProjectApps`). 기본은 앱을 쓰고, 프로젝트 확장의 앱은 막는다 */
export interface UiPolicy {
  readonly apps: boolean;
  readonly allowProjectApps: boolean;
}

export const DEFAULT_UI_POLICY: UiPolicy = { apps: true, allowProjectApps: false };

/** 항목 하나의 진단. `severity`는 `LoadDiagnostic`과 같은 값 집합이다 */
export interface UiIssue {
  readonly severity: "error" | "warning" | "info";
  readonly code: UiDiagnosticCode;
  /** 매니페스트 위치(`/ui/items/<i>/...`). 화면 트리 안의 위치는 `#` 뒤에 JSON Pointer로 붙인다 */
  readonly path: string;
  /** 사람이 읽는 문장. 파일 내용과 파서의 원문을 넣지 않는다 */
  readonly message: string;
}

/** 항목 상태. `disabled`는 정책이 막고 대체 화면도 없을 때다. 확장이 꺼졌는지는 확장의 상태가 나타낸다 */
type UiItemState = "ok" | "invalid" | "disabled";

export interface UiItemReport {
  readonly id: string;
  readonly placement: Placement;
  /** 실제로 그릴 모드. 앱이 금지되어 `fallback`을 쓰면 `native`다 */
  readonly mode: UiMode;
  readonly title: string;
  readonly state: UiItemState;
  /** 화면 트리. native 파일이나 fallback 파일이 트리 검사를 통과했을 때만 있다 */
  readonly tree?: UiNode;
  /** 선언한 앱. 모드가 `app`이면 상태와 상관없이 있다 */
  readonly app?: AppDecl;
  readonly issues: readonly UiIssue[];
}

/** `ExtensionLoader.uiEntries()`가 돌려주는 항목. 확장 이름을 덧붙인다 */
export interface UiEntryReport extends UiItemReport {
  readonly extension: ExtensionName;
}

export interface UiCheckInput {
  /** 검사할 매니페스트의 `ui`. 매니페스트 검사를 통과한 값이다 */
  readonly ui: UiDecl;
  /** 확장 루트 절대 경로. 후보의 `root`와 같다 */
  readonly root: string;
  readonly fs: LoaderFs;
  /** 설치 위치. `project`이면 프로젝트 확장이라 앱 정책의 `allowProjectApps`를 본다 */
  readonly source: InstallSource;
  readonly policy: UiPolicy;
  readonly hostWidgetsVersion: string;
  readonly hostBridgeVersion: string;
}

interface Ctx {
  readonly root: string;
  /** 확장 루트의 실제 경로. 풀 수 없으면 null이고 모든 경로 검사가 실패한다 */
  readonly rootReal: string | null;
  readonly fs: LoaderFs;
  readonly source: InstallSource;
  readonly policy: UiPolicy;
  readonly widgets: string | undefined;
  readonly widgetsOk: boolean;
  readonly hostWidgetsVersion: string;
  readonly bridgeVersion: string;
}

interface Head {
  readonly id: string;
  readonly placement: Placement;
  readonly title: string;
}

interface TreeRead {
  readonly tree?: UiNode;
  readonly issues: readonly UiIssue[];
}

function issueOf(
  severity: UiIssue["severity"],
  code: UiDiagnosticCode,
  path: string,
  message: string,
): UiIssue {
  return { severity, code, path, message };
}

function stateOf(issues: readonly UiIssue[]): UiItemState {
  return issues.some((issue) => issue.severity === "error") ? "invalid" : "ok";
}

/** 확장 루트 안의 실제 경로를 구한다. 모양이 틀리거나, 없거나, 종류가 다르거나, 밖을 가리키면 진단 하나를 돌려준다 */
async function resolveInside(
  ctx: Ctx,
  relative: string,
  at: string,
  want: "file" | "dir",
): Promise<Result<string, UiIssue>> {
  if (!isEntryInsideRoot(relative)) {
    return err(issueOf("error", "ui_path_invalid", at, `${relative} must be inside the extension`));
  }
  if (ctx.rootReal === null) {
    return err(issueOf("error", "ui_file_missing", at, "the extension folder cannot be resolved"));
  }
  const declared = join(ctx.root, relative);
  const present = await attemptAsync(() => ctx.fs.exists(declared));
  if (!present.ok) return err(issueOf("error", "ui_file_missing", at, `cannot check ${relative}`));
  if (!present.value)
    return err(issueOf("error", "ui_file_missing", at, `${relative} does not exist`));
  const real = await attemptAsync(() => ctx.fs.realpath(declared));
  if (!real.ok) return err(issueOf("error", "ui_file_missing", at, `cannot resolve ${relative}`));
  if (!within(real.value, ctx.rootReal)) {
    return err(
      issueOf("error", "ui_path_invalid", at, `${relative} resolves outside the extension`),
    );
  }
  const kind = await kindOf(ctx.fs, real.value);
  if (kind === undefined) {
    return err(issueOf("error", "ui_file_missing", at, `${relative} does not exist`));
  }
  if (kind !== want) {
    const noun = want === "dir" ? "folder" : "file";
    return err(issueOf("error", "ui_file_missing", at, `${relative} is not a ${noun}`));
  }
  return ok(real.value);
}

/** 화면 트리 파일 하나를 읽어 검사한다. native 파일과 fallback 파일이 같은 길을 쓴다 */
async function readTree(ctx: Ctx, relative: string, at: string): Promise<TreeRead> {
  const place = await resolveInside(ctx, relative, at, "file");
  if (!place.ok) return { issues: [place.error] };
  const read = await attemptAsync(() => ctx.fs.readText(place.value));
  if (!read.ok) {
    return { issues: [issueOf("error", "ui_file_missing", at, `cannot read ${relative}`)] };
  }
  if (read.value === null) {
    return { issues: [issueOf("error", "ui_file_missing", at, `${relative} does not exist`)] };
  }
  // LoaderFs에는 크기를 묻는 함수가 없어 다 읽은 뒤에 잰다. 읽기 자체의 상한은 포트가 생기면 둔다
  if (new TextEncoder().encode(read.value).byteLength > UI_FILE_MAX_BYTES) {
    return {
      issues: [
        issueOf("error", "ui_limit", at, `${relative} is larger than ${UI_FILE_MAX_BYTES} bytes`),
      ],
    };
  }
  const text = read.value.startsWith("﻿") ? read.value.slice(1) : read.value;
  const json = parseJson(text);
  if (!json.ok)
    return { issues: [issueOf("error", "ui_invalid", at, `${relative} is not valid JSON`)] };
  const checked = validateUiTree(json.value);
  if (!checked.ok) {
    return {
      issues: checked.issues.map((found) =>
        issueOf(
          "error",
          found.code,
          found.path === "" ? at : `${at}#${found.path}`,
          `${relative}: ${found.message}`,
        ),
      ),
    };
  }
  return { tree: checked.tree, issues: [] };
}

/** 화면 트리를 읽은 결과와 앞에 붙은 진단으로 native 항목 보고를 만든다. native로 그리는 항목은 위젯 범위도 본다 */
function nativeReport(
  ctx: Ctx,
  head: Head,
  read: TreeRead,
  lead: readonly UiIssue[],
): UiItemReport {
  const issues: UiIssue[] = [...lead, ...read.issues];
  if (!ctx.widgetsOk) {
    issues.push(
      issueOf(
        "error",
        "widgets_unsupported",
        "/ui/widgets",
        `ui.widgets "${ctx.widgets ?? ""}" does not include host widgets ${ctx.hostWidgetsVersion}`,
      ),
    );
  }
  return {
    ...head,
    mode: "native",
    state: stateOf(issues),
    ...(read.tree === undefined ? {} : { tree: read.tree }),
    issues,
  };
}

async function nativeItem(
  ctx: Ctx,
  head: Head,
  file: string | undefined,
  at: string,
): Promise<UiItemReport> {
  if (file === undefined) {
    return nativeReport(ctx, head, { issues: [] }, [
      issueOf("error", "ui_invalid", `${at}/file`, "a native view requires file"),
    ]);
  }
  return nativeReport(ctx, head, await readTree(ctx, file, `${at}/file`), []);
}

/** 정책이 앱을 막는 이유. 막지 않으면 undefined다 */
function deniedReason(ctx: Ctx): string | undefined {
  if (!ctx.policy.apps) return "x.ui.apps is off";
  if (ctx.source === "project" && !ctx.policy.allowProjectApps) {
    return "a project extension needs x.ui.allowProjectApps";
  }
  return undefined;
}

/** app root가 확장 안의 폴더인지, app.entry가 그 안의 파일인지 본다 */
async function appFileIssues(ctx: Ctx, app: AppDecl, at: string): Promise<readonly UiIssue[]> {
  const root = await resolveInside(ctx, app.root, `${at}/app/root`, "dir");
  if (!root.ok) return [root.error];
  const entry = await resolveInside(ctx, join(app.root, app.entry), `${at}/app/entry`, "file");
  return entry.ok ? [] : [entry.error];
}

async function appItem(
  ctx: Ctx,
  head: Head,
  item: UiContribution,
  at: string,
): Promise<UiItemReport> {
  const app = item.app;
  if (app === undefined) {
    return {
      ...head,
      mode: "app",
      state: "invalid",
      issues: [issueOf("error", "ui_invalid", `${at}/app`, "an app view requires app")],
    };
  }
  // 정책이 막으면 앱 파일은 쓰지 않으므로 보지 않는다. 대체 화면이 있으면 그것을 native로 그린다
  const denied = deniedReason(ctx);
  if (denied !== undefined) {
    if (item.fallback === undefined) {
      return {
        ...head,
        mode: "app",
        state: "disabled",
        app,
        issues: [
          issueOf(
            "warning",
            "ui_mode_not_allowed",
            `${at}/mode`,
            `app view is not allowed (${denied}) and has no fallback`,
          ),
        ],
      };
    }
    return nativeReport(ctx, head, await readTree(ctx, item.fallback, `${at}/fallback`), [
      issueOf(
        "info",
        "ui_mode_not_allowed",
        `${at}/mode`,
        `app view is not allowed (${denied}); the fallback tree is served`,
      ),
    ]);
  }
  const issues: UiIssue[] = [...(await appFileIssues(ctx, app, at))];
  if (!satisfiesRange(ctx.bridgeVersion, app.bridge)) {
    issues.push(
      issueOf(
        "error",
        "bridge_unsupported",
        `${at}/app/bridge`,
        `app bridge ${app.bridge} does not include host bridge ${ctx.bridgeVersion}`,
      ),
    );
  }
  return { ...head, mode: "app", state: stateOf(issues), app, issues };
}

function checkItem(ctx: Ctx, item: UiContribution, index: number): Promise<UiItemReport> {
  const at = `/ui/items/${index}`;
  const head: Head = { id: item.id, placement: item.placement, title: item.title };
  // command는 화면이 없어 파일과 앱을 보지 않는다
  if (item.placement === "command") {
    return Promise.resolve({ ...head, mode: item.mode ?? "native", state: "ok", issues: [] });
  }
  if (item.mode === "app") return appItem(ctx, head, item, at);
  return nativeItem(ctx, head, item.file, at);
}

/**
 * 매니페스트 `ui` 하나를 검사해 항목마다 보고를 만든다(X.loading-trust.spec §4.3.4). 입력은 매니페스트 검사를 통과한 값이고,
 * 파일 접근은 `fs`만 쓴다. 던지지 않는다: fs 호출이 던지면 그 항목의 진단이 된다
 */
export async function checkUiDecl(input: UiCheckInput): Promise<readonly UiItemReport[]> {
  const rootReal = await attemptAsync(() => input.fs.realpath(input.root));
  const widgetsOk =
    input.ui.widgets === undefined || satisfiesRange(input.hostWidgetsVersion, input.ui.widgets);
  const ctx: Ctx = {
    root: input.root,
    rootReal: rootReal.ok ? rootReal.value : null,
    fs: input.fs,
    source: input.source,
    policy: input.policy,
    widgets: input.ui.widgets,
    widgetsOk,
    hostWidgetsVersion: input.hostWidgetsVersion,
    bridgeVersion: input.hostBridgeVersion,
  };
  const reports: UiItemReport[] = [];
  const indexed = input.ui.items.map((item, index) => ({ item, index }));
  await eachInOrder(indexed, async ({ item, index }) => {
    reports.push(await checkItem(ctx, item, index));
    return "continue";
  });
  return reports;
}
