import { t, type MessageId } from "@xeon/client/i18n";
import { EXIT, type ExitCode } from "../exit-codes.ts";

// L4.cli.spec §3.1 명령 표. 도움말에 보이지 않는 명령(host --stdio, service launch-mode, service run)은 싣지 않는다.

/** 주제 이름 → 도움말 id. 본문은 카탈로그에 있고 보여 줄 때 현재 로케일로 만든다 */
const TOPICS: ReadonlyMap<string, MessageId> = new Map<string, MessageId>([
  ["db", "cli.help.topic.db"],
  ["chat", "cli.help.topic.chat"],
  ["config", "cli.help.topic.config"],
  ["schedule", "cli.help.topic.schedule"],
]);

/** 도움말을 stdout에 쓴다. 모르는 주제는 전체 도움말이다 */
export async function runHelp(
  topic: string | null,
  stdout: (text: string) => Promise<void>,
): Promise<ExitCode> {
  const id = topic === null ? undefined : TOPICS.get(topic);
  await stdout(t(id ?? "cli.help.overview"));
  return EXIT.ok;
}
