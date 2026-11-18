// 공개 이름 대조(X.primitives.plan §6 6번): src/index.ts의 export가 X.primitives.spec §3.1 표와 같은지 본다.
// 아직 만들지 않은 M2 이름은 표에 있어도 요구하지 않고, 표에 없는 이름은 아래 ADDITIONS에 이유와 함께 적은 것만 허용한다.
import { join } from "node:path";
import { expect, test } from "bun:test";
import * as entry from "../../src/index.ts";
import { readDoc } from "../support/docs.ts";

/** 문서 표에 없지만 조립 루트가 필요해 더한 이름 [제안]. 문서 반영을 요청한다 */
const ADDITIONS: ReadonlySet<string> = new Set([
  // 후보 실행기(isolation/candidate-runner.ts): 지난 턴에 돌려 보기의 후보를 격리 자식에서만 돌린다 [제안: 표 반영 요청]
  "createCandidateRunner",
  "CandidateCall",
  "CandidateHandler",
  "CandidateLaunch",
  "CandidateLaunchInfo",
  "CandidateOpenInput",
  "CandidateOutcome",
  "CandidateRunner",
  "CandidateRunnerDeps",
  "ReplayPoint",
  // 정렬 순위(F.operations §5.2 O-2): 호스트의 ext 읽기 포트가 면제 판정에 쓴다 [제안: 표 반영 요청]
  "tierRankOf",
  "TIER_RANK_CORE",
  "TIER_RANK_GUARD",
  "TIER_RANK_PLUGIN",
  "registrationToggleSourceOf",
  "RegistrationToggleSourceOf",
  "createRegistrationControl",
  "RegistrationToggleSource",
  "AdmitInfo",
  "LoaderSettingsSource",
  // 검토본 목록 포트(M5c §4.6, LoaderDeps.reviewedSource): 호스트의 PluginStore가 구현한다. X 표에 없어 여기에 적는다 [제안: X 표 반영 요청]
  "ReviewedSource",
  "ReviewedSourceDiagnostic",
  "ReviewedSourceEntry",
  "ReviewedSourceListing",
  // 초안 적재(ExtensionLoader.loadDraft, X.loading-trust.spec §4.9.8 [제안]): 호스트가 초안을 싣고 내부 이름으로 찾는다 [제안: X 표 반영 요청]
  "internalDraftName",
  // 초안의 판 식별자 `draft:<초안 id>:<해시 앞 8자>`(X.loading-trust §4.9.8 [제안]). 호스트의 테스트 실행 기록이 쓴다
  "draftVersionIdOf",
  "DraftInfo",
  "DraftLoadInput",
  "LoadDraftFailure",
  "ExtDiagnostic", // §3.2에 정의되어 있으나 §3.1 표에는 빠져 있다
  "createExtStorageManager", // 실제 저장소 위의 통합 시험(core-persistence)이 만든다
  "ExtStorageManager", // 조립 루트가 확장 제거의 미리 보기와 저장 테이블 지우기(extUi.storage)의 타입으로 쓴다
  // SDK 가상 모듈 등록: 설치본 재생기(`@fresnel/plugin-builder`의 runInstalledReplay)가 로더와 같은 목록을 같은 방식으로 등록한다 [제안]
  "registerSdkModules",
  "X_SDK_MODULES",
  // 플러그인 호스트 자식 쪽(isolation-protocol.ts): 자식 진입점, 자식이 만든 g에 hostOf를 붙이는 함수, 줄 프레이밍(엔진 쪽 감독이 같은 프레이밍을 쓴다) [제안: X 표 반영 요청]
  "bindHostApiForIsolation",
  "runPluginHost",
  "ImportEntry",
  "ImportEntryError",
  "PluginHostDeps",
  "PluginHostExit",
  "createFrameReader",
  "createFrameWriter",
  "FrameReader",
  "FrameReadError",
  "FrameReadResult",
  "FrameSink",
  "FrameWriteError",
  "FrameWriter",
  // 엔진 쪽 감독(M5b-1, isolation/supervisor.ts): 프로세스 띄우기·호출·취소·유휴 내리기·죽음 셈. 대리 등록(part 2)이 쓴다 [제안: X 표 반영 요청]
  "createPluginHostSupervisor",
  "PluginHostSupervisor",
  "PluginHostSupervisorDeps",
  "PluginHostStatus",
  "PluginHostStatusState",
  "PluginCallOptions",
  "RestartLimitInfo",
  "SupervisorError",
  "CallError",
  // 플러그인 프로세스 실패 오류(isolation/errors.ts): 대리 핸들러가 던지면 디스패처가 실패 이유로 쓴다 [제안]
  "PluginProcessError",
  "isPluginProcessError",
  // `engine.call` 라우터(isolation/engine-calls.ts): 호스트가 준 호출을 엔진의 등록 API로 옮긴다 [제안]
  "createEngineCallRouter",
  "EngineCallRouter",
  "EngineCallRouterDeps",
  // 격리 실효 판정(isolation/effective.ts, F5 2026-11-17): 로더가 설정·매니페스트·포트·drives로 엔진 안인지 격리인지 정한다 [제안]
  "effectiveIsolationOf",
  "InEngineReason",
  "IsolationDecision",
  "IsolationInput",
  "IsolationMode",
  "IsolationRefusal",
  // 격리 확장의 엔진 쪽 대리 등록(isolation/proxy-entry.ts, part 2): 자식의 선언을 실제 ExtHost에 등록한다 [제안]
  "createIsolatedEntry",
  "IsolatedEntryError",
  "IsolatedEntryCode",
  "IsolatedEntryDeps",
  "IsolationLaunch",
  "IsolationLaunchInfo",
  "LoaderIsolation",
  // 외부 훅 실행기(X.operations.spec §3.7, §4.7): 조립 루트가 연결한다
  "createHookRunner",
  "HOOK_SOURCES",
  "HOOK_SOURCE_TIER",
  "HOOK_UNIT_LOAD_INDEX_BASE",
  "hookIdOfUnit",
  "hookUnitName",
  "isHookUnitName",
  "mergeHookDefs",
  "startupFilter",
  "HookDef",
  "HookRunner",
  "HookRunnerDeps",
  "HookUnitSpec",
  "HookSource",
  "LoadedHook",
  "MergedHooks",
  // 저장된 신뢰 결정 한 줄(`ProjectTrustStore.list`). 조립 루트의 `trust.list`가 이 모양을 받는다 (F wire §3.3.1) [결정: 오케스트레이터 기본값, fxPT]
  "TrustListing",
]);

/** 이번 마일스톤(M0·M1)에 있어야 하는 값 이름 */
const REQUIRED_VALUES: readonly string[] = [
  "createExtHost",
  "DEFAULT_DISPATCH_POLICY",
  "LoopPortKey",
  "InputQueuePortKey",
  "RecordCommitPortKey",
  "ProjectorRegistryPortKey",
  "ScopedStorePortKey",
  "ProcessPortKey",
  "ExtHostPortKey",
  "capabilityServiceName",
  "providerServiceName",
  "isReservedServiceName",
  "hostOf",
  "PrimitiveError",
  "primitivesSettings",
  "TRUST_LEVELS",
  "SOURCE_TRUST",
  "TRUST_MATRIX",
  "LoadDiagnosticSchema",
  "createExtensionLoader",
  "LoadAbortError",
  "RESERVED_EXT_KEYS",
  "settingsFromManifest",
  "loadingTrustSettings",
  "TIERS",
  "storageOf",
  "extTablePrefix",
  "parseExtTableName",
  "createOperationsPolicy",
  "operationsSettings",
];

function namesInTable(markdown: string): ReadonlySet<string> {
  const start = markdown.indexOf("### 3.1 공개 API 목록");
  const end = markdown.indexOf("### 3.2 호스트 생성과 수명");
  const table = markdown.slice(start, end);
  const names = new Set<string>();
  for (const line of table.split("\n")) {
    if (!line.startsWith("|")) continue;
    const firstCell = line.split("|")[1] ?? "";
    for (const match of firstCell.matchAll(/`([A-Za-z_][A-Za-z0-9_]*)`/g)) {
      if (match[1] !== undefined) names.add(match[1]);
    }
  }
  return names;
}

async function exportedNames(): Promise<ReadonlySet<string>> {
  const source = await Bun.file(join(import.meta.dir, "../../src/index.ts")).text();
  const names = new Set<string>();
  for (const block of source.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    const body = (block[1] ?? "").replaceAll(/\/\/.*$/gm, "");
    for (const part of body.split(",")) {
      const name = part
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)
        .pop();
      if (name !== undefined && name.length > 0) names.add(name);
    }
  }
  return names;
}

test("public surface: exports are the spec §3.1 names plus the documented additions", async () => {
  const documented = namesInTable(await readDoc("X/primitives/spec.md"));
  const exported = await exportedNames();
  const unexpected = [...exported].filter((name) => !documented.has(name) && !ADDITIONS.has(name));
  expect(unexpected).toEqual([]);
  // 값으로 내보낸 이름은 런타임 모듈에도 있어야 한다
  const values = new Set(Object.keys(entry));
  for (const name of REQUIRED_VALUES) {
    expect(values.has(name)).toBe(true);
    expect(exported.has(name)).toBe(true);
  }
  for (const value of values) expect(exported.has(value)).toBe(true);
});

test("public surface: internal names do not leave the package", async () => {
  const exported = await exportedNames();
  for (const internal of [
    "RegistrationRuntime",
    "PostQueue",
    "LeaseBroker",
    "HandlerRegistry",
    "CordisBridge",
    "hostInternalsOf",
    "createStateService",
    "Context",
  ]) {
    expect(exported.has(internal)).toBe(false);
  }
});

test("vendored Cordis is imported only by the bridge", async () => {
  const importers: string[] = [];
  for await (const file of new Bun.Glob("src/**/*.ts").scan({
    cwd: join(import.meta.dir, "../.."),
  })) {
    const text = await Bun.file(join(import.meta.dir, "../..", file)).text();
    if (text.includes("@fresnel/vendor-cordis")) importers.push(file);
  }
  expect(importers).toEqual(["src/primitives/cordis-bridge.ts"]);
});
