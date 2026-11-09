// Fresnel 서비스 워커(spec §6.2). 탭이 닫혀 있어도 푸시를 받아 알림을 띄우고, 알림을 누르면 열린 탭을 앞으로 가져와 대화를 알린다.
// `sw-build.ts`가 한 파일 classic 스크립트(iife)로 묶어 `/sw.js`로 내준다. 가져오기와 동적 평가를 쓰지 않는다. 푸시 본문은 `{title, threadId}` JSON 하나다.

const APP_NAME = "Fresnel";
const TITLE_MAX_CHARS = 120;

interface PushPayload {
  readonly title: string;
  readonly threadId: string | null;
}

interface WaitableEvent {
  waitUntil(promise: Promise<unknown>): void;
}

interface PushEventLike extends WaitableEvent {
  readonly data: { text(): string | Promise<string> } | null;
}

interface NotificationLike {
  close(): void;
  readonly data: unknown;
}

interface NotificationClickEventLike extends WaitableEvent {
  readonly notification: NotificationLike;
}

interface WindowClientLike {
  readonly focused: boolean;
  focus(): Promise<unknown>;
  postMessage(message: unknown): void;
}

interface WorkerScope {
  readonly registration: {
    showNotification(
      title: string,
      options: { tag: string; data: { threadId: string | null }; renotify: boolean },
    ): Promise<void>;
  };
  readonly clients: {
    matchAll(options: {
      type: "window";
      includeUncontrolled: boolean;
    }): Promise<readonly WindowClientLike[]>;
    openWindow(url: string): Promise<unknown>;
  };
  addEventListener(type: "push", listener: (event: PushEventLike) => void): void;
  addEventListener(
    type: "notificationclick",
    listener: (event: NotificationClickEventLike) => void,
  ): void;
}

/** 서비스 워커 전역을 좁힌다. 이 파일은 서비스 워커에서만 돈다 */
export function isWorkerScope(value: unknown): value is WorkerScope {
  return (
    typeof value === "object" &&
    value !== null &&
    "registration" in value &&
    "clients" in value &&
    "addEventListener" in value
  );
}

type Attempt<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly cause: unknown };

/** 던질 수 있는 호출 하나를 값으로 바꾼다. 서비스 워커 번들에 `@fresnel/contracts`를 넣지 않으려고 작게 다시 둔다 */
function tryParse(text: string): Attempt<unknown> {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (cause) {
    return { ok: false, cause };
  }
}

async function tryRead(data: { text(): string | Promise<string> }): Promise<Attempt<string>> {
  try {
    return { ok: true, value: await data.text() };
  } catch (cause) {
    return { ok: false, cause };
  }
}

function genericPayload(): PushPayload {
  return { title: APP_NAME, threadId: null };
}

function field(value: object, name: string): unknown {
  return Object.getOwnPropertyDescriptor(value, name)?.value;
}

/** 받은 글자를 값으로 읽는다. 형식이 틀리면 일반 제목으로 대신한다(푸시 서비스나 다른 발신자의 잘못된 값을 믿지 않는다) */
export function parsePayload(text: string): PushPayload {
  const parsed = tryParse(text);
  if (!parsed.ok) return genericPayload();
  const value = parsed.value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return genericPayload();
  }
  const rawTitle = field(value, "title");
  const rawThread = field(value, "threadId");
  const title =
    typeof rawTitle === "string" && rawTitle.trim() !== ""
      ? Array.from(rawTitle).slice(0, TITLE_MAX_CHARS).join("")
      : APP_NAME;
  const threadId = typeof rawThread === "string" && rawThread !== "" ? rawThread : null;
  return { title, threadId };
}

async function payloadOf(event: PushEventLike): Promise<PushPayload> {
  if (event.data === null) return genericPayload();
  const read = await tryRead(event.data);
  return read.ok ? parsePayload(read.value) : genericPayload();
}

function threadIdOf(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const threadId = field(data, "threadId");
  return typeof threadId === "string" ? threadId : null;
}

function install(scope: WorkerScope): void {
  async function showFromPush(event: PushEventLike): Promise<void> {
    const payload = await payloadOf(event);
    await scope.registration.showNotification(payload.title, {
      tag: payload.threadId ?? "fresnel",
      data: { threadId: payload.threadId },
      renotify: true,
    });
  }

  // 열린 창이 있으면 그중 앞에 있는 것을(없으면 첫 번째를) 앞으로 가져와 대화를 알린다. 없으면 새 창을 연다
  async function focusThread(threadId: string | null): Promise<void> {
    const windows = await scope.clients.matchAll({ type: "window", includeUncontrolled: true });
    const target = windows.find((client) => client.focused) ?? windows[0];
    if (target === undefined) {
      await scope.clients.openWindow("/");
      return;
    }
    await target.focus();
    // 서비스 워커의 WindowClient.postMessage는 같은 출처 창에만 간다(targetOrigin 인자가 없다)
    const send = target.postMessage.bind(target);
    send({ type: "openThread", threadId });
  }

  scope.addEventListener("push", (event) => {
    event.waitUntil(showFromPush(event));
  });
  scope.addEventListener("notificationclick", (event) => {
    event.notification.close();
    event.waitUntil(focusThread(threadIdOf(event.notification.data)));
  });
}

const scope: unknown = field(globalThis, "self");
if (isWorkerScope(scope)) install(scope);
