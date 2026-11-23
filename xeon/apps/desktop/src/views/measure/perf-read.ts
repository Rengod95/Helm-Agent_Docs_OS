// 플러그인 상세 측정 탭의 읽기: 대화의 최근 Turn(상한 `PERF_TURNS_MAX`개)을 읽어 한 플러그인의 부담 줄을 낸다.
// 옛 성능 측정 화면의 첫 화면 읽기(`loadPerf`)는 화면과 함께 지웠다(AGE-69). 일부만 실패하면 읽은 만큼 쓰고, 전부 실패하면 오류다.
import { perfViewOf, type BurdenRowVM, type PerfTurnInput } from "@fresnel/client/workbench";
import { err, ok, type Result } from "@fresnel/contracts";
import type { Commands, CommandError } from "../commands.ts";

/** 한 번에 읽는 Turn 수. 가장 최근 것부터 */
const PERF_TURNS_MAX = 20;

/** 확장 하나의 부담 읽기 결과. `perfViewOf`의 `burden`과 같은 원천과 계산이다 */
export type OwnerBurden =
  /** 계측이 꺼져 있다 */
  | { readonly kind: "off" }
  /** 읽을 대화나 Turn이 없다 */
  | { readonly kind: "empty" }
  /** 읽은 Turn `turns`개 가운데 이 확장의 줄. 읽은 Turn에 이 확장이 없으면 `row`는 null이다 */
  | { readonly kind: "ready"; readonly turns: number; readonly row: BurdenRowVM | null };

/** 대화의 최근 Turn(상한 `PERF_TURNS_MAX`개)을 읽어 `owner` 확장의 부담 줄을 낸다. 일별 집계는 읽지 않는다 */
export async function loadOwnerBurden(
  commands: Pick<Commands, "measure">,
  threadId: string | null,
  turnIds: readonly string[],
  owner: string,
): Promise<Result<OwnerBurden, CommandError>> {
  if (threadId === null || turnIds.length === 0) return ok({ kind: "empty" });
  const recent = turnIds.slice(-PERF_TURNS_MAX);
  const got = await Promise.all(recent.map((id) => commands.measure.turn(threadId, id)));
  const read: PerfTurnInput[] = [];
  got.forEach((result, index) => {
    const turnId = recent[index];
    if (result.ok && turnId !== undefined) read.push({ turnId, result: result.value });
  });
  const failed = got.flatMap((result) => (result.ok ? [] : [result.error]));
  const firstError = failed[0];
  if (read.length === 0 && firstError !== undefined) return err(firstError);
  const state = perfViewOf([], read);
  if (state.kind !== "ready") return ok({ kind: state.kind });
  return ok({
    kind: "ready",
    turns: read.length,
    row: state.view.burden.find((row) => row.owner === owner) ?? null,
  });
}
