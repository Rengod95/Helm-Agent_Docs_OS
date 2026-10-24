import { afterEach, expect, test } from "bun:test";
import { closeWorlds, createWorld } from "./support/world.ts";

// 실제 bun:sqlite(임시 파일 DB)에서 trigram 표의 동작을 확인한다: 3글자 MATCH, 2글자 MATCH 0건, 대소문자 무시, 한국어 조사
// 앞뒤 일치, bm25 정렬. 투영기 등록이 만든 표를 그대로 쓴다.

afterEach(closeWorlds);

test("trigram table behaviour on a real sqlite file", async () => {
  const world = await createWorld({ sessions: true });
  const kit = world.sessions;
  if (kit === undefined) throw new Error("no sessions");
  const threadId = kit.newThread();
  kit.say(threadId, "user", "검색을 위한 Quick Brown Fox");
  kit.say(threadId, "user", "fox fox fox fox");
  await world.settleIndex();
  const match = (expression: string): number => {
    const read = world.store.root.read((tx) =>
      tx.all(
        "SELECT rowid, bm25(cap_knowledge_sessionfts) AS score FROM cap_knowledge_sessionfts WHERE cap_knowledge_sessionfts MATCH ? ORDER BY score",
        [expression],
      ),
    );
    if (!read.ok) throw new Error("match failed");
    return read.value.length;
  };
  // 3글자 이상: 조사가 붙은 어절 앞뒤, 대소문자 무시
  expect(match('"검색을"')).toBe(1);
  expect(match('"quick"')).toBe(1);
  expect(match('"FOX"')).toBe(2);
  // 2글자: 오류 없이 0건이다(그래서 LIKE 경로가 있다)
  expect(match('"검색"')).toBe(0);
  expect(match('"fo"')).toBe(0);
  // 여러 번 나온 쪽이 더 잘 맞는다
  const ranked = world.store.root.read((tx) =>
    tx.all(
      "SELECT text FROM cap_knowledge_sessionfts WHERE cap_knowledge_sessionfts MATCH '\"fox\"' ORDER BY bm25(cap_knowledge_sessionfts)",
    ),
  );
  expect(ranked.ok && ranked.value[0]?.["text"]).toBe("fox fox fox fox");
});
