import { randomUUID } from "node:crypto";
import {
  OVERLAY_LIMIT,
  wireError,
  type TestRunStartResult,
  type WireHandler,
} from "@fresnel/contracts/wire";
import type { ConnectionHub } from "../../connection-types.ts";
import { CRAFT_PROFILE_ID, DEFAULT_PROFILE_ID } from "../../assembly/m4/profile-defaults.ts";
import type { Engine } from "../../types.ts";
import { claimWrite } from "../owner.ts";
import { markTestRun, wireErrorOfProfile } from "../m4/profile-test-run.ts";
import { wireErrorOfPluginFailure } from "./plugins.ts";

// M5c §4.8.1 `testRun.start`: 기준 프로필로 Test run 대화를 하나 만든다. 대화는 `thread.create { testRun }`과 같은 길로 만들고,
// 표지의 묶음 id(`runGroupId`)를 더한다. 초안을 얹는 일은 격리 1단계(P1) 전에는 없으므로 초안이 하나라도 있으면
// `overlay.draftUnavailable`로 거절한다(덧씌우기와 같은 게이트, §4.3.8). 모든 검사는 대화를 만들기 전에 끝낸다.

export function createTestRunHandlers(
  engine: Engine,
  hub: () => ConnectionHub,
): {
  readonly "testRun.start": WireHandler<"testRun.start">;
} {
  const { threads, plugins } = engine.ports;
  const profiles = engine.ports.m4.profileTestRun;
  return {
    "testRun.start": async (params, context): Promise<TestRunStartResult> => {
      // 한도는 덧씌우기와 같다. 와이어 상한은 넉넉히 받고 처리기가 `overlay.limit`으로 답한다
      if (params.drafts.length > OVERLAY_LIMIT) throw wireError("overlay.limit");
      const baseProfileId = params.baseProfileId ?? DEFAULT_PROFILE_ID;
      // 숨은 `craft` 프로필은 기준이 될 수 없다(`thread.create`와 같다)
      if (baseProfileId === CRAFT_PROFILE_ID) {
        throw wireErrorOfProfile({ kind: "not_found", id: baseProfileId });
      }
      // 기준 프로필이 없으면 `profile.notFound`다. 저장된 값이 검증에서 오류가 나면 `profile.invalid`로 거절하고 대화를 만들지 않는다.
      // 저장된 프로필 레코드는 건드리지 않는다
      const checked = await profiles.preview({
        source: { kind: "stored", id: baseProfileId },
        threadId: undefined,
      });
      if (!checked.ok) throw wireErrorOfProfile(checked.error);
      const errors = checked.value.issues.filter((issue) => issue.severity === "error");
      if (errors.length > 0) throw wireErrorOfProfile({ kind: "invalid", issues: errors });
      // 초안은 그 플러그인의 초안 목록에 있어야 한다. 없으면 `draft.notFound`다
      const listings = await Promise.all(
        params.drafts.map(async (draft) => ({
          draft,
          listed: await plugins.draftList(draft.plugin),
        })),
      );
      for (const { draft, listed } of listings) {
        if (!listed.ok) throw wireErrorOfPluginFailure(listed.error);
        if (!listed.value.drafts.some((info) => info.draftId === draft.draftId)) {
          throw wireError("draft.notFound", { details: { id: draft.draftId } });
        }
      }
      if (params.drafts.length > 0) throw wireError("overlay.draftUnavailable");

      const runGroupId = params.runGroupId ?? `trg-${randomUUID()}`;
      // 작업 폴더를 주지 않으면 `thread.create`와 같이 기본 폴더 아래 대화별 폴더를 쓴다(§4.4.5)
      const created = await threads.create({
        ...(params.workspace === undefined
          ? { defaultFolder: true }
          : { workspace: params.workspace }),
        testRun: true,
        profileId: baseProfileId,
      });
      await claimWrite(engine, hub(), context.connectionId, created.threadId);
      // 열기 훅의 대화 폴더는 쓰기 소유를 얻은 뒤, 첫 턴 전에 정한다(H-7). `thread.create`와 같은 순서다
      await threads.applyOpenWorkspace(created.threadId);
      markTestRun(profiles, created.threadId, baseProfileId, runGroupId);
      return {
        threadId: created.threadId,
        profileId: baseProfileId,
        drafts: [],
        runGroupId,
      };
    },
  };
}
