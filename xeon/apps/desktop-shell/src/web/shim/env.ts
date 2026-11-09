// shim이 브라우저에서 쓰는 것의 모양. 운영 값은 browser.ts가 `window`에서 채우고, 시험은 가짜를 넣는다.
// DOM 타입을 여기서 쓰지 않는다. 같은 모양이면 진짜와 가짜가 똑같이 들어온다.

/** 열린 WebSocket 하나 */
export interface ShimSocket {
  send(text: string): void;
  close(code: number): void;
}

/** 소켓 사건을 받는 곳. `message`는 글이 아닌 데이터도 그대로 받는다(호출자가 프로토콜 위반으로 다룬다) */
export interface SocketHandlers {
  open(): void;
  message(data: unknown): void;
  close(code: number): void;
}

/** 주소로 소켓을 연다 */
export type OpenSocket = (url: string, handlers: SocketHandlers) => ShimSocket;

/** 재연결 시계. 시험은 실행할 순서를 직접 고른다 */
export interface ShimTimers {
  setTimeout(callback: () => void, ms: number): unknown;
}

/** `Location`의 부분 모양 */
export interface ShimLocation {
  readonly protocol: string;
  readonly host: string;
  reload(): void;
  assign(url: string): void;
}

/** 고른 파일 하나. `File`의 부분 모양 */
export interface ShimFileLike {
  readonly name: string;
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** Notification 권한 글(`NotificationPermission`과 같다) */
export type BrowserPermission = "default" | "granted" | "denied";

/** 페이지가 하는 일: 제목, 알림 띄, 파일 고르기, 내려받기, 새 탭, 창 앞으로 */
export interface ShimPage {
  title(): string;
  setTitle(title: string): void;
  /** 연결이 끊겼을 때 보이는 작은 알림. 글만 쓰고 누를 것은 없다 */
  showNotice(text: string): void;
  hideNotice(): void;
  /** 숨은 파일 입력을 사용자 제스처 안에서 연다. 고르지 않고 닫으면 `null` */
  pickFile(): Promise<ShimFileLike | null>;
  /** 글을 파일로 내려받는다 */
  download(name: string, content: string, mime: string): void;
  /** 새 탭에서 연다(`noopener,noreferrer`) */
  openTab(url: string): void;
  focusWindow(): void;
  /** 진단용 코드를 페이지에 알린다. 값이나 주소는 싣지 않는다 */
  report(code: string): void;
}

export interface ShimNoticeContent {
  readonly title: string;
  readonly body: string;
}

export interface ShimNotifyHandlers {
  onClick(): void;
  onError(): void;
}

/** Notification API의 부분 모양 */
export interface ShimNotifications {
  permission(): BrowserPermission;
  requestPermission(): Promise<BrowserPermission>;
  show(notice: ShimNoticeContent, handlers: ShimNotifyHandlers): void;
}

export interface ShimPushSubscription {
  toJSON(): unknown;
}

/** `PushManager`의 부분 모양. `applicationServerKey`는 바이트다 */
export interface ShimPushManager {
  subscribe(options: {
    readonly userVisibleOnly: true;
    readonly applicationServerKey: Uint8Array<ArrayBuffer>;
  }): Promise<ShimPushSubscription>;
}

/** 서비스 워커 등록과 활성 등록의 푸시 관리자 */
export interface ShimServiceWorkers {
  register(url: string): Promise<void>;
  activePushManager(): Promise<ShimPushManager>;
}

export interface ShimRequestInit {
  readonly method?: "GET" | "POST";
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly credentials?: "include";
}

export interface ShimResponse {
  readonly ok: boolean;
  json(): Promise<unknown>;
}

export type ShimFetch = (url: string, init?: ShimRequestInit) => Promise<ShimResponse>;

/** shim이 쓰는 브라우저 전체 */
export interface ShimEnv {
  readonly location: ShimLocation;
  readonly openSocket: OpenSocket;
  readonly timers: ShimTimers;
  readonly page: ShimPage;
  /** Notification API. 없으면 `undefined`이고 알림은 `denied`로 답한다 */
  readonly notifications: ShimNotifications | undefined;
  /** 서비스 워커와 PushManager. 없으면 `undefined`이고 푸시는 하지 않는다 */
  readonly serviceWorkers: ShimServiceWorkers | undefined;
  readonly fetch: ShimFetch;
  readonly isSecureContext: boolean;
}
