import { afterEach, expect, test } from "bun:test";
import { activeLocale, setActiveLocale } from "@fresnel/client/i18n";
import { localizedPluginTitle } from "../../src/views/approval-card/plugin-name.ts";

const before = activeLocale();
afterEach(() => {
  setActiveLocale(before);
});

test("a stored English plugin name is shown in the current language", () => {
  setActiveLocale("ko");
  expect(localizedPluginTitle("Plugin Builder")).toBe("플러그인 빌더");
  expect(localizedPluginTitle("Answer the questions")).toBe("Answer the questions");
  expect(localizedPluginTitle("My own title")).toBe("My own title");
});

test("English stays English", () => {
  setActiveLocale("en");
  expect(localizedPluginTitle("Plugin Builder")).toBe("Plugin Builder");
});
