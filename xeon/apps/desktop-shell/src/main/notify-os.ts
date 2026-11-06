// OS 알림 명령(B-10, Rust `notify_os.rs` 대응). electron을 값으로 가져오지 않는다. 띄우는 일과 권한 읽기는 `ports`로 받는다.
// 제목과 본문의 글은 UI(`os-notify.ts`)가 정하고, 셸은 줄이고 거른 뒤 띄운다. 본문 `notice.body`는 쓰지 않는다.
import { attempt, attemptAsync } from "@fresnel/contracts";
import type { ShellContext, ShellModule } from "./context.ts";
import { ShellError } from "./commands.ts";
import { INTENT_EVENT, sharedIntents } from "./intents.ts";

const TITLE_MAX_CHARS = 80;
const BODY_MAX_CHARS = 400;
const THREAD_ID_MAX_CHARS = 128;
/** 줄바꿈과 탭. 빈칸으로 바꾼다 */
const LINE_BREAKS: ReadonlySet<string> = new Set(["\n", "\r", "\t"]);
/** Unicode 제어 문자(Cc). Rust `char::is_control`과 같다. 0x7f와 0x80~0x9f도 든다 */
const CONTROL = /\p{Cc}/u;

/** 띄운 뒤(답이 `shown`인 뒤)에 OS가 실패를 알리면 UI에 보내는 이벤트. UI 알림 전달기가 듣고 마지막 전달 실패로 기록한다 */
export const NOTIFY_FAILED_EVENT = "notify-failed";

/** 앱 로그에 남는 줄. 제목과 본문과 대화 id는 넣지 않는다 */
export const SHOW_FAILED_LOG = "notify: not shown (reason: show_failed)";

/** 알림 권한 글. Electron에는 권한 API가 없어 `granted`나 `denied`로 답하고, 읽지 못하면 `prompt`다 */
export type NotifyPermission = "granted" | "denied" | "prompt";

/** `notify_os`의 답. 모양은 Rust `NotifyReply`(`{ kind }`)와 같다 */
export type NotifyReply = { readonly kind: "shown" | "denied" | "failed" };

/** 띄울 알림의 내용. 글은 이미 줄였다 */
export interface ShownNotice {
  readonly title: string;
  /** 줄인 뒤 비면 `null`이다 */
  readonly body: string | null;
}

/** 이 모듈이 바깥에 기대는 것. 실제 구현은 `notify-os-shell.ts`가 채운다 */
export interface NotifyOsPorts {
  /** 권한 글. 읽다 던지면 `prompt`로 답한다 */
  readonly permission: () => NotifyPermission;
  /** 알림을 띄운다. OS가 띄웠다고 알리면 `true`, 실패했다고 알리면 `false`로 끝난다. 사용자가 누르면 `onClick`을 한 번 부른다. 던지면 띄우지 못한 것이다. 답한 뒤 OS가 실패를 알리면 `onFailed`를 부른다 */
  readonly show: (
    notice: ShownNotice,
    onClick: () => void,
    onFailed: () => void,
  ) => Promise<boolean>;
  /** 앱 로그 한 줄 */
  readonly log: (line: string) => void;
}

/** 글을 좁힌다. 줄바꿈과 탭은 빈칸으로, 나머지 제어 문자는 뺀다. 코드 포인트 `max`개까지 남기고 앞뒤 공백을 뗀다 */
export function clean(text: string, max: number): string {
  // Array.from은 코드 포인트 단위로 나눈다(Rust chars()와 같다). 문자열 스프레드는 린트가 막는다
  return Array.from(text)
    .map((ch) => (LINE_BREAKS.has(ch) ? " " : ch))
    .filter((ch) => !CONTROL.test(ch))
    .slice(0, max)
    .join("")
    .trim();
}

/** 대화 id를 기록해도 되는 형식인가. 비어 있지 않고, 128자 이하이며, 제어 문자가 없어야 한다 */
export function validThreadId(id: string): boolean {
  return id !== "" && Array.from(id).length <= THREAD_ID_MAX_CHARS && !CONTROL.test(id);
}

/** 알림을 띄울 수 있는지(`Notification.isSupported()`)를 권한 글로 옮긴다 */
export function permissionWordOf(supported: boolean): NotifyPermission {
  return supported ? "granted" : "denied";
}

/** 인자 한 값이 없거나(`undefined`), 비었거나(`null`), 글이면 된다 */
function isOptionalText(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === "string";
}

interface NotifyRequest {
  readonly title: string;
  readonly body: string | null;
  readonly threadId: string | null;
}

/** 인자 모양을 본다. 객체가 아니거나 글이 아닌 값이 있으면 거절한다 */
function notifyRequestOf(args: unknown): NotifyRequest {
  if (typeof args !== "object" || args === null) throw new ShellError("bad-request");
  const title = "title" in args ? args.title : undefined;
  const body = "body" in args ? args.body : undefined;
  const threadId = "threadId" in args ? args.threadId : undefined;
  if (typeof title !== "string") throw new ShellError("bad-request");
  if (!isOptionalText(body) || !isOptionalText(threadId)) throw new ShellError("bad-request");
  return { title, body: body ?? null, threadId: threadId ?? null };
}

/** 권한을 읽는다. 읽기가 던지면 `prompt`다(Rust `map_or("prompt")`와 같다) */
function permissionReply(ports: NotifyOsPorts): NotifyPermission {
  const read = attempt(() => ports.permission());
  return read.ok ? read.value : "prompt";
}

async function notifyOs(
  ctx: ShellContext,
  ports: NotifyOsPorts,
  args: unknown,
): Promise<NotifyReply> {
  const request = notifyRequestOf(args);
  const title = clean(request.title, TITLE_MAX_CHARS);
  if (title === "") throw new ShellError("bad-request");
  const body = request.body === null ? "" : clean(request.body, BODY_MAX_CHARS);
  if (permissionReply(ports) === "denied") return { kind: "denied" };
  const threadId =
    request.threadId !== null && validThreadId(request.threadId) ? request.threadId : null;
  // 누르면 앞으로 올라온다. 대화 id가 있으면 그 대화를 여는 의도를 큐에 넣고 UI를 깨운다
  const onClick = (): void => {
    ctx.showMainWindow();
    if (threadId === null) return;
    sharedIntents.push({ kind: "openThread", threadId }, Date.now());
    ctx.emit(INTENT_EVENT);
  };
  // 던지거나 `false`면 띄우지 못한 것이다. 이유는 고정 한 줄로만 남긴다
  // OS의 답을 기다려 `shown`이나 `failed`로 답한다(프레임이 실제 결과를 받는다). 답한 뒤의 실패는 로그와 UI 이벤트로 알린다
  const onFailed = (): void => {
    ports.log(SHOW_FAILED_LOG);
    ctx.emit(NOTIFY_FAILED_EVENT);
  };
  const shown = await attemptAsync(() =>
    ports.show({ title, body: body === "" ? null : body }, onClick, onFailed),
  );
  if (shown.ok && shown.value) return { kind: "shown" };
  ports.log(SHOW_FAILED_LOG);
  return { kind: "failed" };
}

/** 알림 명령 셋(`notify_permission`, `notify_request_permission`, `notify_os`)을 등록하는 모듈 */
export function createNotifyOsModule(ports: NotifyOsPorts): ShellModule {
  return {
    name: "notify-os",
    register(ctx) {
      ctx.handle("notify_permission", () => permissionReply(ports));
      // 데스크톱은 묻지 않는다. 요청도 지금 권한을 그대로 답한다
      ctx.handle("notify_request_permission", () => permissionReply(ports));
      ctx.handle("notify_os", (_caller, args) => notifyOs(ctx, ports, args));
    },
  };
}
