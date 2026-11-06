import { describe, expect, test } from "bun:test";
import { createCommandRegistry, type ShellReply } from "../src/main/commands.ts";
import type { IpcCaller, ShellContext } from "../src/main/context.ts";
import {
  CHECK_TIMEOUT_MS,
  classifyError,
  createUpdaterModule,
  feedFromText,
  isConfigured,
  type UpdateCandidate,
  type UpdaterBackend,
} from "../src/main/updater.ts";

const HOST = "updates.example.invalid";
const FEED_URL = `https://${HOST}/fresnel/latest`;
// args에 실어 보내는 진행 통로 자리. 가짜 ctx.channel은 이 객체만 채널로 받는다
const CHANNEL = { $channel: 7 };

interface Harness {
  readonly dispatch: (command: string, args: unknown) => Promise<ShellReply>;
  /** 진행 통로로 간 메시지 */
  readonly sent: unknown[];
  /** 앱 로그 줄 */
  readonly logs: string[];
}

/** 모듈을 가짜 ctx에 엮고, 명령은 실제 명령 등록부로 부른다 */
function harness(options: {
  readonly backend: UpdaterBackend;
  readonly configured?: boolean;
  readonly checkTimeoutMs?: number;
}): Harness {
  const registry = createCommandRegistry();
  const sent: unknown[] = [];
  const logs: string[] = [];
  const ctx: ShellContext = {
    env: {},
    platform: "darwin",
    paths: {
      userData: "/fake/userData",
      logs: "/fake/logs",
      resources: "/fake/resources",
      ui: "/fake/ui",
    },
    dialogs: {
      openFolder: () => Promise.resolve(null),
      openFile: () => Promise.resolve(null),
      saveFile: () => Promise.resolve(null),
    },
    openExternal: () => Promise.resolve(),
    handle: (command, handler) => {
      registry.handle(command, handler);
    },
    channel: (_caller, value) =>
      value === CHANNEL
        ? {
            send: (message) => {
              sent.push(message);
            },
          }
        : null,
    emit: () => undefined,
    showMainWindow: () => undefined,
    onQuit: () => undefined,
  };
  createUpdaterModule({
    backend: options.backend,
    configured: options.configured ?? true,
    currentVersion: "1.0.0",
    log: (line) => {
      logs.push(line);
    },
    checkTimeoutMs: options.checkTimeoutMs ?? CHECK_TIMEOUT_MS,
  }).register(ctx);
  const caller: IpcCaller = { sender: Object.create(null) };
  return {
    dispatch: (command, args) => registry.dispatch(caller, command, args),
    sent,
    logs,
  };
}

type Progress = (downloaded: number, total: number | null) => void;

interface Script {
  readonly check?: () => Promise<UpdateCandidate | null>;
  readonly download?: (onProgress: Progress) => Promise<void>;
  readonly install?: () => void;
}

/** 가짜 백엔드. 부른 순서를 `calls`에 적는다. 대본이 없는 호출은 "새 버전 없음"과 "성공"이다 */
function backendOf(script: Script = {}): {
  readonly backend: UpdaterBackend;
  readonly calls: string[];
} {
  const calls: string[] = [];
  const backend: UpdaterBackend = {
    checkForUpdates: () => {
      calls.push("check");
      return script.check?.() ?? Promise.resolve(null);
    },
    download: (onProgress) => {
      calls.push("download");
      return script.download?.(onProgress) ?? Promise.resolve();
    },
    quitAndInstall: () => {
      calls.push("install");
      script.install?.();
    },
  };
  return { backend, calls };
}

/** 코드와 메시지를 가진 오류 */
function coded(code: string, message: string = code): Error {
  return Object.assign(new Error(message), { code });
}

const READY_1_2 = { version: "1.2.0", notes: "fixes" };

describe("feed configuration", () => {
  test("a missing, null or non-object config is not configured", () => {
    expect(isConfigured(undefined)).toBe(false);
    expect(isConfigured(null)).toBe(false);
    expect(isConfigured(FEED_URL)).toBe(false);
    expect(isConfigured(["generic", FEED_URL])).toBe(false);
    expect(isConfigured(5)).toBe(false);
  });

  test("a blank or missing provider or url is not configured", () => {
    const configs = [
      { provider: "", url: FEED_URL },
      { provider: "   ", url: FEED_URL },
      { provider: "generic", url: "" },
      { provider: "generic", url: "\t\n" },
      { provider: "generic" },
      { url: FEED_URL },
    ];
    for (const config of configs) {
      expect(isConfigured(config)).toBe(false);
    }
  });

  test("a wrong shape for provider or url is not configured", () => {
    const configs = [
      { provider: 5, url: FEED_URL },
      { provider: true, url: FEED_URL },
      { provider: ["generic"], url: FEED_URL },
      { provider: "generic", url: 5 },
      { provider: "generic", url: null },
      { provider: "github", url: FEED_URL },
    ];
    for (const config of configs) {
      expect(isConfigured(config)).toBe(false);
    }
  });

  test("a filled-in generic feed is configured, and padding around the url is ignored", () => {
    expect(isConfigured({ provider: "generic", url: FEED_URL })).toBe(true);
    expect(isConfigured({ provider: "generic", url: `  ${FEED_URL} ` })).toBe(true);
  });

  test("a malformed or non-object feed file is not configured", () => {
    for (const text of ["{", "", "not json", "null", "[]", '{"provider":"generic"}']) {
      expect(feedFromText(text)).toBeNull();
    }
  });

  test("a valid feed file yields the trimmed generic feed", () => {
    expect(feedFromText(`{"provider":"generic","url":"  ${FEED_URL}  "}`)).toEqual({
      provider: "generic",
      url: FEED_URL,
    });
  });
});

describe("error classification", () => {
  test("connection codes are offline", () => {
    for (const code of [
      "ENOTFOUND",
      "ECONNREFUSED",
      "ECONNRESET",
      "ETIMEDOUT",
      "EAI_AGAIN",
      "ENETUNREACH",
    ]) {
      expect(classifyError(coded(code))).toEqual({ kind: "offline" });
    }
  });

  test("a checksum or signature failure is reported as signature", () => {
    const messages = [
      "sha512 checksum mismatch, expected abc",
      "Code Signature verification failed",
      "signature mismatch",
    ];
    for (const message of messages) {
      expect(classifyError(new Error(message))).toEqual({ kind: "failed", reason: "signature" });
    }
  });

  test("a missing release is no_release", () => {
    expect(classifyError(coded("ERR_UPDATER_CHANNEL_FILE_NOT_FOUND"))).toEqual({
      kind: "failed",
      reason: "no_release",
    });
    expect(classifyError(new Error("Cannot find latest.yml in the release"))).toEqual({
      kind: "failed",
      reason: "no_release",
    });
    expect(classifyError(new Error("Cannot download update, status 404"))).toEqual({
      kind: "failed",
      reason: "no_release",
    });
  });

  test("everything else is other, and a connection code wins over the message", () => {
    expect(classifyError(new Error("disk full"))).toEqual({ kind: "failed", reason: "other" });
    expect(classifyError(coded("EPERM", "permission denied"))).toEqual({
      kind: "failed",
      reason: "other",
    });
    expect(classifyError("ENOTFOUND")).toEqual({ kind: "failed", reason: "other" });
    expect(classifyError(coded("ENOTFOUND", "signature"))).toEqual({ kind: "offline" });
  });
});

describe("update check", () => {
  test("an unconfigured check never asks the backend", async () => {
    const { backend, calls } = backendOf();
    const h = harness({ backend, configured: false });
    expect(await h.dispatch("update_check", null)).toEqual({
      ok: true,
      value: { kind: "notConfigured" },
    });
    expect(calls).toEqual([]);
  });

  test("a found release is available with its version and notes", async () => {
    const { backend } = backendOf({ check: () => Promise.resolve(READY_1_2) });
    expect(await harness({ backend }).dispatch("update_check", null)).toEqual({
      ok: true,
      value: { kind: "available", version: "1.2.0", notes: "fixes" },
    });
  });

  test("a release without notes keeps the notes null", async () => {
    const { backend } = backendOf({
      check: () => Promise.resolve({ version: "1.2.1", notes: null }),
    });
    expect(await harness({ backend }).dispatch("update_check", null)).toEqual({
      ok: true,
      value: { kind: "available", version: "1.2.1", notes: null },
    });
  });

  test("no newer release is up to date", async () => {
    const { backend } = backendOf({ check: () => Promise.resolve(null) });
    expect(await harness({ backend }).dispatch("update_check", null)).toEqual({
      ok: true,
      value: { kind: "upToDate" },
    });
  });

  test("a connection failure during check is offline, and the log keeps the address out", async () => {
    const { backend } = backendOf({
      check: () => Promise.reject(coded("ENOTFOUND", `getaddrinfo ENOTFOUND ${HOST}`)),
    });
    const h = harness({ backend });
    expect(await h.dispatch("update_check", null)).toEqual({
      ok: true,
      value: { kind: "offline" },
    });
    expect(h.logs).toEqual(["updater: check stopped (offline)"]);
    expect(h.logs.join("\n").includes(HOST)).toBe(false);
  });

  test("a check that fails for another reason keeps its reason", async () => {
    const { backend } = backendOf({
      check: () => Promise.reject(coded("ERR_UPDATER_CHANNEL_FILE_NOT_FOUND")),
    });
    const h = harness({ backend });
    expect(await h.dispatch("update_check", null)).toEqual({
      ok: true,
      value: { kind: "failed", reason: "no_release" },
    });
    expect(h.logs).toEqual(["updater: check failed (reason: no_release)"]);
  });

  test("a check that never answers gives up as offline and releases the busy flag", async () => {
    let asked = 0;
    const { backend } = backendOf({
      check: () => {
        asked += 1;
        return asked === 1
          ? new Promise<UpdateCandidate | null>(() => undefined)
          : Promise.resolve(null);
      },
    });
    const h = harness({ backend, checkTimeoutMs: 1 });
    expect(await h.dispatch("update_check", null)).toEqual({
      ok: true,
      value: { kind: "offline" },
    });
    expect(await h.dispatch("update_check", null)).toEqual({
      ok: true,
      value: { kind: "upToDate" },
    });
  });

  test("the check timeout defaults to 30 seconds", () => {
    expect(CHECK_TIMEOUT_MS).toBe(30_000);
  });

  test("a new check discards the previous result and the downloaded state", async () => {
    let asked = 0;
    const { backend, calls } = backendOf({
      check: () => {
        asked += 1;
        return Promise.resolve(asked === 1 ? READY_1_2 : null);
      },
    });
    const h = harness({ backend });
    await h.dispatch("update_check", null);
    expect(await h.dispatch("update_download", { onEvent: CHANNEL })).toEqual({
      ok: true,
      value: { kind: "ready" },
    });
    expect(await h.dispatch("update_check", null)).toEqual({
      ok: true,
      value: { kind: "upToDate" },
    });
    expect(await h.dispatch("update_install_restart", null)).toEqual({
      ok: true,
      value: { kind: "failed", reason: "nothing_to_install" },
    });
    expect(await h.dispatch("update_download", { onEvent: CHANNEL })).toEqual({
      ok: true,
      value: { kind: "failed", reason: "nothing_to_download" },
    });
    expect(calls).toEqual(["check", "download", "check"]);
  });
});

describe("download and install", () => {
  test("download without a found release is nothing_to_download and never reaches the backend", async () => {
    const { backend, calls } = backendOf();
    const h = harness({ backend });
    expect(await h.dispatch("update_download", { onEvent: CHANNEL })).toEqual({
      ok: true,
      value: { kind: "failed", reason: "nothing_to_download" },
    });
    expect(calls).toEqual([]);
  });

  test("install before a finished download is nothing_to_install, even after a found release", async () => {
    const { backend, calls } = backendOf({ check: () => Promise.resolve(READY_1_2) });
    const h = harness({ backend });
    expect(await h.dispatch("update_install_restart", null)).toEqual({
      ok: true,
      value: { kind: "failed", reason: "nothing_to_install" },
    });
    await h.dispatch("update_check", null);
    expect(await h.dispatch("update_install_restart", null)).toEqual({
      ok: true,
      value: { kind: "failed", reason: "nothing_to_install" },
    });
    expect(calls).toEqual(["check"]);
  });

  test("progress is forwarded as the backend counts it, then the download is ready", async () => {
    const { backend } = backendOf({
      check: () => Promise.resolve(READY_1_2),
      download: async (onProgress) => {
        onProgress(512, 2048);
        onProgress(2048, 2048);
      },
    });
    const h = harness({ backend });
    await h.dispatch("update_check", null);
    expect(await h.dispatch("update_download", { onEvent: CHANNEL })).toEqual({
      ok: true,
      value: { kind: "ready" },
    });
    expect(h.sent).toEqual([
      { kind: "progress", downloaded: 512, total: 2048 },
      { kind: "progress", downloaded: 2048, total: 2048 },
    ]);
  });

  test("an unknown total is sent as null", async () => {
    const { backend } = backendOf({
      check: () => Promise.resolve(READY_1_2),
      download: async (onProgress) => {
        onProgress(100, null);
      },
    });
    const h = harness({ backend });
    await h.dispatch("update_check", null);
    await h.dispatch("update_download", { onEvent: CHANNEL });
    expect(h.sent).toEqual([{ kind: "progress", downloaded: 100, total: null }]);
  });

  test("a finished download installs and reports restarting", async () => {
    const { backend, calls } = backendOf({
      check: () => Promise.resolve(READY_1_2),
      download: () => Promise.resolve(),
    });
    const h = harness({ backend });
    await h.dispatch("update_check", null);
    await h.dispatch("update_download", { onEvent: CHANNEL });
    expect(await h.dispatch("update_install_restart", null)).toEqual({
      ok: true,
      value: { kind: "restarting" },
    });
    expect(calls).toEqual(["check", "download", "install"]);
  });

  test("a failed install keeps the download, so install can be tried again", async () => {
    const { backend, calls } = backendOf({
      check: () => Promise.resolve(READY_1_2),
      install: () => {
        throw new Error("code signature invalid");
      },
    });
    const h = harness({ backend });
    await h.dispatch("update_check", null);
    await h.dispatch("update_download", { onEvent: CHANNEL });
    expect(await h.dispatch("update_install_restart", null)).toEqual({
      ok: true,
      value: { kind: "failed", reason: "signature" },
    });
    expect(await h.dispatch("update_install_restart", null)).toEqual({
      ok: true,
      value: { kind: "failed", reason: "signature" },
    });
    expect(calls).toEqual(["check", "download", "install", "install"]);
    expect(h.logs).toEqual([
      "updater: install failed (reason: signature)",
      "updater: install failed (reason: signature)",
    ]);
  });

  test("an install failure without a known cause is other", async () => {
    const { backend } = backendOf({
      check: () => Promise.resolve(READY_1_2),
      install: () => {
        throw new Error("no update downloaded");
      },
    });
    const h = harness({ backend });
    await h.dispatch("update_check", null);
    await h.dispatch("update_download", { onEvent: CHANNEL });
    expect(await h.dispatch("update_install_restart", null)).toEqual({
      ok: true,
      value: { kind: "failed", reason: "other" },
    });
  });

  test("a failed download is classified, leaves nothing to install, and a retry can succeed", async () => {
    let tries = 0;
    const { backend, calls } = backendOf({
      check: () => Promise.resolve(READY_1_2),
      download: () => {
        tries += 1;
        return tries === 1
          ? Promise.reject(coded("ECONNRESET", "socket hang up"))
          : Promise.resolve();
      },
    });
    const h = harness({ backend });
    await h.dispatch("update_check", null);
    expect(await h.dispatch("update_download", { onEvent: CHANNEL })).toEqual({
      ok: true,
      value: { kind: "offline" },
    });
    expect(await h.dispatch("update_install_restart", null)).toEqual({
      ok: true,
      value: { kind: "failed", reason: "nothing_to_install" },
    });
    expect(await h.dispatch("update_download", { onEvent: CHANNEL })).toEqual({
      ok: true,
      value: { kind: "ready" },
    });
    expect(calls).toEqual(["check", "download", "download"]);
  });

  test("a checksum failure during download is reported as signature", async () => {
    const { backend } = backendOf({
      check: () => Promise.resolve(READY_1_2),
      download: () => Promise.reject(new Error("sha512 mismatch")),
    });
    const h = harness({ backend });
    await h.dispatch("update_check", null);
    expect(await h.dispatch("update_download", { onEvent: CHANNEL })).toEqual({
      ok: true,
      value: { kind: "failed", reason: "signature" },
    });
  });
});

describe("busy flag and channel", () => {
  test("overlapping check, download or install is busy, and the flag is released afterwards", async () => {
    // 확인이 끝나기 전까지 다른 명령이 겹치도록 약속을 밖에서 정한다
    const gate = Promise.withResolvers<UpdateCandidate | null>();
    const { backend, calls } = backendOf({ check: () => gate.promise });
    const h = harness({ backend });
    const first = h.dispatch("update_check", null);
    expect(await h.dispatch("update_check", null)).toEqual({
      ok: true,
      value: { kind: "failed", reason: "busy" },
    });
    expect(await h.dispatch("update_download", { onEvent: CHANNEL })).toEqual({
      ok: true,
      value: { kind: "failed", reason: "busy" },
    });
    expect(await h.dispatch("update_install_restart", null)).toEqual({
      ok: true,
      value: { kind: "failed", reason: "busy" },
    });
    gate.resolve(READY_1_2);
    expect(await first).toEqual({
      ok: true,
      value: { kind: "available", version: "1.2.0", notes: "fixes" },
    });
    expect(await h.dispatch("update_check", null)).toEqual({
      ok: true,
      value: { kind: "available", version: "1.2.0", notes: "fixes" },
    });
    expect(calls).toEqual(["check", "check"]);
  });

  test("a failed check releases the busy flag", async () => {
    let asked = 0;
    const { backend } = backendOf({
      check: () => {
        asked += 1;
        return asked === 1 ? Promise.reject(coded("ENOTFOUND")) : Promise.resolve(null);
      },
    });
    const h = harness({ backend });
    expect(await h.dispatch("update_check", null)).toEqual({
      ok: true,
      value: { kind: "offline" },
    });
    expect(await h.dispatch("update_check", null)).toEqual({
      ok: true,
      value: { kind: "upToDate" },
    });
  });

  test("a download without a usable channel is bad-request, and it does not take the busy flag", async () => {
    const { backend, calls } = backendOf({ check: () => Promise.resolve(READY_1_2) });
    const h = harness({ backend });
    expect(await h.dispatch("update_download", { onEvent: 5 })).toEqual({
      ok: false,
      error: "bad-request",
    });
    expect(await h.dispatch("update_download", null)).toEqual({
      ok: false,
      error: "bad-request",
    });
    expect(await h.dispatch("update_check", null)).toEqual({
      ok: true,
      value: { kind: "available", version: "1.2.0", notes: "fixes" },
    });
    expect(calls).toEqual(["check"]);
  });

  test("update_status reports the configured flag and the current version", async () => {
    const { backend } = backendOf();
    expect(await harness({ backend }).dispatch("update_status", null)).toEqual({
      ok: true,
      value: { configured: true, currentVersion: "1.0.0" },
    });
    expect(await harness({ backend, configured: false }).dispatch("update_status", null)).toEqual({
      ok: true,
      value: { configured: false, currentVersion: "1.0.0" },
    });
  });
});
