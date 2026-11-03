import { expect, test } from "bun:test";
import { toolsManifest } from "@fresnel/core-tools";
import { BUILTIN_CAPABILITY_DEFS } from "../../src/assembly/capability-defs.ts";
import { L2_TOOL_CAPABILITIES } from "../../src/assembly/extensions.ts";

// 도구를 가진 내장 기능은 core-tools 매니페스트에 선언되어야 한다. 선언이 없으면 도구 호출이 항상 "공급자 없음"으로 끝난다(cross/C-01).

// web.research는 cap-web 2차에서 provides에 더한다(cap-web/src/manifest.ts). 공급자가 없는 동안은 선언 대상이 아니다.
const NOT_PROVIDED_YET: ReadonlySet<string> = new Set(["web.research"]);

test("every built-in capability that carries tools is declared by the core-tools manifest", () => {
  const declared = new Set<string>(
    toolsManifest(L2_TOOL_CAPABILITIES).plugins.flatMap((plugin) =>
      (plugin.optional ?? []).map((requirement) => requirement.id),
    ),
  );
  const missing = BUILTIN_CAPABILITY_DEFS.filter(
    (def) => def.tools.length > 0 && !NOT_PROVIDED_YET.has(def.id) && !declared.has(def.id),
  ).map((def) => def.id);
  expect(missing).toEqual([]);
  expect(declared.has("knowledge.memory")).toBe(true);
  expect(declared.has("knowledge.search")).toBe(true);
});
