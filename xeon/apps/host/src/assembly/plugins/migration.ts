import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { lstat, realpath } from "node:fs/promises";
import {
  assertNever,
  attemptAsync,
  Bug,
  err,
  ok,
  type Clock,
  type Logger,
  type Result,
} from "@fresnel/contracts";
import {
  PROFILE_ID_PATTERN,
  type ForeignFormatFound,
  type MigrationApplyResult,
  type MigrationChangedParams,
  type MigrationChoices,
  type MigrationDetectHarness,
  type MigrationDetectResult,
  type MigrationProfileProposal,
  type MigrationProgressParams,
  type MigrationProposalResult,
  type MigrationReportGetResult,
  type MigrationScanResult,
  type MigrationScanRoot,
} from "@fresnel/contracts/wire";
import {
  bundledRulesets,
  DEFAULT_SCAN_LIMITS,
  detectForeignFormats,
  foreignFormatNotice,
  propose,
  type Choices,
  type ForeignFormatMarker,
  type HarnessId,
  type MigrationScan,
  type ReportLine,
  type Ruleset,
  type ScanFs,
} from "@fresnel/plugin-migration";
import type { MigrationFailure, MigrationPort } from "../../handlers/m5/migration.ts";
import type { ProfileTestRunPort } from "../../handlers/m4/profile-test-run.ts";
import { collectInOrder } from "./in-order.ts";
import { createExistenceFs } from "./migration-fs.ts";
import {
  createMigrationScanner,
  type MigrationScanSource,
  type MigrationScanTuning,
} from "./migration-scan-child.ts";
import { createMigrationState, dismissKeyOf } from "./migration-state.ts";
import type { MigrationSubmitPort } from "./migration-submit.ts";

// 가져오기 서비스(migration.md §6.1~§6.3, §7.4, §7.5, §8.4 [제안]). 감지, 훑기, 제안, 적용, 보고서, 표지 숨기기를 맡는다.
// 라이브러리(`@fresnel/plugin-migration`)는 순수하다. 이 서비스는 읽기 전용 파일 포트(`migration-fs.ts`), 제출 포트, 프로필 저장소를 잇는다.
// 예상 가능한 실패는 `Result`로 돌려준다. 원문과 가린 전 값은 로그에 쓰지 않는다(경로 종류와 상태 코드만).
// 훑기 결과, 제안, 보고서는 서비스 메모리에 둔다(재시작하면 `migration.report.get`은 `notFound`다). 숨긴 표지만 상태 파일에 남는다.
// 훑기는 엔진 밖의 샌드박스 자식 프로세스(`migration-scan --stdio`)에서 돈다(`migration-scan-child.ts`, §7.4 [제안]). 엔진은 자식의 응답 줄을
// 검증해서만 받고, 원본 파일 내용을 읽거나 파싱하지 않는다. 감지는 존재만 보므로 엔진 안에 둔다.

/** 서비스가 기억하는 훑기, 제안, 보고서의 수 [제안]. 넘으면 가장 오래된 것부터 버린다 */
const KEPT_LIMIT = 32;

/**
 * 사용자 수준 지침의 공통 후보 프로필 이름(§6.3 Q12 [제안]). 식별자 값이라 한국어 문구를 두지 않는다. 화면은 `scope`로 제목을 고른다.
 * `createProfiles`로는 만들지 않는다(프로젝트 이름의 프로필만 만든다)
 */
const USER_COMMON_PROFILE_NAME = "user-common";

const PROFILE_ID = new RegExp(PROFILE_ID_PATTERN);

/** 작은 기억 상자. 넣을 때 상한을 넘으면 가장 먼저 넣은 것을 버린다 */
function keepLatest<V>(limit: number): {
  get(key: string): V | undefined;
  set(key: string, value: V): void;
} {
  const map = new Map<string, V>();
  return {
    get: (key) => map.get(key),
    set(key, value) {
      map.set(key, value);
      if (map.size <= limit) return;
      const oldest = map.keys().next();
      if (!oldest.done) map.delete(oldest.value);
    },
  };
}

/** 구독자 목록. 알림을 같은 순서로 보낸다 */
function listenersOf<T>(): {
  emit(value: T): void;
  subscribe(listener: (value: T) => void): () => void;
} {
  const listeners = new Set<(value: T) => void>();
  return {
    emit(value) {
      for (const listener of listeners) listener(value);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** 훑기 결과를 저장한 뒤 보는 제안 하나. 적용은 이 제안의 훑기를 다시 본다 */
interface StoredProposal {
  readonly scanId: string;
  readonly proposal: ReturnType<typeof propose>;
}

/** 보고서 하나. 적용 결과의 `reportId`로 다시 읽는다 */
interface StoredReport {
  readonly report: readonly ReportLine[];
  readonly rulesVersions: Readonly<Record<string, string>>;
}

/** 프로필 저장소. `profile.list`, `profile.put`이 쓰는 것과 같은 포트다 */
export type MigrationProfilePort = Pick<ProfileTestRunPort, "list" | "put">;

export interface MigrationServiceDeps {
  /** 홈 폴더의 절대 경로. 항목 경로를 `~/…`로 줄이고, 감지가 홈의 `.agents/skills`를 세지 않게 한다 */
  readonly homeDir: string;
  /** 호스트 상태 폴더(`migration-state.json`이 놓인다) */
  readonly stateDir: string;
  /** 제출 포트(`engine.ports.pluginMigration`). 승인 전의 초안과 검토 항목을 만든다 */
  readonly submitter: MigrationSubmitPort;
  readonly profiles: MigrationProfilePort;
  readonly clock: Clock;
  readonly log: Logger;
  /** 훑기 자식을 띄우는 원천(`fresnel.process`, `fresnel.sandbox`, 자기 실행, 스케줄러). 조립이 채운다 */
  readonly scanSource: MigrationScanSource;
  /** 훑기 자식의 기한과 응답 상한을 시험이 줄이는 값. 운영은 생략해 기본을 쓴다(§7.4 [제안]) */
  readonly scanTuning?: MigrationScanTuning;
  /**
   * 감지가 쓰는 읽기 포트. 기본은 존재만 보는 포트다. 시험이 읽기 호출을 세는 대역으로 바꾼다
   */
  readonly detectFs?: () => ScanFs;
}

/** 프로필 하나의 계획: 제안 이름과 만들 id */
interface ProfilePlan {
  readonly name: string;
  readonly id: string;
}

/** 감지 표지의 하네스를 wire 값으로 옮긴다. 표 데이터에 `agents-md` 행이 없으므로 그 값은 버그다 */
function detectHarnessOf(harness: HarnessId | "other"): MigrationDetectHarness {
  switch (harness) {
    case "claude-code":
      return "claude-code";
    case "agent-skills":
      return "agent-skills";
    case "other":
      return "other";
    case "agents-md":
      throw new Bug("migration.detect: the marker table has no agents-md row");
    default:
      return assertNever(harness, "detectHarnessOf");
  }
}

function foundOf(marker: ForeignFormatMarker): ForeignFormatFound {
  return {
    marker: marker.marker,
    harness: detectHarnessOf(marker.harness),
    engineReads: marker.engineReads,
    importable: marker.importable,
  };
}

/** 절대 경로의 정규 폴더. 없거나 폴더가 아니면 `root_invalid`다 */
async function canonicalDir(path: string): Promise<Result<string, MigrationFailure>> {
  if (!isAbsolute(path)) return err({ kind: "root_invalid" });
  const real = await attemptAsync(() => realpath(path));
  if (!real.ok) return err({ kind: "root_invalid" });
  const stat = await attemptAsync(() => lstat(real.value));
  if (!stat.ok || !stat.value.isDirectory()) return err({ kind: "root_invalid" });
  return ok(real.value);
}

/** 훑기 결과를 wire 응답으로 옮긴다. 값은 싣지 않고 `secretCount`만 싣는다 */
function scanResultOf(scanId: string, scan: MigrationScan): MigrationScanResult {
  return {
    scanId,
    summary: { itemCount: scan.items.length },
    items: scan.items.map((item) => ({
      itemId: item.itemId,
      harness: item.harness,
      kind: item.kind,
      scope: item.scope,
      path: item.path,
      bytes: item.bytes,
      secretCount: item.secrets.length,
    })),
    diagnostics: scan.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      path: diagnostic.path,
      message: diagnostic.message,
    })),
  };
}

/** 사용자 수준 지침이 든 플러그인들의 공통 후보. 보고 줄의 항목 범위가 사용자 것이고 종류가 지침인 것으로 모은다 */
function userCommonOf(report: readonly ReportLine[]): readonly MigrationProfileProposal[] {
  const names = new Set<string>();
  for (const line of report) {
    if (line.kind === "instruction" && line.source.scope === "user" && line.output !== undefined) {
      names.add(line.output.plugin);
    }
  }
  if (names.size === 0) return [];
  return [
    {
      name: USER_COMMON_PROFILE_NAME,
      pluginNames: [...names].toSorted(),
      scope: "user-common",
    },
  ];
}

/** 제안을 wire 응답으로 옮긴다. 프로젝트 범위 항목의 묶음은 프로젝트 이름의 프로필 제안이다 */
function proposalResultOf(
  proposalId: string,
  proposal: StoredProposal["proposal"],
): MigrationProposalResult {
  const projectProfiles = proposal.profileProposals.map((profile): MigrationProfileProposal => ({
    name: profile.profileName,
    pluginNames: [...profile.plugins],
    scope: "project",
  }));
  return {
    proposalId,
    plugins: proposal.plugins.map((plugin) => ({
      name: plugin.name,
      purpose: plugin.purpose,
      derivedFrom: [...plugin.derivedFrom],
    })),
    profileProposals: [...projectProfiles, ...userCommonOf(proposal.report)],
    questions: proposal.questions.map((question) => ({
      id: question.id,
      itemId: question.itemId,
      text: question.text,
      options: [...question.options],
    })),
    report: proposal.report,
  };
}

/** wire의 답을 라이브러리의 답으로 옮긴다. 없는 필드는 싣지 않는다(`exactOptionalPropertyTypes`) */
function choicesOf(wire: MigrationChoices | undefined): Choices {
  if (wire === undefined) return { answers: {} };
  return wire.existingPlugins === undefined
    ? { answers: wire.answers }
    : { answers: wire.answers, existingPlugins: wire.existingPlugins };
}

/**
 * 프로필 id. 프로필 id 형식(`PROFILE_ID_PATTERN`)에 맞는 소문자 조각을 쓰고, 맞지 않으면 이름의 해시로 정한다.
 * 같은 이름이면 같은 id다
 */
function profileIdOf(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  if (PROFILE_ID.test(slug)) return slug;
  return `project-${createHash("sha256").update(name).digest("hex").slice(0, 12)}`;
}

/** 번들 규칙. 패키지에 든 규칙이 스키마에 맞지 않으면 빌드가 잘못된 것이라 버그로 던진다 */
function rulesetsOf(): readonly Ruleset[] {
  const bundled = bundledRulesets();
  if (!bundled.ok) {
    // fresnel-disable-next-line fresnel/bug-for-expected -- 패키지에 든 규칙이 스키마에 맞지 않으면 빌드가 잘못된 것이라 코드 결함이다 (eng.typescript.guide TY-24)
    throw new Bug("migration: bundled rules do not match their schema", { cause: bundled.error });
  }
  return bundled.value;
}

/** 가져오기 서비스를 만든다. 실패는 값으로 돌려주고, 알림은 `onChanged`와 `onProgress`로 낸다 */
export function createMigrationService(deps: MigrationServiceDeps): MigrationPort {
  const { log } = deps;
  const rulesets = rulesetsOf();
  const state = createMigrationState({ stateDir: deps.stateDir, log });
  const detectFs = deps.detectFs ?? createExistenceFs;
  const scanner = createMigrationScanner(deps.scanSource, log, deps.scanTuning);
  const scans = keepLatest<MigrationScan>(KEPT_LIMIT);
  const proposals = keepLatest<StoredProposal>(KEPT_LIMIT);
  const reports = keepLatest<StoredReport>(KEPT_LIMIT);
  const changes = listenersOf<MigrationChangedParams>();
  const progress = listenersOf<MigrationProgressParams>();
  // 식별자는 시작 시각과 순번으로 만든다. 같은 프로세스에서 겹치지 않고, 시각과 난수를 직접 쓰지 않는다(TY-21)
  const epoch = deps.clock.now().toString(36);
  let sequence = 0;
  function newId(kind: "scan" | "proposal" | "report"): string {
    sequence += 1;
    return `${kind}-${epoch}-${sequence}`;
  }

  /** 감지 표지 가운데 숨기지 않은 것. 읽기 자체가 실패하면 실패를 준다 */
  async function visibleMarkers(
    root: string,
  ): Promise<Result<readonly ForeignFormatMarker[], MigrationFailure>> {
    const found = await attemptAsync(() =>
      detectForeignFormats({ fs: detectFs(), projectRoot: root, homeDir: deps.homeDir }),
    );
    if (!found.ok) {
      log.warn("migration.detect.failed", {});
      return err({ kind: "store", code: "detect" });
    }
    const hidden = await state.dismissedKeys();
    if (!hidden.ok) {
      // 숨김을 읽지 못하면 표지를 모두 보인다. 알림이 더 나오는 쪽이 안전하다
      log.warn("migration.state.unreadable", { code: hidden.error.code });
      return ok(found.value);
    }
    return ok(found.value.filter((marker) => !hidden.value.has(dismissKeyOf(root, marker.marker))));
  }

  /** 프로필 계획. 제안되지 않은 이름이나 이미 있는 id가 있으면 아무것도 만들지 않는다 */
  async function planProfiles(
    proposal: ReturnType<typeof propose>,
    names: readonly string[],
  ): Promise<Result<readonly ProfilePlan[], MigrationFailure>> {
    const wanted = [...new Set(names)];
    const proposed = new Set(proposal.profileProposals.map((profile) => profile.profileName));
    const unproposed = wanted.find((name) => !proposed.has(name));
    if (unproposed !== undefined) return err({ kind: "profile_not_proposed", name: unproposed });
    if (wanted.length === 0) return ok([]);
    const listed = await deps.profiles.list();
    if (!listed.ok) return err({ kind: "profile", failure: listed.error });
    const taken = new Set(listed.value.profiles.map((profile) => profile.id));
    const plans = wanted.map((name) => ({ name, id: profileIdOf(name) }));
    const clash = plans.find((plan) => taken.has(plan.id));
    if (clash !== undefined) return err({ kind: "name_conflict", name: clash.name });
    return ok(plans);
  }

  /**
   * 프로필 하나를 만든다. 프로필에는 아직 승인되지 않은 플러그인을 넣지 않는다: 프로필 검증이 대기 이름을 `plugin_not_reviewed`로
   * 막기 때문이다(§4.2.7). 빈 프로필을 만들고, 승인할 때 플러그인을 고른 프로필에 넣는다 [제안].
   */
  async function createProfile(
    plan: ProfilePlan,
  ): Promise<Result<{ readonly profileId: string; readonly name: string }, MigrationFailure>> {
    const put = await deps.profiles.put(
      { id: plan.id, title: plan.name, plugins: [], settings: [], startDrive: null },
      null,
    );
    if (put.ok) return ok({ profileId: plan.id, name: plan.name });
    if (put.error.kind === "conflict") return err({ kind: "name_conflict", name: plan.name });
    return err({ kind: "profile", failure: put.error });
  }

  return {
    async detect(workspace) {
      const root = await canonicalDir(workspace);
      if (!root.ok) return err(root.error);
      const markers = await visibleMarkers(root.value);
      if (!markers.ok) return err(markers.error);
      const result: MigrationDetectResult = {
        found: markers.value.map(foundOf),
        notice: foreignFormatNotice(markers.value) ?? null,
      };
      return ok(result);
    },

    async foreignFormatsOf(projectRoot) {
      const root = await canonicalDir(projectRoot);
      if (!root.ok) return undefined;
      const markers = await visibleMarkers(root.value);
      return markers.ok ? foreignFormatNotice(markers.value) : undefined;
    },

    async scan(roots) {
      const resolved = await collectInOrder(roots, async (root: MigrationScanRoot) => {
        const dir = await canonicalDir(root.path);
        if (!dir.ok) return err(dir.error);
        return ok([{ path: dir.value, scope: root.scope, label: root.label }]);
      });
      if (!resolved.ok) return err(resolved.error);
      const scanRootList = resolved.value;
      const scanId = newId("scan");
      // 훑기는 자식 프로세스에서 돈다. 진행 줄은 루트마다 온다(`migration.progress`)
      const outcome = await scanner.run({
        scanId,
        roots: scanRootList,
        homeDir: deps.homeDir,
        onProgress: (done, total) => {
          progress.emit({ scanId, done, total });
        },
      });
      if (!outcome.ok) {
        log.error("migration.scan.failed", { reason: outcome.error });
        return err({ kind: "scan_failed", reason: outcome.error });
      }
      const reply = outcome.value;
      if (reply.limitReached || reply.diagnostics.some((item) => item.code === "limit")) {
        log.warn("migration.scan.limit", { roots: scanRootList.length });
        return err({ kind: "scan_limit" });
      }
      const merged: MigrationScan = {
        roots: scanRootList,
        scanned: reply.scanned,
        items: reply.items,
        diagnostics: reply.diagnostics,
        limits: DEFAULT_SCAN_LIMITS,
      };
      scans.set(scanId, merged);
      changes.emit({ kind: "scan" });
      return ok(scanResultOf(scanId, merged));
    },

    proposal(scanId, choices) {
      const scan = scans.get(scanId);
      if (scan === undefined) return Promise.resolve(err({ kind: "not_found", id: scanId }));
      const proposal = propose(scan, rulesets, choicesOf(choices));
      const proposalId = newId("proposal");
      proposals.set(proposalId, { scanId, proposal });
      changes.emit({ kind: "proposal" });
      return Promise.resolve(ok(proposalResultOf(proposalId, proposal)));
    },

    async apply(proposalId, choices, createProfiles) {
      const stored = proposals.get(proposalId);
      if (stored === undefined) return err({ kind: "not_found", id: proposalId });
      const scan = scans.get(stored.scanId);
      if (scan === undefined) return err({ kind: "not_found", id: stored.scanId });
      // 적용은 답을 받아 다시 제안한다. 질문이 남아 있으면 아무것도 쓰지 않는다
      const planned = propose(scan, rulesets, choicesOf(choices));
      if (planned.questions.length > 0) return err({ kind: "questions_open", proposalId });
      const plans = await planProfiles(planned, createProfiles);
      if (!plans.ok) return err(plans.error);

      // 승인 전에는 아무것도 돌지 않는다. 제출은 초안과 검토 항목만 만든다
      const submitted = await deps.submitter.submitPlanned(planned.plugins);
      if (!submitted.ok) {
        const failure = submitted.error;
        if (failure.kind === "exists") return err({ kind: "name_conflict", name: failure.name });
        return err({ kind: "plugin", failure });
      }

      const created = await collectInOrder(plans.value, async (plan) => {
        const made = await createProfile(plan);
        if (!made.ok) return err(made.error);
        return ok([made.value]);
      });
      if (!created.ok) return err(created.error);

      const reportId = newId("report");
      reports.set(reportId, { report: planned.report, rulesVersions: planned.rulesVersions });
      changes.emit({ kind: "apply" });
      const result: MigrationApplyResult = {
        drafts: submitted.value.map((draft) => ({
          name: draft.name,
          draftId: draft.draftId,
          itemId: draft.itemId,
        })),
        profiles: created.value,
        reportId,
      };
      return ok(result);
    },

    reportGet(reportId) {
      const stored = reports.get(reportId);
      if (stored === undefined) return Promise.resolve(err({ kind: "not_found", id: reportId }));
      const result: MigrationReportGetResult = {
        report: stored.report,
        rulesVersions: stored.rulesVersions,
      };
      return Promise.resolve(ok(result));
    },

    async dismiss(root, marker) {
      const dir = await canonicalDir(root);
      if (!dir.ok) return err(dir.error);
      const saved = await state.dismiss({
        root: dir.value,
        marker,
        at: new Date(deps.clock.now()).toISOString(),
      });
      if (!saved.ok) {
        log.error("migration.dismiss.failed", { code: saved.error.code });
        return err({ kind: "store", code: saved.error.code });
      }
      changes.emit({ kind: "dismiss" });
      return ok(undefined);
    },

    onChanged: (listener) => changes.subscribe(listener),
    onProgress: (listener) => progress.subscribe(listener),
  };
}
