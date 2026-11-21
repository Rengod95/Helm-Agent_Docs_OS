import { describe, expect, test } from "bun:test";
import {
  countsAsMessage,
  enteringKeysOf,
  lostUserRow,
  rowEnterOf,
  rowItemIdsOf,
  settledOf,
} from "../../src/views/transcript-enter.ts";
import type { TranscriptRow } from "../../src/views/transcript-rows.ts";
import { itm } from "../state/helpers.ts";

// 대화 줄 들어옴 판단(dzM2 시안 §2, DP-117)

const user = (n: number): TranscriptRow => ({
  key: `u${n}`,
  kind: "user",
  id: itm(n),
  prevId: null,
});
const reply = (n: number): TranscriptRow => ({
  key: `r${n}`,
  kind: "reply",
  id: itm(n),
  blocks: [],
});
const live = (n: number): TranscriptRow => ({ key: `l${n}`, kind: "live", id: itm(n) });
const result = (n: number): TranscriptRow => ({
  key: `x${n}`,
  kind: "result",
  id: itm(n),
});
const foot = (n: number): TranscriptRow => ({
  key: `f${n}`,
  kind: "turnFoot",
  turnId: null,
  replyId: itm(n),
});

describe("들어옴 갈래", () => {
  test("줄 종류마다 시안 표의 갈래를 고른다", () => {
    expect(
      [user(1), reply(2), live(3), result(4), foot(5)].map((row) => rowEnterOf(row.kind)),
    ).toEqual(["user", "reply", "reply", "quiet", "foot"]);
    expect(rowEnterOf("marker")).toBe("divider");
    expect(rowEnterOf("compaction")).toBe("compaction");
    expect(rowEnterOf("card")).toBe("card");
    // Drive 구간 머리는 조용한 한 줄이라 도구 줄과 같이 4px 오른다(lcM6g: 레일이 그어지는 움직임을 없앴다)
    expect(rowEnterOf("leadHead")).toBe("quiet");
  });

  test("줄이 그리는 item id: 발 줄은 없다", () => {
    expect(rowItemIdsOf(reply(2))).toEqual([itm(2)]);
    expect(rowItemIdsOf(foot(2))).toEqual([]);
  });
});

describe("들어옴을 돌릴 줄", () => {
  test("처음 그린 커밋(과거 대화를 연 때)은 아무것도 돌지 않는다", () => {
    const rows = [user(1), reply(2), foot(2)];
    expect([...enteringKeysOf({ rows, known: null, settled: new Set() })]).toEqual([]);
  });

  test("알려진 키는 다시 마운트돼도 돌지 않고, 새 키만 돈다", () => {
    const rows = [user(1), reply(2), user(3)];
    const known = new Set(["u1", "r2"]);
    expect([...enteringKeysOf({ rows, known, settled: new Set() })]).toEqual(["u3"]);
  });

  test("확정된 item의 줄은 자리만 옮긴 것이라 돌지 않는다. 사용자 말과 발 줄은 돈다", () => {
    const rows = [user(1), reply(2), result(3), foot(2)];
    const known = new Set(["u1", "l2"]);
    const settled = settledOf([itm(2), itm(3)], []);
    expect([...enteringKeysOf({ rows, known, settled })]).toEqual(["f2"]);
  });

  test("확정 집합은 직전 진행 중 id 가운데 빠진 것이다", () => {
    expect([...settledOf([itm(1), itm(2)], [itm(2), itm(3)])]).toEqual([itm(1)]);
  });
});

describe("안 본 줄과 되감기", () => {
  test("메시지 줄만 센다", () => {
    expect([user(1), reply(2), live(3), result(4), foot(5)].map(countsAsMessage)).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
  });

  test("사용자 말 줄이 빠지면 되감긴 것이다. 답 줄만 빠지면 아니다", () => {
    expect(lostUserRow([user(1), reply(2)], [user(1)])).toBe(false);
    expect(lostUserRow([user(1), reply(2), user(3)], [user(1), reply(2)])).toBe(true);
  });
});
