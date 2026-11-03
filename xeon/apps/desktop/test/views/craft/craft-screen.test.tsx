import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { renderToString } from "react-dom/server";
import {
  craftReducer,
  initialCraftState,
  type CraftState,
} from "../../../src/views/craft/craft-context.tsx";
import { CraftScreen } from "../../../src/views/craft/craft-screen.tsx";
import { createDesktopRegistry } from "../../../src/views/desktop-registry.tsx";

const run = (s: CraftState, ...actions: Parameters<typeof craftReducer>[1][]): CraftState =>
  actions.reduce(craftReducer, s);

describe("craft state", () => {
  test("canvas.selection-sync: a pick survives switching between the three views", () => {
    const s = run(
      initialCraftState,
      { t: "selectPlugin", id: "helm" },
      { t: "mode", mode: "strata" },
      { t: "mode", mode: "link" },
    );
    expect(s.sel).toEqual({ k: "plugin", id: "helm" });
    expect(s.panel).toBe(true);
    expect(s.mode).toBe("link");
  });

  test("the contrib filter toggles and clear closes the panel", () => {
    const on = run(
      initialCraftState,
      { t: "contrib", contrib: "hook" },
      { t: "contrib", contrib: "skill" },
    );
    expect(on.contrib).toEqual(["hook", "skill"]);
    const off = run(
      on,
      { t: "contrib", contrib: "hook" },
      { t: "selectGroup", id: "helm" },
      { t: "clear" },
    );
    expect(off.contrib).toEqual(["skill"]);
    expect(off.panel).toBe(false);
    expect(off.sel).toEqual({ k: "agent" });
  });

  test("details open and close without losing the pick", () => {
    const s = run(
      initialCraftState,
      { t: "selectPlugin", id: "review" },
      { t: "detail", id: "review" },
    );
    expect(s.detail).toBe("review");
    expect(run(s, { t: "detail", id: null }).sel).toEqual({ k: "plugin", id: "review" });
  });
});

describe("craft screen registration", () => {
  test("the workbench overview screen is registered under the nav id", () => {
    const def = createDesktopRegistry().screen("overview");
    expect(def?.area).toBe("workbench");
    expect(def?.label).toBe("desktop.shell.nav.overview");
  });

  test("without an engine source the screen shows the empty state text", () => {
    const html = renderToString(<CraftScreen source={null} />);
    expect(html).toContain(t("desktop.craft.screen.noSourceTitle"));
  });
});
