// 순서 화면의 저장 결정. 한 훅 줄 안에서 핸들러를 옮긴 뒤 할 일을 정한다: 아무것도 안 함, 바로 저장, 확인 묻기.
// 포트의 실패는 `Result`의 err 값으로 온다. 이 흐름은 그 값을 그대로 돌려주고, 실패 뒤에는 저장을 부르지 않는다. 화면이 줄 안에 알린다.
import {
  commitOrder,
  needsConfirm,
  nextOrderForKey,
  proposeOrder,
  readOrders,
  type CommittedOrder,
  type HookOrderPort,
  type HookOrderState,
  type OrderPortError,
  type OrderWarning,
} from "@fresnel/client/workbench/canvas";
import { ok, type Result } from "@fresnel/contracts";
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
 * 포트가 err를 돌려주면 그 값을 그대로 돌려주고, 그 뒤 호출은 하지 않는다.
 */
export async function requestReorder(
  port: HookOrderPort,
  hook: string,
  before: readonly string[],
  after: readonly string[],
  nameOf: (registrationId: string) => string,
): Promise<Result<ReorderStep, OrderPortError>> {
  if (sameOrder(before, after)) return ok({ k: "unchanged" });
  // 미결: 미리보기의 `skips`에는 기본 순서에서 이미 앞이던 건너뜀도 들어 있을 수 있다(m4/order의
  // HooksOrderPreviewResult 주석). 그러면 현재 순서로도 미리보기를 불러 새로 생긴 것만 경고해야 한다.
  // 지금은 새 순서만 보므로 옛 건너뜀까지 경고가 뜰 수 있다. 호출 수가 바뀌므로 이 자리에서만 고친다.
  const proposal = await proposeOrder(port, hook, after, nameOf);
  if (!proposal.ok) return proposal;
  if (needsConfirm(proposal.value.warning)) {
    return ok({ k: "confirm", hook, order: [...after], warning: proposal.value.warning });
  }
  const committed = await commitOrder(port, hook, [...after]);
  if (!committed.ok) return committed;
  return ok({ k: "saved", hook, committed: committed.value });
}

/** 확인을 받은 뒤의 저장. 미리보기와 같은 순서를 쓴다. 포트가 err를 돌려주면 그 값을 그대로 돌려준다 */
export function saveConfirmed(
  port: HookOrderPort,
  confirm: ReorderConfirm,
): Promise<Result<CommittedOrder, OrderPortError>> {
  return commitOrder(port, confirm.hook, [...confirm.order]);
}

/**
 * 저장 순서가 지금 적용돼 있고 핸들러가 둘 이상인 훅마다, 그 적용 순서의 미리보기 경고를 모은다.
 * 적용 전(pending)의 훅은 뺀다. 그때 적용 순서는 저장 순서가 아니라 예전 것이라 경고가 엉뚱해진다.
 * 미리보기는 저장하지 않는다. 포트가 err를 돌려주면 그 값을 그대로 돌려준다.
 */
export async function warningsOf(
  port: HookOrderPort,
  orders: Readonly<Record<string, HookOrderState>>,
  nameOf: (registrationId: string) => string,
): Promise<Result<Record<string, OrderWarning>, OrderPortError>> {
  const checked = Object.entries(orders).filter(
    ([, s]) => !s.pending && s.saved.length > 0 && s.applied.length >= 2,
  );
  const proposals = await Promise.all(
    checked.map(async ([hook, s]) => ({
      hook,
      proposal: await proposeOrder(port, hook, s.applied, nameOf),
    })),
  );
  const out: Record<string, OrderWarning> = {};
  for (const { hook, proposal } of proposals) {
    if (!proposal.ok) return proposal;
    out[hook] = proposal.value.warning;
  }
  return ok(out);
}

/** 화면이 한 번에 넣는 값: 훅별 저장 상태와 적용 중 순서의 줄 경고 */
export interface OrderView {
  readonly orders: Readonly<Record<string, HookOrderState>>;
  readonly warnings: Readonly<Record<string, OrderWarning>>;
}

/** 저장 순서를 읽고 그 줄 경고까지 모은다. 어느 쪽이든 err면 그 값을 그대로 돌려준다 */
export async function readOrderView(
  port: HookOrderPort,
  nameOf: (registrationId: string) => string,
): Promise<Result<OrderView, OrderPortError>> {
  const orders = await readOrders(port);
  if (!orders.ok) return orders;
  const warnings = await warningsOf(port, orders.value, nameOf);
  if (!warnings.ok) return warnings;
  return ok({ orders: orders.value, warnings: warnings.value });
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
