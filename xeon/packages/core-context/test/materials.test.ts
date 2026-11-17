import { expect, test } from "bun:test";
import type { ContextMaterialFact } from "@fresnel/contracts/extensions";
import { assembleOptions, userItem } from "./support/builders.ts";
import { harness, installContextHandler } from "./support/harness.ts";
import { valueOf } from "./support/result.ts";

// 재료는 조립 결과의 측정 속성이다(정본 turn-record-metrics.md §4.5 규칙 26·27). 요청 메시지는 재료가 있어도 같다.

async function assembleWith(overrides: Parameters<typeof assembleOptions>[1] = {}): Promise<{
  readonly materials: readonly ContextMaterialFact[];
  readonly messages: readonly unknown[];
  readonly composition: { readonly injected: number } | undefined;
}> {
  const h = await harness();
  h.log.append("thread.started", {});
  h.log.append("item.recorded", userItem(h.log, "question one"));
  const result = valueOf(
    await h.service.assemble(h.log.threadId, h.log.leaf(), assembleOptions(h.log.ids, overrides)),
  );
  return {
    materials: result.materials ?? [],
    messages: result.messages,
    composition: result.composition,
  };
}

test("materials_list_base_prompt_sections_and_prompt_addition_with_exact_tokens", async () => {
  const result = await assembleWith({
    basePrompt: "You are Fresnel.",
    sections: {
      "plugin:alpha:guides/style.md": "Use short sentences.",
      project: "Project notes",
    },
    volatile: { environment: "date", instructions: "Extra rule." },
  });
  // 글자 수 / 4 올림: 16자 → 4, 20자 → 5, 13자 → 4, 11자 → 3
  expect(result.materials).toEqual([
    {
      plugin: "none",
      versionId: null,
      registrationId: null,
      kind: "always",
      material: "instruction",
      ref: "base-prompt",
      tokens: 4,
      truncated: false,
      omitted: null,
      itemId: null,
      attribution: "shared",
    },
    {
      plugin: "alpha",
      versionId: null,
      registrationId: null,
      kind: "always",
      material: "instruction",
      ref: "guides/style.md",
      tokens: 5,
      truncated: false,
      omitted: null,
      itemId: null,
      attribution: "declared",
    },
    {
      plugin: "none",
      versionId: null,
      registrationId: null,
      kind: "always",
      material: "instruction",
      ref: "project",
      tokens: 4,
      truncated: false,
      omitted: null,
      itemId: null,
      attribution: "shared",
    },
    {
      plugin: "none",
      versionId: null,
      registrationId: null,
      kind: "always",
      material: "instruction",
      ref: "prompt-addition",
      tokens: 3,
      truncated: false,
      omitted: null,
      itemId: null,
      attribution: "shared",
    },
  ]);
});

test("a_context_hook_injection_is_one_shared_hook_text_material_owned_by_the_first_applier", async () => {
  const h = await harness();
  h.log.append("thread.started", {});
  h.log.append("item.recorded", userItem(h.log, "question one"));
  await installContextHandler(h.host, "ctx-inject", 0, (payload) => ({
    messages: [...payload.messages, { role: "user", content: "a".repeat(400), timestamp: 9 }],
  }));
  const result = valueOf(
    await h.service.assemble(h.log.threadId, h.log.leaf(), assembleOptions(h.log.ids)),
  );
  const hook = (result.materials ?? []).filter((material) => material.material === "hook_text");
  expect(
    hook.map((item) => [item.plugin, item.kind, item.ref, item.attribution, item.tokens]),
  ).toEqual([
    ["ctx-inject", "always", "request-hooks", "shared", result.composition?.injected ?? -1],
  ]);
  expect(result.composition?.injected).toBeGreaterThan(0);
  // 재료가 있어도 요청 메시지에는 주입 본문 외에 아무것도 더하지 않는다(측정 전용)
  expect(result.messages.length).toBe(3);
});

test("materials_never_carry_content_only_names_and_counts", async () => {
  const result = await assembleWith({ sections: { "plugin:beta:secret.md": "TOP-SECRET-BODY" } });
  const serialized = JSON.stringify(result.materials);
  expect(serialized.includes("TOP-SECRET-BODY")).toBe(false);
  expect(result.materials.some((material) => material.ref === "secret.md")).toBe(true);
});
