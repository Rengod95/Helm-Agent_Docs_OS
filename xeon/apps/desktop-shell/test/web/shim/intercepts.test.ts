import { describe, expect, test } from "bun:test";
import type { ShimEnv, ShimNotifyHandlers, ShimServiceWorkers } from "../../../src/web/shim/env.ts";
import { createShim, type ShimApi } from "../../../src/web/shim/shim.ts";
import {
  type FakeNotifications,
  type FakePage,
  fakeFile,
  fakeNotifications,
  fakePage,
  liveEnv,
  replyOk,
  type ShellServer,
  settled,
  startShellServer,
} from "./support.ts";

/** 실제 서버와 shim 하나. 서버는 `control` 명령에 `pong`으로 답한다 */
function harness(extra: Partial<ShimEnv> = {}): {
  readonly server: ShellServer;
  readonly api: ShimApi;
  readonly page: FakePage;
} {
  const page = fakePage();
  const server = startShellServer({
    onInvoke: (call) => {
      replyOk(call, "pong");
    },
  });
  const api = createShim(liveEnv(server, { page, ...extra }));
  return { server, api, page };
}

function firstHandlers(notifications: FakeNotifications): ShimNotifyHandlers {
  const handlers = notifications.state.handlers.at(0);
  if (handlers === undefined) throw new Error("no notification was shown");
  return handlers;
}

const LABELS = {
  open: "Open Fresnel",
  newThread: "New chat",
  running: "Running {count}",
  quit: "Quit",
};

describe("browser-side shell commands", () => {
  test("shell_capabilities reports the web shape; push is on only where it can work", async () => {
    const plain = harness();
    expect(await plain.api.invoke("shell_capabilities")).toEqual({
      kind: "web",
      folderPicker: "origin",
      fileDownload: true,
      push: false,
    });
    const workers: ShimServiceWorkers = {
      register: () => Promise.resolve(),
      activePushManager: () => {
        throw new Error("not used when the permission is not granted");
      },
    };
    const secure = harness({
      isSecureContext: true,
      notifications: fakeNotifications("default"),
      serviceWorkers: workers,
    });
    expect(await secure.api.invoke("shell_capabilities")).toEqual({
      kind: "web",
      folderPicker: "origin",
      fileDownload: true,
      push: true,
    });
  });

  test("pick_file_read opens the picker synchronously and replies with the desktop file shape", async () => {
    const { api, page } = harness();
    page.state.pickAnswer = fakeFile("note.txt", new TextEncoder().encode("hello"));
    const pending = api.invoke("pick_file_read");
    expect(page.state.pickCalls).toBe(1);
    expect(await pending).toEqual({
      name: "note.txt",
      path: "note.txt",
      size: 5,
      encoding: "utf8",
      content: "hello",
    });
  });

  test("pick_file_read sends bytes that are not UTF-8 as base64", async () => {
    const { api, page } = harness();
    page.state.pickAnswer = fakeFile("blob.bin", new Uint8Array([0, 255]));
    expect(await api.invoke("pick_file_read")).toEqual({
      name: "blob.bin",
      path: "blob.bin",
      size: 2,
      encoding: "base64",
      content: "AP8=",
    });
  });

  test("pick_file_read replies null when the picker is cancelled and rejects too-large", async () => {
    const { api, page } = harness();
    page.state.pickAnswer = null;
    expect(await api.invoke("pick_file_read")).toBe(null);
    page.state.pickAnswer = fakeFile("big.bin", new Uint8Array(0), 67_108_865);
    expect(await settled(api.invoke("pick_file_read"))).toEqual({
      ok: false,
      error: "too-large",
    });
  });

  test("save_file downloads the content under a bare name and replies with that name", async () => {
    const { api, page } = harness();
    expect(await api.invoke("save_file", { suggestedName: "../notes.md", content: "# hi" })).toBe(
      "notes.md",
    );
    expect(page.state.downloads).toEqual([
      { name: "notes.md", content: "# hi", mime: "text/markdown;charset=utf-8" },
    ]);
  });

  test("save_file with a non-text argument rejects bad-request", async () => {
    const { api, page } = harness();
    expect(await settled(api.invoke("save_file", { suggestedName: 1, content: "x" }))).toEqual({
      ok: false,
      error: "bad-request",
    });
    expect(page.state.downloads).toEqual([]);
  });

  test("open_external opens only http and https addresses, in a new tab", async () => {
    const { api, page } = harness();
    const refused = await Promise.all(
      ["javascript:alert(1)", "file:///etc/hosts", "mailto:a@example.com"].map((href) =>
        settled(api.invoke("open_external", { href })),
      ),
    );
    expect(refused).toEqual([
      { ok: false, error: "href_not_allowed" },
      { ok: false, error: "href_not_allowed" },
      { ok: false, error: "href_not_allowed" },
    ]);
    expect(await api.invoke("open_external", { href: "https://example.com/a?b=1" })).toBe(null);
    expect(page.state.tabs).toEqual(["https://example.com/a?b=1"]);
  });

  test("notify_permission answers the desktop words, and denied without the Notification API", async () => {
    const asked = harness({ notifications: fakeNotifications("default") });
    expect(await asked.api.invoke("notify_permission")).toBe("prompt");
    const granted = harness({ notifications: fakeNotifications("granted") });
    expect(await granted.api.invoke("notify_permission")).toBe("granted");
    const blocked = harness({ notifications: fakeNotifications("denied") });
    expect(await blocked.api.invoke("notify_permission")).toBe("denied");
    const none = harness();
    expect(await none.api.invoke("notify_permission")).toBe("denied");
  });

  test("notify_request_permission asks once while the permission is unasked", async () => {
    const notifications = fakeNotifications("default");
    notifications.state.requestAnswer = "granted";
    const { api } = harness({ notifications });
    expect(await api.invoke("notify_request_permission")).toBe("granted");
    expect(notifications.state.requests).toBe(1);
    expect(await api.invoke("notify_request_permission")).toBe("granted");
    expect(notifications.state.requests).toBe(1);
  });

  test("notify_os shows the cleaned notice; a click focuses the tab and makes the thread the target once", async () => {
    const notifications = fakeNotifications("granted");
    const { api, page } = harness({ notifications });
    const heard: string[] = [];
    api.listen("shell-intent", () => {
      heard.push("shell-intent");
    });
    const reply = await api.invoke("notify_os", {
      title: "  Hello\u0007\nworld  ",
      body: "Body\tline",
      threadId: "thr_1",
    });
    expect(reply).toEqual({ kind: "shown" });
    expect(notifications.state.shown).toEqual([{ title: "Hello world", body: "Body line" }]);
    firstHandlers(notifications).onClick();
    expect(page.state.focusCount).toBe(1);
    expect(heard).toEqual(["shell-intent"]);
    expect(await api.invoke("notify_take_target")).toBe("thr_1");
    expect(await api.invoke("notify_take_target")).toBe(null);
  });

  test("notify_os answers denied, without showing, when the permission is not granted", async () => {
    const notifications = fakeNotifications("default");
    const { api } = harness({ notifications });
    expect(await api.invoke("notify_os", { title: "Hi", body: null, threadId: null })).toEqual({
      kind: "denied",
    });
    expect(notifications.state.shown).toEqual([]);
  });

  test("notify_os rejects an empty title with bad-request and answers failed when the browser refuses", async () => {
    const notifications = fakeNotifications("granted");
    const { api } = harness({ notifications });
    expect(
      await settled(api.invoke("notify_os", { title: "\n\t", body: null, threadId: null })),
    ).toEqual({ ok: false, error: "bad-request" });
    notifications.state.throwOnShow = true;
    expect(await api.invoke("notify_os", { title: "Hi", body: null, threadId: null })).toEqual({
      kind: "failed",
    });
  });

  test("a failure after the notice is shown emits notify-failed", async () => {
    const notifications = fakeNotifications("granted");
    const { api } = harness({ notifications });
    const heard: string[] = [];
    api.listen("notify-failed", () => {
      heard.push("notify-failed");
    });
    await api.invoke("notify_os", { title: "Hi", body: null, threadId: null });
    firstHandlers(notifications).onError();
    expect(heard).toEqual(["notify-failed"]);
  });

  test("tray_update puts the running count in front of the title, and drops it at zero", async () => {
    const { api, page } = harness();
    expect(await api.invoke("tray_update", { labels: LABELS, running: 3 })).toEqual({
      kind: "updated",
    });
    expect(page.state.title).toBe("(3) Fresnel");
    expect(await api.invoke("tray_update", { labels: LABELS, running: 1 })).toEqual({
      kind: "updated",
    });
    expect(page.state.title).toBe("(1) Fresnel");
    expect(await api.invoke("tray_update", { labels: LABELS, running: 0 })).toEqual({
      kind: "updated",
    });
    expect(page.state.title).toBe("Fresnel");
  });

  test("tray_update rejects a malformed argument with bad-request", async () => {
    const { api, page } = harness();
    expect(await settled(api.invoke("tray_update", { labels: LABELS, running: -1 }))).toEqual({
      ok: false,
      error: "bad-request",
    });
    expect(page.state.title).toBe("Fresnel");
  });

  test("commands the web hides reject unsupported-on-web", async () => {
    const { api } = harness();
    const names = [
      "os_reauth",
      "update_status",
      "update_check",
      "update_download",
      "update_install_restart",
      "open_data_dir",
      "open_log_dir",
      "engine_retarget",
    ];
    const results = await Promise.all(names.map((name) => settled(api.invoke(name))));
    expect(results).toEqual(names.map(() => ({ ok: false, error: "unsupported-on-web" })));
  });

  test("intercepted commands never reach the server, and a plain command does", async () => {
    const notifications = fakeNotifications("granted");
    const { api, server, page } = harness({ notifications });
    page.state.pickAnswer = null;
    await api.invoke("shell_capabilities");
    await api.invoke("pick_file_read");
    await settled(api.invoke("save_file", { suggestedName: "a.txt", content: "x" }));
    await settled(api.invoke("open_external", { href: "https://example.com" }));
    await api.invoke("notify_permission");
    await api.invoke("notify_request_permission");
    await settled(api.invoke("notify_os", { title: "t", body: null, threadId: null }));
    await api.invoke("notify_take_target");
    await api.invoke("tray_update", { labels: LABELS, running: 0 });
    await settled(api.invoke("os_reauth"));
    expect(await api.invoke("control")).toBe("pong");
    expect(server.commands).toEqual(["control"]);
  });
});
