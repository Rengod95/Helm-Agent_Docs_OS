import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { recordingModels } from "../fixtures/recording-tape.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// M5c §4.4.10, §4.5.2, §4.7.9, 수용 34 (int, 실제 엔진): 프로젝트를 등록하면 그 폴더의 `.fresnel/extensions/<이름>`이 `project` 출처의
// 검토 항목이 된다. 승인 전에는 그 플러그인의 코드가 돌지 않는다(표지 파일이 생기지 않는다). 승인하면 검토본에서 실린다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const CARRIED = "proj-carried";

/** 프로젝트 폴더의 동반 플러그인. 엔트리가 실행되면 `marker`에 파일을 쓴다. 이름을 생략하면 `CARRIED`다 */
function projectExtension(project: string, marker: string, name: string = CARRIED): void {
  const root = join(project, ".fresnel", "extensions", name);
  mkdirSync(join(root, ".fresnel-plugin"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, ".fresnel-plugin", "plugin.json"),
    JSON.stringify({
      schemaVersion: 2,
      name,
      version: "1.0.0",
      purpose: "Carried by the project",
      description: "Carried by the project so it runs there after approval.",
      entry: "./src/index.ts",
      plugins: [{ layer: "plugin", hooks: ["boundary.settle.after"] }],
    }),
  );
  writeFileSync(
    join(root, "src", "index.ts"),
    `import { writeFileSync } from "node:fs";
export const extension = ({ register }) => {
  writeFileSync(${JSON.stringify(marker)}, "loaded");
  register(${JSON.stringify(name)}, {}, (g) => {
    g.on("boundary.settle.after", () => {});
  });
};
`,
  );
}

realTest(
  "a project's carried plugin is a project review item and does not run until approved; approval loads it from the reviewed copy",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const base = realpathSync(mkdtempSync(join(tmpdir(), "xh-project-plugin-")));
    const project = join(base, "project");
    const marker = join(base, "carried.marker");
    mkdirSync(project, { recursive: true });
    projectExtension(project, marker);
    const model = recordingModels("project-plugin", ["one."], { contextWindow: 200_000 });
    const previousCwd = process.cwd();
    process.chdir(base);
    // 격리 포트 없이 엔진 안에서 돈다. 격리 샌드박스는 이 기기에서 시험할 수 없다(`mcp-sandbox.int.test.ts`와 같다)
    const host = await startInProcessHost({
      devChecks: true,
      buildModels: model.buildModels,
      pluginHost: { disabled: true },
    });
    const connection = createHostConnection(host.client);
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      // 시작 때는 프로젝트가 없어 아무것도 싣지 않는다
      expect(existsSync(marker)).toBe(false);

      // 프로젝트를 등록한다. 등록이 그 루트를 훑어 동반 플러그인을 검토 항목으로 만든다
      await connection.request("project.create", { root: project });
      const listed = await connection.request("pluginReview.list", {});
      const carried = listed.items.filter((item) => item.name === CARRIED);
      expect(carried.map((item) => [item.provenance, item.state])).toEqual([
        ["project", "pending"],
      ]);
      const itemId = carried[0]?.itemId;
      if (itemId === undefined) throw new Error("the project plugin has no review item");

      // 신뢰하고 작업 폴더를 열어도 승인 전에는 돌지 않는다(검토본이 없어 적재할 것이 없다)
      await connection.request("trust.decide", {
        workspace: project,
        choice: { kind: "session", verdict: "allow" },
      });
      await connection.request("thread.create", { workspace: project });
      expect(existsSync(marker)).toBe(false);

      // 승인하면 검토본에서 실린다
      const decided = await connection.request("pluginReview.decide", {
        itemId,
        decision: { kind: "approve", profileIds: [], libraryOnly: true },
      });
      expect(decided.item.state).toBe("approved");
      await connection.request("thread.create", { workspace: project });
      expect(existsSync(marker)).toBe(true);
      expect(readFileSync(marker, "utf8")).toBe("loaded");
    } finally {
      await connection.close();
      await host.close();
      process.chdir(previousCwd);
      rmSync(base, { recursive: true, force: true });
      home.dispose();
    }
  },
  60_000,
);

realTest(
  "project.get counts the pending review items of that project only: the project with a carried plugin says 1 until it is approved, a project without one says 0",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const base = realpathSync(mkdtempSync(join(tmpdir(), "xh-project-pending-")));
    const carrying = join(base, "carrying");
    const plain = join(base, "plain");
    mkdirSync(carrying, { recursive: true });
    mkdirSync(plain, { recursive: true });
    projectExtension(carrying, join(base, "carried.marker"));
    const model = recordingModels("project-pending", ["one."], { contextWindow: 200_000 });
    const previousCwd = process.cwd();
    process.chdir(base);
    const host = await startInProcessHost({
      devChecks: true,
      buildModels: model.buildModels,
      pluginHost: { disabled: true },
    });
    const connection = createHostConnection(host.client);
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      const withPlugin = await connection.request("project.create", { root: carrying });
      const without = await connection.request("project.create", { root: plain });
      expect(
        (await connection.request("project.get", { projectId: withPlugin.project.projectId }))
          .pendingReview,
      ).toBe(1);
      expect(
        (await connection.request("project.get", { projectId: without.project.projectId }))
          .pendingReview,
      ).toBe(0);

      const listed = await connection.request("pluginReview.list", { state: "pending" });
      const itemId = listed.items.find((item) => item.name === CARRIED)?.itemId;
      if (itemId === undefined) throw new Error("the project plugin has no review item");
      await connection.request("pluginReview.decide", {
        itemId,
        decision: { kind: "approve", profileIds: [], libraryOnly: true },
      });
      expect(
        (await connection.request("project.get", { projectId: withPlugin.project.projectId }))
          .pendingReview,
      ).toBe(0);
    } finally {
      await connection.close();
      await host.close();
      process.chdir(previousCwd);
      rmSync(base, { recursive: true, force: true });
      home.dispose();
    }
  },
  60_000,
);

// AGE-34: `project.list`의 `pendingReviewCount`는 `project.get`의 `pendingReview`와 같은 값이고, `rootMissing`은 루트가 사라진 프로젝트만 참이다
realTest(
  "project.list gives each project its pending review count and its root state: two carried plugins make 2, one approved makes 1, a removed root is rootMissing",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const base = realpathSync(mkdtempSync(join(tmpdir(), "xh-project-list-pending-")));
    const carrying = join(base, "carrying");
    const plain = join(base, "plain");
    mkdirSync(carrying, { recursive: true });
    mkdirSync(plain, { recursive: true });
    projectExtension(carrying, join(base, "carried.marker"));
    projectExtension(carrying, join(base, "second.marker"), "proj-second");
    const model = recordingModels("project-list-pending", ["one."], { contextWindow: 200_000 });
    const previousCwd = process.cwd();
    process.chdir(base);
    const host = await startInProcessHost({
      devChecks: true,
      buildModels: model.buildModels,
      pluginHost: { disabled: true },
    });
    const connection = createHostConnection(host.client);
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      const carriedProject = await connection.request("project.create", {
        root: carrying,
        name: "carrying",
      });
      await connection.request("project.create", { root: plain, name: "plain" });
      const counted = await connection.request("project.list", {});
      expect(
        counted.projects.map((item) => [item.name, item.pendingReviewCount, item.rootMissing]),
      ).toEqual([
        ["carrying", 2, false],
        ["plain", 0, false],
      ]);
      const listed = await connection.request("pluginReview.list", { state: "pending" });
      const itemId = listed.items.find((item) => item.name === "proj-second")?.itemId;
      if (itemId === undefined) throw new Error("the second project plugin has no review item");
      await connection.request("pluginReview.decide", {
        itemId,
        decision: { kind: "approve", profileIds: [], libraryOnly: true },
      });
      rmSync(plain, { recursive: true, force: true });
      const after = await connection.request("project.list", {});
      expect(
        after.projects.map((item) => [item.name, item.pendingReviewCount, item.rootMissing]),
      ).toEqual([
        ["carrying", 1, false],
        ["plain", 0, true],
      ]);
      // 목록의 수와 한 건 읽기의 수가 같다
      expect(
        (
          await connection.request("project.get", {
            projectId: carriedProject.project.projectId,
          })
        ).pendingReview,
      ).toBe(1);
    } finally {
      await connection.close();
      await host.close();
      process.chdir(previousCwd);
      rmSync(base, { recursive: true, force: true });
      home.dispose();
    }
  },
  60_000,
);
