// `register(ctx)` 계약. 기능 모듈(src/main/<기능>.ts)은 이 ctx만 받고 electron을 직접 import하지 않는다(타입만 가능).
// 그래서 bun test가 가짜 ctx로 모듈을 돌린다. main.ts가 진짜 ctx를 만든다.
import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  CustomScheme,
  WebContents,
} from "electron";

/** 웹 게이트웨이의 탭 하나(`src/web/session`). 탭마다 객체가 하나라 핸들 표가 탭별로 갈린다. WebContents가 아니다 */
export interface TabSender {
  readonly kind: "web-tab";
}

/** 요청을 보낸 renderer. main.ts가 발신 프레임을 검사한 뒤에만 핸들러에 닿는다. 웹 게이트웨이에서는 탭이다 */
export interface IpcCaller {
  readonly sender: WebContents | TabSender;
}

/** renderer가 args에 실어 보낸 채널. `send`는 그 renderer의 해당 콜백으로 간다 */
export interface ShellChannel {
  send(message: unknown): void;
}

export type CommandHandler = (caller: IpcCaller, args: unknown) => unknown;

export interface ShellPaths {
  /** Electron userData(`<appData>/dev.fresnel.desktop.electron`). 브라우저 캐시 같은 Electron 전용 상태가 들어가며 설정 폴더와 섞이지 않는다 */
  readonly userData: string;
  /** 설정 폴더(`<appData>/dev.fresnel.desktop`). 데스크톱 설정 파일이 여기 있다(옛 Tauri 앱과 같은 폴더라 설정이 이어진다) */
  readonly configDir: string;
  /** 앱 로그 폴더. macOS는 `~/Library/Logs/dev.fresnel.desktop` */
  readonly logs: string;
  /** 패키지 앱이면 `Resources`, 개발 중이면 셸 패키지 폴더 */
  readonly resources: string;
  /** UI 번들 폴더(index.html이 있는 곳) */
  readonly ui: string;
}

export interface ShellDialogs {
  openFolder(): Promise<string | null>;
  openFile(): Promise<string | null>;
  /** 저장 위치를 고르게 한다. 취소면 null */
  saveFile(suggestedName: string): Promise<string | null>;
}

export interface ShellContext {
  readonly env: NodeJS.ProcessEnv;
  readonly platform: NodeJS.Platform;
  readonly paths: ShellPaths;
  readonly dialogs: ShellDialogs;
  /** 허용 스킴 검사는 모듈이 한다. 이것은 OS 호출만 한다 */
  openExternal(url: string): Promise<void>;
  /** 명령 하나를 등록한다. 같은 이름을 두 번 등록하면 던진다(시작 때 고쳐야 하는 오류) */
  handle(command: string, handler: CommandHandler): void;
  /** args 값이 `{ $channel: id }`이면 그 채널을, 아니면 null */
  channel(caller: IpcCaller, value: unknown): ShellChannel | null;
  /** 열린 모든 창의 UI에 이름 붙은 이벤트를 보낸다 */
  emit(name: string): void;
  /** 메인 창을 앞으로 가져온다. 창이 없으면(트레이 유지로 닫힌 뒤) 새로 만든다 */
  showMainWindow(): void;
  /** 앱이 끝나기 전에 부른다(등록 역순, 하나씩 기다린다). 엔진 정리처럼 오래 걸리는 일은 여기서 기다린다 */
  onQuit(cleanup: () => void | Promise<void>): void;
  /** 사용자 정의 스킴(`schemes`로 미리 등록한 것)의 요청을 처리한다 */
  handleScheme(scheme: string, handler: (request: Request) => Response | Promise<Response>): void;
  /** 지금 열린 창들 */
  windows(): readonly BrowserWindow[];
  /** 창을 만들 때 옵션에 덮어쓸 값. 여러 모듈이 등록하면 등록 순서대로 합친다 */
  windowOptions(provider: () => BrowserWindowConstructorOptions): void;
  /** 창이 만들어진 직후 부른다(이벤트를 달 때 쓴다) */
  onWindow(hook: (window: BrowserWindow) => void): void;
}

/** 모듈이 내보내는 것. main.ts의 modules 목록이 이것만 엮는다 */
export interface ShellModule {
  readonly name: string;
  /** `app.ready` 전에 등록해야 하는 사용자 정의 스킴. main.ts가 모아 한 번에 등록한다 */
  readonly schemes?: readonly CustomScheme[];
  /** `app.ready` 전에 부른다. 단일 인스턴스 잠금처럼 ready 전에 해야 하는 일만 둔다 */
  beforeReady?(): void;
  register(ctx: ShellContext): void;
}
