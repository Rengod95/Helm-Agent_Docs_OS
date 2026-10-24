// src/state/engine/describe.ts
import { assertNever } from "@xeon/contracts";
import type { EngineState } from "../../transport/ipc.ts";
import type { MirrorInput, VolatileFact } from "./input.ts";
import type { ApplyNote } from "./reduce.ts";

/** journal에 들어갈 수 있는 입력 이름. 내용 문자열은 이 유니온에 맞지 않아 컴파일 오류가 된다 */
type InputName =
  | MirrorInput["type"]
  | `subscribed:${"cursor" | "head"}`
  | `chunk:${VolatileFact["type"]}`
  | `engine:${EngineState["kind"]}`;

export type InputLabel = { readonly input: InputName; readonly seq: number | null };

/** journal에 남길 필드를 고르는 허용 목록. 새 입력 종류는 여기서 이름과 seq만 고른다 */
export function describeInput(input: MirrorInput): InputLabel {
  switch (input.type) {
    case "batch":
      return { input: "batch", seq: input.to };
    case "subscribed":
      return { input: `subscribed:${input.from}`, seq: input.start };
    case "chunk":
      return { input: `chunk:${input.fact.type}`, seq: null };
    case "transcript":
      return { input: "transcript", seq: input.asOfSeq };
    case "engine":
      return { input: `engine:${input.state.kind}`, seq: null };
    case "connecting":
    case "ended":
    case "out_of_range":
    case "subscribe_failed":
    case "threads":
    case "transcript_opening":
    case "transcript_closed":
    case "approvals":
    case "threads_failed":
    case "transcript_failed":
      return { input: input.type, seq: null };
    default:
      return assertNever(input, "describeInput");
  }
}

/**
 * journalStage에 넘기는 기록 정책. 정상 적용된 휘발 조각은 기록하지 않는다.
 * 델타가 초당 수십 건이라 1,000칸이 20초면 차고, 그러면 구멍·재설정 같은 중요한 항목이 밀려난다.
 * 적용된 조각 수는 커밋 단위 flush 항목의 count가 센다. stale·duplicate 조각은 이상 징후라 남긴다.
 */
export function journalLabel(input: MirrorInput, note: ApplyNote): InputLabel | null {
  return input.type === "chunk" && note === "applied" ? null : describeInput(input);
}
