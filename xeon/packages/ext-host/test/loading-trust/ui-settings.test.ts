import { expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import { buildCatalog } from "@fresnel/contracts/settings";
import { uiSettings } from "../../src/loading-trust/index.ts";

test("settings: x.ui keys pass the catalog", () => {
  const defs = Object.values(uiSettings.defs);
  expect(buildCatalog([{ owner: "ext-host", namespace: "x.ui", defs }]).ok).toBe(true);
});

test("settings: apps defaults on after the frame isolation check and allowProjectApps stays off, both in the X layer", () => {
  expect(Object.keys(uiSettings.defs)).toEqual(["apps", "allowProjectApps", "hidden", "order"]);
  expect(uiSettings.defs.apps.key).toBe("x.ui.apps");
  expect(uiSettings.defs.apps.default).toBe(true);
  expect(uiSettings.defs.apps.layer).toBe("X");
  expect(uiSettings.defs.allowProjectApps.key).toBe("x.ui.allowProjectApps");
  expect(uiSettings.defs.allowProjectApps.default).toBe(false);
  expect(uiSettings.defs.allowProjectApps.layer).toBe("X");
});

test("settings: neither key can be set from the project, local or launch scope", () => {
  // 저장소가 자기 앱 권한을 켜거나 전역 정책을 되돌리지 못하게 한다(X.loading-trust.spec §6)
  expect(uiSettings.defs.apps.allowedScopes).toEqual(["managed", "user"]);
  expect(uiSettings.defs.allowProjectApps.allowedScopes).toEqual(["managed", "user"]);
  expect(uiSettings.defs.apps.runtimeChange).toBe("restart");
  expect(uiSettings.defs.allowProjectApps.runtimeChange).toBe("restart");
});

test("settings: hidden items and place order are user values that apply live and stay off the settings screen", () => {
  // AGE-73: 앱 전체에 한 벌, 리뷰 없음. 크래프트 상세 "화면과 설정" 탭이 바꾼다
  for (const def of [uiSettings.defs.hidden, uiSettings.defs.order]) {
    expect(def.allowedScopes).toEqual(["managed", "user"]);
    expect(def.runtimeChange).toBe("live");
    expect(def.layer).toBe("X");
    expect(def.ui).toBeUndefined();
  }
  expect(uiSettings.defs.hidden.key).toBe("x.ui.hidden");
  expect(uiSettings.defs.hidden.default).toEqual([]);
  expect(uiSettings.defs.order.key).toBe("x.ui.order");
  expect(uiSettings.defs.order.default).toEqual({});
});

test("settings: order takes status and panel lists only", () => {
  const order = uiSettings.defs.order.type;
  expect(parse(order, { status: ["helm/phase"], panel: ["kanban/board", "helm/panel"] }).ok).toBe(
    true,
  );
  expect(parse(order, { page: ["kanban/board"] }).ok).toBe(false);
  expect(parse(uiSettings.defs.hidden.type, ["helm/phase", "x"]).ok).toBe(false);
});
