// 순서 화면이 쓰는 호출 묶음. 미리보기는 저장하지 않고, 저장은 미리보기 뒤에 사용자가 확인했을 때만 부른다.
// 포트의 실패는 `Result`의 err 값으로 온다. 이 묶음은 그 값을 그대로 돌려주고, 실패 뒤의 저장은 부르지 않는다.
import type {
  HooksOrderGetResult,
  HooksOrderPreviewParams,
  HooksOrderPreviewResult,
  HooksOrderResetParams,
  HooksOrderResetResult,
  HooksOrderSetParams,
  HooksOrderSetResult,
} from "@fresnel/contracts/wire";
import { ok, type Result } from "@fresnel/contracts";
import { buildOrderWarning, type OrderWarning } from "./guard-warning.ts";

/**
 * 순서 호출이 실패한 이유. 종류는 데스크톱 명령 실패와 같은 여섯 가지다. 이 패키지는 데스크톱 타입을 가져오지 않으려고
 * 같은 모양을 적는다. `locked`의 선택지 목록은 순서 화면이 쓰지 않아서 싣지 않는다.
 */
export type OrderPortError =
  | { readonly kind: "offline" }
  | { readonly kind: "unsupported" }
  | { readonly kind: "locked"; readonly ownerKind: string }
  | { readonly kind: "rejected"; readonly code: number | null; readonly detail?: string }
  | { readonly kind: "failed" }
  | { readonly kind: "switching" };

/** 순서 기능이 쓰는 wire 호출 넷. 전송 계층(클라이언트 연결)이 이것을 구현한다. 실패는 던지지 않고 err 값으로 돌려준다 */
export interface HookOrderPort {
  get(): Promise<Result<HooksOrderGetResult, OrderPortError>>;
  set(params: HooksOrderSetParams): Promise<Result<HooksOrderSetResult, OrderPortError>>;
  reset(params: HooksOrderResetParams): Promise<Result<HooksOrderResetResult, OrderPortError>>;
  preview(
    params: HooksOrderPreviewParams,
  ): Promise<Result<HooksOrderPreviewResult, OrderPortError>>;
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

/** 저장 전 미리보기. set은 부르지 않는다. 포트가 err를 돌려주면 그 값을 그대로 돌려준다 */
export async function proposeOrder(
  port: HookOrderPort,
  hook: string,
  order: readonly string[],
  nameOf: (registrationId: string) => string,
): Promise<Result<ProposedOrder, OrderPortError>> {
  const preview = await port.preview({ hook, order });
  if (!preview.ok) return preview;
  return ok({
    warning: buildOrderWarning(preview.value, nameOf),
    order: preview.value.order,
  });
}

/** 확인이 끝난 순서를 저장한다. 적용은 다음 단계 경계다. 포트가 err를 돌려주면 그 값을 그대로 돌려준다 */
export async function commitOrder(
  port: HookOrderPort,
  hook: string,
  order: readonly string[],
): Promise<Result<CommittedOrder, OrderPortError>> {
  const saved = await port.set({ hook, order });
  if (!saved.ok) return saved;
  return ok({ saved: saved.value.saved, appliesAt: saved.value.appliesAt });
}

/** 저장된 덮어쓰기를 지운다. hook을 생략하면 모든 훅이다 */
export function resetOrder(
  port: HookOrderPort,
  hook?: string,
): Promise<Result<HooksOrderResetResult, OrderPortError>> {
  return port.reset(hook === undefined ? {} : { hook });
}

/** 훅마다 적용 중 순서, 저장 순서, 보류 여부를 모은다 */
export async function readOrders(
  port: HookOrderPort,
): Promise<Result<Record<string, HookOrderState>, OrderPortError>> {
  const got = await port.get();
  if (!got.ok) return got;
  return ok(
    Object.fromEntries(
      got.value.hooks.map((e): [string, HookOrderState] => [
        e.hook,
        { applied: e.applied, saved: e.saved, pending: e.pending },
      ]),
    ),
  );
}
