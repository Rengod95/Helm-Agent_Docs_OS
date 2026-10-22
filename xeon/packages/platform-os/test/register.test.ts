import { describe, expect, test } from "bun:test";
import { OsPortKey } from "@xeon/contracts/services";
import { createExtHost } from "@xeon/ext-host";
import { createIdFactory, platformOsPlugin } from "../src/index.ts";
import { eventOf } from "./support/json.ts";
import { manualClock, seededRandom } from "./support/clock.ts";
import { fakeRuntime } from "./support/runtime.ts";

// 실제 ExtHost.registerPlatform으로 등록한다(L0.os.spec §3.10, X.primitives.spec §3.2)
function newHost() {
  const clock = manualClock();
  return createExtHost({
    ids: createIdFactory(clock, seededRandom(9)),
    now: () => clock.now(),
    setTimer: (ms, fn) => {
      const handle = clock.setTimeout(fn, ms);
      return () => clock.clearTimeout(handle);
    },
    settings: {
      driveDefaultLimits: () => ({}),
      driveLimits: () => ({}),
      activeDriveGroup: () => null,
      capabilityProviders: () => ({}),
    },
    report: () => {},
  });
}

describe("ExtHost.registerPlatform", () => {
  test("등록하면 xeon.os 포트가 조회되고 dispose가 서비스를 내린다", async () => {
    const lines: string[] = [];
    const host = newHost();
    await host.registerPlatform(
      platformOsPlugin(
        { resourceDir: "/opt/xeon/resources", logSink: (l) => lines.push(l), logRedact: (l) => l },
        fakeRuntime(),
      ),
    );
    const os = host.ports.get(OsPortKey);
    expect(os?.info.platform).toBe("linux");
    expect(os?.machineId).toBe("0123456789abcdef");
    await host.dispose();
    expect(lines.map(eventOf).at(-1)).toBe("os.service.stopped");
  });

  test("지원 밖 플랫폼이면 registerPlatform이 던지고 포트가 없다", async () => {
    const host = newHost();
    const failure = await host
      .registerPlatform(
        platformOsPlugin(
          { resourceDir: "/opt/x", logSink: () => {}, logRedact: (l) => l },
          fakeRuntime({
            probe: {
              platform: "aix",
              arch: "x64",
              release: "",
              wslDistro: undefined,
              procVersion: undefined,
            },
          }),
        ),
      )
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );
    expect(failure).toBeDefined();
    expect(host.ports.get(OsPortKey)).toBeUndefined();
    await host.dispose();
  });
});
