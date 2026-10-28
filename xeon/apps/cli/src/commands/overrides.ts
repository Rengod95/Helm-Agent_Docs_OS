import { err, ok, type Result } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import { WireError, type HostConnection } from "@xeon/contracts/wire";
import type { SessionOverride } from "../cli/command.ts";
import { failureOfCaught, failureOfWire, type Failure } from "../errors.ts";
import { EXIT } from "../exit-codes.ts";
import { interpretRaw } from "../settings-input.ts";

// L4.cli.spec §4.8 `--set key=value`. 대상 세션이 정해진 뒤 첫 turn.start 전에 settings.set { scope: "session", threadId }를
// 순서대로 부른다. 하나라도 실패하면 turn을 시작하지 않는다(사용법 오류 2).

/** 덮어쓰기를 차례로 적용한다. 앞 항목이 끝나야 다음을 보낸다: 순서가 의미다 */
export async function applyOverrides(
  connection: HostConnection,
  threadId: ThreadId,
  overrides: readonly SessionOverride[],
): Promise<Result<void, Failure>> {
  for (const override of overrides) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- 설정은 적은 순서대로 적용한다 (L4.cli.spec §4.8)
      await connection.request("settings.set", {
        key: override.key,
        value: interpretRaw(override.raw),
        scope: "session",
        threadId,
      });
    } catch (caught) {
      if (caught instanceof WireError && caught.data.kind === "jsonrpc.methodNotFound") {
        return err({
          message: "이 엔진은 아직 --set을 받을 수 없다 (settings.set이 없다)",
          fix: "엔진을 갱신하거나 설정 파일을 직접 고친다",
          code: EXIT.error,
        });
      }
      if (caught instanceof WireError) {
        const failure = failureOfWire(caught);
        return err({
          ...failure,
          message: `--set ${override.key}: ${failure.message}`,
          code: EXIT.usage,
        });
      }
      const failure = failureOfCaught(caught);
      if (failure === undefined) throw caught;
      return err(failure);
    }
  }
  return ok(undefined);
}
