// 순서 화면이 쓰는 호출 묶음. 미리보기는 저장하지 않고, 저장은 미리보기 뒤에 사용자가 확인했을 때만 부른다.
// 포트의 오류는 잡지 않고 그대로 올린다.
import type {
  HooksOrderGetResult,
  HooksOrderPreviewParams,
  HooksOrderPreviewResult,
  HooksOrderResetParams,
  HooksOrderResetResult,
  HooksOrderSetParams,
  HooksOrderSetResult,
} from "@fresnel/contracts/wire";
import { buildOrderWarning, type OrderWarning } from "./guard-warning.ts";

/** 순서 기능이 쓰는 wire 호출 넷. 전송 계층(클라이언트 연결)이 이것을 구현한다 */
export interface HookOrderPort {
  get(): Promise<HooksOrderGetResult>;
  set(params: HooksOrderSetParams): Promise<HooksOrderSetResult>;
  reset(params: HooksOrderResetParams): Promise<HooksOrderResetResult>;
  preview(params: HooksOrderPreviewParams): Promise<HooksOrderPreviewResult>;
}

export interface ProposedOrder {
  readonly warning: OrderWarning;
  /** 엔진이 돌려준 전체 순서(제안을 적용했을 때) */
  readonly order: readonly string[];
}

export interface CommittedOrder {
  readonly saved: readonly string[];
  readonly appliesAt: HooksOrderSetResult["appliesAt"];
}

export interface HookOrderState {
  readonly applied: readonly string[];
  readonly saved: readonly string[];
  readonly pending: boolean;
}

/** 저장 전 미리보기. set은 부르지 않는다 */
export async function proposeOrder(
  port: HookOrderPort,
  hook: string,
  order: readonly string[],
  nameOf: (registrationId: string) => string,
): Promise<ProposedOrder> {
  const preview = await port.preview({ hook, order });
  return { warning: buildOrderWarning(preview, nameOf), order: preview.order };
}

/** 확인이 끝난 순서를 저장한다. 적용은 다음 단계 경계다 */
export async function commitOrder(
  port: HookOrderPort,
  hook: string,
  order: readonly string[],
): Promise<CommittedOrder> {
  const saved = await port.set({ hook, order });
  return { saved: saved.saved, appliesAt: saved.appliesAt };
}

/** 저장된 덮어쓰기를 지운다. hook을 생략하면 모든 훅이다 */
export function resetOrder(port: HookOrderPort, hook?: string): Promise<HooksOrderResetResult> {
  return port.reset(hook === undefined ? {} : { hook });
}

/** 훅마다 적용 중 순서, 저장 순서, 보류 여부를 모은다 */
export async function readOrders(port: HookOrderPort): Promise<Record<string, HookOrderState>> {
  const got = await port.get();
  return Object.fromEntries(
    got.hooks.map((e): [string, HookOrderState] => [
      e.hook,
      { applied: e.applied, saved: e.saved, pending: e.pending },
    ]),
  );
}
