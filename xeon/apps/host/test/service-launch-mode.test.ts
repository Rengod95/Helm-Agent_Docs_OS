import { afterEach, expect, test } from "bun:test";
import { resolveRemoteEndpoint, type RemoteResolution } from "../src/service/launch-mode.ts";
import { useEngineHome, type EngineHome } from "./fixtures/engine-home.ts";
import { writeUserSettings } from "./fixtures/user-settings.ts";

// 원격 서비스 주소 해석(service/launch-mode.ts). 우선순위는 `--remote` 플래그, 그다음 사용자 설정 `l0.process.service.remote`다.
// 설정 파일은 임시 FRESNEL_HOME 아래에 쓴다. 토큰은 환경 변수 FRESNEL_REMOTE_TOKEN에서만 오고, tcp 주소에만 붙는다.

const SETTING = "l0.process.service.remote";
const TOKEN = "fixture-remote-token";

const homes: EngineHome[] = [];
afterEach(() => {
  for (const home of homes.splice(0).toReversed()) home.dispose();
});

/** 시험마다 빈 엔진 홈을 쓴다. 설정 파일이 없는 상태에서 시작한다 */
function freshHome(): EngineHome {
  const home = useEngineHome();
  homes.push(home);
  return home;
}

test("the flag wins over the remote setting", async () => {
  const home = freshHome();
  writeUserSettings(home, { [SETTING]: "unix:/run/from-setting.sock" });
  expect(await resolveRemoteEndpoint({ flag: "unix:/run/from-flag.sock", env: {} })).toEqual({
    kind: "remote",
    endpoint: { kind: "unix", path: "/run/from-flag.sock" },
    from: "flag",
  });
});

test("the setting is used without a flag, and an empty flag counts as no flag", async () => {
  const home = freshHome();
  writeUserSettings(home, {
    [SETTING]: "ssh://alice@build.example:2222/run/fresnel/service.sock",
  });
  const expected: RemoteResolution = {
    kind: "remote",
    endpoint: {
      kind: "ssh",
      target: "alice@build.example",
      remoteSocket: "/run/fresnel/service.sock",
      port: 2222,
    },
    from: "setting",
  };
  expect(await resolveRemoteEndpoint({ env: {} })).toEqual(expected);
  expect(await resolveRemoteEndpoint({ flag: "", env: {} })).toEqual(expected);
});

test("empty or whitespace-only text means no remote endpoint, whatever the setting type", async () => {
  const home = freshHome();
  expect(await resolveRemoteEndpoint({ env: {} })).toEqual({ kind: "none" });
  expect(await resolveRemoteEndpoint({ flag: "  \t ", env: {} })).toEqual({ kind: "none" });
  writeUserSettings(home, { [SETTING]: "" });
  expect(await resolveRemoteEndpoint({ env: {} })).toEqual({ kind: "none" });
  writeUserSettings(home, { [SETTING]: " \n " });
  expect(await resolveRemoteEndpoint({ env: {} })).toEqual({ kind: "none" });
  writeUserSettings(home, { [SETTING]: 42 });
  expect(await resolveRemoteEndpoint({ env: {} })).toEqual({ kind: "none" });
});

test("text that does not parse is invalid with its source and parse error, and never falls back to local", async () => {
  const home = freshHome();
  expect(await resolveRemoteEndpoint({ flag: "http://build.example:7421", env: {} })).toEqual({
    kind: "invalid",
    text: "http://build.example:7421",
    from: "flag",
    error: { kind: "unknown_scheme" },
  });
  expect(await resolveRemoteEndpoint({ flag: "/run/with space.sock", env: {} })).toEqual({
    kind: "invalid",
    text: "/run/with space.sock",
    from: "flag",
    error: { kind: "invalid", part: "path" },
  });
  writeUserSettings(home, { [SETTING]: "ssh://build.example" });
  expect(await resolveRemoteEndpoint({ env: {} })).toEqual({
    kind: "invalid",
    text: "ssh://build.example",
    from: "setting",
    error: { kind: "invalid", part: "path" },
  });
});

test("a tcp endpoint takes its token from FRESNEL_REMOTE_TOKEN, whether the address came from the flag or the setting", async () => {
  const home = freshHome();
  const env = { FRESNEL_REMOTE_TOKEN: TOKEN };
  expect(await resolveRemoteEndpoint({ flag: "tcp://build.example:7421", env })).toEqual({
    kind: "remote",
    endpoint: { kind: "tcp", host: "build.example", port: 7421, token: TOKEN },
    from: "flag",
  });
  writeUserSettings(home, { [SETTING]: "tcp://build.example:7421" });
  expect(await resolveRemoteEndpoint({ env })).toEqual({
    kind: "remote",
    endpoint: { kind: "tcp", host: "build.example", port: 7421, token: TOKEN },
    from: "setting",
  });
});

test("an absent or empty token variable leaves the tcp endpoint without a token property", async () => {
  // toStrictEqual: `token: undefined`도 토큰이 있는 것으로 보면 안 되므로 속성이 없어야 한다
  const expected: RemoteResolution = {
    kind: "remote",
    endpoint: { kind: "tcp", host: "build.example", port: 7421 },
    from: "flag",
  };
  expect(await resolveRemoteEndpoint({ flag: "tcp://build.example:7421", env: {} })).toStrictEqual(
    expected,
  );
  expect(
    await resolveRemoteEndpoint({
      flag: "tcp://build.example:7421",
      env: { FRESNEL_REMOTE_TOKEN: "" },
    }),
  ).toStrictEqual(expected);
});

test("userinfo in a tcp address is an invalid host, so no endpoint and no token come out of it", async () => {
  expect(
    await resolveRemoteEndpoint({
      flag: "tcp://tok@host:7421",
      env: { FRESNEL_REMOTE_TOKEN: TOKEN },
    }),
  ).toEqual({
    kind: "invalid",
    text: "tcp://tok@host:7421",
    from: "flag",
    error: { kind: "invalid", part: "host" },
  });
});

test("the token is never attached to a unix or an ssh endpoint", async () => {
  const env = { FRESNEL_REMOTE_TOKEN: TOKEN };
  expect(await resolveRemoteEndpoint({ flag: "/run/fresnel.sock", env })).toStrictEqual({
    kind: "remote",
    endpoint: { kind: "unix", path: "/run/fresnel.sock" },
    from: "flag",
  });
  expect(
    await resolveRemoteEndpoint({
      flag: "ssh://build.example/run/fresnel/service.sock",
      env,
    }),
  ).toStrictEqual({
    kind: "remote",
    endpoint: { kind: "ssh", target: "build.example", remoteSocket: "/run/fresnel/service.sock" },
    from: "flag",
  });
});
