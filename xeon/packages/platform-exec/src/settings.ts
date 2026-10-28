import { Type } from "typebox";
import { defineSettings, validateSettingValue, type SettingDef } from "@xeon/contracts/settings";

// L0.exec.spec §6. 모두 layer L0, since 0.1.0이다.
// shell과 envAllowlist.extra는 project 범위를 받지 않는다: 저장소 파일이 실행 셸을 바꾸거나 부모 env를 자식에 열지 못하게 한다.
// envAllowlist.extra에서 deny 패턴(3.5절)에 맞는 이름을 거부하는 일은 값 검사가 아니라 쓰기 검사(checkSettingWrite)의 몫이다.

/** 기본값은 이 상수 한 곳에만 둔다(BP-06) */
const OUTPUT_SPILL_DEFAULT_BYTES = 10_485_760;

/** 무인 경로 명령 상한 기본값(30분). 일반 대화의 defaultTimeoutMs는 0을 유지한다(M3-REQ-46) */
const UNATTENDED_TIMEOUT_DEFAULT_MS = 1_800_000;

const group = defineSettings("l0.exec", {
  shell: {
    type: Type.String({ minLength: 1, maxLength: 4096 }),
    runtimeChange: "restart",
    allowedScopes: ["managed", "user"],
    ui: {
      tab: "execution",
      widget: "text",
      order: 100,
      label: "셸 경로",
      help: "절대 경로. 비우면 자동으로 찾는다",
    },
    since: "0.1.0",
  },
  defaultTimeoutMs: {
    type: Type.Integer(),
    default: 0,
    range: { min: 0, max: 2_147_483_647 },
    runtimeChange: "nextTurn",
    allowedScopes: ["managed", "user", "project"],
    ui: {
      tab: "execution",
      widget: "number",
      order: 110,
      label: "명령 기본 시간 제한",
      help: "0이면 호출자가 정하지 않을 때 제한 없음",
      unit: "ms",
    },
    since: "0.1.0",
  },
  unattendedTimeoutMs: {
    type: Type.Integer(),
    default: UNATTENDED_TIMEOUT_DEFAULT_MS,
    range: { min: 1000, max: 2_147_483_647 },
    runtimeChange: "nextTurn",
    allowedScopes: ["managed", "user"],
    ui: {
      tab: "execution",
      widget: "number",
      order: 115,
      label: "무인 실행 명령 시간 상한",
      help: "예약·루프처럼 사람이 없는 경로의 명령에만 적용한다. 일반 대화는 제한 없음",
      unit: "ms",
    },
    since: "0.1.0",
  },
  outputSpillBytes: {
    type: Type.Integer(),
    default: OUTPUT_SPILL_DEFAULT_BYTES,
    range: { min: 0, max: 1_073_741_824 },
    runtimeChange: "nextTurn",
    allowedScopes: ["managed", "user", "project"],
    since: "0.1.0",
  },
  "envAllowlist.extra": {
    type: Type.Array(Type.String({ pattern: "^[A-Za-z_][A-Za-z0-9_]{0,127}$" }), {
      maxItems: 256,
    }),
    default: [],
    runtimeChange: "nextTurn",
    allowedScopes: ["managed", "user"],
    ui: {
      tab: "execution",
      widget: "list",
      order: 120,
      label: "자식 프로세스에 넘길 추가 환경 변수",
      help: "이름만 적는다. 비밀 값은 넣지 않는다",
    },
    since: "0.1.0",
  },
});

/** `l0.exec.*` 선언 전체. 카탈로그 조립(buildCatalog)이 쓴다 */
export const EXEC_SETTING_DEFS: readonly SettingDef[] = Object.values(group.defs);

/** 무인 경로 상한 값을 읽는다. 값이 없거나 범위 밖이면 기본값이다(상한을 없애는 쪽으로 해석하지 않는다) */
export function readUnattendedTimeoutMs(read: (key: string) => unknown): number {
  const def = group.defs.unattendedTimeoutMs;
  const value = read(def.key);
  return typeof value === "number" && validateSettingValue(def, value).ok
    ? value
    : UNATTENDED_TIMEOUT_DEFAULT_MS;
}
