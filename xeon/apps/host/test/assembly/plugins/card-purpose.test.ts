import { expect, test } from "bun:test";
import {
  validateManifest,
  type ExtensionManifest,
  type PluginCard,
} from "@fresnel/contracts/extensions";
import type { DependencyNode } from "@fresnel/ext-host";
import { buildPluginCard, type CardSubject } from "../../../src/assembly/plugins/card.ts";
import { withManifestPurpose } from "../../../src/assembly/plugins/service.ts";

// scnUi7: 이전에 승인한 카드의 목적이 도구 설명으로 덮여 있으면 매니페스트의 목적을 보인다. 저장된 카드는 그대로다.

const MATERIALS: CardSubject["materials"] = {
  instructions: [],
  skills: [],
  mcpServers: [],
  agents: [],
  commands: [],
};

const TOOL_TEXT = "Adds one movie to the list.";

function manifestOf(purpose: string): ExtensionManifest {
  const checked = validateManifest({
    schemaVersion: 2,
    name: "movies",
    version: "1.0.0",
    purpose,
    tools: [{ name: "movies_add", description: TOOL_TEXT }],
  });
  if (checked.manifest === undefined) throw new Error("the test manifest is invalid");
  return checked.manifest;
}

function nodeOf(purpose: string): DependencyNode {
  return { name: "movies", version: "1.0.0", manifest: manifestOf(purpose) };
}

function cardWith(purpose: string | null): PluginCard {
  const card = buildPluginCard({
    folder: {
      name: "movies",
      manifest: manifestOf("Tracks movies to watch."),
      materials: MATERIALS,
    },
    origin: { kind: "user" },
    review: { state: "approved", currentHash: null, pendingItemId: null, approvedAt: null },
    usedBy: [],
    health: { state: "idle", lastActiveAt: null, lastError: null },
  });
  return { ...card, purpose };
}

test("a stored purpose equal to a tool description shows the manifest purpose", () => {
  const shown = withManifestPurpose(cardWith(TOOL_TEXT), [nodeOf("Tracks movies to watch.")]);
  expect(shown.purpose).toBe("Tracks movies to watch.");
});

test("a stored purpose that is not a tool description stays", () => {
  const stored = cardWith("My own purpose.");
  expect(withManifestPurpose(stored, [nodeOf("Tracks movies to watch.")]).purpose).toBe(
    "My own purpose.",
  );
});

test("without an installed manifest the stored purpose stays", () => {
  expect(withManifestPurpose(cardWith(TOOL_TEXT), []).purpose).toBe(TOOL_TEXT);
});
