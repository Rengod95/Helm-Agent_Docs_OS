// OS 알림 전달기(B-10). 앱 창이 있는 동안 `notify.delivered`를 듣고, 보낼 알림이면 Rust `notify_os`로 띄운다.
// 처음 보내기 전에 권한을 한 번 읽고 `prompt`이면 요청을 한 번 부른다. 전달이 거부되거나 실패하면 마지막 전달 실패로 기록해
// 설정 화면이 구독해 볼 수 있게 한다. 명령이 거부되거나 답의 모양이 틀려도 앱은 계속 돈다(값으로 처리한다).
// 판단은 `os-notify-model.ts`가 하고, 이 파일은 명령과 구독과 기록을 맡는다.
import { attemptAsync, detach, rethrow, type Result } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { NotifyDeliveredParams, ThreadSummary } from "@fresnel/contracts/wire";
import {
  coalesceStep,
  osNoticeOf,
  type NotifyPrefs,
  type OsNoticePlan,
  type PermissionState,
} from "./os-notify-model.ts";

/** 셸이 띄운 뒤의 OS 실패를 알리는 이벤트 이름. 셸 `notify-os.ts`의 `NOTIFY_FAILED_EVENT`와 같다 */
export const NOTIFY_FAILED_EVENT = "notify-failed";

export type OsNotifyCommand = "notify_permission" | "notify_request_permission" | "notify_os";

/** `notify_os`의 인자. 셸이 `thread_id`로 받는다 */
type OsNotifyArgs = {
  readonly title: string;
  readonly body: string;
  readonly threadId: ThreadId | null;
};

export type OsNotifyInvoke = (command: OsNotifyCommand, args?: OsNotifyArgs) => Promise<unknown>;

/** 한 번 보낸 결과. `shown`만 전달이 된 것이다 */
export type NotifyOutcome = "shown" | "denied" | "failed";

export interface NotifyStatus {
  readonly permission: PermissionState;
  /** 마지막으로 보낸 알림이 띄워지지 않았는가 */
  readonly lastDeliveryFailed: boolean;
}

/** 설정 화면이 구독해 보는 작은 저장소 */
export interface NotifyStatusStore {
  readonly get: () => NotifyStatus;
  readonly subscribe: (listener: () => void) => () => void;
}

export interface OsNotifyPort {
  /** `notify.delivered` 구독. 반환값은 해제 함수다. 연결이 바뀌면 호출자가 다시 건다 */
  readonly subscribe: (listener: (delivered: NotifyDeliveredParams) => void) => () => void;
  readonly invoke: OsNotifyInvoke;
  /**
   * 셸이 띄운 뒤의 실패(`notify_os`가 `shown`으로 답한 알림을 OS가 나중에 실패 처리함)를 알리는 이벤트 구독.
   * 받으면 마지막 전달 실패로 기록한다. Electron 셸만 보낸다. 없어도 된다
   */
  readonly subscribeFailure?: ((listener: () => void) => () => void) | undefined;
  /** 앱 창이 앞에 있는가 */
  readonly isFocused: () => boolean;
  /** 종류별 켜짐. 보낼 때마다 읽는다 */
  readonly prefs: () => NotifyPrefs;
  /** 대화 요약. 목록에 없으면 `undefined`다 */
  readonly threadOf: (threadId: ThreadId) => Pick<ThreadSummary, "origin" | "title"> | undefined;
  readonly now: () => number;
  /** 보낸 결과마다 부른다(기록과 시험용). 없어도 된다 */
  readonly onResult?: ((outcome: NotifyOutcome) => void) | undefined;
}

export interface OsNotifier {
  readonly status: NotifyStatusStore;
  /** `notify.delivered`를 듣기 시작한다. 반환값으로 듣기를 멈춘다 */
  readonly listen: () => () => void;
}

/** 권한 읽기 한 번. `prompt`이면 요청을 한 번 더 부른다. 명령이 거부되면 `unknown`이다 */
async function readPermission(invoke: OsNotifyInvoke): Promise<PermissionState> {
  const read = permissionWordOf(await attemptAsync(() => invoke("notify_permission")));
  if (read !== "prompt") return read;
  return permissionWordOf(await attemptAsync(() => invoke("notify_request_permission")));
}

function permissionWordOf(reply: Result<unknown, unknown>): PermissionState {
  if (!reply.ok) return "unknown";
  const word = reply.value;
  if (word === "granted" || word === "denied" || word === "prompt") return word;
  return "unknown";
}

/** 보내기 답의 종류. 답이 객체가 아니거나 `kind`가 글이 아니면 빈 글이다 */
function kindOf(reply: unknown): string {
  if (typeof reply !== "object" || reply === null || !("kind" in reply)) return "";
  return typeof reply.kind === "string" ? reply.kind : "";
}

/** `notify_os`의 답을 결과로 바꾼다. 명령이 거부되거나 모르는 답이면 `failed`다 */
function outcomeOf(reply: Result<unknown, unknown>): NotifyOutcome {
  if (!reply.ok) return "failed";
  const kind = kindOf(reply.value);
  if (kind === "shown" || kind === "denied") return kind;
  return "failed";
}

export function createOsNotifier(port: OsNotifyPort): OsNotifier {
  let status: NotifyStatus = { permission: "unknown", lastDeliveryFailed: false };
  const listeners = new Set<() => void>();
  let sent: ReadonlyMap<string, number> = new Map();
  // 권한 읽기는 처음 보낼 때 한 번만 한다. 여러 알림이 겹쳐도 같은 약속을 기다린다
  let permission: Promise<PermissionState> | null = null;

  const publish = (next: NotifyStatus): void => {
    if (
      next.permission === status.permission &&
      next.lastDeliveryFailed === status.lastDeliveryFailed
    ) {
      return;
    }
    status = next;
    for (const listener of listeners) listener();
  };

  const ensurePermission = (): Promise<PermissionState> => {
    permission ??= readPermission(port.invoke);
    return permission;
  };

  const record = (outcome: NotifyOutcome): void => {
    publish({ permission: status.permission, lastDeliveryFailed: outcome !== "shown" });
    port.onResult?.(outcome);
  };

  const deliver = async (plan: OsNoticePlan): Promise<NotifyOutcome> => {
    const state = await ensurePermission();
    publish({ permission: state, lastDeliveryFailed: status.lastDeliveryFailed });
    const reply = await attemptAsync(() =>
      port.invoke("notify_os", { title: plan.title, body: plan.body, threadId: plan.threadId }),
    );
    return outcomeOf(reply);
  };

  const onDelivered = (delivered: NotifyDeliveredParams): void => {
    const { notice, threadId } = delivered;
    const thread = threadId === null ? undefined : port.threadOf(threadId);
    const plan = osNoticeOf({
      notice,
      threadId,
      threadOrigin: thread?.origin ?? null,
      threadTitle: thread?.title ?? null,
      windowFocused: port.isFocused(),
      prefs: port.prefs(),
    });
    if (plan === null) return;
    const step = coalesceStep(sent, plan, port.now());
    sent = step.sent;
    if (!step.send) return;
    detach(deliver(plan).then(record), rethrow);
  };

  return {
    status: {
      get: () => status,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    listen: () => {
      const stopDelivered = port.subscribe(onDelivered);
      const stopFailure = port.subscribeFailure?.(() => {
        record("failed");
      });
      return () => {
        stopDelivered();
        stopFailure?.();
      };
    },
  };
}
