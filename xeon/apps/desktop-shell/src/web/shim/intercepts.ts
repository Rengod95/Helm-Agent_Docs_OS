// 브라우저에서 뜻이 바뀌는 셸 명령의 표. 여기 있는 명령은 `/shell`로 보내지 않는다(§6.1).
// 나머지 명령은 `invoke`가 그대로 서버로 보낸다.
import type { ShimPage } from "./env.ts";
import { pickFileRead, saveFile } from "./files.ts";
import type { NotifyCommands } from "./notify.ts";
import { isAllowedHref } from "./text.ts";
import { attempt, isRecord, ownField, refuse } from "./util.ts";

/** 가로챈 명령 하나. 인자를 받아 답을 준다(거절은 거절로) */
export type Intercept = (args: unknown) => Promise<unknown>;

export interface InterceptDeps {
  readonly page: ShimPage;
  readonly notify: NotifyCommands;
  /** 푸시를 쓸 수 있는 페이지인가(안전한 문맥, 서비스 워커, Notification) */
  readonly pushSupported: boolean;
}

/**
 * 웹에서 숨기는 명령(§6.1). 호출하면 `unsupported-on-web`으로 거절한다.
 * 업데이트와 재인증과 데이터·로그 폴더는 origin 컴퓨터의 데스크톱에서만 한다.
 */
const UNSUPPORTED_ON_WEB: readonly string[] = [
  "os_reauth",
  "update_status",
  "update_check",
  "update_download",
  "update_install_restart",
  "open_data_dir",
  "open_log_dir",
  "engine_retarget",
];

/** 트레이 메뉴 글 길이 상한(문자 수). 데스크톱 `LABEL_MAX_CHARS`와 같다 */
const LABEL_MAX_CHARS = 80;
/** 탭 제목 앞의 `(N) ` 접두 */
const TITLE_PREFIX = /^\(\d+\) /u;

/**
 * `shell_capabilities`의 답. UI는 이 모양으로 버튼을 고른다(§6.1).
 * `kind`는 `"web"`, `folderPicker`는 고르는 폴더가 origin에 있다는 뜻의 `"origin"`,
 * `fileDownload`는 저장을 내려받기로 한다는 뜻, `push`는 이 페이지에서 푸시를 쓸 수 있는가다.
 */
interface WebCapabilities {
  readonly kind: "web";
  readonly folderPicker: "origin";
  readonly fileDownload: true;
  readonly push: boolean;
}

/** `tray_update`의 답. 데스크톱 `TrayUpdateReply`와 같은 모양이다 */
type TrayUpdateReply =
  | { readonly kind: "updated" }
  | { readonly kind: "failed"; readonly reason: "set_text" };

/** 트레이 인자가 맞으면 진행 중 개수를, 아니면 `null`. 글 네 개는 길이만 본다 */
function trayRunningOf(args: unknown): number | null {
  const labels = ownField(args, "labels");
  const running = ownField(args, "running");
  if (!isRecord(labels) || typeof running !== "number") return null;
  if (!Number.isInteger(running) || running < 0) return null;
  const texts = [
    ownField(labels, "open"),
    ownField(labels, "newThread"),
    ownField(labels, "running"),
    ownField(labels, "quit"),
  ];
  const fits = texts.every(
    (text): text is string =>
      typeof text === "string" && Array.from(text).length <= LABEL_MAX_CHARS,
  );
  return fits ? running : null;
}

/** 진행 중 개수를 탭 제목 접두로 보인다. 개수가 0이면 접두를 뗀다 */
function trayUpdate(page: ShimPage, args: unknown): Promise<TrayUpdateReply> {
  const running = trayRunningOf(args);
  if (running === null) return refuse("bad-request");
  const base = page.title().replace(TITLE_PREFIX, "");
  const title = running > 0 ? `(${running}) ${base}` : base;
  const set = attempt(() => {
    page.setTitle(title);
  });
  return Promise.resolve(set.ok ? { kind: "updated" } : { kind: "failed", reason: "set_text" });
}

/** 확인 줄을 거친 외부 링크를 새 탭으로 연다. 허용되지 않은 주소는 거절한다(데스크톱 `open-external.ts`와 같다) */
function openExternal(page: ShimPage, args: unknown): Promise<null> {
  const href = ownField(args, "href");
  if (typeof href !== "string" || !isAllowedHref(href)) return refuse("href_not_allowed");
  const opened = attempt(() => {
    page.openTab(href);
  });
  return opened.ok ? Promise.resolve(null) : refuse("open_failed");
}

export function createIntercepts(deps: InterceptDeps): ReadonlyMap<string, Intercept> {
  const { page, notify } = deps;
  const capabilities: WebCapabilities = {
    kind: "web",
    folderPicker: "origin",
    fileDownload: true,
    push: deps.pushSupported,
  };
  const table = new Map<string, Intercept>([
    ["shell_capabilities", () => Promise.resolve({ ...capabilities })],
    ["pick_file_read", () => pickFileRead(page)],
    ["save_file", (args) => saveFile(page, args)],
    ["open_external", (args) => openExternal(page, args)],
    ["notify_permission", () => notify.permission()],
    ["notify_request_permission", () => notify.requestPermission()],
    ["notify_os", (args) => notify.notifyOs(args)],
    ["notify_take_target", () => notify.takeTarget()],
    ["tray_update", (args) => trayUpdate(page, args)],
  ]);
  for (const command of UNSUPPORTED_ON_WEB) {
    table.set(command, () => refuse("unsupported-on-web"));
  }
  return table;
}
