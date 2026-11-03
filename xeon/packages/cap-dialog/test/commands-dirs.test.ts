import { describe, expect, test } from "bun:test";
import type { ScopeLayer } from "@fresnel/contracts/settings";
import { createCommandsService } from "../src/commands/service.ts";
import { callOptions, harness, newThread } from "./support/harness.ts";
import { memoryCommandFiles } from "./support/memory-command-files.ts";

// 설정 `l2.dialog.commands.dirs`의 범위별 규칙(spec §4.2.1a, §6). 저장소가 쓸 수 있는 설정(project, local)은
// 상대 경로만 명령 디렉터리로 받는다. 절대·홈 경로는 user 범위에서만 읽는다.

const KEY = "l2.dialog.commands.dirs";
const HOME_NOTES = "/home/user/Notes/note.md";
const OUTSIDE = "/srv/outside/outside.md";
const INSIDE = "/work/docs/inside.md";

function layer(scope: ScopeLayer["scope"], dirs: readonly string[]): ScopeLayer {
  return { scope, values: new Map([[KEY, [...dirs]]]) };
}

function namesWith(layers: readonly ScopeLayer[], trusted: boolean): Promise<readonly string[]> {
  const commandFiles = memoryCommandFiles({
    [HOME_NOTES]: "메모 설명",
    [OUTSIDE]: "바깥 설명",
    [INSIDE]: "안쪽 설명",
  });
  const h = harness({
    commandFiles,
    layers,
    projectTrusted: () => Promise.resolve(trusted),
  });
  const { api } = createCommandsService(h.deps);
  return api
    .list({}, callOptions(newThread()))
    .then(({ commands }) => commands.map((command) => command.name));
}

describe("commands.dirs의 범위별 규칙", () => {
  test("프로젝트 설정의 홈 경로는 신뢰 여부와 관계없이 읽지 않는다", async () => {
    const layers = [layer("project", ["~/Notes"])];
    expect(await namesWith(layers, true)).toEqual([]);
    expect(await namesWith(layers, false)).toEqual([]);
  });

  test("프로젝트 설정의 절대 경로는 신뢰 여부와 관계없이 읽지 않는다", async () => {
    const layers = [layer("project", ["/srv/outside"])];
    expect(await namesWith(layers, true)).toEqual([]);
    expect(await namesWith(layers, false)).toEqual([]);
  });

  test("local 설정의 절대·홈 경로도 읽지 않는다(저장소 안의 파일이다)", async () => {
    expect(await namesWith([layer("local", ["~/Notes", "/srv/outside"])], true)).toEqual([]);
  });

  test("사용자 설정의 홈·절대 경로는 신뢰 여부와 관계없이 읽는다", async () => {
    const layers = [layer("user", ["~/Notes", "/srv/outside"])];
    expect(await namesWith(layers, true)).toEqual(["note", "outside"]);
    expect(await namesWith(layers, false)).toEqual(["note", "outside"]);
  });

  test("프로젝트 설정의 상대 경로는 신뢰한 프로젝트에서만 읽는다", async () => {
    const layers = [layer("project", ["docs"])];
    expect(await namesWith(layers, true)).toEqual(["inside"]);
    expect(await namesWith(layers, false)).toEqual([]);
  });
});
