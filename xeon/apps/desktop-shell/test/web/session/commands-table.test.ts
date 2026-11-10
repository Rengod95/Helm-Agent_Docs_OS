// 명령 표 시험. 새 명령이 표 없이 들어오면 실패해야 한다. 표의 처리 위치는 L4.remote.spec §6.1 행과 맞아야 한다.
import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  COMMAND_TABLE,
  dispositionOf,
  isServedByGateway,
} from "../../../src/web/session/commands-table.ts";
import { createWebContext, type WebContext } from "../../../src/web/session/web-context.ts";
import { recordedLog, sessionOptions } from "./support.ts";
import { cleanupTempDirs, tempDir } from "../support/fixtures.ts";

afterEach(cleanupTempDirs);

const SRC_MAIN = path.resolve(import.meta.dirname, "../../../src/main");

/** `src/main` 아래 모든 `.ts`에서 `.handle("이름"` 꼴로 등록되는 명령 이름 */
function commandNamesIn(dir: string): string[] {
  const names: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      names.push(...commandNamesIn(full));
      continue;
    }
    if (!entry.endsWith(".ts")) continue;
    for (const match of readFileSync(full, "utf8").matchAll(/\.handle\(\s*"([^"]+)"/gu)) {
      const name = match[1];
      if (name !== undefined) names.push(name);
    }
  }
  return names;
}

/** 탭 하나의 컨텍스트. 소켓 경로는 없는 경로라 엔진은 띄워지지 않고 실패 상태에서 기다린다 */
function webForTest(): WebContext {
  const socketPath = path.join(tempDir(), "absent.sock");
  return createWebContext({
    ...sessionOptions(socketPath, recordedLog()),
    deviceId: "dev_test",
    tabId: "tab_test",
    send: () => undefined,
  });
}

describe("command table completeness", () => {
  test("every command the loaded modules request has a table entry", async () => {
    const web = webForTest();
    try {
      const unlisted = web.requested.filter((name) => dispositionOf(name) === undefined);
      expect(unlisted).toEqual([]);
      // 표본이 비어 있지 않다는 것: 엔진, 폴더, 백업, 서비스 모듈이 모두 요청한다
      expect(web.requested).toContain("engine_attach");
      expect(web.requested).toContain("folder_read");
      expect(web.requested).toContain("db_export");
      expect(web.requested).toContain("service_status");
      expect(web.requested).toContain("app_roots_set");
      expect(web.requested).toContain("secret_register");
    } finally {
      await web.close();
    }
  });

  test("every command name in src/main has a table entry", () => {
    const found = [...new Set(commandNamesIn(SRC_MAIN))].toSorted();
    const unlisted = found.filter((name) => dispositionOf(name) === undefined);
    expect(found).toContain("engine_attach");
    expect(found).toContain("pick_file");
    expect(unlisted).toEqual([]);
  });

  test("every table entry is a command the desktop or the web session knows", () => {
    const known = new Set(commandNamesIn(SRC_MAIN));
    // 웹 세션이 직접 답하는 명령은 `src/main`에 없다(web-context.ts의 `serve`)
    const webOwn = new Set(["shell_capabilities", "origin_folder_list", "view_root"]);
    const extra = Object.keys(COMMAND_TABLE).filter(
      (name) => !known.has(name) && !webOwn.has(name),
    );
    expect(extra).toEqual([]);
  });
});

describe("spec 6.1 rows match the table", () => {
  // L4.remote.spec §6.1의 "실행 위치" 열을 옮긴 것. `origin`은 게이트웨이에서 답한다(gap이 있어도 명세상 origin이다).
  // `pick_folder`는 W4에서 웹 숨김으로 바꿨다(명세 행과 다르다). 웹 화면은 `origin_folder_list`로 서버 폴더를 고른다.
  const rows: Readonly<Record<string, "origin" | "browser" | "hidden">> = {
    engine_attach: "origin",
    engine_write: "origin",
    engine_ack: "origin",
    engine_detach: "origin",
    engine_restart: "origin",
    engine_retarget: "hidden",
    pick_file_read: "browser",
    save_file: "browser",
    pick_folder: "hidden",
    pick_folder_open: "origin",
    folder_list: "origin",
    folder_read: "origin",
    open_external: "browser",
    open_data_dir: "hidden",
    open_log_dir: "hidden",
    notify_permission: "browser",
    notify_request_permission: "browser",
    notify_os: "browser",
    shell_take_intents: "origin",
    notify_take_target: "origin",
    tray_update: "browser",
    update_status: "hidden",
    update_check: "hidden",
    update_download: "hidden",
    update_install_restart: "hidden",
    os_reauth: "hidden",
    secret_register: "origin",
    desktop_settings_read: "origin",
    desktop_settings_write: "origin",
    db_export: "origin",
    db_usage: "origin",
    db_previous_remove: "origin",
    db_restore: "origin",
    app_roots_set: "origin",
  };

  test("each row's commands have the row's disposition", () => {
    const actual = Object.fromEntries(
      Object.keys(rows).map((name) => [name, dispositionOf(name)?.kind ?? "missing"]),
    );
    expect(actual).toEqual(rows);
  });
});

describe("served set", () => {
  test("the gateway registers exactly the origin commands that have an implementation", async () => {
    const web = webForTest();
    try {
      expect([...web.served].toSorted()).toEqual(
        [
          "app_roots_set",
          "db_export",
          "db_previous_remove",
          "db_restore",
          "db_usage",
          "desktop_settings_read",
          "desktop_settings_write",
          "engine_ack",
          "engine_attach",
          "engine_detach",
          "engine_restart",
          "engine_write",
          "folder_list",
          "folder_read",
          "notify_take_target",
          "origin_folder_list",
          "secret_register",
          "service_autostart_set",
          "service_ensure",
          "service_status",
          "service_stop",
          "shell_capabilities",
          "shell_take_intents",
          "view_root",
        ].toSorted(),
      );
    } finally {
      await web.close();
    }
  });

  test("hidden, browser and gap commands are not served", () => {
    const notServed = Object.keys(COMMAND_TABLE).filter((name) => !isServedByGateway(name));
    expect(notServed).toContain("open_external");
    expect(notServed).toContain("engine_retarget");
    expect(notServed).toContain("pick_folder_open");
    expect(notServed).toContain("pick_folder");
    expect(isServedByGateway("db_restore")).toBe(true);
    expect(isServedByGateway("desktop_settings_read")).toBe(true);
    expect(isServedByGateway("origin_folder_list")).toBe(true);
    expect(isServedByGateway("shell_capabilities")).toBe(false);
  });

  test("every gap carries the reason it is not served", () => {
    const gaps = Object.entries(COMMAND_TABLE).flatMap(([name, disposition]) =>
      disposition.kind === "origin" && disposition.gap !== undefined ? [name] : [],
    );
    expect(gaps.toSorted()).toEqual(["pick_folder_open"]);
    for (const name of gaps) {
      const disposition = dispositionOf(name);
      expect(disposition?.kind === "origin" && (disposition.gap ?? "").length > 0).toBe(true);
    }
  });
});
