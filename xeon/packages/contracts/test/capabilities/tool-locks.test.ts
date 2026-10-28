import { expect, test } from "bun:test";
import { Type, type Static } from "typebox";
import {
  defineCapability,
  validateCapability,
  type CallerId as CapCallerId,
  type ToolLockDecl,
  type ToolRisk as CapToolRisk,
} from "../../src/capabilities/index.ts";
import type { CallerId, ToolRisk } from "../../src/services/index.ts";
import type { Equal, Expect } from "../types/expect.ts";

/** services/tools.ts가 다시 내보내는 이름은 capabilities의 정의와 같은 타입이다 */
test("services re-exports the same CallerId and ToolRisk types", () => {
  const sameCaller: Expect<Equal<CallerId, CapCallerId>> = true;
  const sameRisk: Expect<Equal<ToolRisk, CapToolRisk>> = true;
  expect([sameCaller, sameRisk]).toEqual([true, true]);
});

test("ToolSpec.locks returns path and access from the parameters, and the capability validates", () => {
  const input = Type.Object(
    { path: Type.String({ maxLength: 64 }) },
    { additionalProperties: false },
  );
  const output = Type.Object({ ok: Type.Boolean() }, { additionalProperties: false });
  const def = defineCapability({
    id: "workspace.probe",
    version: "1.0.0",
    description: "probe",
    service: { methods: { edit: { description: "e", input, output, replay: "unsafe" } } },
    tools: [
      {
        name: "edit",
        label: "edit",
        description: "edit a file",
        method: "edit",
        parameters: input,
        locks: (params: Static<typeof input>) => [{ path: params.path, access: "write" }],
      },
    ],
  });
  expect(validateCapability(def)).toEqual([]);
  const locks: readonly ToolLockDecl[] = def.tools[0].locks({ path: "a.txt" });
  expect(locks).toEqual([{ path: "a.txt", access: "write" }]);
});

test("locks rejects an unknown access value at compile time", () => {
  const input = Type.Object(
    { path: Type.String({ maxLength: 64 }) },
    { additionalProperties: false },
  );
  const output = Type.Object({ ok: Type.Boolean() }, { additionalProperties: false });
  defineCapability({
    id: "workspace.probe",
    version: "1.0.0",
    description: "probe",
    service: { methods: { edit: { description: "e", input, output } } },
    tools: [
      {
        name: "edit",
        label: "edit",
        description: "edit a file",
        method: "edit",
        parameters: input,
        // @ts-expect-error -- access는 "read" | "write"만 받는다
        locks: (params: Static<typeof input>) => [{ path: params.path, access: "rw" }],
      },
    ],
  });
});
