import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// 2026-11-06 검은 화면: 크래프트 개수 줄이 읽을 때마다 새 객체를 돌려주는 선택자를 썼고,
// 스토어 훅이 결과를 참조로만 비교해 React가 무한 반복(#185)에 빠졌다.
// 그래서 모든 스토어 훅은 선택자를 useShallow로 감싼다. 이 테스트는 그 약속을 지킨다.
const HOOKS = ["engine", "shell", "ui", "workbench"] as const;

describe("스토어 훅은 선택자를 얕게 비교한다", () => {
  for (const name of HOOKS) {
    test(name, () => {
      const src = readFileSync(join(import.meta.dir, "../../src/state", name, "hooks.ts"), "utf8");
      const calls = [...src.matchAll(/useStore\(([^;]*)\)\s*;/g)].map((m) => m[1] ?? "");
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) expect(call).toContain("useShallow(selector)");
    });
  }
});
