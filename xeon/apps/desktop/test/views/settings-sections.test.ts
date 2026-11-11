import { describe, expect, test } from "bun:test";
import { activeLocale, setActiveLocale } from "@fresnel/client/i18n";
import type { FieldVM } from "@fresnel/client/settings";
import type { SettingKey, SettingsTab } from "@fresnel/contracts/settings";
import {
  fieldsOfSection,
  isShownSection,
  jumpSectionOf,
  sectionLabelOf,
  sectionOfField,
  sectionsShownOf,
  SECTION_ORDER,
  type ShownSettingsSection,
} from "../../src/views/pages/settings/settings-sections.ts";
import { defOf, fieldIn, settingOf, viewOf } from "./settings-fixtures.ts";

// 설정 구역 모델 시험. 허용 목록의 항목이 어느 구역에 드는지, 목록 밖의 항목은 어디에도 없는지, 구역 순서와 빈 구역 거르기,
// 설정 점프가 가리는 구역을 값으로 비교한다. 항목은 정의에서 만든 실제 화면 항목이다.

/** 정의 하나를 화면 항목으로 만든다. 값은 구역 판정과 무관하다 */
function fieldOf(key: SettingKey, tab: SettingsTab): FieldVM {
  const view = viewOf([defOf(key, tab, "text", { type: "string" })], [settingOf(key, "x")]);
  const field = fieldIn(view, key);
  if (field === undefined) throw new Error(`field ${key} must exist`);
  return field;
}

describe("section order", () => {
  test("the eleven shown sections come in this order, models, budgets and sandbox are not sections", () => {
    expect([...SECTION_ORDER]).toEqual([
      "overview",
      "providers",
      "secrets",
      "permissions",
      "tools",
      "plugins",
      "connection",
      "execution",
      "sessions",
      "appearance",
      "advanced",
    ]);
    expect(isShownSection("models")).toBe(false);
    expect(isShownSection("budgets")).toBe(false);
    expect(isShownSection("sandbox")).toBe(false);
    expect(isShownSection("connection")).toBe(true);
  });

  test("each section has its own label, and the connection section is named connection and services", () => {
    const previous = activeLocale();
    try {
      setActiveLocale("ko");
      expect(sectionLabelOf("connection")).toBe("연결과 서비스");
      expect(sectionLabelOf("providers")).toBe("모델과 계정");
      expect(sectionLabelOf("advanced")).toBe("백업과 고급");
      setActiveLocale("en");
      expect(sectionLabelOf("connection")).toBe("Connection and services");
    } finally {
      setActiveLocale(previous);
    }
  });
});

describe("which section a field belongs to", () => {
  test("the allowed keys land in their section, whatever tab their definition names", () => {
    const rows: readonly (readonly [SettingKey, SettingsTab, ShownSettingsSection])[] = [
      ["l1.models.default", "models", "providers"],
      ["l1.models.allowedModels", "models", "providers"],
      ["l1.models.deniedModels", "models", "providers"],
      ["l1.models.accounts", "providers", "providers"],
      ["l1.models.providers", "providers", "providers"],
      ["l0.secrets.defaultProvider", "secrets", "secrets"],
      ["l0.secrets.sops.binary", "advanced", "secrets"],
      ["l0.secrets.approval.default", "permissions", "secrets"],
      ["l0.process.service.enabled", "execution", "connection"],
      ["l0.process.service.remote", "execution", "connection"],
      ["l0.sandbox.enabled", "permissions", "permissions"],
      ["l1.tools.permissionMode", "permissions", "permissions"],
      ["l2.mcp.servers", "tools", "tools"],
      ["l2.web.policy.allow", "tools", "tools"],
      ["l2.dialog.commands.shellInjection", "tools", "tools"],
      ["ext.helm.enabled", "plugins", "plugins"],
      ["x.operations.hookDefs", "plugins", "plugins"],
      ["l3.authoring.devMode", "plugins", "plugins"],
      ["l0.exec.shell", "execution", "execution"],
      ["l2.schedule.entries.directCreate", "execution", "execution"],
      ["l1.persistence.autoResume", "sessions", "sessions"],
      ["l2.knowledge.memory.enabled", "sessions", "sessions"],
      ["l4.ui.locale", "appearance", "appearance"],
      ["l4.desktop.window.closeBehavior", "appearance", "appearance"],
      ["l2.dialog.notify.backgroundCompleted", "execution", "appearance"],
      ["l0.os.log.level", "advanced", "advanced"],
      ["l0.os.telemetry.enabled", "advanced", "advanced"],
    ];
    expect(rows.map(([key, tab]) => sectionOfField(fieldOf(key, tab)))).toEqual(
      rows.map(([, , section]) => section),
    );
  });

  test("the keys outside the list belong to no section, even when their tab is a section tab", () => {
    const rows: readonly (readonly [SettingKey, SettingsTab])[] = [
      ["l1.loop.maxSteps", "budgets"],
      ["l1.loop.repeat.enabled", "budgets"],
      ["l1.models.rateLimit", "budgets"],
      ["l1.models.thinkingLevel", "models"],
      ["l1.agents.judge.maxRuns", "models"],
      ["l1.models.routing.review", "models"],
      ["l1.models.retry", "advanced"],
      ["l0.store.heartbeatMs", "advanced"],
      ["l4.cli.theme", "appearance"],
      ["l0.secrets.lease.maxUses", "secrets"],
      ["l0.sandbox.selfTestIntervalMin", "permissions"],
      ["l0.exec.defaultTimeoutMs", "execution"],
      ["l1.context.reserveTokens", "sessions"],
      ["l2.web.fetch.maxChars", "tools"],
      ["l2.dialog.commands.advertise", "tools"],
      ["ext.helm.maxLenses", "plugins"],
      ["ext.helm.isolation", "plugins"],
      ["x.operations.budget.chainMs", "plugins"],
      ["l3.learning.scan.enabled", "plugins"],
      ["zz.not.registered", "tools"],
    ];
    expect(rows.map(([key, tab]) => sectionOfField(fieldOf(key, tab)))).toEqual(
      rows.map(() => null),
    );
  });
});

const WITH_PANEL = (section: ShownSettingsSection): boolean =>
  section === "tools" || section === "secrets";

describe("sections of a view", () => {
  test("fieldsOfSection collects the fields of one section across tabs, in tab order", () => {
    const models = defOf(
      "l1.models.default",
      "models",
      "text",
      { type: "string" },
      {},
      { order: 1 },
    );
    const accounts = defOf("l1.models.accounts", "providers", "table", { type: "array" }, {}, {});
    const servers = defOf("l2.mcp.servers", "tools", "table", { type: "array" }, {}, {});
    const view = viewOf(
      [accounts, servers, models],
      [settingOf(models.key, "a/b"), settingOf(accounts.key, []), settingOf(servers.key, [])],
    );
    expect(fieldsOfSection(view, "providers").map((field) => field.key)).toEqual([
      "l1.models.default",
      "l1.models.accounts",
    ]);
    expect(fieldsOfSection(view, "tools").map((field) => field.key)).toEqual(["l2.mcp.servers"]);
    expect(fieldsOfSection(view, "secrets")).toEqual([]);
  });

  test("the nav keeps the overview always, the sections with a panel or a field, in section order", () => {
    const models = defOf("l1.models.default", "models", "text", { type: "string" });
    const view = viewOf([models], [settingOf(models.key, "a/b")]);
    expect(sectionsShownOf(view, WITH_PANEL)).toEqual([
      "overview",
      "providers",
      "secrets",
      "tools",
    ]);
  });

  test("before the values are read every section is shown", () => {
    expect(sectionsShownOf(null, () => false)).toEqual([...SECTION_ORDER]);
  });

  test("a jump goes to the section of its key, else to its section tab, else to the overview", () => {
    const models = defOf("l1.models.default", "models", "text", { type: "string" });
    const steps = defOf("l1.loop.maxSteps", "budgets", "number", { type: "integer" });
    const service = defOf("l0.process.service.enabled", "execution", "toggle", { type: "boolean" });
    const view = viewOf(
      [models, steps, service],
      [settingOf(models.key, "a/b"), settingOf(steps.key, 3), settingOf(service.key, true)],
    );
    expect(jumpSectionOf({ tab: "models", key: "l1.models.default" }, view)).toBe("providers");
    expect(jumpSectionOf({ tab: "execution", key: "l0.process.service.enabled" }, view)).toBe(
      "connection",
    );
    expect(jumpSectionOf({ tab: "connection", key: null }, view)).toBe("connection");
    expect(jumpSectionOf({ tab: "budgets", key: "l1.loop.maxSteps" }, view)).toBe("overview");
    expect(jumpSectionOf({ tab: "sandbox", key: null }, view)).toBe("overview");
    expect(jumpSectionOf({ tab: "providers", key: null }, null)).toBe("providers");
    expect(jumpSectionOf({ tab: "models", key: "l1.models.default" }, null)).toBe("overview");
  });
});
