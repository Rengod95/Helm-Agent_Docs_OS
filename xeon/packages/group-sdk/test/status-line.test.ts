import { expect, test } from "bun:test";
import type { GroupStatus } from "@xeon/contracts/services";
import { displayWidth, formatGroupStatusLine } from "../src/index.ts";

function group(id: string, patch: Partial<GroupStatus> = {}): GroupStatus {
  return {
    id,
    displayName: id,
    scope: "enabled",
    pendingToggle: null,
    usesDrive: false,
    drive: "none",
    leaseId: null,
    lastError: null,
    recordKinds: [],
    metrics: null,
    ...patch,
  };
}

const helm = (patch: Partial<GroupStatus> = {}): GroupStatus =>
  group("helm", { usesDrive: true, drive: "holder", ...patch });

test("status-line.examples", () => {
  // 1. Helm 구동, 학습 그룹 켜짐
  expect(formatGroupStatusLine([helm(), group("learning")])).toBe("그룹 helm[구동] learning");
  // 2. 추가 그룹 review 대기
  expect(
    formatGroupStatusLine([
      helm(),
      group("learning"),
      group("review", { usesDrive: true, drive: "waiting" }),
    ]),
  ).toBe("그룹 helm[구동] learning review[대기]");
  // 3. 실행 중 learning 끄기 요청
  expect(
    formatGroupStatusLine([
      helm(),
      group("learning", { scope: "disabling", pendingToggle: "disable" }),
    ]),
  ).toBe("그룹 helm[구동] learning -learning · 다음 단계 경계에 적용");
  // 4. Helm drive 예외
  expect(formatGroupStatusLine([helm({ drive: "error" }), group("learning")])).toBe(
    "그룹 helm[오류] learning",
  );
  // 5. activeDriveGroup=review인데 review가 꺼짐
  expect(
    formatGroupStatusLine([
      helm({ drive: "waiting" }),
      group("learning"),
      group("review", { scope: "disabled", usesDrive: true }),
    ]),
  ).toBe("그룹 helm[대기] learning");
});

test("status-line.rejected-lease-request", () => {
  expect(
    formatGroupStatusLine([helm(), group("review", { usesDrive: true, drive: "rejected" })]),
  ).toBe("그룹 helm[구동] review[거부]");
});

test("status-line.pending-enable-and-empty-and-switch", () => {
  expect(
    formatGroupStatusLine([group("review", { scope: "enabling", pendingToggle: "enable" })]),
  ).toBe("그룹 +review · 다음 단계 경계에 적용");
  expect(formatGroupStatusLine([])).toBeNull();
  expect(formatGroupStatusLine([group("review", { scope: "disabled" })])).toBeNull();
  expect(formatGroupStatusLine([helm()], { enabled: false })).toBeNull();
});

test("status-line.truncates-from-the-back-with-a-count", () => {
  const groups = [
    helm(),
    group("learning"),
    group("review", { drive: "waiting" }),
    group("commitguard"),
    group("guardrail"),
  ];
  const line = formatGroupStatusLine(groups, { maxWidth: 30 });
  expect(line).toBe("그룹 helm[구동] learning +3");
  expect(displayWidth(line ?? "")).toBeLessThanOrEqual(30);
  // 적용 대기 문구는 빼지 않는다
  const pending = formatGroupStatusLine(
    [...groups, group("late", { scope: "enabling", pendingToggle: "enable" })],
    { maxWidth: 40 },
  );
  expect(pending?.endsWith(" · 다음 단계 경계에 적용")).toBe(true);
  expect(pending).toContain(" +");
  // 항목 하나는 폭을 넘어도 남긴다
  expect(formatGroupStatusLine([helm()], { maxWidth: 3 })).toBe("그룹 helm[구동]");
});

test("status-line.counts-wide-characters-as-two-columns", () => {
  expect(displayWidth("abc")).toBe(3);
  expect(displayWidth("그룹")).toBe(4);
});
