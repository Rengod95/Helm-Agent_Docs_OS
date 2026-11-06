// 트레이의 Electron 어댑터. tray.ts의 ports를 Tray와 Menu로 채운다. 로직과 시험은 tray.ts와 test/tray.test.ts에 있다.
// 아이콘은 셸 패키지의 assets/tray.png(44x44 템플릿)다. 개발 중에는 셸 패키지 폴더에서, 패키지 앱에서는 Resources/assets에서 읽는다(scripts/package.ts의 extraResource가 넣는다).
// 이 파일은 시험하지 않는다. 셸을 띄워 메뉴 막대에서 확인한다.
import path from "node:path";
import { attempt, err, ok } from "@fresnel/contracts";
import { app, Menu, type MenuItemConstructorOptions, nativeImage, Tray } from "electron";
import type { ShellContext, ShellModule } from "./context.ts";
import { appLogOf } from "./lib/applog.ts";
import {
  actionOf,
  createTrayModule,
  type TrayAction,
  type TrayLabels,
  type TrayPorts,
} from "./tray.ts";

/** 메뉴 막대에 맞춘 아이콘 높이(pt). 원본 44px을 이 높이로 줄인다 */
const MENU_BAR_HEIGHT = 18;

/** 트레이 객체를 붙들어 두어 GC가 메뉴 막대에서 지우지 않게 한다 */
const liveTrays = new Set<Tray>();

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
  const appLog = appLogOf(ctx);
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
      appLog.line(line);
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
