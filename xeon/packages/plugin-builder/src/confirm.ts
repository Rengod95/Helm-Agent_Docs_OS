import { parse, err, type Result } from "@fresnel/contracts";
import type { JsonValue } from "@fresnel/contracts/conversation";
import type { AskCard } from "@fresnel/contracts/extensions";
import { QuestionAnswerSchema } from "@fresnel/contracts/records";
import type { DevkitError, ReplayInput, ReplayReport } from "@fresnel/contracts/services";
import { createHash } from "node:crypto";

// L3.authoring.spec §4.1 package 단계, §9 A-4·A-5. 그룹 `authoring`의 drive와 도구가 쓴다.
// 묶기 앞 사람 확인은 drive가 `ask` 명령으로 낸다(drive-isolation.md §1.1). 이 파일은 질문 카드, 요청 id,
// 답을 읽는 규칙만 만든다. 답이 `yes`가 아니면 drive는 파일을 쓰는 호출(`pack`)을 하지 않는다.
// 옛 `release.ts`에서 설치 확인(`installConfirmation`)을 뺀 나머지다(M5c §7.7: 설치 경로 폐기).

const CONFIRM_QUESTION = "confirm";
const CONFIRM_YES = "yes";
const CONFIRM_NO = "no";

/** 예·아니요 질문 카드. 선택지는 `yes`·`no`다 */
export function confirmCard(text: string): AskCard {
  return {
    questions: [
      {
        id: CONFIRM_QUESTION,
        text,
        options: [
          { id: CONFIRM_YES, label: "예", recommended: true },
          { id: CONFIRM_NO, label: "아니요" },
        ],
        multiSelect: false,
        allowFreeText: false,
      },
    ],
  };
}

/** requestId는 64자 이하여야 한다. 경로는 짧은 지문으로 줄이고 `round`로 거절 뒤 다시 묻는 질문을 가른다 */
function requestIdOf(action: "package", target: string, round: number): string {
  const digest = createHash("sha256").update(target).digest("hex").slice(0, 12);
  return `authoring:${action}:${digest}:${String(round)}`;
}

/** 묶기 확인의 `ask` 명령 재료. 같은 `dir`과 `round`면 같은 요청 id다(같은 `ask`는 기록된 답을 돌려준다) */
export function packConfirmation(
  dir: string,
  round: number,
): { readonly requestId: string; readonly card: AskCard } {
  return {
    requestId: requestIdOf("package", dir, round),
    card: confirmCard(`다음 폴더를 묶을까요? ${dir}`),
  };
}

/** 질문 답 값이 `confirm`에서 `yes`를 골랐는가. 답 값이 질문 답의 모양이 아니면 `yes`가 아니다 */
export function confirmedYes(value: JsonValue | null): boolean {
  const answer = parse(QuestionAnswerSchema, value);
  return answer.ok && answer.value[CONFIRM_QUESTION]?.selected.includes(CONFIRM_YES) === true;
}

export interface ReplayRunner {
  (input: ReplayInput): Promise<Result<ReplayReport, DevkitError>>;
}

/** 개발 모드가 아니면 `dev_mode_required`다(A-5). 판정은 호출하는 쪽(호스트 한 곳)이 준다 */
export function replayInDevMode(
  devMode: boolean,
  run: ReplayRunner,
  input: ReplayInput,
): Promise<Result<ReplayReport, DevkitError>> {
  if (!devMode)
    return Promise.resolve(
      err({ kind: "dev_mode_required", message: "replay runs only in development mode" }),
    );
  return run(input);
}
