import { expect, test } from "bun:test";
import { BLOCK_MODEL } from "@fresnel/contracts/blocks";
import { WIRE_METHODS } from "@fresnel/contracts/wire";
import { buildEngineCatalog } from "../../src/assembly/catalog.ts";
import { createFakeHost } from "../fixtures/fake-host.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// blocks.describe(M4, M5e 스펙 §4.9). 처리기는 엔진 빌드의 BLOCK_MODEL을 그대로 돌려준다.
// 블록의 설정 키는 실제 카탈로그의 키여야 하고 범위도 정의와 같아야 한다(부록 A를 정의에서 맞춘 결과가 유지되는지 본다).

test("blocks.describe returns the engine's block model unchanged", async () => {
  const { connection } = createFakeHost().connect();
  await connection.request("host.hello", HELLO_PARAMS);
  expect(await connection.request("blocks.describe", {})).toEqual(BLOCK_MODEL);
  await connection.close();
});

test("host.hello lists blocks.describe as an active feature since 0.1.0", async () => {
  const { connection } = createFakeHost().connect();
  const hello = await connection.request("host.hello", HELLO_PARAMS);
  const feature = hello.features.find((entry) => entry.name === "blocks.describe");
  expect(feature).toEqual({ name: "blocks.describe", status: "active", since: "0.1.0" });
  expect(WIRE_METHODS["blocks.describe"].stage).toBe("M4");
  await connection.close();
});

test("every block setting is a real catalog key with the same scopes as its definition", () => {
  const built = buildEngineCatalog();
  if (!built.ok) {
    throw new Error(`catalog is invalid: ${built.issues.map((issue) => issue.code).join(", ")}`);
  }
  const refs = BLOCK_MODEL.blocks.flatMap((block) => block.settings);
  const problems = refs.flatMap((ref) => {
    const def = built.catalog.get(ref.key);
    if (def === undefined) return [`missing ${ref.key}`];
    const sameLength = def.allowedScopes.length === ref.scope.length;
    const sameSet = ref.scope.every((scope) =>
      def.allowedScopes.some((allowed) => allowed === scope),
    );
    return sameLength && sameSet ? [] : [`scope ${ref.key}`];
  });
  expect(problems).toEqual([]);
  expect(refs.length).toBeGreaterThan(100);
});

test("blocks.applied on a host without a plugin set reads the six blocks with catalog defaults and no handlers", async () => {
  const { connection } = createFakeHost().connect();
  await connection.request("host.hello", HELLO_PARAMS);
  const applied = await connection.request("blocks.applied", {});
  expect(applied.profileId).toBe("default");
  expect(applied.blocks.map((block) => block.id)).toEqual(BLOCK_MODEL.blocks.map((b) => b.id));
  // 값은 모델의 설정 겹 키마다 하나씩, 출처는 설정을 놓은 범위가 없으면 default다
  for (const described of BLOCK_MODEL.blocks) {
    const block = applied.blocks.find((entry) => entry.id === described.id);
    expect(block?.settings.map((entry) => entry.key)).toEqual(described.settings.map((r) => r.key));
    expect(block?.parts.map((part) => part.current)).toEqual(described.parts.map((p) => p.default));
  }
  await connection.close();
});
