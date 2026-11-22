import { describe, expect, test } from "bun:test";
import { WIRE_ERRORS } from "@fresnel/contracts/wire";
import type { CommandError } from "../../../src/views/commands.ts";
import { profileErrorText } from "../../../src/views/compose/compose-text.ts";
import { isRequiredByCore } from "../../../src/views/craft/core-required.ts";

describe("isRequiredByCore", () => {
  test("a rejection with the plugin.requiredByCore code (3626) is a core-required plugin", () => {
    expect(WIRE_ERRORS["plugin.requiredByCore"].code).toBe(3626);
    expect(isRequiredByCore({ kind: "rejected", code: 3626 })).toBe(true);
  });

  test("a rejection with any other code is not a core-required plugin", () => {
    expect(isRequiredByCore({ kind: "rejected", code: WIRE_ERRORS["profile.conflict"].code })).toBe(
      false,
    );
    expect(isRequiredByCore({ kind: "rejected", code: -32602 })).toBe(false);
  });

  test("a rejection without a code is not a core-required plugin", () => {
    expect(isRequiredByCore({ kind: "rejected", code: null })).toBe(false);
  });

  test("an offline error is not a core-required plugin", () => {
    expect(isRequiredByCore({ kind: "offline" })).toBe(false);
  });
});

describe("profileErrorText", () => {
  test("a 3626 rejection reads as the core-required sentence, not the generic failure", () => {
    const error: CommandError = { kind: "rejected", code: 3626 };
    expect(profileErrorText(error)).toBe("desktop.compose.profile.error.requiredByCore");
  });

  test("a profile conflict keeps the conflict sentence", () => {
    const error: CommandError = {
      kind: "rejected",
      code: WIRE_ERRORS["profile.conflict"].code,
    };
    expect(profileErrorText(error)).toBe("desktop.compose.profile.error.conflict");
  });

  test("other rejections keep the generic failure sentence", () => {
    expect(profileErrorText({ kind: "rejected", code: -32602 })).toBe(
      "desktop.compose.profile.error.failed",
    );
    expect(profileErrorText({ kind: "rejected", code: null })).toBe(
      "desktop.compose.profile.error.failed",
    );
  });
});
