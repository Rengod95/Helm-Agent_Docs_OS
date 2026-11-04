// P-21 구성기의 순수 모델(L4.desktop-ux.spec §6.28). 매니페스트의 구성 선언을 블록 줄과 단계 줄로, 검사 이슈를 개수로,
// 프로필 편집 값을 `profile.put` 입력으로 바꾼다. 읽기만 하고 명령은 부르지 않는다.
import { parse } from "@fresnel/contracts";
import {
  CompositionDeclSchema,
  type CompositionDecl,
  type CompositionOp,
  type PhaseNodeKind,
} from "@fresnel/contracts/extensions";
import {
  PROFILE_ID_PATTERN,
  type Profile,
  type ProfileInput,
  type ProfileSetting,
  type WireManifestIssue,
} from "@fresnel/contracts/wire";

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 설치 그룹의 구성. 선언이 없으면 `none`이고 훅 이름으로 짐작하지 않는다(spec §6.28, C-7) */
export type GroupComposition =
  | { readonly kind: "none" }
  | { readonly kind: "declared"; readonly composition: CompositionDecl };

/** `ext.get`의 매니페스트에서 `group.composition`을 읽는다. 없거나 모양이 맞지 않으면 `none`이다 */
export function compositionOf(manifest: Readonly<Record<string, unknown>>): GroupComposition {
  const group = manifest["group"];
  if (!isRecord(group)) return { kind: "none" };
  const declared = group["composition"];
  if (declared === undefined) return { kind: "none" };
  const parsed = parse(CompositionDeclSchema, declared);
  return parsed.ok ? { kind: "declared", composition: parsed.value } : { kind: "none" };
}

export type ProductText = "record" | "post" | "state";

export interface BlockRow {
  readonly id: string;
  /** 제목이 없으면 id */
  readonly title: string;
  readonly stage: string;
  readonly op: CompositionOp;
  readonly summary: string | null;
  readonly hooks: readonly string[];
  readonly consumes: readonly string[];
  /** 블록이 내는 것. 공개 기록은 기록 종류를 뒤에 붙인다 */
  readonly produces: readonly { readonly kind: ProductText; readonly recordKind: string | null }[];
}

export function blockRowsOf(composition: CompositionDecl): readonly BlockRow[] {
  return composition.blocks.map((block) => ({
    id: block.id,
    title: block.title ?? block.id,
    stage: block.stage,
    op: block.op,
    summary: block.summary ?? null,
    hooks: block.hooks ?? [],
    consumes: block.consumes ?? [],
    produces: (block.produces ?? []).map((product) => ({
      kind: product.kind,
      recordKind: product.kind === "record" ? product.recordKind : null,
    })),
  }));
}

export interface IssueSummary {
  readonly errors: number;
  readonly warnings: number;
}

export function issueSummaryOf(issues: readonly WireManifestIssue[]): IssueSummary {
  let errors = 0;
  let warnings = 0;
  for (const issue of issues) {
    if (issue.severity === "error") errors += 1;
    else warnings += 1;
  }
  return { errors, warnings };
}

/** 블록 id → 그 블록의 이슈. `path`가 `blocks[<번호>]`로 시작하면 그 번호의 블록에 붙이고, 아니면 어느 블록에도 붙이지 않는다 */
export function issuesByBlockOf(
  composition: CompositionDecl,
  issues: readonly WireManifestIssue[],
): ReadonlyMap<string, readonly WireManifestIssue[]> {
  const byBlock = new Map<string, WireManifestIssue[]>();
  for (const issue of issues) {
    const match = /(?:^|\.)blocks\[(\d+)\]/.exec(issue.path);
    const index = match?.[1] === undefined ? -1 : Number(match[1]);
    const block = composition.blocks[index];
    if (block === undefined) continue;
    byBlock.set(block.id, [...(byBlock.get(block.id) ?? []), issue]);
  }
  return byBlock;
}

export interface PhaseRow {
  readonly id: string;
  readonly kind: PhaseNodeKind;
  readonly title: string;
  readonly initial: boolean;
  readonly out: readonly {
    readonly to: string;
    readonly event: string | null;
    readonly when: string | null;
  }[];
}

/** 단계 선언을 위에서 아래로 읽는 줄로 만든다. 선언이 없으면 null이다("단계 선언이 없어요") */
export function phaseRowsOf(composition: CompositionDecl): readonly PhaseRow[] | null {
  const phases = composition.phases;
  if (phases === undefined) return null;
  return phases.nodes.map((node) => ({
    id: node.id,
    kind: node.kind,
    title: node.title ?? node.id,
    initial: node.id === phases.initial,
    out: phases.transitions
      .filter((transition) => transition.from === node.id)
      .map((transition) => ({
        to: transition.to,
        event: transition.event ?? null,
        when: transition.when ?? null,
      })),
  }));
}

/** 프로필 편집 값. 확장마다 켜기·끄기·그대로 중 하나다. 그대로는 enable·disable 어디에도 넣지 않는다 */
export type ProfileChoice = "on" | "off" | "keep";

export interface ProfileDraft {
  readonly id: string;
  readonly title: string;
  readonly enable: readonly string[];
  readonly disable: readonly string[];
  /** 화면이 고치지 않는 값은 저장할 때 그대로 돌려 보낸다 */
  readonly settings: readonly ProfileSetting[];
  readonly driver: string | null;
  /** 저장된 프로필이면 그 `rev`, 새 프로필이면 null(`profile.put`의 `baseRev`) */
  readonly baseRev: number | null;
}

export function profileDraftOf(profile: Profile | null): ProfileDraft {
  if (profile === null) {
    return {
      id: "",
      title: "",
      enable: [],
      disable: [],
      settings: [],
      driver: null,
      baseRev: null,
    };
  }
  return {
    id: profile.id,
    title: profile.title,
    enable: profile.enable,
    disable: profile.disable,
    settings: profile.settings,
    driver: profile.driver,
    baseRev: profile.rev,
  };
}

export function choiceOf(draft: ProfileDraft, name: string): ProfileChoice {
  if (draft.enable.includes(name)) return "on";
  if (draft.disable.includes(name)) return "off";
  return "keep";
}

export function withChoice(draft: ProfileDraft, name: string, choice: ProfileChoice): ProfileDraft {
  const enable = draft.enable.filter((item) => item !== name);
  const disable = draft.disable.filter((item) => item !== name);
  return {
    ...draft,
    enable: choice === "on" ? [...enable, name] : enable,
    disable: choice === "off" ? [...disable, name] : disable,
  };
}

export type ProfileDraftProblem = "id" | "title";

/** 저장할 수 없는 까닭. 새 프로필이면 id 규칙도 본다(저장된 프로필의 id는 바꾸지 않는다) */
export function profileDraftProblemOf(draft: ProfileDraft): ProfileDraftProblem | null {
  if (draft.baseRev === null && !new RegExp(PROFILE_ID_PATTERN).test(draft.id)) return "id";
  if (draft.title.trim().length === 0) return "title";
  return null;
}

export function profileInputOf(draft: ProfileDraft): ProfileInput {
  return {
    id: draft.id,
    title: draft.title.trim(),
    enable: draft.enable.toSorted(),
    disable: draft.disable.toSorted(),
    settings: draft.settings,
    driver: draft.driver,
  };
}
