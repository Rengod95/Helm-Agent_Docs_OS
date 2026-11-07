import { expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { ExtListEntry } from "@fresnel/contracts/wire";
import { renderToString } from "react-dom/server";
import { CommandsContext } from "../../../src/views/commands.ts";
import { ExportExtension } from "../../../src/views/workbench/export-extension.tsx";
import { fakeCommands } from "../fake-commands.ts";

// 상세 머리의 "내보내기" 단추. 상자는 눌러야 열리므로 첫 마크업에는 단추만 있다.
const ENTRY: ExtListEntry = {
  name: "lens",
  displayName: "Lens",
  layer: "L2",
  isGroup: false,
  version: "1.2.0",
  location: "/cfg/extensions/lens",
  origin: "user",
  requestedGrade: "user",
  effectiveGrade: "user",
  tier: null,
  status: "enabled",
  plugins: [],
  diagnostics: [],
  autoDisabled: false,
  safeModeExcluded: null,
  hookCount: 0,
};

test("the export button reads Export / 내보내기 and the dialog is closed at first", () => {
  const html = renderToString(
    <CommandsContext.Provider value={fakeCommands()}>
      <ExportExtension entry={ENTRY} />
    </CommandsContext.Provider>,
  );
  expect(html).toContain(t("desktop.workbench.export.open"));
  expect(html).not.toContain(t("desktop.workbench.export.subtitle"));
});
