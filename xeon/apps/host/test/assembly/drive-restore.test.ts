import { expect, test } from "bun:test";
import { restorableLeasesOf } from "../../src/assembly/m4/drive-restore.ts";

// M5c §4.3.5: 재시작 뒤 되살릴 임대의 후보. 판 식별자가 없거나 이름을 모르는 임대는 빼고, 한 플러그인이 두 판을 가지면 둘 다 뺀다.

const HASH_A = "sha256:" + "a".repeat(64);
const HASH_B = "sha256:" + "b".repeat(64);
const NAMES: Record<string, string> = {
  helm: "helm",
  "helm/extra": "helm",
  other: "other",
};

function pluginOf(scopeId: string): string | undefined {
  return NAMES[scopeId];
}

test("판 식별자가 있는 임대는 플러그인 이름과 판으로 한 번씩 되살린다", () => {
  expect(
    restorableLeasesOf(
      [
        { scopeId: "other", contentHash: HASH_A },
        { scopeId: "helm", contentHash: HASH_B },
      ],
      pluginOf,
    ),
  ).toEqual([
    { plugin: "other", contentHash: HASH_A },
    { plugin: "helm", contentHash: HASH_B },
  ]);
});

test("같은 플러그인의 같은 판 임대가 여럿이면 한 번만 준다", () => {
  expect(
    restorableLeasesOf(
      [
        { scopeId: "helm", contentHash: HASH_A },
        { scopeId: "helm/extra", contentHash: HASH_A },
      ],
      pluginOf,
    ),
  ).toEqual([{ plugin: "helm", contentHash: HASH_A }]);
});

test("판 식별자가 없는 임대와 플러그인 이름을 모르는 scope는 뺀다", () => {
  expect(
    restorableLeasesOf(
      [
        { scopeId: "other", contentHash: null },
        { scopeId: "gone", contentHash: HASH_A },
      ],
      pluginOf,
    ),
  ).toEqual([]);
});

test("같은 플러그인이 서로 다른 판의 임대를 가지면 어느 판으로 되살릴지 정하지 않고 둘 다 뺀다", () => {
  expect(
    restorableLeasesOf(
      [
        { scopeId: "helm", contentHash: HASH_A },
        { scopeId: "helm/extra", contentHash: HASH_B },
        { scopeId: "other", contentHash: HASH_A },
      ],
      pluginOf,
    ),
  ).toEqual([{ plugin: "other", contentHash: HASH_A }]);
});
