import type { PluginCard } from "@fresnel/contracts/extensions";
import type { InvocableEntry } from "@fresnel/contracts/wire";
import type { PluginFolder } from "./folder-reader.ts";

// 호출할 수 있는 항목(M5c §3.4 `InvocableEntry`, §4.3.2)을 검토본과 카드에서 만든다. 검토본이 없는 플러그인에는 항목이 없다.
// 스킬과 명령은 검토본 `tree/`를 읽은 결과에서 온다(실행하는 복사본과 같은 내용). Drive 시작은 카드의 `does.drive.start`에서 온다.
// 모든 검토된 플러그인은 이름으로 얹는 `kind: "plugin"` 항목을 하나 가진다. 그 항목의 `entry`는 플러그인 이름이다.

/** 와이어의 이름 상한(`Name`, 96자). 이보다 긴 항목은 와이어에 싣지 않는다 */
const ENTRY_MAX = 96;
/** 와이어의 제목 상한(128자) */
const TITLE_MAX = 128;
/** Drive 시작 항목의 이름. 카드에는 시작 항목의 이름이 없어 고정한다 */
const DRIVE_START_ENTRY = "start";

/** 코드 포인트 단위로 자른다(서로게이트 쌍을 가르지 않는다) */
function clip(text: string, max: number): string {
  const points = Array.from(text);
  return points.length <= max ? text : points.slice(0, max).join("");
}

export interface InvocableSource {
  readonly plugin: string;
  readonly reviewedHash: string;
  readonly card: Pick<PluginCard, "displayName" | "does">;
  /** 검토본 폴더를 읽은 결과. 읽지 못했으면 null이고 스킬과 명령은 빠진다 */
  readonly folder: Pick<PluginFolder, "materials"> | null;
}

/** 검토된 플러그인 하나의 호출 항목. 스킬, 명령, Drive 시작, 플러그인 전체 순서다 */
export function invocablesOf(source: InvocableSource): InvocableEntry[] {
  const { plugin, reviewedHash, card, folder } = source;
  const entries: InvocableEntry[] = [];
  const add = (entry: string, kind: InvocableEntry["kind"], title: string): void => {
    // 이름이 와이어 상한을 넘으면 호출할 수 없는 이름이라 싣지 않는다
    if (entry.length === 0 || entry.length > ENTRY_MAX) return;
    entries.push({ plugin, entry, kind, title: clip(title, TITLE_MAX), reviewedHash });
  };
  for (const skill of folder?.materials.skills ?? []) {
    add(skill.name, "skill", skill.description ?? skill.name);
  }
  for (const command of folder?.materials.commands ?? []) {
    add(command.name, "command", command.name);
  }
  // 시작 Drive는 프로필의 `driver`가 고른다. 여기서는 호출할 수 있는 항목으로만 보이고, 덧씌우기는 거절한다(overlay.ts)
  if (card.does.drive?.start === true) {
    add(DRIVE_START_ENTRY, "drive", card.displayName);
  }
  add(plugin, "plugin", card.displayName);
  return entries;
}

/** 도구나 MCP 서버를 더하는 플러그인인가. 캐시 영향 [제안]에 쓴다 */
export function addsToolsOf(card: Pick<PluginCard, "does">): boolean {
  const inject = card.does.inject;
  return inject !== null && (inject.tools.length > 0 || inject.mcpServers.length > 0);
}
