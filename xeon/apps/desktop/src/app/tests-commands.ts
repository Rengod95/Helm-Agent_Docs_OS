import { DEV_MODE_SETTING_KEY } from "@fresnel/client/workbench";
import { err, ok, type Result } from "@fresnel/contracts";
import type { HostConnection } from "@fresnel/contracts/wire";
import type { CommandError, TestCommands } from "../views/commands.ts";

// 테스트 화면(P-19)이 부르는 wire. 읽기는 연결이 있으면 되고, 실행과 Test run 제어는 쓰기 연결을 거친다(엔진 대상 전환 중이면 거절).
// 기대한 실패(`ok: false`의 `error`)는 transport 오류가 아니라 값이다. 연결이 없거나 구형 host일 때만 `CommandError`다.

type Run = <T>(
  work: (connection: HostConnection) => Promise<T>,
) => Promise<Result<T, CommandError>>;

export function createTestCommands(read: Run, write: Run): TestCommands {
  return {
    async list() {
      const listed = await read((c) => c.request("ext.test.list", {}));
      return listed.ok ? ok(listed.value.tests) : err(listed.error);
    },
    async devMode() {
      const got = await read((c) => c.request("settings.get", { keys: [DEV_MODE_SETTING_KEY] }));
      if (got.ok) return ok(got.value.settings[0]?.value === true);
      // 호스트가 이 키를 모르면(`settings.unknownKey`) 개발 모드가 아니다. 연결이 없을 때만 오류다
      return got.error.kind === "offline" ? err(got.error) : ok(false);
    },
    async run(params) {
      const started = await write((c) => c.request("ext.test.run", params));
      return started.ok ? ok(started.value) : err(started.error);
    },
    async createTestRun(profileId?: string) {
      const created = await write((c) =>
        c.request(
          "thread.create",
          profileId === undefined ? { testRun: true } : { testRun: true, profileId },
        ),
      );
      return created.ok ? ok(created.value.threadId) : err(created.error);
    },
    async pause(threadId: string) {
      const done = await write((c) => c.request("testRun.pause", { threadId }));
      return done.ok ? ok(done.value.paused) : err(done.error);
    },
    async resume(threadId: string) {
      const done = await write((c) => c.request("testRun.resume", { threadId }));
      return done.ok ? ok(done.value.paused) : err(done.error);
    },
    async step(threadId: string) {
      const done = await write((c) => c.request("testRun.step", { threadId }));
      return done.ok ? ok(done.value.paused) : err(done.error);
    },
    phase: (threadId: string) => read((c) => c.request("testRun.phase", { threadId })),
  };
}
