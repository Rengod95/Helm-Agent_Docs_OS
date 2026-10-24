import { expect, test } from "bun:test";
import {
  findTrustRequiringResources,
  TRUST_REQUIRING_PROJECT_RESOURCES,
} from "../../src/loading-trust/index.ts";
import { readDoc, tableRowsAfter } from "../support/docs.ts";
import { memoryFs } from "./support/trust-fakes.ts";

const HOME = "/home/test";

test("bare dir needs no trust", async () => {
  // 빈 .xeon 디렉터리와 컨텍스트 파일은 신뢰를 요구하지 않는다
  const fs = memoryFs(["/work/proj/.xeon", "/work/proj/AGENTS.md", "/work/proj/CLAUDE.md"]);
  expect(await findTrustRequiringResources(fs, "/work/proj", HOME)).toEqual([]);
});

test("each trust-requiring resource is found with its relative path", async () => {
  const everything = TRUST_REQUIRING_PROJECT_RESOURCES.map((entry) => `/work/proj/${entry}`);
  const fs = memoryFs(everything);
  expect(await findTrustRequiringResources(fs, "/work/proj", HOME)).toEqual([
    ...TRUST_REQUIRING_PROJECT_RESOURCES,
  ]);
  const one = memoryFs(["/work/proj/.xeon/extensions"]);
  expect(await findTrustRequiringResources(one, "/work/proj", HOME)).toEqual([".xeon/extensions"]);
});

test("shared skills are found in the project root and its ancestors, never in the user's home", async () => {
  const root = memoryFs(["/work/proj/.agents/skills"]);
  expect(await findTrustRequiringResources(root, "/work/proj", HOME)).toEqual([".agents/skills"]);

  const ancestor = memoryFs(["/work/.agents/skills"]);
  expect(await findTrustRequiringResources(ancestor, "/work/proj", HOME)).toEqual([
    "../.agents/skills",
  ]);

  // 사용자 홈의 스킬은 사용자 자원이다. 홈 아래 프로젝트에서도, 프로젝트 루트가 홈이어도 제외한다
  const home = memoryFs([`${HOME}/.agents/skills`]);
  expect(await findTrustRequiringResources(home, `${HOME}/proj`, HOME)).toEqual([]);
  expect(await findTrustRequiringResources(home, HOME, HOME)).toEqual([]);
  // 홈이 아닌 같은 이름 디렉터리는 센다
  const other = memoryFs(["/home/other/.agents/skills"]);
  expect(await findTrustRequiringResources(other, "/home/other/proj", HOME)).toEqual([
    "../.agents/skills",
  ]);
});

test("only existence is checked, file contents are never read", async () => {
  let reads = 0;
  const fs = {
    ...memoryFs(["/work/proj/.xeon/mcp.json"]),
    readText: () => {
      reads += 1;
      return Promise.resolve(null);
    },
  };
  expect(await findTrustRequiringResources(fs, "/work/proj", HOME)).toEqual([".xeon/mcp.json"]);
  expect(reads).toBe(0);
});

test("a project-root .mcp.json alone requires trust", async () => {
  // 루트 .mcp.json은 stdio 서버 실행 명령을 담는다. .xeon 없이 이 파일만 있어도 신뢰 판정이 필요하다
  const fs = memoryFs(["/work/proj/.mcp.json"]);
  expect(await findTrustRequiringResources(fs, "/work/proj", HOME)).toEqual([".mcp.json"]);
});

test("docs: the resource list matches the spec table", async () => {
  const spec = await readDoc("X/loading-trust/spec.md");
  const rows = tableRowsAfter(spec, "#### 4.7.2 신뢰 필요 자원");
  const documented = rows
    .flatMap((cells) => [...(cells[0] ?? "").matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? ""))
    .map((path) => path.replace(/\/$/, ""))
    .filter((path) => path.startsWith(".xeon/") || path === ".mcp.json");
  expect(documented.toSorted()).toEqual([...TRUST_REQUIRING_PROJECT_RESOURCES].toSorted());
});
