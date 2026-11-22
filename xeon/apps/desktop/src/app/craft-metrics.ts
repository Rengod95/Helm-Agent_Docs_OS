import { detach, err, ok, type Result } from "@fresnel/contracts";
import type { HostConnection } from "@fresnel/contracts/wire";
import { recentTurnRecords, watchTurnRecord, type TurnRecordFailure } from "@fresnel/client";
import type { CommandError, CraftMetricsCommands } from "../views/commands.ts";
import { errorOf } from "./command-error.ts";

// Craft 메트릭(C9)과 트레이스(C8) 화면이 부르는 wire(M5d §3.5, §3.8): 지표, 인사이트, 턴 기록과 그 구독.
// 다음 걸음 셋(테스트 챗 열기, 프로필에서 빼기, 인사이트 닫기)은 쓰기라 엔진 대상을 바꾸는 중이면 `switching`으로 거절한다(`withWrite`).

/** 엔진의 최소 표본 설정(호스트 `assemble.ts`의 `metricsSettingsOf`가 읽는 키) */
const MIN_SAMPLE_KEY = "x.operations.metrics.minSample";

type WithConnection = <T>(
  run: (connection: HostConnection) => Promise<T>,
) => Promise<Result<T, CommandError>>;

/**
 * 턴 기록 호출의 실패를 화면의 실패 갈래로 옮긴다. 응답을 못 받았으면 `failed`, 그 밖의 엔진 오류는 다른 명령과 같은 규칙(`errorOf`)이라
 * 메서드가 없는 엔진은 `unsupported`다(화면은 "아직 없어요"를 보인다)
 */
function commandErrorOf(failure: TurnRecordFailure): CommandError {
  if (failure.kind === "transport") return { kind: "failed" };
  if (failure.kind === "host") return errorOf(failure.error);
  return { kind: "rejected", code: null };
}

export function createCraftMetricsCommands(
  withConnection: WithConnection,
  withWrite: WithConnection,
): CraftMetricsCommands {
  return {
    catalog: () => withConnection((c) => c.request("metrics.catalog", {})),
    query: (params) => withConnection((c) => c.request("metrics.query", params)),
    findings: (params) => withConnection((c) => c.request("findings.list", params)),
    evidence: (findingId, cursor) =>
      withConnection((c) =>
        c.request("findings.evidence", cursor === null ? { findingId } : { findingId, cursor }),
      ),
    dismiss: async (findingId, until) => {
      const sent = await withWrite((c) =>
        c.request("findings.dismiss", until === null ? { findingId } : { findingId, until }),
      );
      return sent.ok ? ok(null) : sent;
    },
    profiles: () => withConnection((c) => c.request("profile.list", {})),
    plugin: (name) => withConnection((c) => c.request("plugin.get", { name })),
    turns: (params) => withConnection((c) => c.request("turnRecord.list", params)),
    recent: async (params) => {
      const got = await withConnection((c) => recentTurnRecords(c, params));
      if (!got.ok) return got;
      return got.value.ok ? ok(got.value.value) : err(commandErrorOf(got.value.error));
    },
    turn: (threadId, turnId) =>
      withConnection((c) => c.request("turnRecord.get", { threadId, turnId, detail: "full" })),
    watch: async (threadId, onDelta) => {
      const got = await withConnection((c) => watchTurnRecord(c, threadId, onDelta));
      if (!got.ok) return got;
      if (!got.value.ok) return err(commandErrorOf(got.value.error));
      const watching = got.value.value;
      return ok(() => {
        // 화면을 떠날 때 닫는다. 서버 쪽 해제가 실패해도 알림 수신은 이미 멈췄다
        detach(watching.unwatch(), () => {});
      });
    },
    openCraftChat: (params) => withWrite((c) => c.request("craftChat.open", params)),
    removeFromProfile: (profileId, plugin, baseRev, withDependents) =>
      withWrite((c) =>
        c.request(
          "profile.removePlugin",
          withDependents === true
            ? { id: profileId, plugin, baseRev, withDependents }
            : { id: profileId, plugin, baseRev },
        ),
      ),
    minSample: async () => {
      const got = await withConnection((c) =>
        c.request("settings.get", { keys: [MIN_SAMPLE_KEY] }),
      );
      if (!got.ok) return got;
      const value = got.value.settings.find((s) => s.key === MIN_SAMPLE_KEY)?.value;
      return ok(typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : null);
    },
  };
}
