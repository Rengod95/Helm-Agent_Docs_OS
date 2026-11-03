// 순서 화면의 저장 결정. 한 훅 줄 안에서 핸들러를 옮긴 뒤 할 일을 정한다: 아무것도 안 함, 바로 저장, 확인 묻기.
// 포트 오류는 잡지 않고 올린다. 화면이 Result로 바꿔 줄 안에 알린다.
import {
  commitOrder,
  needsConfirm,
  nextOrderForKey,
  proposeOrder,
  type CommittedOrder,
  type HookOrderPort,
  type OrderWarning,
} from "@fresnel/client/workbench/canvas";
import { sameOrder } from "./strata-model.ts";

/** 한 번의 끌기·키 이동이 낳는 결과 */
export type ReorderStep =
  | { readonly k: "unchanged" }
  | { readonly k: "saved"; readonly hook: string; readonly committed: CommittedOrder }
  | {
      readonly k: "confirm";
      readonly hook: string;
      /** 확인 뒤 저장할 순서. 미리보기에 넣은 것과 같다 */
      readonly order: readonly string[];
      readonly warning: OrderWarning;
    };

/** 확인을 기다리는 제안. 화면이 모달로 보인다 */
export type ReorderConfirm = Extract<ReorderStep, { readonly k: "confirm" }>;

/**
 * 한 훅 줄의 순서를 `before`에서 `after`로 바꾸려 할 때.
 * 같으면 포트를 부르지 않는다. 경고가 없으면 미리보기 뒤 바로 저장한다. 경고가 있으면 저장하지 않고 확인을 돌려준다.
 */
export async function requestReorder(
  port: HookOrderPort,
  hook: string,
  before: readonly string[],
  after: readonly string[],
  nameOf: (registrationId: string) => string,
): Promise<ReorderStep> {
  if (sameOrder(before, after)) return { k: "unchanged" };
  // 미결: 미리보기의 `skips`에는 기본 순서에서 이미 앞이던 건너뜀도 들어 있을 수 있다(m4/order의
  // HooksOrderPreviewResult 주석). 그러면 현재 순서로도 미리보기를 불러 새로 생긴 것만 경고해야 한다.
  // 지금은 새 순서만 보므로 옛 건너뜀까지 경고가 뜰 수 있다. 호출 수가 바뀌므로 이 자리에서만 고친다.
  const proposal = await proposeOrder(port, hook, after, nameOf);
  if (needsConfirm(proposal.warning)) {
    return { k: "confirm", hook, order: [...after], warning: proposal.warning };
  }
  const committed = await commitOrder(port, hook, [...after]);
  return { k: "saved", hook, committed };
}

/** 확인을 받은 뒤의 저장. 미리보기와 같은 순서를 쓴다 */
export function saveConfirmed(
  port: HookOrderPort,
  confirm: ReorderConfirm,
): Promise<CommittedOrder> {
  return commitOrder(port, confirm.hook, [...confirm.order]);
}

/**
 * Alt+←·→로 핸들러를 한 칸 옮긴 순서. Alt가 없거나 화살표가 아니거나 끝에서 더 못 가면 null이다.
 * null이면 화면은 아무것도 하지 않는다(기본 동작을 막지도 않는다).
 */
export function keyReorder(
  key: { readonly key: string; readonly altKey: boolean },
  order: readonly string[],
  id: string,
): string[] | null {
  if (!key.altKey) return null;
  const dir = keyDirection(key.key);
  if (dir === null) return null;
  const next = nextOrderForKey(order, id, dir);
  return sameOrder(next, order) ? null : next;
}

function keyDirection(key: string): "left" | "right" | null {
  if (key === "ArrowLeft") return "left";
  if (key === "ArrowRight") return "right";
  return null;
}
