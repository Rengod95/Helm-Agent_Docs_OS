import { describe, expect, test } from "bun:test";
import { CapabilityError, type CommandInfo } from "@xeon/contracts/capabilities";
import { createCommandsService } from "../src/commands/service.ts";
import { memoryCommandFiles } from "./support/memory-command-files.ts";
import { callOptions, harness, newThread } from "./support/harness.ts";

const PROJECT = "/work/.xeon/commands";
const USER = "/home/user/.xeon/commands";

async function rejection(promise: Promise<unknown>): Promise<CapabilityError> {
  try {
    await promise;
  } catch (caught) {
    if (caught instanceof CapabilityError) return caught;
    throw caught;
  }
  throw new Error("expected a CapabilityError");
}

function names(commands: readonly CommandInfo[]): string[] {
  return commands.map((command) => `${command.name}@${command.source}`);
}

describe("명령 우선순위", () => {
  test("다섯 출처에 같은 이름이 있으면 builtin이 쓰이고 나머지는 includeHidden에서만 보인다", async () => {
    const commandFiles = memoryCommandFiles({
      [`${PROJECT}/dup.md`]: "project body",
      [`${USER}/dup.md`]: "user body",
    });
    const h = harness({ commandFiles });
    const { api } = createCommandsService(h.deps);
    await api.register({
      name: "dup",
      description: "cap",
      template: "capability body",
      origin: "grp",
    });
    api.declareBuiltin([{ name: "dup", description: "builtin", origin: "cli" }]);

    const shown = await api.list({}, callOptions(newThread()));
    expect(names(shown.commands)).toEqual(["dup@builtin"]);
    const all = await api.list({ includeHidden: true }, callOptions(newThread()));
    expect(names(all.commands)).toEqual([
      "dup@builtin",
      "dup@capability",
      "dup@project",
      "dup@user",
    ]);
  });

  test("builtin이 이긴 이름은 expand와 run이 명령으로 보지 않는다", async () => {
    const h = harness();
    const { api } = createCommandsService(h.deps);
    await api.register({
      name: "dup",
      description: "cap",
      template: "capability body",
      origin: "grp",
    });
    api.declareBuiltin([{ name: "dup", description: "builtin", origin: "cli" }]);
    const options = callOptions(newThread(), { requestId: "r" });
    expect(await api.expand({ text: "/dup" }, options)).toEqual({ matched: false });
    expect(await api.run({ text: "/dup" }, options)).toEqual({ status: "not_command" });
  });

  test("프로젝트 > 사용자: 프로젝트 것이 쓰이고 사용자 것은 includeHidden에서만 보인다", async () => {
    const commandFiles = memoryCommandFiles({
      [`${PROJECT}/review.md`]: "from project $1",
      [`${USER}/review.md`]: "from user $1",
      [`${USER}/only-user.md`]: "only user",
    });
    const h = harness({ commandFiles });
    const { api } = createCommandsService(h.deps);
    const options = callOptions(newThread(), { requestId: "r" });
    expect(await api.run({ text: "/review x" }, options)).toEqual({
      status: "expanded",
      name: "review",
      text: "from project x",
    });
    expect(names((await api.list({}, options)).commands)).toEqual([
      "only-user@user",
      "review@project",
    ]);
    expect(names((await api.list({ includeHidden: true }, options)).commands)).toEqual([
      "only-user@user",
      "review@project",
      "review@user",
    ]);
  });

  test("capability가 파일 명령보다 앞선다", async () => {
    const commandFiles = memoryCommandFiles({ [`${PROJECT}/goal.md`]: "file body" });
    const h = harness({ commandFiles });
    const { api } = createCommandsService(h.deps);
    await api.register({ name: "goal", description: "cap", template: "cap body", origin: "grp" });
    const run = await api.run({ text: "/goal" }, callOptions(newThread(), { requestId: "r" }));
    expect(run).toEqual({ status: "expanded", name: "goal", text: "cap body" });
  });

  test("capability 중복 등록은 command_name_taken이다", async () => {
    const h = harness();
    const { api } = createCommandsService(h.deps);
    await api.register({ name: "dup", description: "a", template: "a", origin: "one" });
    const error = await rejection(
      api.register({ name: "dup", description: "b", template: "b", origin: "two" }),
    );
    expect(error.data.code).toBe("command_name_taken");
    api.registerAction({ name: "act", description: "x", origin: "one" }, () =>
      Promise.resolve({ message: null }),
    );
    let thrown: unknown;
    try {
      api.registerAction({ name: "act", description: "y", origin: "two" }, () =>
        Promise.resolve({ message: null }),
      );
    } catch (caught) {
      thrown = caught;
    }
    expect(thrown).toBeInstanceOf(CapabilityError);
    expect(thrown instanceof CapabilityError ? thrown.data.code : "").toBe("command_name_taken");
  });

  test("prefix 필터와 이름 순서", async () => {
    const commandFiles = memoryCommandFiles({
      [`${PROJECT}/zeta.md`]: "z",
      [`${PROJECT}/review.md`]: "r",
      [`${PROJECT}/research.md`]: "s",
    });
    const h = harness({ commandFiles });
    const { api } = createCommandsService(h.deps);
    const found = await api.list({ prefix: "re" }, callOptions(newThread()));
    expect(found.commands.map((command) => command.name)).toEqual(["research", "review"]);
  });

  test("설정 디렉터리의 명령은 user 출처이고 홈과 프로젝트 기준 경로를 푼다", async () => {
    const commandFiles = memoryCommandFiles({
      "/home/user/shared/a.md": "a",
      "/work/team/b.md": "b",
      "/abs/c.md": "c",
    });
    const h = harness({
      commandFiles,
      layers: [
        {
          scope: "user",
          values: new Map([["l2.dialog.commands.dirs", ["~/shared", "team", "/abs", "/missing"]]]),
        },
      ],
    });
    const { api } = createCommandsService(h.deps);
    const listed = await api.list({}, callOptions(newThread()));
    expect(names(listed.commands)).toEqual(["a@user", "b@user", "c@user"]);
  });

  test("신뢰하지 않은 프로젝트 폴더는 명령 디렉터리와 그 폴더 기준 상대 경로 디렉터리를 읽지 않는다 (G1-03)", async () => {
    const commandFiles = memoryCommandFiles({
      [`${PROJECT}/p.md`]: "p",
      [`${USER}/u.md`]: "u",
      "/work/team/b.md": "b",
      "/abs/c.md": "c",
    });
    const layers = [
      {
        scope: "user" as const,
        values: new Map([["l2.dialog.commands.dirs", ["team", "/abs"]]]),
      },
    ];
    const untrusted = harness({
      commandFiles,
      layers,
      projectTrusted: () => Promise.resolve(false),
    });
    expect(
      names(
        (await createCommandsService(untrusted.deps).api.list({}, callOptions(newThread())))
          .commands,
      ),
    ).toEqual(["c@user", "u@user"]);
    // 같은 파일이라도 신뢰하면 프로젝트 명령과 상대 경로 디렉터리가 보인다
    const trusted = harness({ commandFiles, layers, projectTrusted: () => Promise.resolve(true) });
    expect(
      names(
        (await createCommandsService(trusted.deps).api.list({}, callOptions(newThread()))).commands,
      ),
    ).toEqual(["b@user", "c@user", "p@project", "u@user"]);
  });

  test("프로젝트 폴더를 모르면 상대 경로 디렉터리와 프로젝트 명령 디렉터리를 건너뛴다", async () => {
    const commandFiles = memoryCommandFiles({
      [`${PROJECT}/p.md`]: "p",
      [`${USER}/u.md`]: "u",
      "/work/team/b.md": "b",
    });
    const h = harness({
      commandFiles,
      projectRoot: () => null,
      layers: [{ scope: "user", values: new Map([["l2.dialog.commands.dirs", ["team"]]]) }],
    });
    const { api } = createCommandsService(h.deps);
    expect(names((await api.list({}, callOptions(newThread()))).commands)).toEqual(["u@user"]);
  });
});
