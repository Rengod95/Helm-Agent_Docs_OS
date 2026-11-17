// 로더의 격리 연결 시험(F5, 2026-11-17 결정). 실제 임시 디렉터리의 외부 확장을 싣고, 띄우기 포트는 메모리 파이프로 실제 자식을 돌린다.
// 실효 판정은 effective.test.ts가 표로 본다. 여기서는 로더가 그 결정을 설치, 진단, 보고, 다시 읽기에 옮기는지 본다.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionName, LoaderPaths } from "@fresnel/contracts/extensions";
import type { PluginHostSupervisor } from "../../src/isolation/supervisor.ts";
import type {
  LoadDiagnostic,
  LoadOptions,
  LoaderIsolation,
} from "../../src/loading-trust/index.ts";
import {
  createFakeProcessPort,
  createManualClock,
  until,
  type FakeProcessPort,
  type ManualClock,
} from "../isolation/support/fake-process.ts";
import { createLoaderHarness, type LoaderHarness } from "./support/harness.ts";
import { writePlugin } from "./support/plugin-fixture.ts";
import { makeTempDir, realLoaderFs } from "./support/real-fs.ts";

/** 빈 등록을 하는 외부 확장 엔트리. 엔진 안에서도 자식에서도 import 없이 돈다 */
const ENGINE_ENTRY = `export const extension = ({ register }) => {
  register("iso", {}, (g) => {
    g.on("boundary.settle.after", () => {});
  });
};
`;

/** `hostOf(g)`로 격리에서 쓸 수 없는 API를 setup에서 부른다. 자식은 `unsupported_api`로 답한다 */
function unsupportedEntry(api: string): string {
  return `import { hostOf } from "@fresnel/ext-host";
export const extension = ({ register }) => {
  register("iso", {}, (g) => {
    hostOf(g).${api}(${api === "provide" ? "" : "() => ({})"});
  });
};
`;
}

interface Supervised {
  readonly name: ExtensionName;
  readonly supervisor: PluginHostSupervisor;
}

let temp: Awaited<ReturnType<typeof makeTempDir>>;
let paths: LoaderPaths;
let userExtensions: string;
let project: string;

beforeEach(async () => {
  temp = await makeTempDir();
  paths = { userDir: join(temp.dir, "user"), managedDir: null, homeDir: join(temp.dir, "home") };
  userExtensions = join(paths.userDir, "extensions");
  project = join(temp.dir, "project");
  await mkdir(project, { recursive: true });
});

afterEach(async () => {
  await temp.cleanup();
});

interface Rig {
  readonly harness: LoaderHarness;
  readonly port: FakeProcessPort;
  readonly clock: ManualClock;
  readonly supervised: Supervised[];
}

/** 격리 포트와 시계가 있는 로더. `isolated`가 거짓이면 포트를 주지 않는다 */
async function rigOf(
  options: { readonly isolated?: boolean; readonly isolation?: boolean } = {},
): Promise<Rig> {
  const port = createFakeProcessPort();
  const clock = createManualClock();
  const supervised: Supervised[] = [];
  const isolation: LoaderIsolation = {
    launch: () => ({ command: "plugin-host", args: [], env: {} }),
    setTimer: clock.setTimer,
    initTimeoutMs: 1000,
    onSupervisor: (name, supervisor) => {
      supervised.push({ name, supervisor });
    },
  };
  const harness = await createLoaderHarness({
    loader: {
      fs: realLoaderFs,
      paths,
      ...(options.isolated === false ? {} : { process: port }),
      ...(options.isolation === false ? {} : { isolation }),
    },
  });
  return { harness, port, clock, supervised };
}

function loadOptions(harness: LoaderHarness, extra: Partial<LoadOptions> = {}): LoadOptions {
  return harness.options([], { cwd: project, ...extra });
}

function codesOf(diagnostics: readonly LoadDiagnostic[], extension: string): string[] {
  return diagnostics.filter((entry) => entry.extension === extension).map((entry) => entry.code);
}

async function fire(harness: LoaderHarness): Promise<void> {
  const thread = harness.t.newThread();
  await harness.t.host.openThread(thread);
  await harness.t.host.dispatch(
    "boundary.settle.after",
    { turnId: harness.t.ids.next("trn"), aborted: false },
    { threadId: thread, dispatchKey: "k" },
  );
}

test("an isolated extension loads in its own process and reports isolation process", async () => {
  const rig = await rigOf();
  await writePlugin(userExtensions, "iso", { name: "iso", entry: ENGINE_ENTRY });
  const report = await rig.harness.loader.loadAll(loadOptions(rig.harness));
  const info = report.extensions.find((entry) => entry.name === "iso");
  expect(info?.state).toBe("active");
  expect(info?.isolation).toBe("process");
  expect(rig.port.children.length).toBe(1);
  expect(rig.supervised.map((entry) => entry.name)).toEqual(["iso"]);

  // 호출이 실제로 자식에 간다
  await fire(rig.harness);
  expect(rig.port.children[0]?.received()).toContain('"boundary.settle.after"');
  await rig.harness.loader.dispose();
});

test("a default extension with no process port runs in the engine and reports isolation none", async () => {
  const rig = await rigOf({ isolated: false, isolation: false });
  await writePlugin(userExtensions, "iso", { name: "iso", entry: ENGINE_ENTRY });
  const report = await rig.harness.loader.loadAll(loadOptions(rig.harness));
  expect(report.extensions.map((entry) => [entry.name, entry.state, entry.isolation])).toEqual([
    ["iso", "active", "none"],
  ]);
  expect(rig.port.children.length).toBe(0);
  await rig.harness.loader.dispose();
});

test("an explicit process setting without the port is refused as isolation_unavailable", async () => {
  const rig = await rigOf({ isolated: false });
  rig.harness.settings.isolation.set("iso", "process");
  await writePlugin(userExtensions, "iso", { name: "iso", entry: ENGINE_ENTRY });
  const report = await rig.harness.loader.loadAll(loadOptions(rig.harness));
  const info = report.extensions.find((entry) => entry.name === "iso");
  expect(info?.state).toBe("error");
  expect(info?.isolation).toBe("none");
  const diagnostic = report.diagnostics.find((entry) => entry.code === "isolation_unavailable");
  expect(diagnostic?.stage).toBe("isolation");
  expect(diagnostic?.severity).toBe("error");
  expect(diagnostic?.extension).toBe("iso");
  await rig.harness.loader.dispose();
});

test("an explicit manifest process without the port is refused as isolation_unavailable", async () => {
  const rig = await rigOf({ isolated: false });
  await writePlugin(userExtensions, "iso", {
    name: "iso",
    entry: ENGINE_ENTRY,
    isolation: "process",
  });
  const report = await rig.harness.loader.loadAll(loadOptions(rig.harness));
  expect(report.extensions.find((entry) => entry.name === "iso")?.state).toBe("error");
  expect(codesOf(report.diagnostics, "iso")).toContain("isolation_unavailable");
  await rig.harness.loader.dispose();
});

test("an explicit process setting with drives is refused as isolation_drive_unsupported", async () => {
  const rig = await rigOf();
  rig.harness.settings.isolation.set("iso", "process");
  await writePlugin(userExtensions, "iso", {
    name: "iso",
    entry: ENGINE_ENTRY,
    group: true,
    layer: "L3",
    drives: true,
  });
  const report = await rig.harness.loader.loadAll(loadOptions(rig.harness));
  const info = report.extensions.find((entry) => entry.name === "iso");
  expect(info?.state).toBe("error");
  expect(info?.isolation).toBe("none");
  expect(codesOf(report.diagnostics, "iso")).toContain("isolation_drive_unsupported");
  expect(rig.port.children.length).toBe(0);
  await rig.harness.loader.dispose();
});

test("a default extension with drives runs in the engine even with a port", async () => {
  const rig = await rigOf();
  await writePlugin(userExtensions, "iso", {
    name: "iso",
    entry: ENGINE_ENTRY,
    group: true,
    layer: "L3",
    drives: true,
  });
  const report = await rig.harness.loader.loadAll(loadOptions(rig.harness));
  const info = report.extensions.find((entry) => entry.name === "iso");
  expect(info?.state).toBe("active");
  expect(info?.isolation).toBe("none");
  expect(codesOf(report.diagnostics, "iso")).not.toContain("isolation_drive_unsupported");
  expect(rig.port.children.length).toBe(0);
  await rig.harness.loader.dispose();
});

test("a setting none runs an extension in the engine even with a port", async () => {
  const rig = await rigOf();
  rig.harness.settings.isolation.set("iso", "none");
  await writePlugin(userExtensions, "iso", {
    name: "iso",
    entry: ENGINE_ENTRY,
    isolation: "process",
  });
  const report = await rig.harness.loader.loadAll(loadOptions(rig.harness));
  const info = report.extensions.find((entry) => entry.name === "iso");
  expect(info?.state).toBe("active");
  expect(info?.isolation).toBe("none");
  expect(rig.port.children.length).toBe(0);
  await rig.harness.loader.dispose();
});

test("an isolated extension that uses registerShortcut fails to load with isolation_protocol naming the API", async () => {
  const rig = await rigOf();
  await writePlugin(userExtensions, "iso", {
    name: "iso",
    entry: unsupportedEntry("registerShortcut"),
  });
  const report = await rig.harness.loader.loadAll(loadOptions(rig.harness));
  const info = report.extensions.find((entry) => entry.name === "iso");
  expect(info?.state).toBe("error");
  expect(info?.isolation).toBe("none");
  const diagnostic = report.diagnostics.find((entry) => entry.code === "isolation_protocol");
  expect(diagnostic?.extension).toBe("iso");
  expect(diagnostic?.message).toContain("registerShortcut");
  await rig.harness.loader.dispose();
});

test("an isolated extension that uses provide fails to load with isolation_protocol naming the API", async () => {
  const rig = await rigOf();
  await writePlugin(userExtensions, "iso", { name: "iso", entry: unsupportedEntry("provide") });
  const report = await rig.harness.loader.loadAll(loadOptions(rig.harness));
  expect(report.extensions.find((entry) => entry.name === "iso")?.state).toBe("error");
  const diagnostic = report.diagnostics.find((entry) => entry.code === "isolation_protocol");
  expect(diagnostic?.message).toContain("provide");
  await rig.harness.loader.dispose();
});

test("reloading an isolated extension starts a new supervisor and disposes the old one after the swap", async () => {
  const rig = await rigOf();
  await writePlugin(userExtensions, "iso", { name: "iso", entry: ENGINE_ENTRY });
  await rig.harness.loader.loadAll(loadOptions(rig.harness));
  expect(rig.supervised.length).toBe(1);
  const old = rig.supervised[0]?.supervisor;

  const started = await rig.harness.loader.reload("iso", new AbortController().signal);
  expect(started.ok).toBe(true);
  if (!started.ok) return;
  const applied = await started.value.applied;
  expect(applied.status).toBe("applied");

  expect(rig.supervised.length).toBe(2);
  const fresh = rig.supervised[1]?.supervisor;
  expect(fresh).toBeDefined();
  expect(fresh).not.toBe(old);
  expect(fresh?.status().state).toBe("running");
  // 옛 자식은 `reload` 사유로 내려간다
  expect(rig.port.children[0]?.received()).toContain('"reason":"reload"');
  await until(() => old?.status().state === "stopped", "the old supervisor to stop");
  await rig.harness.loader.dispose();
});
