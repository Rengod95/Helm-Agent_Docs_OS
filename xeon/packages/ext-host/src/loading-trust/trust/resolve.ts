// Forked from earendil-works/pi packages/coding-agent/src/core/project-trust.ts
// at cdaf6c227d4718a72b59ccd02152c9614df44cfc (pi 1.1.0). MIT License, Copyright (c) 2025 Mario Zechner. See LICENSE.pi.
// Changes: see docs/xeon/X/loading-trust/spec.md §4.7.1, §4.7.3 and PATCHES.md.
import { dirname } from "node:path";
import { attemptAsync } from "@xeon/contracts";
import type {
  LoaderFs,
  TrustChoice,
  TrustPrompter,
  TrustPromptRequest,
} from "@xeon/contracts/extensions";
import type { LoaderMode } from "./levels.ts";
import { findTrustRequiringResources } from "./resources.ts";
import {
  trustOptions,
  type ProjectTrustStore,
  type TrustStoreError,
  type TrustVerdict,
} from "./store.ts";

/** 판정이 어디서 나왔는가 */
export type TrustVia =
  | "override"
  | "notRequired"
  | "point"
  | "store"
  | "sessionMemory"
  | "default"
  | "prompt"
  | "headless"
  | "corruptStore";

export interface ProjectTrustResult {
  readonly projectRoot: string;
  /** 신뢰 필요 자원이 있었는가 */
  readonly required: boolean;
  readonly trusted: boolean;
  readonly verdict: TrustVerdict;
  readonly via: TrustVia;
  /** 찾은 신뢰 필요 자원(프로젝트 루트 기준 상대 경로) */
  readonly resources: readonly string[];
  /** 결정을 저장하려다 실패했다(손상된 저장 파일 등). 결정 자체는 유효하다. 호출자가 `trust_store_corrupt` 진단을 남긴다 */
  readonly storeError?: TrustStoreError;
}

export interface ResolveProjectTrustInput {
  readonly projectRoot: string;
  readonly mode: LoaderMode;
  readonly trustOverride?: boolean;
  readonly defaultProjectTrust: "ask" | "always" | "never";
  readonly store: ProjectTrustStore;
  readonly fs: LoaderFs;
  readonly homeDir: string;
  readonly prompter?: TrustPrompter;
  /** project_trust 지점 디스패치. X.primitives의 디스패처를 감싼 함수. 첫 결정이 없으면 undefined */
  readonly emitProjectTrust: (
    cwd: string,
    signal: AbortSignal,
  ) => Promise<{ readonly trusted: "yes" | "no"; readonly remember?: boolean } | undefined>;
  /** 이번 호스트 프로세스 동안만 유지하는 결정. 키는 정규화한 프로젝트 루트다 */
  readonly sessionMemory: Map<string, "allow" | "deny">;
  readonly signal: AbortSignal;
}

function outcome(
  base: Pick<ProjectTrustResult, "projectRoot" | "required" | "resources">,
  verdict: TrustVerdict,
  via: TrustVia,
  storeError?: TrustStoreError,
): ProjectTrustResult {
  const result = { ...base, trusted: verdict === "allow", verdict, via };
  return storeError === undefined ? result : { ...result, storeError };
}

function parentOf(root: string): string | null {
  const parent = dirname(root);
  return parent === root ? null : parent;
}

function sameChoice(a: TrustChoice, b: TrustChoice): boolean {
  return a.kind === b.kind && a.verdict === b.verdict;
}

/**
 * 프로젝트 신뢰를 정한다(X.loading-trust.spec §4.7.3). 순서는 pi `resolveProjectTrusted`와 같고 세션 기억(3번),
 * 저장 파일 손상(5번), 비대화형 불신(7번)을 더했다. `session.trust.before` 핸들러 예외는 불신이다(F fail-closed).
 * 불신은 `deny`(명시)와 `undecided`(결정 없음, 저장하지 않음)로 나눈다
 */
// XEON-PATCH: decision-order
export async function resolveProjectTrust(
  input: ResolveProjectTrustInput,
): Promise<ProjectTrustResult> {
  const projectRoot = await input.store.canonical(input.projectRoot);
  const resources = await findTrustRequiringResources(input.fs, projectRoot, input.homeDir);
  const base = { projectRoot, required: resources.length > 0, resources };

  // 1. 일회 지정은 저장하지 않는다
  if (input.trustOverride !== undefined) {
    return outcome(base, input.trustOverride ? "allow" : "deny", "override");
  }
  // 2. 신뢰가 필요한 자원이 없으면 판정하지 않는다
  if (!base.required) return outcome(base, "allow", "notRequired");

  // 3. 이번 호스트 프로세스의 세션 기억
  const remembered = input.sessionMemory.get(projectRoot);
  if (remembered !== undefined) return outcome(base, remembered, "sessionMemory");

  // 4. project_trust 지점. 발화 자체가 던져도 불신이다
  // XEON-PATCH: point-fail-closed
  const emitted = await attemptAsync(() => input.emitProjectTrust(projectRoot, input.signal));
  if (!emitted.ok) return outcome(base, "deny", "point");
  const decision = emitted.value;
  if (decision !== undefined) {
    const verdict = decision.trusted === "yes" ? "allow" : "deny";
    if (decision.remember === true) {
      const saved = await input.store.setMany([{ path: projectRoot, verdict, via: "point" }]);
      return outcome(base, verdict, "point", saved.ok ? undefined : saved.error);
    }
    return outcome(base, verdict, "point");
  }

  // 5. 저장소. 손상이면 프롬프트 없이 불신으로 간다(6번의 always/never는 여전히 적용)
  const looked = await input.store.lookup(projectRoot);
  if (looked.kind === "found") return outcome(base, looked.verdict, "store");

  // 6. 기본 정책
  if (input.defaultProjectTrust === "always") return outcome(base, "allow", "default");
  if (input.defaultProjectTrust === "never") return outcome(base, "deny", "default");

  // XEON-PATCH: corrupt-store-no-prompt
  if (looked.kind === "corrupt") {
    return outcome(base, "undecided", "corruptStore", { kind: "corrupt", reason: looked.reason });
  }

  // 7. 프롬프트를 띄울 수 없다
  // XEON-PATCH: prompter-port
  const prompter = input.prompter;
  if (input.mode === "headless" || prompter === undefined) {
    return outcome(base, "undecided", "headless");
  }

  // 8. 프롬프트. 닫거나 취소하면 저장하지 않고 불신이다
  const parent = parentOf(projectRoot);
  const options = trustOptions(projectRoot, parent);
  const request: TrustPromptRequest = { projectRoot, parent, resources, options };
  const asked = await attemptAsync(() => prompter.ask(request, input.signal));
  const choice = asked.ok ? asked.value : undefined;
  const selected =
    choice === undefined ? undefined : options.find((option) => sameChoice(option.choice, choice));
  if (selected === undefined) return outcome(base, "undecided", "prompt");

  const verdict = selected.choice.verdict;
  if (selected.choice.kind === "session") {
    input.sessionMemory.set(projectRoot, verdict);
    return outcome(base, verdict, "prompt");
  }
  const saved = await input.store.setMany(selected.updates);
  return outcome(base, verdict, "prompt", saved.ok ? undefined : saved.error);
}
