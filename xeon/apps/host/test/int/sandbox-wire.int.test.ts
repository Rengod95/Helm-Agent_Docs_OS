import { expect, test } from "bun:test";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";
import { writeUserSettings } from "../fixtures/user-settings.ts";

// 샌드박스 자가 시험 wire(L0.sandbox §4.4, F.wire-settings §3.3.1): `sandbox.lastSelfTest`(마지막 보고서 읽기)와 `sandbox.selfTest`(지금 한 번 돌리기).
//
// 시험할 수 있는 길은 샌드박스를 끈 엔진뿐이다(`l0.sandbox.enabled: false`). 그때 자가 시험은 격리를 쓸 수 없다고 보고
// 명령을 하나도 실행하지 않고 여섯 항목을 `sandbox_unavailable`로 돌려준다(platform-sandbox `runOneSelfTest`). 격리를 쓸 수 없을 때는
// 보고서를 기록하지 않는다(L0.sandbox §4.4, 2026-11-11 사용자 결정). 그래서 마지막 보고서는 계속 없다.
//
// 샌드박스를 켠 자가 시험(실제 sandbox-exec·srt로 명령을 돌리고 example.com:80 연결을 시도하는 항목 포함)은 여기서 돌리지 않는다.
// 임시 홈에서도 외부로 나가는 실제 연결 시도가 들어 있어 안전하게 돌릴 가짜 경계가 없다(실제 엔진 시험 불가: 샌드박스를 켠 자가 시험).
// 마지막 보고서가 있는 경우의 읽기와 실제 항목의 통과·실패는 platform-sandbox의 시험(`self-test.test.ts`, `sandbox.int.test.ts`)이 맡는다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

/** L0.sandbox §4.4의 여섯 항목, 보고의 순서다 */
const SELF_TEST_ITEMS = [
  "protected_read_denied",
  "fresnel_data_write_denied",
  "network_denied",
  "workspace_write_allowed",
  "env_allowlist",
  "git_hooks_write_denied",
] as const;

realTest(
  "with the sandbox off, sandbox.lastSelfTest has no report and sandbox.selfTest reports every item as sandbox_unavailable without recording it",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, { "l0.sandbox.enabled": false });
    const host = await startInProcessHost({ devChecks: true, defaultGroups: false });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);
    try {
      expect(await connection.request("sandbox.lastSelfTest", {})).toEqual({ report: null });

      // 지금 한 번 돌린다: 명령은 실행되지 않고 보고서가 돌아온다
      const ran = await connection.request("sandbox.selfTest", {});
      expect(ran).toEqual({
        at: expect.any(Number),
        durationMs: 0,
        passed: false,
        items: SELF_TEST_ITEMS.map((id) => ({ id, passed: false, detail: "sandbox_unavailable" })),
      });

      // 격리를 쓸 수 없었으므로 기록하지 않는다: 읽기는 여전히 없다
      expect(await connection.request("sandbox.lastSelfTest", {})).toEqual({ report: null });
    } finally {
      await connection.close();
      await host.close();
      home.dispose();
    }
  },
  60_000,
);
