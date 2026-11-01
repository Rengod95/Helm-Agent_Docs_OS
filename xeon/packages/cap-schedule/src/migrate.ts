// 예약 상태 파일의 한 단계 올리기(rename-plan §3.1, 예약 종류 "loop" → "repeat"). 저장된 예약 정의는 사용자 데이터라 읽을 때 한 번 바꾼다.
// version 1 파일은 trigger.kind와 run의 firedBy가 "loop"였다. version 2는 둘 다 "repeat"이다. 다른 모양은 그대로 돌려주고 검사는 저장소의 스키마가 한다.

const OLD_KIND = "loop";
const NEW_KIND = "repeat";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function renameKind(value: unknown, field: string): unknown {
  if (!isRecord(value) || value[field] !== OLD_KIND) return value;
  return { ...value, [field]: NEW_KIND };
}

function upgradeEntry(entry: unknown): unknown {
  if (!isRecord(entry)) return entry;
  return { ...entry, trigger: renameKind(entry["trigger"], "kind") };
}

/** version 1 상태 값을 version 2로 올린다. version 1이 아니면 그대로 돌려준다 */
export function upgradeScheduleState(raw: unknown): unknown {
  if (!isRecord(raw) || raw["version"] !== 1) return raw;
  const entries = Array.isArray(raw["entries"]) ? raw["entries"].map(upgradeEntry) : raw["entries"];
  const runs = Array.isArray(raw["runs"])
    ? raw["runs"].map((run) => renameKind(run, "firedBy"))
    : raw["runs"];
  return { ...raw, version: 2, entries, runs };
}
