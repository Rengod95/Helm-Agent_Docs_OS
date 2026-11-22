import { randomUUID } from "node:crypto";
import {
  OVERLAY_LIMIT,
  wireError,
  type TestRunStartResult,
  type WireHandler,
} from "@fresnel/contracts/wire";
import { draftVersionIdOf } from "@fresnel/ext-host";
import type { ConnectionHub } from "../../connection-types.ts";
import { CRAFT_PROFILE_ID, DEFAULT_PROFILE_ID } from "../../assembly/m4/profile-defaults.ts";
import { draftRecordOf, encodeTestRunDrafts } from "../../assembly/measure/test-run-marks.ts";
import type { Engine } from "../../types.ts";
import { claimWrite } from "../owner.ts";
import { markTestRun, wireErrorOfProfile } from "../m4/profile-test-run.ts";
import { wireErrorOfPluginFailure } from "./plugins.ts";
import { wireErrorOfOverlay } from "../turn.ts";

// M5c §4.8.1 `testRun.start`: 기준 프로필과 초안으로 Test run 대화를 하나 만든다. 대화는 `thread.create { testRun }`과 같은 길로 만들고,
// 표지의 묶음 id(`runGroupId`)를 더한다. 초안은 대화를 만들기 전에 검사하고 싣는다(덧씌우기와 같은 검사와 싣기, §4.3.8). 싣지 못하면
// `overlay.draftUnavailable`로 거절하고 대화를 만들지 않는다. 싣은 초안은 만든 대화에 묶고, 대화를 만들지 못하면 붙잡음을 풀어 내린다.

export function createTestRunHandlers(
  engine: Engine,
  hub: () => ConnectionHub,
): {
  readonly "testRun.start": WireHandler<"testRun.start">;
} {
  const { threads, plugins, testRunDrafts } = engine.ports;
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
      // 저장된 프로필이 이미 가리키던, 지금은 이 기기에 없는 플러그인(기본 프로필이 처음 준 것을 사용자가 지운 경우 포함)은
      // 오류가 아니라 경고다. 건너뛰고 시작하고 건너뛴 이름은 결과에 싣는다 [결정: 2026-11-20, 사용자, AGE-34; 2026-11-18, AGE-51].
      // 그 밖의 오류는 그대로 `profile.invalid`다
      const errors = checked.value.issues.filter((issue) => issue.severity === "error");
      if (errors.length > 0) throw wireErrorOfProfile({ kind: "invalid", issues: errors });
      const skippedPlugins = [
        ...new Set(
          checked.value.issues.flatMap((issue) =>
            issue.code === "plugin_unknown" && issue.plugin !== undefined ? [issue.plugin] : [],
          ),
        ),
      ];
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
      // 초안은 대화를 만들기 전에 싣는다. 못 싣으면 아무것도 만들지 않는다(§4.8.1 1, 5)
      const prepared = await testRunDrafts.prepare(params.drafts);
      if (!prepared.ok)
        throw wireErrorOfOverlay(prepared.error, (event, fields) =>
          engine.ports.log.error(event, fields),
        );
      const { marks, unhold } = prepared.value;

      const runGroupId = params.runGroupId ?? `trg-${randomUUID()}`;
      let created: Awaited<ReturnType<typeof threads.create>>;
      try {
        // 작업 폴더를 주지 않으면 `thread.create`와 같이 기본 폴더 아래 대화별 폴더를 쓴다(§4.4.5)
        created = await threads.create({
          ...(params.workspace === undefined
            ? { defaultFolder: true }
            : { workspace: params.workspace }),
          testRun: true,
          profileId: baseProfileId,
        });
      } catch (caught) {
        // 대화를 만들지 못했다. 싣은 초안은 아무도 쓰지 않으므로 붙잡음을 풀어 내린다
        unhold();
        throw caught;
      }
      // 싣은 초안을 대화에 묶는다. 묶은 뒤 대화가 참조로 쥔다(§4.8.1 2). 승인 `auto`는 그 대화의 드래프트 카드를 없앤다(항목 10)
      const approval = params.draftApproval === "auto" ? "auto" : undefined;
      await testRunDrafts.bind(created.threadId, [prepared.value], approval);
      await claimWrite(engine, hub(), context.connectionId, created.threadId);
      // 열기 훅의 대화 폴더는 쓰기 소유를 얻은 뒤, 첫 턴 전에 정한다(H-7). `thread.create`와 같은 순서다
      await threads.applyOpenWorkspace(created.threadId);
      // 기록에는 검토본의 이름과 초안 id, 내용 해시를 남긴다(되살릴 때 같은 판인지 본다)
      markTestRun(
        profiles,
        created.threadId,
        baseProfileId,
        runGroupId,
        encodeTestRunDrafts(marks.map(draftRecordOf), approval),
      );
      return {
        threadId: created.threadId,
        profileId: baseProfileId,
        drafts: marks.map((mark) => ({
          plugin: mark.replaces,
          draftId: mark.draftId,
          versionId: draftVersionIdOf(mark),
        })),
        runGroupId,
        skippedPlugins,
      };
    },
  };
}
