import { expect, test } from "bun:test";
import {
  findTrustRequiringResources,
  TRUST_REQUIRING_PROJECT_RESOURCES,
} from "../../src/loading-trust/index.ts";
import { readDoc, tableRowsAfter } from "../support/docs.ts";
import { memoryFs } from "./support/trust-fakes.ts";

test("bare dir needs no trust", async () => {
  // 빈 .fresnel 디렉터리와 컨텍스트 파일은 신뢰를 요구하지 않는다
  const fs = memoryFs(["/work/proj/.fresnel", "/work/proj/AGENTS.md", "/work/proj/CLAUDE.md"]);
  expect(await findTrustRequiringResources(fs, "/work/proj")).toEqual([]);
});

test("each trust-requiring resource is found with its relative path", async () => {
  const everything = TRUST_REQUIRING_PROJECT_RESOURCES.map((entry) => `/work/proj/${entry}`);
  const fs = memoryFs(everything);
  expect(await findTrustRequiringResources(fs, "/work/proj")).toEqual([
    ...TRUST_REQUIRING_PROJECT_RESOURCES,
  ]);
  const one = memoryFs(["/work/proj/.fresnel/extensions"]);
  expect(await findTrustRequiringResources(one, "/work/proj")).toEqual([".fresnel/extensions"]);
});

test("the shared .agents/skills in the project or above is not a trust-requiring resource (M5g-2)", async () => {
  // 부정 시험: 엔진은 `.agents/skills`를 보지도 읽지도 않는다. 그래서 이 폴더만 있으면 판정이 필요 없다
  const root = memoryFs(["/work/proj/.agents/skills"]);
  expect(await findTrustRequiringResources(root, "/work/proj")).toEqual([]);
  const ancestor = memoryFs(["/work/.agents/skills", "/.agents/skills"]);
  expect(await findTrustRequiringResources(ancestor, "/work/proj")).toEqual([]);
});

test("only existence is checked, file contents are never read", async () => {
  let reads = 0;
  const fs = {
    ...memoryFs(["/work/proj/.fresnel/mcp.json"]),
    readText: () => {
      reads += 1;
      return Promise.resolve(null);
    },
  };
  expect(await findTrustRequiringResources(fs, "/work/proj")).toEqual([".fresnel/mcp.json"]);
  expect(reads).toBe(0);
});

test("a project .fresnel/commands alone requires trust", async () => {
  // 명령 파일은 모델에게 가는 프롬프트 본문이고 셸 주입을 담을 수 있다(L2.dialog.spec 4.2.1a). 이 폴더만 있어도 판정이 필요하다
  const fs = memoryFs(["/work/proj/.fresnel/commands"]);
  expect(await findTrustRequiringResources(fs, "/work/proj")).toEqual([".fresnel/commands"]);
});

test("a project-root .mcp.json alone does not require trust, the fresnel one does (M5g-2)", async () => {
  // 부정 시험: 루트 `.mcp.json`은 엔진이 읽지 않으므로 신뢰 자원이 아니다. `.fresnel/mcp.json`은 여전히 자원이다
  expect(
    await findTrustRequiringResources(memoryFs(["/work/proj/.mcp.json"]), "/work/proj"),
  ).toEqual([]);
  expect(
    await findTrustRequiringResources(memoryFs(["/work/proj/.fresnel/mcp.json"]), "/work/proj"),
  ).toEqual([".fresnel/mcp.json"]);
});

test("docs: the resource list matches the spec table", async () => {
  const spec = await readDoc("X/loading-trust/spec.md");
  const rows = tableRowsAfter(spec, "#### 4.7.2 신뢰 필요 자원");
  const documented = rows
    .flatMap((cells) => [...(cells[0] ?? "").matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? ""))
    .map((path) => path.replace(/\/$/, ""))
    .filter(
      (path) => path.startsWith(".fresnel/") || path === ".mcp.json" || path === ".agents/skills",
    );
  // 표가 `.mcp.json`이나 `.agents/skills`를 신뢰 자원으로 적으면 안 된다(M5g-2). 목록은 `.fresnel/` 아래만이다
  expect(documented.toSorted()).toEqual([...TRUST_REQUIRING_PROJECT_RESOURCES].toSorted());
});
