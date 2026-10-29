import { describe, expect, test } from "bun:test";
import { firstRunView, type SetupInput } from "../../src/settings/index.ts";
import type { ToolsWebView, WebRecommendation } from "../../src/web/index.ts";

const READY_KEY: SetupInput = {
  providers: [
    { id: "anthropic", enabled: true, apiKeyRef: "secret://anthropic-api-key", baseUrl: null },
  ],
  defaultModel: "anthropic/claude",
  secrets: [{ name: "anthropic-api-key", registered: true }],
  toolsReady: true,
};

const NO_KEY: SetupInput = {
  providers: [],
  defaultModel: null,
  secrets: [],
  toolsReady: true,
};

function recommendation(
  label: "Exa" | "Brave",
  state: WebRecommendation["state"],
): WebRecommendation {
  return {
    label,
    providerId: label === "Exa" ? "plugin:web-exa" : "plugin:web-brave",
    secretName: label === "Exa" ? "exa-api-key" : "brave-api-key",
    state,
    hint:
      state === "needs-key"
        ? `xeon secret add ${label === "Exa" ? "exa-api-key" : "brave-api-key"}`
        : "",
  };
}

function webOf(
  recommendations: readonly WebRecommendation[],
  provider = "auto",
  order: readonly string[] = [],
): ToolsWebView {
  return {
    search: { capability: "web.search", provider, order: [...order], rows: [] },
    browse: { capability: "web.browse", provider: "auto", order: [], rows: [] },
    fetch: { capability: "web.fetch", provider: "auto", order: [], rows: [] },
    parallel: 1,
    robots: { value: "never", follows: false },
    recommendations,
    noticesPending: [],
  };
}

describe("first run steps", () => {
  test("a ready setup has every step done and a chat can start", () => {
    const view = firstRunView({ setup: READY_KEY, web: null, searchHintDismissed: false });
    expect(view.steps.map((step) => [step.id, step.done])).toEqual([
      ["tools", true],
      ["key", true],
      ["model", true],
    ]);
    expect(view.readyToChat).toBe(true);
    expect(view.next).toBeNull();
  });

  test("the next step is the first one not done", () => {
    const view = firstRunView({ setup: NO_KEY, web: null, searchHintDismissed: false });
    expect(view.readyToChat).toBe(false);
    expect(view.next).toBe("key");
  });

  test("an unknown step (no result) is skipped when looking for the next step", () => {
    const unknownTools: SetupInput = { ...NO_KEY, toolsReady: null };
    const view = firstRunView({ setup: unknownTools, web: null, searchHintDismissed: false });
    expect(view.steps.find((step) => step.id === "tools")).toEqual({
      id: "tools",
      done: false,
      unknown: true,
    });
    expect(view.next).toBe("key");
  });
});

describe("first run search hint", () => {
  test("no web view means no search block", () => {
    const view = firstRunView({ setup: READY_KEY, web: null, searchHintDismissed: false });
    expect(view.search).toBeNull();
  });

  test("the hint shows while a recommended key plugin is not ready and it was not dismissed", () => {
    const web = webOf([recommendation("Exa", "needs-key"), recommendation("Brave", "ready")]);
    const view = firstRunView({ setup: READY_KEY, web, searchHintDismissed: false });
    expect(view.search?.show).toBe(true);
    expect(view.search?.recommendations).toEqual(web.recommendations);
  });

  test("dismissing hides the hint even when a key is still missing", () => {
    const web = webOf([
      recommendation("Exa", "needs-key"),
      recommendation("Brave", "not-installed"),
    ]);
    const view = firstRunView({ setup: READY_KEY, web, searchHintDismissed: true });
    expect(view.search?.show).toBe(false);
  });

  test("the hint hides when every recommended plugin is ready", () => {
    const web = webOf([recommendation("Exa", "ready"), recommendation("Brave", "ready")]);
    const view = firstRunView({ setup: READY_KEY, web, searchHintDismissed: false });
    expect(view.search?.show).toBe(false);
  });

  test("provider and order pass through from the web view unchanged", () => {
    const web = webOf([], "plugin:web-exa", ["plugin:web-exa", "web-search"]);
    const view = firstRunView({ setup: READY_KEY, web, searchHintDismissed: false });
    expect(view.search?.provider).toBe("plugin:web-exa");
    expect(view.search?.order).toEqual(["plugin:web-exa", "web-search"]);
  });
});
