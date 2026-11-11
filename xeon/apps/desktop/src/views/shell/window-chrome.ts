import { detach, rethrow } from "@fresnel/contracts";

// 창 틀(L4.desktop-ux DP-80 [결정: 2026-11-11 사용자]). 데스크톱 셸이 OS 제목 막대를 숨기면 앱 머리 줄이 창 틀이다.
// 셸의 `window_chrome_state`를 읽어 `<html data-window-chrome="mac|overlay">`, `data-fullscreen`, 신호등 자리 폭
// `--chrome-inset-start`(px, 셸이 macOS 판에 맞춰 잰 값)를 건다.
// styles.css가 이 속성으로 끌기 영역과 신호등·창 단추 자리를 둔다. 속성이 없으면(웹, 셸이 없거나 오래된 셸) 아무 것도 바뀌지 않는다.
// 전체 화면을 들어가고 나올 때 셸이 `window-chrome` 이벤트를 보내면 다시 읽는다(전체 화면에는 신호등이 없다).

export const WINDOW_CHROME_EVENT = "window-chrome";

type WindowChromeKind = "mac" | "overlay" | "none";

export interface WindowChromeState {
  readonly kind: WindowChromeKind;
  readonly fullscreen: boolean;
  /** 머리 줄 앞에서 비울 폭(px). 신호등이 없으면 0 */
  readonly insetStart: number;
}

const NONE: WindowChromeState = { kind: "none", fullscreen: false, insetStart: 0 };
/** 셸이 주는 앞 여백의 상한(px). 그보다 크면 틀린 값으로 보고 0을 쓴다 */
const MAX_INSET = 200;

/** 셸 답을 읽는다. 모양이 틀리면 틀이 없는 것으로 본다 */
export function windowChromeStateOf(value: unknown): WindowChromeState {
  if (typeof value !== "object" || value === null) return NONE;
  const kind: unknown = Object.getOwnPropertyDescriptor(value, "kind")?.value;
  const fullscreen: unknown = Object.getOwnPropertyDescriptor(value, "fullscreen")?.value;
  const inset: unknown = Object.getOwnPropertyDescriptor(value, "insetStart")?.value;
  if ((kind !== "mac" && kind !== "overlay") || typeof fullscreen !== "boolean") return NONE;
  const insetStart =
    typeof inset === "number" && Number.isInteger(inset) && inset >= 0 && inset <= MAX_INSET
      ? inset
      : 0;
  return { kind, fullscreen, insetStart };
}

export interface WindowChromeRoot {
  readonly dataset: Record<string, string | undefined>;
  readonly style: {
    setProperty(name: string, value: string): void;
    removeProperty(name: string): unknown;
  };
}

export function applyWindowChrome(root: WindowChromeRoot, state: WindowChromeState): void {
  if (state.kind === "none") delete root.dataset["windowChrome"];
  else root.dataset["windowChrome"] = state.kind;
  if (state.kind !== "none" && state.fullscreen) root.dataset["fullscreen"] = "";
  else delete root.dataset["fullscreen"];
  if (state.insetStart > 0) root.style.setProperty("--chrome-inset-start", `${state.insetStart}px`);
  else root.style.removeProperty("--chrome-inset-start");
}

export interface WindowChromeDeps {
  readonly invoke: (command: string) => Promise<unknown>;
  readonly listen: (event: string, onEvent: () => void) => Promise<() => void>;
  readonly root: WindowChromeRoot;
}

/** 지금 상태를 걸고 바뀔 때마다 다시 건다. 셸이 명령을 모르면(거절) 틀 속성을 걸지 않는다 */
export function installWindowChrome(deps: WindowChromeDeps): void {
  const refresh = async (): Promise<void> => {
    const state = await deps.invoke("window_chrome_state").then(windowChromeStateOf, () => NONE);
    applyWindowChrome(deps.root, state);
  };
  detach(refresh(), rethrow);
  detach(
    deps.listen(WINDOW_CHROME_EVENT, () => {
      detach(refresh(), rethrow);
    }),
    rethrow,
  );
}
