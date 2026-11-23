// 멤버 떼기와 플러그인 합치기의 엔진 호출(m6Mb, AGE-33). 그리지 않는다.
// 떼기 `ext.members.detach`, 합치기 `ext.members.merge`가 새 폴더를 쓰면, 그 폴더로 드래프트를 만들어 리뷰에 낸다
// (`plugin.draft.create { dir: outDir }` 다음 `pluginReview.submitDraft`). 원본 폴더와 원래 플러그인은 그대로다.
// 리뷰로 내기가 실패해도 새 폴더는 이미 쓰였으므로 성공으로 돌려주고 그 실패를 따로 싣는다.
// 프로필 계획(AGE-72): 리뷰 항목에 시작한 자리의 프로필(`originProfileId`)과 `profilePlan`을 싣는다. 승인 때 엔진이 프로필을 바꾼다.
// 떼기에서 남는 구성원이 있으면 새 플러그인을 리뷰로 낸 뒤 원래 묶음 폴더에서 그 구성원을 빼고, 그 새 판도 리뷰에 낸다.
import type { MessageId } from "@fresnel/client/i18n";
import type { Result } from "@fresnel/contracts";
import type { MembersDetachInput, MembersMergeInput } from "@fresnel/contracts/services";
import type { HostConnection, ProfilePlan } from "@fresnel/contracts/wire";
import { useCallback, useMemo } from "react";
import { useCommands, type CommandError } from "../../commands.ts";
import { submitDirForReview, useOpenReview, type ReviewSubmitOptions } from "./members-source.ts";
import {
  detachPlanOf,
  extensionNameOf,
  splitFailureText,
  splitNotesOf,
  swapOutOf,
  type SplitNote,
} from "./split-model.ts";

/** 엔진을 한 번 부르는 자리(`pluginUi.withConnection`): 연결에 callback을 돌리고 결과를 `Result`로 받는다 */
type EngineRun = <T>(
  work: (connection: HostConnection) => Promise<T>,
) => Promise<Result<T, CommandError>>;

/** 합치기·떼기를 시작한 자리의 프로필 맥락. 캔버스는 열린 프로필 id, 플러그인 목록·상세와 구성원 탭은 null이다 */
export interface SplitContext {
  readonly profileId: string | null;
}

export type SplitOutcome =
  | {
      readonly ok: true;
      readonly name: string;
      readonly outDir: string;
      /** 리뷰 항목 id. 리뷰로 내지 못했으면 null이고 `sendFailed`가 그 까닭이다 */
      readonly itemId: string | null;
      readonly sendFailed: MessageId | null;
      readonly notes: readonly SplitNote[];
      /** 떼기에서 원래 묶음 폴더의 새 판을 리뷰에 낸 항목 id. 낼 일이 없었거나 못 냈으면 null */
      readonly bundleItemId: string | null;
      /** 원래 묶음의 새 판을 내지 못한 까닭. 새 플러그인의 제출은 되돌리지 않는다 */
      readonly bundleFailed: MessageId | null;
    }
  | { readonly ok: false; readonly text: MessageId };

type Sent = Extract<SplitOutcome, { readonly ok: true }>;

export interface SplitActions {
  /** `context`가 있으면 리뷰 항목에 그 프로필을 기본 대상으로 싣는다. 없으면 프로필 맥락이 없다 */
  readonly detach: (input: MembersDetachInput, context?: SplitContext) => Promise<SplitOutcome>;
  readonly merge: (input: MembersMergeInput, context?: SplitContext) => Promise<SplitOutcome>;
  /** 플러그인마다 원본 폴더(`plugin.get`의 `source.path`). 원본 폴더가 없거나 읽지 못한 이름은 빠진다 */
  readonly sources: (names: readonly string[]) => Promise<ReadonlyMap<string, string>>;
  readonly openReview: (itemId: string) => void;
}

/** 리뷰 제출 옵션. 프로필 맥락이 없으면 `originProfileId`를 싣지 않는다 */
function reviewOptionsOf(
  context: SplitContext | undefined,
  profilePlan: ProfilePlan,
): ReviewSubmitOptions {
  const profileId = context?.profileId ?? null;
  return profileId === null ? { profilePlan } : { originProfileId: profileId, profilePlan };
}

/** 새 폴더를 리뷰에 낸다. 쓰기는 이미 끝났으므로 리뷰가 실패해도 성공으로 돌려주고 그 까닭을 싣는다 */
async function sendNew(
  run: EngineRun,
  written: { readonly name: string; readonly outDir: string },
  notes: readonly SplitNote[],
  options: ReviewSubmitOptions,
): Promise<Sent> {
  const sent = await submitDirForReview(run, written.outDir, options);
  return {
    ok: true,
    name: written.name,
    outDir: written.outDir,
    itemId: sent.ok ? sent.itemId : null,
    sendFailed: sent.ok ? null : sent.text,
    notes,
    bundleItemId: null,
    bundleFailed: null,
  };
}

/** 합치기: 원래 플러그인들을 프로필에서 빼고 새 플러그인을 그 가장 앞선 자리에 든다 */
export async function mergeToReview(
  run: EngineRun,
  input: MembersMergeInput,
  context?: SplitContext,
): Promise<SplitOutcome> {
  const done = await run((c) =>
    c.request("ext.members.merge", { ...input, dirs: [...input.dirs] }),
  );
  if (!done.ok) return { ok: false, text: splitFailureText(done.error) };
  const profilePlan: ProfilePlan = {
    swapOut: swapOutOf(done.value.profileMove),
    placeAfter: null,
    driveFrom: null,
  };
  return sendNew(
    run,
    done.value,
    splitNotesOf(done.value.issues),
    reviewOptionsOf(context, profilePlan),
  );
}

/** 원래 묶음 폴더에서 떼어 낸 구성원을 빼고 그 새 판을 리뷰에 낸다. 실패는 알림으로만 싣는다 */
async function editBundle(
  run: EngineRun,
  dir: string,
  member: string,
): Promise<Pick<Sent, "bundleItemId" | "bundleFailed">> {
  const edited = await run((c) =>
    c.request("ext.members.edit", { dir, ops: [{ kind: "remove", id: member }] }),
  );
  if (!edited.ok) return { bundleItemId: null, bundleFailed: "desktop.craft.split.bundle.failed" };
  const sent = await submitDirForReview(run, dir);
  return sent.ok
    ? { bundleItemId: sent.itemId, bundleFailed: null }
    : { bundleItemId: null, bundleFailed: sent.text };
}

/**
 * 떼기: 떼기 전에 구성원을 읽어 프로필 계획을 정한다. 남는 구성원이 있으면 새 플러그인을 리뷰로 낸 뒤에만
 * 원래 묶음 폴더에서 그 구성원을 빼고 새 판을 낸다(새 플러그인이 못 나갔으면 원래 묶음은 그대로 둔다)
 */
export async function detachToReview(
  run: EngineRun,
  input: MembersDetachInput,
  context?: SplitContext,
): Promise<SplitOutcome> {
  const read = await run((c) => c.request("ext.members.read", { dir: input.dir }));
  if (!read.ok) return { ok: false, text: splitFailureText(read.error) };
  const done = await run((c) => c.request("ext.members.detach", input));
  if (!done.ok) return { ok: false, text: splitFailureText(done.error) };
  const plan = detachPlanOf(
    read.value.members,
    input.member,
    extensionNameOf(done.value.profileMove.from),
  );
  const sent = await sendNew(
    run,
    done.value,
    splitNotesOf(done.value.issues),
    reviewOptionsOf(context, plan.profilePlan),
  );
  if (!plan.bundleStays) return sent;
  const bundle: Pick<Sent, "bundleItemId" | "bundleFailed"> =
    sent.itemId === null
      ? { bundleItemId: null, bundleFailed: "desktop.craft.split.bundle.notSent" }
      : await editBundle(run, input.dir, input.member);
  return { ...sent, ...bundle };
}

export function useSplitActions(): SplitActions {
  const commands = useCommands();
  const openReview = useOpenReview();
  const pluginUi = commands.pluginUi;
  const run = useCallback(
    <T>(work: (connection: HostConnection) => Promise<T>) => pluginUi.withConnection(work),
    [pluginUi],
  );
  const detach = useCallback(
    (input: MembersDetachInput, context?: SplitContext) => detachToReview(run, input, context),
    [run],
  );
  const merge = useCallback(
    (input: MembersMergeInput, context?: SplitContext) => mergeToReview(run, input, context),
    [run],
  );
  const sources = useCallback(
    async (names: readonly string[]): Promise<ReadonlyMap<string, string>> => {
      const got = await Promise.all(
        names.map(async (name) => {
          const read = await run((c) => c.request("plugin.get", { name }));
          const path = read.ok ? (read.value.source?.path ?? null) : null;
          return [name, path] as const;
        }),
      );
      const out = new Map<string, string>();
      for (const [name, path] of got) if (path !== null) out.set(name, path);
      return out;
    },
    [run],
  );
  return useMemo(
    () => ({ detach, merge, sources, openReview }),
    [detach, merge, sources, openReview],
  );
}
