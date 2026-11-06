import { describe, expect, test } from "bun:test";
import {
  createUpdateController,
  type UpdateController,
} from "../../src/views/update-controller.ts";
import type { UpdateInvoke } from "../../src/views/update-invoke.ts";
import type { UpdateState } from "../../src/views/update-model.ts";

// 업데이트 컨트롤러(B-10). 가짜 invoke가 명령마다 답을 주고, 시험은 상태 값과 부른 명령의 순서를 비교한다.
// 겹치는 호출은 무시하고, 실패 뒤의 다시 시도는 멈춘 단계를 다시 한다.

type Args = { readonly onEvent?: unknown } | undefined;
type Script = (command: string, args: Args) => Promise<unknown>;

/** 명령의 답을 나중에 주는 약속. 시험이 답을 고를 때까지 호출은 기다린다 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let done: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    done = resolve;
  });
  return {
    promise,
    resolve: (value) => {
      done?.(value);
    },
  };
}

/** 명령을 기록하고 답은 `script`가 준다. 진행 통로는 가장 최근에 만들어진 것의 `onMessage`를 잡아 둔다 */
function harnessOf(script: Script): {
  controller: UpdateController;
  calls: string[];
  progress: (message: unknown) => void;
} {
  const calls: string[] = [];
  let sink: ((message: unknown) => void) | null = null;
  const invoke: UpdateInvoke = (command, args) => {
    calls.push(command);
    return script(command, args);
  };
  const controller = createUpdateController({
    invoke,
    createChannel: (onMessage) => {
      sink = onMessage;
      return { tag: "channel" };
    },
  });
  return {
    controller,
    calls,
    progress: (message) => {
      sink?.(message);
    },
  };
}

const CONFIGURED = { configured: true, currentVersion: "0.4.1" };
const AVAILABLE = { kind: "available", version: "0.4.2", notes: "고친 점" };

/** 설정을 읽고 확인해 새 버전을 찾은 컨트롤러. 명령은 주어진 답으로 돈다 */
function foundScript(extra: Script): Script {
  return async (command, args) => {
    if (command === "update_status") return CONFIGURED;
    if (command === "update_check") return AVAILABLE;
    return extra(command, args);
  };
}

describe("starting up", () => {
  test("the app reads its version, checks quietly, and an available update waits for the user", async () => {
    const h = harnessOf(foundScript(async () => null));
    expect(h.controller.getState()).toEqual({ kind: "checking" });
    expect(h.controller.currentVersion()).toBeNull();
    await h.controller.start();
    expect(h.controller.getState()).toEqual({
      kind: "available",
      version: "0.4.2",
      notes: "고친 점",
    });
    expect(h.controller.currentVersion()).toBe("0.4.1");
    expect(h.calls).toEqual(["update_status", "update_check"]);
  });

  test("an app without an update setup ends at unconfigured and never checks", async () => {
    const h = harnessOf(async (command) => {
      if (command === "update_status") return { configured: false, currentVersion: "0.4.1" };
      return null;
    });
    await h.controller.start();
    expect(h.controller.getState()).toEqual({ kind: "unconfigured" });
    expect(h.controller.currentVersion()).toBe("0.4.1");
    expect(h.calls).toEqual(["update_status"]);
  });

  test("when the status cannot be read the check still answers, and it says not configured", async () => {
    const h = harnessOf(async (command) => {
      if (command === "update_status") throw new Error("command not found");
      return { kind: "notConfigured" };
    });
    await h.controller.start();
    expect(h.controller.getState()).toEqual({ kind: "unconfigured" });
    expect(h.controller.currentVersion()).toBeNull();
    expect(h.calls).toEqual(["update_status", "update_check"]);
  });
});

describe("the whole flow", () => {
  test("download with progress, ready, an install that fails, and a retry of the install", async () => {
    const seen: UpdateState[] = [];
    const h = harnessOf(
      foundScript(async (command) => {
        if (command === "update_download") {
          h.progress({ kind: "progress", downloaded: 25, total: 100 });
          return { kind: "ready" };
        }
        if (command === "update_install_restart") return { kind: "failed", reason: "other" };
        return null;
      }),
    );
    h.controller.subscribe(() => {
      seen.push(h.controller.getState());
    });
    await h.controller.start();
    await h.controller.download();
    expect(h.controller.getState()).toEqual({
      kind: "ready",
      version: "0.4.2",
      notes: "고친 점",
    });
    await h.controller.installAndRestart();
    expect(h.controller.getState()).toEqual({
      kind: "failed",
      stage: "install",
      reason: "other",
      version: "0.4.2",
      notes: "고친 점",
    });
    await h.controller.retry();
    expect(h.controller.getState()).toEqual({
      kind: "failed",
      stage: "install",
      reason: "other",
      version: "0.4.2",
      notes: "고친 점",
    });
    expect(h.calls).toEqual([
      "update_status",
      "update_check",
      "update_download",
      "update_install_restart",
      "update_install_restart",
    ]);
    // 버전을 읽을 때 한 번(checking), 확인 결과(available), 내려받기 시작과 진행, 준비, 설치 두 번의 전이를 듣는다
    expect(seen.map((state) => state.kind)).toEqual([
      "checking",
      "available",
      "downloading",
      "downloading",
      "ready",
      "installing",
      "failed",
      "installing",
      "failed",
    ]);
  });

  test("progress with an unknown total is accepted, and an offline download keeps the version", async () => {
    const h = harnessOf(
      foundScript(async (command) => {
        if (command === "update_download") {
          h.progress({ kind: "progress", downloaded: 40, total: null });
          return { kind: "offline" };
        }
        return null;
      }),
    );
    await h.controller.start();
    const pending = h.controller.download();
    await pending;
    expect(h.controller.getState()).toEqual({
      kind: "offline",
      stage: "download",
      version: "0.4.2",
      notes: "고친 점",
    });
  });
});

describe("overlapping calls", () => {
  test("a check that starts while another check runs is ignored", async () => {
    const answer = deferred<unknown>();
    const h = harnessOf(async (command) => {
      if (command === "update_status") return CONFIGURED;
      return answer.promise;
    });
    const starting = h.controller.start();
    await h.controller.check();
    answer.resolve({ kind: "upToDate" });
    await starting;
    expect(h.calls).toEqual(["update_status", "update_check"]);
    expect(h.controller.getState()).toEqual({ kind: "current" });
  });

  test("an install that is asked for while a download runs is ignored", async () => {
    const download = deferred<unknown>();
    const h = harnessOf(
      foundScript(async (command) => {
        if (command === "update_download") return download.promise;
        return null;
      }),
    );
    await h.controller.start();
    const downloading = h.controller.download();
    await h.controller.installAndRestart();
    download.resolve({ kind: "ready" });
    await downloading;
    expect(h.calls).toEqual(["update_status", "update_check", "update_download"]);
    expect(h.controller.getState().kind).toBe("ready");
  });

  test("the same check asked twice runs once", async () => {
    const h = harnessOf(foundScript(async () => null));
    await h.controller.start();
    await Promise.all([h.controller.check(), h.controller.check()]);
    expect(h.calls).toEqual(["update_status", "update_check", "update_check"]);
  });
});

describe("retrying a failure", () => {
  test("a failed download keeps its version and the download is asked again", async () => {
    let attempts = 0;
    const h = harnessOf(
      foundScript(async (command) => {
        if (command !== "update_download") return null;
        attempts += 1;
        return attempts === 1 ? { kind: "failed", reason: "network" } : { kind: "ready" };
      }),
    );
    await h.controller.start();
    await h.controller.download();
    expect(h.controller.getState()).toEqual({
      kind: "failed",
      stage: "download",
      reason: "network",
      version: "0.4.2",
      notes: "고친 점",
    });
    await h.controller.retry();
    expect(h.controller.getState()).toEqual({
      kind: "ready",
      version: "0.4.2",
      notes: "고친 점",
    });
    expect(h.calls.filter((command) => command === "update_download")).toHaveLength(2);
  });

  test("an offline check is checked again by retry", async () => {
    let online = false;
    const h = harnessOf(async (command) => {
      if (command === "update_status") return CONFIGURED;
      if (!online) return { kind: "offline" };
      return AVAILABLE;
    });
    await h.controller.start();
    expect(h.controller.getState()).toEqual({
      kind: "offline",
      stage: "check",
      version: null,
      notes: null,
    });
    online = true;
    await h.controller.retry();
    expect(h.controller.getState()).toEqual({
      kind: "available",
      version: "0.4.2",
      notes: "고친 점",
    });
    expect(h.calls).toEqual(["update_status", "update_check", "update_check"]);
  });

  test("retry with nothing failed asks nothing", async () => {
    const h = harnessOf(foundScript(async () => null));
    await h.controller.start();
    await h.controller.retry();
    expect(h.calls).toEqual(["update_status", "update_check"]);
  });
});

describe("states that do not allow an action", () => {
  test("download, install and check do nothing when the state does not allow them", async () => {
    const h = harnessOf(async (command) => {
      if (command === "update_status") return { configured: true, currentVersion: "0.4.1" };
      return { kind: "upToDate" };
    });
    await h.controller.start();
    expect(h.controller.getState()).toEqual({ kind: "current" });
    await h.controller.download();
    await h.controller.installAndRestart();
    expect(h.calls).toEqual(["update_status", "update_check"]);
    expect(h.controller.getState()).toEqual({ kind: "current" });
  });

  test("an unconfigured app asks for no check when the user presses check", async () => {
    const h = harnessOf(async () => ({ configured: false, currentVersion: "0.4.1" }));
    await h.controller.start();
    await h.controller.check();
    expect(h.calls).toEqual(["update_status"]);
    expect(h.controller.getState()).toEqual({ kind: "unconfigured" });
  });
});

describe("subscribers", () => {
  test("a listener hears each real change and nothing when a call changes nothing", async () => {
    const h = harnessOf(async (command) => {
      if (command === "update_status") return { configured: false, currentVersion: "0.4.1" };
      return null;
    });
    let heard = 0;
    const unsubscribe = h.controller.subscribe(() => {
      heard += 1;
    });
    await h.controller.start();
    const afterStart = heard;
    expect(afterStart).toBeGreaterThan(0);
    await h.controller.check();
    expect(heard).toBe(afterStart);
    unsubscribe();
    expect(h.controller.getState()).toEqual({ kind: "unconfigured" });
  });
});
