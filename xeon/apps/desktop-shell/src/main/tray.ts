// 트레이 메뉴(tray.rs 대응). 메뉴 글과 진행 중 개수는 WebView가 `tray_update`로 바꾼다.
// 이 파일은 electron을 import하지 않는다. 트레이를 만드는 일은 ports로 받고, Electron 연결은 tray-shell.ts가 한다.
import { assertNever, attempt, type Result } from "@fresnel/contracts";
import { setTrayActive } from "./close-behavior.ts";
import { ShellError } from "./commands.ts";
import type { ShellContext, ShellModule } from "./context.ts";
import { INTENT_EVENT, sharedIntents } from "./intents.ts";

/** 메뉴 항목이 가리키는 동작. 진행 중 줄은 비활성이라 동작이 없다 */
/** 트레이를 만든 뒤 앱 로그에 남는 줄 */
export const TRAY_CREATED_LOG = "tray: created";

export type TrayAction = "open" | "newThread" | "quit";

/**
 * 메뉴 글. `tray_update`가 받는 `running`은 `{count}`가 든 템플릿이고,
 * `TrayHandle.setLabels`가 받는 `running`은 개수가 들어간 최종 글이다.
 */
export interface TrayLabels {
  readonly open: string;
  readonly newThread: string;
  readonly running: string;
  readonly quit: string;
}

/** 처음 글. 영어 기본값이고 WebView가 `tray_update`로 바꾼다 */
export const DEFAULT_TRAY_LABELS: TrayLabels = {
  open: "Open Fresnel",
  newThread: "New chat",
  running: "Running {count}",
  quit: "Quit",
};

/** 글 길이 상한(문자 수). 넘는 글은 bad-request다 */
const LABEL_MAX_CHARS = 80;

/** 메뉴 항목 id를 동작으로. 진행 중 줄과 모르는 id는 null이다 */
const ACTION_BY_ID: ReadonlyMap<string, TrayAction> = new Map<string, TrayAction>([
  ["open", "open"],
  ["new_thread", "newThread"],
  ["quit", "quit"],
]);

export function actionOf(id: string): TrayAction | null {
  return ACTION_BY_ID.get(id) ?? null;
}

/** 진행 중 줄의 글. 템플릿의 `{count}`를 모두 개수로 바꾼다 */
export function runningText(template: string, count: number): string {
  return template.replaceAll("{count}", String(count));
}

/** 글이 모두 상한 안인지. 글자 수는 코드 포인트로 센다(한글 한 글자와 이모지 한 개가 각각 1이다) */
export function labelsFit(labels: TrayLabels): boolean {
  // Array.from은 코드 포인트 단위로 나눈다. 여기서는 세기만 하므로 조각을 다루지 않는다
  return [labels.open, labels.newThread, labels.running, labels.quit].every(
    (text) => Array.from(text).length <= LABEL_MAX_CHARS,
  );
}

/** 트레이를 만들지 못한 이유 코드. 앱 로그에 그대로 남는다 */
export interface TrayCreateError {
  readonly reason: "icon" | "build";
}

/** 만든 트레이를 다루는 손잡이 */
export interface TrayHandle {
  /** 메뉴 글을 바꾼다. `running`은 개수가 들어간 글이다 */
  setLabels(labels: TrayLabels): void;
  destroy(): void;
}

export interface TrayPorts {
  /** 아이콘과 메뉴로 트레이를 만든다. 메뉴 항목을 누르면 `onAction`을 부른다 */
  create(
    initial: TrayLabels,
    onAction: (action: TrayAction) => void,
  ): Result<TrayHandle, TrayCreateError>;
  /** 앱 로그에 한 줄 남긴다 */
  log(line: string): void;
  /** 앱을 끝낸다 */
  quit(): void;
}

/** `tray_update`의 답. WebView는 `kind`로 가른다. 실패는 이유 코드만 담는다 */
export type TrayUpdateReply =
  | { readonly kind: "updated" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "failed"; readonly reason: "set_text" };

interface TrayUpdate {
  readonly labels: TrayLabels;
  readonly running: number;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

/** `tray_update` 인자의 모양과 글 길이를 본다. 어긋나면 bad-request다 */
function readUpdate(args: unknown): TrayUpdate {
  if (!isRecord(args)) throw new ShellError("bad-request");
  const { labels, running } = args;
  if (!isRecord(labels)) throw new ShellError("bad-request");
  if (typeof running !== "number" || !Number.isInteger(running) || running < 0) {
    throw new ShellError("bad-request");
  }
  const { open, newThread, running: template, quit } = labels;
  if (
    typeof open !== "string" ||
    typeof newThread !== "string" ||
    typeof template !== "string" ||
    typeof quit !== "string"
  ) {
    throw new ShellError("bad-request");
  }
  const parsed: TrayLabels = { open, newThread, running: template, quit };
  if (!labelsFit(parsed)) throw new ShellError("bad-request");
  return { labels: parsed, running };
}

/** 트레이 모듈. 만들었는지에 따라 트레이 유지 상태(`setTrayActive`)와 `tray_update`의 답이 정해진다 */
export function createTrayModule(ports: TrayPorts): ShellModule {
  return {
    name: "tray",
    register(ctx: ShellContext) {
      const onAction = (action: TrayAction): void => {
        switch (action) {
          case "open":
            ctx.showMainWindow();
            return;
          case "newThread":
            ctx.showMainWindow();
            sharedIntents.push({ kind: "newThread" }, Date.now());
            ctx.emit(INTENT_EVENT);
            return;
          case "quit":
            ports.quit();
            return;
          default:
            assertNever(action, "tray action");
        }
      };

      const made = ports.create(
        { ...DEFAULT_TRAY_LABELS, running: runningText(DEFAULT_TRAY_LABELS.running, 0) },
        onAction,
      );
      // 만든 줄도 남긴다: 묶기 스모크(`electron-smoke.ts`)가 메뉴 막대를 읽을 수 없어 이 줄로 트레이가 만들어졌는지 본다
      ports.log(made.ok ? TRAY_CREATED_LOG : `tray: not created (reason: ${made.error.reason})`);
      setTrayActive(made.ok);
      const handle = made.ok ? made.value : null;
      if (handle !== null) {
        ctx.onQuit(() => {
          handle.destroy();
        });
      }

      // 트레이가 없어도 명령은 등록한다. 그래야 WebView가 unknown-command가 아니라 unavailable을 받는다
      ctx.handle("tray_update", (_caller, args): TrayUpdateReply => {
        const update = readUpdate(args);
        if (handle === null) return { kind: "unavailable" };
        const labels: TrayLabels = {
          ...update.labels,
          running: runningText(update.labels.running, update.running),
        };
        const applied = attempt(() => {
          handle.setLabels(labels);
        });
        if (!applied.ok) {
          ports.log("tray: set_text failed");
          return { kind: "failed", reason: "set_text" };
        }
        return { kind: "updated" };
      });
    },
  };
}
