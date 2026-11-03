import { err, type Result } from "@fresnel/contracts";
import type { AskCard, AskRequest } from "@fresnel/contracts/extensions";
import type {
  DevkitError,
  LinkResult,
  PackInput,
  PackResult,
  ReplayInput,
  ReplayReport,
} from "@fresnel/contracts/services";

// L3.authoring.spec §3.3 `replay`, §4.1 package 단계, §9 A-4·A-5. 그룹 `authoring`의 drive와 도구가 부르는 함수다.
// 사람 확인(`ask`)은 drive 원시 `loop.ask`를 그대로 넘겨 받는다. 확인이 `yes`가 아니면 파일을 쓰는 호출을 하지 않는다.

/** `loop.ask`의 모양. 답은 질문 id → 선택 id 목록이다 */
export type Ask = (request: AskRequest) => Promise<
  | {
      readonly status: "answered";
      readonly answer: Readonly<Record<string, { readonly selected: readonly string[] }>>;
    }
  | { readonly status: "denied" }
>;

const CONFIRM_QUESTION = "confirm";
const CONFIRM_YES = "yes";
const CONFIRM_NO = "no";

function cardOf(text: string): AskCard {
  return {
    questions: [
      {
        id: CONFIRM_QUESTION,
        text,
        options: [
          { id: CONFIRM_YES, label: "Yes", recommended: true },
          { id: CONFIRM_NO, label: "No" },
        ],
        multiSelect: false,
        allowFreeText: false,
      },
    ],
  };
}

async function confirmed(ask: Ask, requestId: string, text: string): Promise<boolean> {
  const outcome = await ask({ requestId, card: cardOf(text) });
  return (
    outcome.status === "answered" &&
    outcome.answer[CONFIRM_QUESTION]?.selected.includes(CONFIRM_YES) === true
  );
}

export interface ReleaseDevkit {
  pack(input: PackInput): Promise<Result<PackResult, DevkitError>>;
  link(input: { readonly source: string }): Promise<Result<LinkResult, DevkitError>>;
}

/** 묶기 전에 확인을 받는다. 거절이면 `denied`이고 `pack`을 부르지 않는다(파일 쓰기 0) */
export async function packWithConfirmation(
  devkit: ReleaseDevkit,
  ask: Ask,
  input: PackInput,
): Promise<Result<PackResult, DevkitError>> {
  const yes = await confirmed(ask, `authoring:package:${input.dir}`, `Package ${input.dir}?`);
  if (!yes) return err({ kind: "denied", message: "packaging was not confirmed" });
  return devkit.pack(input);
}

/** 설치(연결) 전에 확인을 받는다. 거절이면 `denied`이고 `link`를 부르지 않는다 */
export async function installWithConfirmation(
  devkit: ReleaseDevkit,
  ask: Ask,
  source: string,
): Promise<Result<LinkResult, DevkitError>> {
  const yes = await confirmed(ask, `authoring:install:${source}`, `Install ${source}?`);
  if (!yes) return err({ kind: "denied", message: "installing was not confirmed" });
  return devkit.link({ source });
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
