// 캔버스의 합치기, 의존으로 잇기, 떼기, 새로 만들기의 엔진 호출(cvMerge, AGE-72). 그리지 않는다.
// 합치기와 떼기는 플러그인 목록과 상세가 쓰는 길(`useSplitActions`: `ext.members.merge`·`ext.members.detach` → 드래프트 → 리뷰) 그대로이고,
// 의존은 의존 탭과 같은 길(`ext.dependencies.edit` → 드래프트 → 리뷰)이다. 리뷰를 건너뛰는 설치 길은 없다.
// 리뷰에 낸 합치기·떼기 결과의 항목 id를 기억해 두면 캔버스가 그 결과를 반투명 판으로 그린다(`store.ts`의 `readPending`).
// 캔버스에서 낸 합치기·떼기는 열린 프로필을 맥락으로 싣는다(승인 때 그 프로필에서 원래 것을 빼고 새 것을 넣는다, AGE-72).
import type { MessageId } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import type { HostConnection } from "@fresnel/contracts/wire";
import { useCallback, useEffect, useMemo } from "react";
import { depsEditFailureText } from "../../deps/deps-model.ts";
import { submitDirForReview } from "../../members/members-source.ts";
import { defaultDetachName, siblingDirOf } from "../../members/split-model.ts";
import {
  useSplitActions,
  type SplitActions,
  type SplitOutcome,
} from "../../members/split-source.ts";
import { useOpenTestChat } from "../../test-chat/use-test-chat.ts";
import { useCanvasEngine, useProfileCommands } from "../profile-source.ts";
import { memberPartsOf, track, type MergeFacts } from "./merge.ts";
import { readPending, startLive } from "./store.ts";

type LinkOutcome =
  | { readonly ok: true; readonly itemId: string | null }
  | { readonly ok: false; readonly text: MessageId };

export interface CanvasMergeActions {
  /** 합치기 상자에 줄 동작: 합친 결과를 리뷰에 내면 그 항목을 기억한다 */
  readonly split: SplitActions;
  /** 끌어온 것(`from`)이 놓인 것(`to`)에 기대게 한다(선택 의존). 원본 폴더의 매니페스트에 줄을 더하고 리뷰로 보낸다 */
  readonly link: (from: string, to: string, facts: MergeFacts) => Promise<LinkOutcome>;
  /** 멤버 판 하나를 새 플러그인으로 뗀다(이름과 폴더는 기본값, 원래 플러그인에 선택 의존). 결과를 리뷰에 내고 기억한다 */
  readonly detachMember: (plate: string, facts: MergeFacts) => Promise<SplitOutcome>;
  readonly openReview: (itemId: string) => void;
  /** 크래프트 테스트 챗에서 빌더로 새 플러그인 만들기를 시작한다 */
  readonly create: () => void;
}

/** `profileId`는 지금 캔버스에 열린 프로필이다(표본이나 불러오는 중이면 null). 합치기와 떼기의 리뷰 항목이 이 프로필을 기본 대상으로 싣는다 */
export function useCanvasMerge(profileId: string | null): CanvasMergeActions {
  const commands = useCanvasEngine();
  const profileCommands = useProfileCommands();
  const base = useSplitActions();
  const openTestChat = useOpenTestChat();
  const pluginUi = commands.pluginUi;
  const run = useCallback(
    <T>(work: (connection: HostConnection) => Promise<T>) => pluginUi.withConnection(work),
    [pluginUi],
  );

  // 리뷰가 바뀌면(승인, 버림, 돌려보냄, 새 항목) 목록과 반투명 판을 다시 읽는다: 승인되어 프로필에 들면 보통 판이 된다
  useEffect(
    () =>
      commands.pluginReview.onChanged(() => {
        detach(startLive(profileCommands), rethrow);
      }),
    [commands, profileCommands],
  );

  const remember = useCallback(
    (outcome: SplitOutcome): SplitOutcome => {
      if (outcome.ok && outcome.itemId !== null) {
        track(outcome.itemId);
        detach(readPending(profileCommands), rethrow);
      }
      return outcome;
    },
    [profileCommands],
  );

  const split = useMemo(
    (): SplitActions => ({
      ...base,
      merge: async (input) => remember(await base.merge(input, { profileId })),
      detach: async (input) => remember(await base.detach(input, { profileId })),
    }),
    [base, profileId, remember],
  );

  const link = useCallback(
    async (from: string, to: string, facts: MergeFacts): Promise<LinkOutcome> => {
      const dir = facts.sources.get(from);
      if (dir === undefined)
        return { ok: false, text: "desktop.craft.canvas.cvMerge.refuse.noSource" };
      const edited = await run((c) =>
        c.request("ext.dependencies.edit", {
          dir,
          ops: [{ kind: "add", dependency: { plugin: to, kind: "soft" } }],
        }),
      );
      if (!edited.ok) return { ok: false, text: depsEditFailureText(edited.error) };
      const sent = await submitDirForReview(run, dir);
      return sent.ok ? { ok: true, itemId: sent.itemId } : { ok: true, itemId: null };
    },
    [run],
  );

  const detachMember = useCallback(
    async (plate: string, facts: MergeFacts): Promise<SplitOutcome> => {
      const { root, member } = memberPartsOf(plate);
      const dir = facts.sources.get(root);
      if (dir === undefined)
        return { ok: false, text: "desktop.craft.canvas.cvMerge.refuse.noSource" };
      const name = defaultDetachName(root, member);
      return split.detach({
        dir,
        member,
        outDir: siblingDirOf(dir, name),
        name,
        keepDependency: true,
        dependencyKind: "soft",
      });
    },
    [split],
  );

  const create = useCallback((): void => {
    detach(openTestChat({ plugin: null, reuse: "new" }), rethrow);
  }, [openTestChat]);

  return useMemo(
    () => ({ split, link, detachMember, openReview: base.openReview, create }),
    [split, link, detachMember, base.openReview, create],
  );
}
