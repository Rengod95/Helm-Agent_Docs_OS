import { expect, test } from "bun:test";
import type { AutostartStatus } from "../src/service/autostart.ts";
import { serviceStatusView, type ServiceStatusResult } from "../src/service/control.ts";

// 접속 토큰은 실행 때 만든다(비밀 스캐너가 소스의 고정 문자열을 시크릿으로 읽는다)
const TOKEN = ["fixture", "service", "connect", "token"].join("-").padEnd(43, "x");
const AUTOSTART: AutostartStatus = {
  platform: "darwin",
  supported: true,
  registered: true,
  active: true,
  path: "/Users/tester/Library/LaunchAgents/com.fresnel.service.plist",
  linger: null,
};

test("the status JSON view keeps the registration fields except the connection token (H4-02)", () => {
  const status = {
    mode: "service",
    pid: 4242,
    startedAt: "2023-11-14T22:13:20.000Z",
    connections: 1,
    liveTurns: 0,
    idleShutdownAt: null,
  } as const;
  const result: ServiceStatusResult = {
    running: true,
    registration: {
      schemaVersion: 1,
      version: "0.0.1",
      protocolVersion: "1.0.0",
      socket: "/tmp/fresnel.sock",
      pid: 4242,
      startedAt: 1700000000000,
      token: TOKEN,
      storeId: "store-1",
    },
    status,
    remote: null,
  };
  const text = JSON.stringify(serviceStatusView(result, AUTOSTART));
  expect(text).not.toContain(TOKEN);
  expect(JSON.parse(text)).toEqual({
    running: true,
    registration: {
      schemaVersion: 1,
      version: "0.0.1",
      protocolVersion: "1.0.0",
      socket: "/tmp/fresnel.sock",
      pid: 4242,
      startedAt: 1700000000000,
      storeId: "store-1",
    },
    status: { ...status },
    remote: null,
    autostart: AUTOSTART,
  });
});

test("a not-running status keeps its reason and adds the autostart object", () => {
  expect(serviceStatusView({ running: false, reason: "no_registration" }, AUTOSTART)).toEqual({
    running: false,
    reason: "no_registration",
    autostart: AUTOSTART,
  });
});
