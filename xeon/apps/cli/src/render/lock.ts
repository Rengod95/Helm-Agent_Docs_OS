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

const LABELS: Readonly<Record<LockOption, { key: string; text: string }>> = {
  observe: { key: "o", text: "관찰만 한다" },
  fork: { key: "f", text: "분기해서 새 세션으로 연다" },
  delegate: { key: "d", text: "소유자에게 입력을 보낸다" },
};

export function createLockPrompt(io: PromptIo): LockPrompt {
  return async (info, signal) => {
    if (info.options.length === 0) return "cancel";
    const lines = [
      `다른 프로세스(${info.ownerKind})가 이 세션을 쓰고 있다.`,
      ...info.options.map((option) => `  [${LABELS[option].key}] ${LABELS[option].text}`),
      "  [엔터] 취소",
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
      await io.stdout("보이는 글자 중 하나를 입력한다\n");
    }
  };
}
