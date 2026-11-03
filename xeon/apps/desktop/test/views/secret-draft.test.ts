import { describe, expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import { SecretNameSchema, type SecretName } from "@fresnel/contracts/capabilities";
import type { SecretListEntry } from "@fresnel/contracts/wire";
import {
  draftOf,
  entryNameOf,
  metaParamsOf,
  type MetaDraft,
} from "../../src/views/pages/secrets/secret-draft.ts";

// 시크릿 화면의 입력 검사. 이름은 계약의 규칙을 그대로 쓰고, 메타 칸은 `secret.meta`의 범위를 따른다.

function nameOf(text: string): SecretName {
  const parsed = parse(SecretNameSchema, text);
  if (!parsed.ok) throw new Error("test name must parse");
  return parsed.value;
}

const META: NonNullable<SecretListEntry["meta"]> = {
  name: nameOf("exa-api-key"),
  desc: "search key",
  provider: "sops",
  ref: "dev/EXA",
  scope: "user",
  expiresAt: "2026-12-31",
  use: { modes: ["runtime-http"], tools: ["web.search"], hosts: ["api.exa.ai"] },
  approval: "per-use",
  ttlSeconds: 3600,
  maxUses: 50,
};

const DRAFT: MetaDraft = draftOf(META);

describe("entry name check", () => {
  test("a name that follows the contract's rule is accepted, with surrounding spaces trimmed", () => {
    expect(entryNameOf("  exa-api-key ")).toEqual({ ok: true, value: nameOf("exa-api-key") });
  });

  test("a name that breaks the rule is refused", () => {
    for (const text of ["Exa", "1key", "k", "has space", ""]) {
      expect(entryNameOf(text)).toEqual({ ok: false, error: "name" });
    }
  });
});

describe("metadata draft", () => {
  test("the draft shows the metadata as text, and an absent metadata shows empty fields", () => {
    expect(DRAFT).toEqual({
      desc: "search key",
      hosts: "api.exa.ai",
      expiresAt: "2026-12-31",
      approval: "per-use",
      ttlSeconds: "3600",
      maxUses: "50",
    });
    expect(draftOf(undefined)).toEqual({
      desc: "",
      hosts: "",
      expiresAt: "",
      approval: "none",
      ttlSeconds: "",
      maxUses: "",
    });
  });

  test("a valid draft becomes secret.meta params, keeping the modes and tools of the current policy", () => {
    const checked = metaParamsOf(
      nameOf("exa-api-key"),
      { ...DRAFT, hosts: "api.exa.ai, *.exa.test", expiresAt: "" },
      META,
    );
    expect(checked).toEqual({
      ok: true,
      value: {
        name: nameOf("exa-api-key"),
        desc: "search key",
        expiresAt: null,
        approval: "per-use",
        use: {
          modes: ["runtime-http"],
          tools: ["web.search"],
          hosts: ["api.exa.ai", "*.exa.test"],
        },
        ttlSeconds: 3600,
        maxUses: 50,
      },
    });
  });

  test("with no current metadata the policy is not sent, and empty numbers are left unchanged", () => {
    const checked = metaParamsOf(
      nameOf("exa-api-key"),
      { ...DRAFT, ttlSeconds: "", maxUses: "" },
      undefined,
    );
    expect(checked).toEqual({
      ok: true,
      value: {
        name: nameOf("exa-api-key"),
        desc: "search key",
        expiresAt: "2026-12-31",
        approval: "per-use",
      },
    });
  });

  test("each field refuses its own bad value and names the field", () => {
    expect(metaParamsOf(nameOf("exa-api-key"), { ...DRAFT, desc: "  " }, META)).toEqual({
      ok: false,
      error: "desc",
    });
    expect(
      metaParamsOf(nameOf("exa-api-key"), { ...DRAFT, expiresAt: "2026/12/31" }, META),
    ).toEqual({
      ok: false,
      error: "expiresAt",
    });
    expect(metaParamsOf(nameOf("exa-api-key"), { ...DRAFT, ttlSeconds: "0" }, META)).toEqual({
      ok: false,
      error: "ttlSeconds",
    });
    expect(metaParamsOf(nameOf("exa-api-key"), { ...DRAFT, maxUses: "1.5" }, META)).toEqual({
      ok: false,
      error: "maxUses",
    });
  });
});
