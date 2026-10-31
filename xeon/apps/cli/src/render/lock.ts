import { t, type MessageId } from "@xeon/client/i18n";
import type { PromptIo } from "./approval.ts";

// L4.cli.spec §4.11 잠금 프롬프트. thread.locked(3002)의 대안(details.options) 중 가능한 것만 보인다.

export type LockOption = "observe" | "fork" | "delegate";
type LockChoice = LockOption | "cancel";

interface LockInfo {
  /** 쓰기 소유를 쥔 프로세스 종류(cli, app, service). 모르면 unknown */
  readonly ownerKind: string;
  readonly options: readonly LockOption[];
}

/** 프롬프트 한 번. 아무것도 고르지 않으면(엔터, EOF, 중단) "cancel"이다 */
export type LockPrompt = (info: LockInfo, signal: AbortSignal) => Promise<LockChoice>;

const LABELS: Readonly<Record<LockOption, { key: string; text: MessageId }>> = {
  observe: { key: "o", text: "cli.render.lock.observe" },
  fork: { key: "f", text: "cli.render.lock.fork" },
  delegate: { key: "d", text: "cli.render.lock.delegate" },
};

export function createLockPrompt(io: PromptIo): LockPrompt {
  return async (info, signal) => {
    if (info.options.length === 0) return "cancel";
    const lines = [
      t("cli.render.lock.busy", { ownerKind: info.ownerKind }),
      ...info.options.map((option) => `  [${LABELS[option].key}] ${t(LABELS[option].text)}`),
      t("cli.render.lock.cancel"),
      "",
    ];
    await io.stdout(lines.join("\n"));
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- 알아듣는 입력이 올 때까지 같은 질문을 다시 묻는다 (L4.cli.spec §4.11)
      const line = await io.readLine("> ", signal);
      const text = line?.trim().toLowerCase() ?? "";
      if (text.length === 0) return "cancel";
      const picked = info.options.find((option) => LABELS[option].key === text);
      if (picked !== undefined) return picked;
      // oxlint-disable-next-line no-await-in-loop -- 잘못된 입력을 알린 뒤 다시 묻는다 (L4.cli.spec §4.11)
      await io.stdout(t("cli.render.lock.retry"));
    }
  };
}
