import { assertNever } from "@xeon/contracts";
import type { GroupStatus } from "@xeon/contracts/services";

export interface StatusLineOptions {
  /** 표시 폭(열). 기본 60 */
  readonly maxWidth?: number;
  /** l3.group-kit.statusLine 값. false면 null을 돌려준다. 기본 true */
  readonly enabled?: boolean;
}

const DEFAULT_MAX_WIDTH = 60;
const PENDING_SUFFIX = " · 다음 단계 경계에 적용";

/** 한글·CJK 같은 전각 문자는 두 열로 센다 */
function isWide(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
}

/** 문자열이 차지하는 열 수 */
export function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) width += isWide(char.codePointAt(0) ?? 0) ? 2 : 1;
  return width;
}

function mark(group: GroupStatus): string {
  switch (group.drive) {
    case "holder":
      return "[구동]";
    case "waiting":
      return "[대기]";
    case "error":
      return "[오류]";
    case "rejected":
      return "[거부]";
    case "none":
      return "";
    default:
      return assertNever(group.drive, "DriveRole");
  }
}

/**
 * 상태줄 문자열(L3.group-kit.spec §3.9). 순수 함수.
 * 표시 대상은 켜졌거나 켜기·끄기가 대기 중인 그룹이다. 하나도 없거나 `enabled`가 false면 null이다.
 * 항목 순서는 holder, 켜진 그룹(입력 순서 = 로드 순서), 대기 중인 토글(`+이름`, `-이름`)이다.
 */
export function formatGroupStatusLine(
  groups: readonly GroupStatus[],
  options: StatusLineOptions = {},
): string | null {
  if (options.enabled === false) return null;
  const on = groups.filter((group) => group.scope === "enabled" || group.scope === "disabling");
  const pending = groups.filter((group) => group.pendingToggle !== null);
  if (on.length === 0 && pending.length === 0) return null;

  const holders = on.filter((group) => group.drive === "holder");
  const others = on.filter((group) => group.drive !== "holder");
  const items = [
    ...[...holders, ...others].map((group) => `${group.id}${mark(group)}`),
    ...pending.map((group) => `${group.pendingToggle === "enable" ? "+" : "-"}${group.id}`),
  ];
  const suffix = pending.length > 0 ? PENDING_SUFFIX : "";
  const maxWidth = options.maxWidth ?? DEFAULT_MAX_WIDTH;

  const render = (count: number): string => {
    const hidden = items.length - count;
    const more = hidden > 0 ? ` +${hidden}` : "";
    return `그룹 ${items.slice(0, count).join(" ")}${more}${suffix}`;
  };
  let count = items.length;
  while (count > 1 && displayWidth(render(count)) > maxWidth) count -= 1;
  return render(count);
}
