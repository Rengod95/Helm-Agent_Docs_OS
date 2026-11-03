import { describe, expect, test } from "bun:test";
import { buildFixture } from "@fresnel/client/workbench/canvas";
import {
  codeOf,
  failLimitOf,
  idOfTarget,
  membersOfTarget,
  originOf,
  switchNameOf,
  switchOf,
  targetOf,
  versionOf,
  type DetailTarget,
} from "../../../src/views/craft/detail-model.ts";

const snap = buildFixture(18);

function need(target: DetailTarget | null): DetailTarget {
  if (target === null) throw new Error("expected a target");
  return target;
}

describe("targetOf: 그룹 id면 그룹, 아니면 플러그인", () => {
  test("id가 없으면 null", () => {
    expect(targetOf(snap, null)).toBeNull();
    expect(targetOf(snap, "no-such-plugin")).toBeNull();
  });

  test("그룹 id는 구성원 전부를 가리킨다. 같은 id의 루트 플러그인보다 그룹이 이긴다", () => {
    const t = need(targetOf(snap, "helm"));
    expect(t.k).toBe("group");
    expect(membersOfTarget(t).map((p) => p.id)).toEqual(["helm", "helm/explore", "helm/panel"]);
    expect(idOfTarget(t)).toBe("helm");
  });

  test("그룹 구성원 플러그인은 자기 그룹을 함께 가진다", () => {
    const t = need(targetOf(snap, "helm/explore"));
    expect(t.k).toBe("plugin");
    if (t.k !== "plugin") throw new Error("expected plugin");
    expect(t.group?.id).toBe("helm");
  });

  test("혼자 설치된 플러그인은 그룹이 없다", () => {
    const t = need(targetOf(snap, "exa"));
    expect(t.k).toBe("plugin");
    if (t.k !== "plugin") throw new Error("expected plugin");
    expect(t.group).toBeUndefined();
  });
});

describe("switchOf: 스위치는 그룹 단위 하나(15-1)", () => {
  test("그룹 구성원 하나를 열어도 스위치는 그룹 전체를 가리킨다", () => {
    const sw = switchOf(snap, need(targetOf(snap, "helm/explore")));
    expect(sw.targets).toEqual(["helm", "helm/explore", "helm/panel"]);
    expect(sw.total).toBe(3);
    expect(sw.onCount).toBe(3);
    expect(sw.autoOff).toBe(false);
  });

  test("자동 꺼짐 구성원이 있으면 켜진 수는 그만큼 빠지고 자동 꺼짐이 보인다", () => {
    const sw = switchOf(snap, need(targetOf(snap, "review")));
    expect(sw).toEqual({ targets: ["review", "review/lens"], total: 2, onCount: 1, autoOff: true });
  });

  test("혼자 꺼진 플러그인은 자기 하나를 가리킨다", () => {
    const sw = switchOf(snap, need(targetOf(snap, "exa")));
    expect(sw).toEqual({ targets: ["exa"], total: 1, onCount: 0, autoOff: false });
  });

  test("스위치 이름: 그룹에 속하면 그룹 이름", () => {
    expect(switchNameOf(need(targetOf(snap, "helm/explore")))).toBe("Helm");
    expect(switchNameOf(need(targetOf(snap, "exa")))).toBe("Exa search");
  });
});

describe("읽기 전용 옆 열", () => {
  test("버전과 출처는 대상에서 온다", () => {
    expect(versionOf(need(targetOf(snap, "exa")))).toBe("1.0.3");
    expect(originOf(need(targetOf(snap, "exa")))).toBe("user");
    expect(versionOf(need(targetOf(snap, "helm")))).toBe("0.4.0");
  });

  test("실패 한도는 실패 기록이 있는 구성원의 값이고, 기록이 없으면 없다", () => {
    expect(failLimitOf(membersOfTarget(need(targetOf(snap, "review"))))).toBe(5);
    expect(failLimitOf(membersOfTarget(need(targetOf(snap, "learning"))))).toBeUndefined();
  });

  test("코드 칸은 스냅샷 필드를 JSON으로 보인다", () => {
    const text = codeOf(need(targetOf(snap, "exa")));
    expect(text).toContain('"id": "exa"');
    expect(text).toContain('"layer": "plugin"');
    expect(text).toContain('"tool"');
  });
});
