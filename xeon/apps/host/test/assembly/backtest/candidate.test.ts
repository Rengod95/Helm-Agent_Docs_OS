import { expect, test } from "bun:test";
import { err, ok, type Result } from "@fresnel/contracts";
import type { DraftInfo } from "@fresnel/contracts/wire";
import {
  createCandidateResolver,
  type CandidateResolveError,
  type CandidateStoreView,
} from "../../../src/assembly/backtest/candidate.ts";

// 후보 찾기(§4.8 규칙 54). 검토본과 초안의 `versionId`를 트리와 매니페스트로 바꾼다. 저장소와 파일은 가짜다.

const HASH = `sha256:${"a".repeat(64)}`;
const DRAFT_HASH = `sha256:${"ab".repeat(32)}`;
const MANIFEST = JSON.stringify({
  schemaVersion: 2,
  name: "guard-a",
  version: "1.0.0",
  entry: "./src/index.ts",
});

interface StoreOptions {
  readonly tree?: Result<string, { readonly kind: "not_found"; readonly what: string }>;
  readonly verify?: Result<
    void,
    {
      readonly kind: "pinned_corrupt";
      readonly name: string;
      readonly contentHash: string;
      readonly actual: null;
    }
  >;
  readonly draft?: Result<DraftInfo, { readonly kind: "not_found"; readonly what: string }>;
}

function storeOf(options: StoreOptions = {}): CandidateStoreView {
  return {
    treePath: () => Promise.resolve(options.tree ?? ok("/store/reviewed/guard-a/aaaa/tree")),
    verifyIntegrity: () => Promise.resolve(options.verify ?? ok(undefined)),
    readDraft: () => Promise.resolve(options.draft ?? err({ kind: "not_found", what: "draft" })),
    draftDir: (draftId) => `/store/drafts/${draftId}`,
  };
}

function manifestsOf(files: Readonly<Record<string, string>>) {
  return (path: string): Promise<Result<string | null, string>> =>
    Promise.resolve(ok(files[path] ?? null));
}

const DRAFT_INFO: DraftInfo = {
  draftId: "drf_01HZ",
  name: "guard-a",
  contentHash: DRAFT_HASH,
  parent: null,
  createdAt: "2026-11-18T09:00:00.000Z",
  originThreadId: null,
  label: null,
  submittedItemId: null,
};

function kindOf(result: Result<unknown, CandidateResolveError>): string {
  return result.ok ? "ok" : result.error.kind;
}

test("a reviewed version resolves to its tree, the manifest name and its entry", async () => {
  const resolve = createCandidateResolver({
    store: storeOf(),
    readManifestText: manifestsOf({
      "/store/reviewed/guard-a/aaaa/tree/.fresnel-plugin/plugin.json": MANIFEST,
    }),
  });
  const found = await resolve({ pluginId: "guard-a", versionId: HASH });
  expect(found.ok).toBe(true);
  if (!found.ok) return;
  expect(found.value.name).toBe("guard-a");
  expect(found.value.versionId).toBe(HASH);
  expect(found.value.root).toBe("/store/reviewed/guard-a/aaaa/tree");
  expect(found.value.entry).toBe("./src/index.ts");
  expect(found.value.manifest).toEqual({
    schemaVersion: 2,
    name: "guard-a",
    version: "1.0.0",
    entry: "./src/index.ts",
  });
});

test("a draft version resolves to the draft tree when the name and the hash prefix match", async () => {
  const resolve = createCandidateResolver({
    store: storeOf({ draft: ok(DRAFT_INFO) }),
    readManifestText: manifestsOf({
      "/store/drafts/drf_01HZ/tree/.fresnel-plugin/plugin.json": MANIFEST,
    }),
  });
  const found = await resolve({ pluginId: "guard-a", versionId: "draft:drf_01HZ:abababab" });
  expect(found.ok).toBe(true);
  if (!found.ok) return;
  expect(found.value.root).toBe("/store/drafts/drf_01HZ/tree");
  expect(found.value.versionId).toBe("draft:drf_01HZ:abababab");
});

test("an inject-only candidate with no entry resolves with a null entry", async () => {
  const manifest = JSON.stringify({ schemaVersion: 2, name: "guard-a", version: "1.0.0" });
  const resolve = createCandidateResolver({
    store: storeOf(),
    readManifestText: manifestsOf({
      "/store/reviewed/guard-a/aaaa/tree/.fresnel-plugin/plugin.json": manifest,
    }),
  });
  const found = await resolve({ pluginId: "guard-a", versionId: HASH });
  expect(found.ok && found.value.entry).toBe(null);
});

test("a project plugin id is split into its name and resolves through the project key", async () => {
  const keys: string[] = [];
  const store: CandidateStoreView = {
    ...storeOf(),
    treePath: (key) => {
      keys.push(key);
      return Promise.resolve(ok("/store/reviewed/prj_01/guard-a/aaaa/tree"));
    },
  };
  const resolve = createCandidateResolver({
    store,
    readManifestText: manifestsOf({
      "/store/reviewed/prj_01/guard-a/aaaa/tree/.fresnel-plugin/plugin.json": MANIFEST,
    }),
  });
  const found = await resolve({ pluginId: "prj_01/guard-a", versionId: HASH });
  expect(keys).toEqual(["prj_01/guard-a"]);
  expect(found.ok && found.value.name).toBe("guard-a");
});

test("every way a candidate can be missing answers candidate_not_found", async () => {
  const missingManifest = createCandidateResolver({
    store: storeOf(),
    readManifestText: manifestsOf({}),
  });
  expect(kindOf(await missingManifest({ pluginId: "guard-a", versionId: HASH }))).toBe(
    "candidate_not_found",
  );

  const notInStore = createCandidateResolver({
    store: storeOf({ tree: err({ kind: "not_found", what: "tree" }) }),
    readManifestText: manifestsOf({}),
  });
  expect(kindOf(await notInStore({ pluginId: "guard-a", versionId: HASH }))).toBe(
    "candidate_not_found",
  );

  const corrupt = createCandidateResolver({
    store: storeOf({
      verify: err({ kind: "pinned_corrupt", name: "guard-a", contentHash: HASH, actual: null }),
    }),
    readManifestText: manifestsOf({}),
  });
  expect(kindOf(await corrupt({ pluginId: "guard-a", versionId: HASH }))).toBe(
    "candidate_not_found",
  );

  const invalidManifest = createCandidateResolver({
    store: storeOf(),
    readManifestText: manifestsOf({
      "/store/reviewed/guard-a/aaaa/tree/.fresnel-plugin/plugin.json": JSON.stringify({
        name: "guard-a",
      }),
    }),
  });
  expect(kindOf(await invalidManifest({ pluginId: "guard-a", versionId: HASH }))).toBe(
    "candidate_not_found",
  );

  const otherName = createCandidateResolver({
    store: storeOf(),
    readManifestText: manifestsOf({
      "/store/reviewed/guard-a/aaaa/tree/.fresnel-plugin/plugin.json": MANIFEST.replace(
        "guard-a",
        "guard-b",
      ),
    }),
  });
  expect(kindOf(await otherName({ pluginId: "guard-a", versionId: HASH }))).toBe(
    "candidate_not_found",
  );
});

test("a draft of another plugin, or with another hash prefix, is not the candidate", async () => {
  const files = { "/store/drafts/drf_01HZ/tree/.fresnel-plugin/plugin.json": MANIFEST };
  const otherPlugin = createCandidateResolver({
    store: storeOf({ draft: ok({ ...DRAFT_INFO, name: "guard-b" }) }),
    readManifestText: manifestsOf(files),
  });
  expect(
    kindOf(await otherPlugin({ pluginId: "guard-a", versionId: "draft:drf_01HZ:abababab" })),
  ).toBe("candidate_not_found");
  const otherHash = createCandidateResolver({
    store: storeOf({ draft: ok(DRAFT_INFO) }),
    readManifestText: manifestsOf(files),
  });
  expect(
    kindOf(await otherHash({ pluginId: "guard-a", versionId: "draft:drf_01HZ:cdcdcdcd" })),
  ).toBe("candidate_not_found");
});

test("a malformed plugin id or version id is not a candidate", async () => {
  const resolve = createCandidateResolver({
    store: storeOf(),
    readManifestText: manifestsOf({}),
  });
  expect(kindOf(await resolve({ pluginId: "Bad Name", versionId: HASH }))).toBe(
    "candidate_not_found",
  );
  expect(kindOf(await resolve({ pluginId: "guard-a", versionId: "sha256:xyz" }))).toBe(
    "candidate_not_found",
  );
});
