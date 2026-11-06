// 트레이(메뉴 막대) 메뉴 글과 진행 중 개수를 Rust `tray_update`로 보내는 다리(B-10).
// 메뉴 글은 화면 언어의 카탈로그 문장이다. 진행 중 줄의 `{count}`는 Rust가 개수로 바꾸므로 글에 리터럴로 남긴다
// (카탈로그 문장에서 `'{count}'`로 따옴표를 씌워 ICU 인자로 읽히지 않게 한다).
// 같은 글과 같은 개수면 명령을 부르지 않는다. 화면이 언어를 바꾸면 트리가 다시 그려지며 새 다리가 처음 값을 보낸다.
import { attemptAsync, type Result } from "@fresnel/contracts";
import { t } from "@fresnel/client/i18n";

/** `tray_update`의 글. Rust `TrayLabels`의 칸 이름과 같다 */
export type TrayLabels = {
  readonly open: string;
  readonly newThread: string;
  /** `{count}`가 든 템플릿이다. Rust가 진행 중 개수로 바꾼다 */
  readonly running: string;
  readonly quit: string;
};

export type TraySnapshot = {
  readonly labels: TrayLabels;
  readonly running: number;
};

export type TrayInvoke = (
  command: "tray_update",
  args: { readonly labels: TrayLabels; readonly running: number },
) => Promise<unknown>;

type TrayOutcome = "updated" | "skipped" | "unavailable" | "failed";

export interface TrayBridge {
  readonly update: (next: TraySnapshot) => Promise<TrayOutcome>;
}

/** 화면 언어의 메뉴 글. 진행 중 줄은 `{count}`를 그대로 남긴다 */
export function trayLabelsOf(): TrayLabels {
  return {
    open: t("desktop.tray.open"),
    newThread: t("desktop.tray.newThread"),
    running: t("desktop.tray.running"),
    quit: t("desktop.tray.quit"),
  };
}

function sameSnapshot(a: TraySnapshot, b: TraySnapshot): boolean {
  return (
    a.running === b.running &&
    a.labels.open === b.labels.open &&
    a.labels.newThread === b.labels.newThread &&
    a.labels.running === b.labels.running &&
    a.labels.quit === b.labels.quit
  );
}

/** 답의 종류. `updated`, `unavailable`만 값으로 알고 그 밖은 모두 실패다 */
function outcomeOf(reply: Result<unknown, unknown>): TrayOutcome {
  if (!reply.ok) return "failed";
  const kind = kindOf(reply.value);
  if (kind === "updated" || kind === "unavailable") return kind;
  return "failed";
}

function kindOf(reply: unknown): string {
  if (typeof reply !== "object" || reply === null || !("kind" in reply)) return "";
  return typeof reply.kind === "string" ? reply.kind : "";
}

/** 다리 하나를 만든다. 마지막으로 보낸 값을 기억해 같은 값이면 부르지 않는다 */
export function createTrayBridge(invoke: TrayInvoke): TrayBridge {
  let sent: TraySnapshot | null = null;
  return {
    update: async (next) => {
      if (sent !== null && sameSnapshot(sent, next)) return "skipped";
      sent = next;
      const reply = await attemptAsync(() =>
        invoke("tray_update", { labels: next.labels, running: next.running }),
      );
      return outcomeOf(reply);
    },
  };
}
