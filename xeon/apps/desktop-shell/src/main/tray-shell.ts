// 트레이의 Electron 어댑터. tray.ts의 ports를 Tray와 Menu로 채운다. 로직과 시험은 tray.ts와 test/tray.test.ts에 있다.
// 아이콘은 셸 패키지의 assets/tray.png(44x44 템플릿)다. 개발 중에는 셸 패키지 폴더에서, 패키지 앱에서는 Resources/assets에서 읽는다(scripts/package.ts의 extraResource가 넣는다).
// 이 파일은 시험하지 않는다. 셸을 띄워 메뉴 막대에서 확인한다.
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { attempt, err, ok } from "@fresnel/contracts";
import { app, Menu, type MenuItemConstructorOptions, nativeImage, Tray } from "electron";
import type { ShellContext, ShellModule } from "./context.ts";
import {
  actionOf,
  createTrayModule,
  type TrayAction,
  type TrayLabels,
  type TrayPorts,
} from "./tray.ts";

/** Tauri 앱 로그(AppLog)와 같은 파일이다 */
const LOG_FILE = "fresnel-desktop.log";
/** 메뉴 막대에 맞춘 아이콘 높이(pt). 원본 44px을 이 높이로 줄인다 */
const MENU_BAR_HEIGHT = 18;

/** 트레이 객체를 붙들어 두어 GC가 메뉴 막대에서 지우지 않게 한다 */
const liveTrays = new Set<Tray>();

/** os-reauth-shell.ts의 같은 함수와 같다. 두 곳이 같이 쓰므로 공용으로 뺄 때 함께 옮긴다 */
function appendLogLine(logsDir: string, line: string): void {
  const text = `${new Date().toISOString()} ${line}\n`;
  const written = attempt(() => {
    mkdirSync(logsDir, { recursive: true });
    appendFileSync(path.join(logsDir, LOG_FILE), text);
  });
  if (!written.ok) process.stderr.write(text);
}

/** 메뉴 항목은 id로 동작을 찾는다(actionOf). 진행 중 줄은 비활성이라 누를 수 없다 */
function buildMenu(labels: TrayLabels, onAction: (action: TrayAction) => void): Menu {
  const item = (id: string, label: string, enabled = true): MenuItemConstructorOptions => ({
    id,
    label,
    enabled,
    click: () => {
      const action = actionOf(id);
      if (action !== null) onAction(action);
    },
  });
  return Menu.buildFromTemplate([
    item("open", labels.open),
    item("new_thread", labels.newThread),
    { type: "separator" },
    item("running", labels.running, false),
    { type: "separator" },
    item("quit", labels.quit),
  ]);
}

function trayPorts(ctx: ShellContext): TrayPorts {
  const iconPath = path.join(ctx.paths.resources, "assets", "tray.png");
  return {
    create(initial, onAction) {
      const icon = nativeImage.createFromPath(iconPath);
      if (icon.isEmpty()) return err({ reason: "icon" });
      const bar = icon.resize({ height: MENU_BAR_HEIGHT });
      // macOS 템플릿 이미지는 메뉴 막대의 밝기에 맞춰 칠해진다
      if (ctx.platform === "darwin") bar.setTemplateImage(true);
      const made = attempt(() => {
        const created = new Tray(bar);
        created.setContextMenu(buildMenu(initial, onAction));
        return created;
      });
      if (!made.ok) return err({ reason: "build" });
      const tray = made.value;
      liveTrays.add(tray);
      return ok({
        setLabels(labels: TrayLabels) {
          tray.setContextMenu(buildMenu(labels, onAction));
        },
        destroy() {
          liveTrays.delete(tray);
          tray.destroy();
        },
      });
    },
    log(line) {
      appendLogLine(ctx.paths.logs, line);
    },
    quit() {
      app.quit();
    },
  };
}

export const trayShellModule: ShellModule = {
  name: "tray",
  register(ctx: ShellContext) {
    createTrayModule(trayPorts(ctx)).register(ctx);
  },
};
