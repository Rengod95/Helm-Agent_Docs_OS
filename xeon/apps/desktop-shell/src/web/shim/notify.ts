// 알림 명령(`notify_permission`, `notify_request_permission`, `notify_os`, `notify_take_target`)의 브라우저 대응.
// 데스크톱 `notify-os.ts`와 같은 답과 같은 글 규칙을 쓴다. 권한 요청은 사용자 제스처 안에서 UI가 부른다.
import type { BrowserPermission, ShimNotifications, ShimPage } from "./env.ts";
import { cleanText, validThreadId } from "./text.ts";
import { attempt, attemptAsync, ownField, refuse } from "./util.ts";

/** 셸 의도 이벤트 이름. 데스크톱 `shell-intents.ts`의 `SHELL_INTENT_EVENT`와 같다 */
const SHELL_INTENT_EVENT = "shell-intent";
/** 띄운 뒤의 실패 이벤트 이름. 데스크톱 `NOTIFY_FAILED_EVENT`와 같다 */
const NOTIFY_FAILED_EVENT = "notify-failed";

const TITLE_MAX_CHARS = 80;
const BODY_MAX_CHARS = 400;

/** 데스크톱과 같은 권한 글. `prompt`는 아직 묻지 않았다는 뜻이다 */
type NotifyPermission = "granted" | "denied" | "prompt";

interface NotifyReply {
  readonly kind: "shown" | "denied" | "failed";
}

export interface NotifyDeps {
  readonly page: ShimPage;
  readonly notifications: ShimNotifications | undefined;
  /** 이 탭 안에서 이벤트를 보낸다 */
  readonly emit: (name: string) => void;
  /** 권한이 허용되었을 때 푸시 등록을 시작한다(한 번만 한다) */
  readonly ensurePush: () => void;
}

export interface NotifyCommands {
  permission(): Promise<NotifyPermission>;
  requestPermission(): Promise<NotifyPermission>;
  notifyOs(args: unknown): Promise<NotifyReply>;
  /** 알림을 눌러 올라온 대화 id를 한 번 준다. 없으면 `null` */
  takeTarget(): Promise<string | null>;
}

function wordOf(permission: BrowserPermission): NotifyPermission {
  if (permission === "granted") return "granted";
  if (permission === "denied") return "denied";
  return "prompt";
}

/** Notification API가 없으면 `denied`(데스크톱이 지원하지 않을 때와 같다). 읽기가 던지면 `prompt` */
function permissionOf(notifications: ShimNotifications | undefined): NotifyPermission {
  if (notifications === undefined) return "denied";
  const read = attempt(() => notifications.permission());
  return read.ok ? wordOf(read.value) : "prompt";
}

function isOptionalText(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === "string";
}

interface NotifyRequest {
  readonly title: string;
  readonly body: string | null;
  readonly threadId: string | null;
}

function notifyRequestOf(args: unknown): NotifyRequest | null {
  const title = ownField(args, "title");
  const body = ownField(args, "body");
  const threadId = ownField(args, "threadId");
  if (typeof title !== "string" || !isOptionalText(body) || !isOptionalText(threadId)) {
    return null;
  }
  return { title, body: body ?? null, threadId: threadId ?? null };
}

export function createNotifyCommands(deps: NotifyDeps): NotifyCommands {
  const { notifications } = deps;
  // 누른 알림의 대화 id. 한 번 가져가면 비운다(데스크톱의 notify_take_target과 같다)
  let pendingTarget: string | null = null;

  return {
    permission() {
      return Promise.resolve(permissionOf(notifications));
    },
    async requestPermission() {
      if (notifications === undefined) return "denied";
      const current = permissionOf(notifications);
      if (current !== "prompt") {
        if (current === "granted") deps.ensurePush();
        return current;
      }
      const answer = await attemptAsync(() => notifications.requestPermission());
      const word = answer.ok ? wordOf(answer.value) : "prompt";
      if (word === "granted") deps.ensurePush();
      return word;
    },
    notifyOs(args) {
      const request = notifyRequestOf(args);
      if (request === null) return refuse("bad-request");
      const title = cleanText(request.title, TITLE_MAX_CHARS);
      if (title === "") return refuse("bad-request");
      // 브라우저는 권한 없이 띄울 수 없다. 묻지 않은 상태(`prompt`)도 보낼 수 없으므로 `denied`로 답한다
      if (notifications === undefined || permissionOf(notifications) !== "granted") {
        return Promise.resolve({ kind: "denied" });
      }
      const body = request.body === null ? "" : cleanText(request.body, BODY_MAX_CHARS);
      const threadId =
        request.threadId !== null && validThreadId(request.threadId) ? request.threadId : null;
      const shown = attempt(() => {
        notifications.show(
          { title, body },
          {
            onClick: () => {
              // 대화 id는 창을 앞으로 올리기 전에 둔다. 포커스 사건이 바로 올 수 있으므로
              if (threadId !== null) {
                pendingTarget = threadId;
              }
              deps.page.focusWindow();
              if (threadId !== null) deps.emit(SHELL_INTENT_EVENT);
            },
            onError: () => {
              deps.emit(NOTIFY_FAILED_EVENT);
            },
          },
        );
      });
      return Promise.resolve({ kind: shown.ok ? "shown" : "failed" });
    },
    takeTarget() {
      const target = pendingTarget;
      pendingTarget = null;
      return Promise.resolve(target);
    },
  };
}
