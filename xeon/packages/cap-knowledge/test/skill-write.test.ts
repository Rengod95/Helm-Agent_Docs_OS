import { afterEach, describe, expect, test } from "bun:test";
import { eachAsync } from "@xeon/contracts";
import type { CallOptions } from "@xeon/contracts/capabilities";
import { scriptedApprovals } from "./support/approvals.ts";
import { asHost, rejection, threadIdOf } from "./support/helpers.ts";
import { contextOf } from "./support/plans.ts";
import {
  closeWorlds,
  createWorld,
  PROJECT_SKILLS,
  putSkill,
  USER_SKILLS,
  userLayer,
  type World,
} from "./support/world.ts";

afterEach(closeWorlds);

const THREAD = threadIdOf(1);
const DEPLOY = `${USER_SKILLS}/deploy`;

async function code(promise: Promise<unknown>): Promise<string> {
  return (await rejection(promise)).data.code;
}

function asModel(
  agent: "main" | "subagent" | "background",
  extra: Partial<CallOptions> = {},
): CallOptions {
  return { context: contextOf(THREAD, { kind: "model", agent }), ...extra };
}

function asExtension(extension: string, extra: Partial<CallOptions> = {}): CallOptions {
  return { context: contextOf(undefined, { kind: "extension", extension }), ...extra };
}

async function seed(world: World, body = "# Deploy\n\nStep one.\n") {
  const created = await world.runtime.skillsApi.create(
    { name: "deploy", description: "Deploy steps.", body },
    asHost(),
  );
  const viewed = await world.runtime.skillsApi.view({ name: "deploy" });
  return { created, hash: viewed.treeHash };
}

describe("skill create", () => {
  test("a created skill is a SKILL.md with name and description, indexed and in the ledger", async () => {
    const world = await createWorld();
    const { created, hash } = await seed(world);
    expect(created).toMatchObject({ status: "applied", approvedBy: "user", indexChanged: true });
    expect(created.afterHash).toBe(hash);
    expect(world.fs.text(`${DEPLOY}/SKILL.md`)).toBe(
      '---\nname: deploy\ndescription: "Deploy steps."\n---\n\n# Deploy\n\nStep one.\n',
    );
    const listed = await world.runtime.skillsApi.list({});
    expect(listed.skills).toMatchObject([
      { name: "deploy", scope: "user", createdBy: "user", description: "Deploy steps." },
    ]);
    const viewed = await world.runtime.skillsApi.view({ name: "deploy" });
    expect(viewed.content).toBe("# Deploy\n\nStep one.");
    const entries = (await world.runtime.ledgerApi.list({}, asHost())).entries;
    expect(entries[0]).toMatchObject({
      op: "skill.create",
      actor: { kind: "user" },
      beforeHash: null,
    });
  });

  test("a description with quotes, a colon and a newline round-trips", async () => {
    const world = await createWorld();
    const description = 'Use when: "deploying"\nSecond line # not a comment';
    await world.runtime.skillsApi.create({ name: "tricky", description, body: "b" }, asHost());
    const viewed = await world.runtime.skillsApi.view({ name: "tricky" });
    expect(viewed.description).toBe(description);
  });

  test("an existing skill of the same scope is a name conflict, also when the index is stale", async () => {
    const world = await createWorld();
    await seed(world);
    const again = await rejection(
      world.runtime.skillsApi.create({ name: "deploy", description: "d", body: "b" }, asHost()),
    );
    expect(again.data.code).toBe("name_conflict");
    putSkill(world.fs, USER_SKILLS, "hidden");
    const hidden = await rejection(
      world.runtime.skillsApi.create({ name: "hidden", description: "d", body: "b" }, asHost()),
    );
    expect(hidden.data.code).toBe("name_conflict");
  });

  test("structure limits", async () => {
    const world = await createWorld();
    const api = world.runtime.skillsApi;
    expect(
      await code(api.create({ name: "a".repeat(65), description: "d", body: "b" }, asHost())),
    ).toBe("invalid_input");
    expect(
      await code(api.create({ name: "Bad_Name", description: "d", body: "b" }, asHost())),
    ).toBe("invalid_input");
    expect(
      await code(api.create({ name: "x", description: "d".repeat(1025), body: "b" }, asHost())),
    ).toBe("limit_exceeded");
    expect(
      await code(api.create({ name: "x", description: "d", body: "b".repeat(100_001) }, asHost())),
    ).toBe("limit_exceeded");
    await seed(world);
    const hash = (await api.view({ name: "deploy" })).treeHash;
    expect(
      await code(
        api.writeFile(
          { name: "deploy", path: "references/big.md", content: "x".repeat(1_048_577) },
          asHost(),
        ),
      ),
    ).toBe("limit_exceeded");
    expect(
      await code(
        api.writeFile(
          { name: "deploy", path: "docs/x.md", content: "x", baseHash: hash },
          asHost(),
        ),
      ),
    ).toBe("invalid_input");
    expect(
      await code(
        api.writeFile(
          { name: "deploy", path: "references/../x.md", content: "x", baseHash: hash },
          asHost(),
        ),
      ),
    ).toBe("invalid_input");
    // 거부된 쓰기는 아무것도 바꾸지 않는다
    expect((await api.view({ name: "deploy" })).treeHash).toBe(hash);
  });

  test("a file count above 500 is refused", async () => {
    const world = await createWorld();
    const { hash } = await seed(world);
    for (let index = 0; index < 499; index += 1) {
      world.fs.put(`${DEPLOY}/references/f${String(index)}.md`, "x");
    }
    const viewed = await world.runtime.skillsApi.view({ name: "deploy" });
    expect(viewed.treeHash).not.toBe(hash);
    const over = await rejection(
      world.runtime.skillsApi.writeFile(
        { name: "deploy", path: "references/extra.md", content: "x" },
        asHost(),
      ),
    );
    expect(over.data.code).toBe("limit_exceeded");
  });
});

describe("skill edit, patch and files", () => {
  test("edit keeps the other frontmatter keys and comments verbatim", async () => {
    const world = await createWorld();
    putSkill(world.fs, USER_SKILLS, "deploy", {
      description: "Old text.",
      frontmatter: "license: MIT\n# keep this note\ndisable-model-invocation: false\n",
      body: "# Body\n\nOld.\n",
    });
    await world.runtime.skillsApi.reindex({});
    const hash = (await world.runtime.skillsApi.view({ name: "deploy" })).treeHash;
    const edited = await world.runtime.skillsApi.edit(
      { name: "deploy", baseHash: hash, description: "New text." },
      asHost(),
    );
    expect(edited.status).toBe("applied");
    const text = world.fs.text(`${DEPLOY}/SKILL.md`) ?? "";
    expect(text).toContain("license: MIT\n# keep this note\ndisable-model-invocation: false");
    expect(text).toContain('description: "New text."');
    expect(text).toContain("# Body\n\nOld.");
    const viewed = await world.runtime.skillsApi.view({ name: "deploy" });
    expect(viewed.description).toBe("New text.");
    expect(viewed.content).toBe("# Body\n\nOld.");
  });

  test("edit replaces the body only when no description is given", async () => {
    const world = await createWorld();
    const { hash } = await seed(world);
    await world.runtime.skillsApi.edit(
      { name: "deploy", baseHash: hash, body: "Fresh." },
      asHost(),
    );
    const viewed = await world.runtime.skillsApi.view({ name: "deploy" });
    expect(viewed.content).toBe("Fresh.");
    expect(viewed.description).toBe("Deploy steps.");
    const nothing = await rejection(
      world.runtime.skillsApi.edit({ name: "deploy", baseHash: viewed.treeHash }, asHost()),
    );
    expect(nothing.data.code).toBe("invalid_input");
  });

  test("patch exact match", async () => {
    const world = await createWorld();
    const { hash } = await seed(world, "alpha beta\nalpha gamma\n");
    const patch = (oldText: string, newText = "z") =>
      world.runtime.skillsApi.patch(
        { name: "deploy", baseHash: hash, edits: [{ oldText, newText }] },
        asHost(),
      );
    expect((await rejection(patch("missing"))).data.code).toBe("patch_mismatch");
    const twice = await rejection(patch("alpha"));
    expect(twice.data.code).toBe("patch_mismatch");
    expect(twice.data.detail).toEqual({ edit: 1, matches: 2 });
    expect((await world.runtime.skillsApi.view({ name: "deploy" })).treeHash).toBe(hash);
    const ok = await patch("alpha beta", "ALPHA");
    expect(ok.status).toBe("applied");
    expect((await world.runtime.skillsApi.view({ name: "deploy" })).content).toBe(
      "ALPHA\nalpha gamma",
    );
  });

  test("patch edits apply in order and see the earlier edit", async () => {
    const world = await createWorld();
    const { hash } = await seed(world, "one two\n");
    await world.runtime.skillsApi.patch(
      {
        name: "deploy",
        baseHash: hash,
        edits: [
          { oldText: "one", newText: "uno" },
          { oldText: "uno two", newText: "dos" },
        ],
      },
      asHost(),
    );
    expect((await world.runtime.skillsApi.view({ name: "deploy" })).content).toBe("dos");
  });

  test("base stale", async () => {
    const world = await createWorld();
    const { hash } = await seed(world);
    world.fs.put(`${DEPLOY}/references/a.md`, "outside edit");
    const stale = await rejection(
      world.runtime.skillsApi.edit({ name: "deploy", baseHash: hash, body: "x" }, asHost()),
    );
    expect(stale.data.code).toBe("base_stale");
    expect(world.fs.text(`${DEPLOY}/SKILL.md`)).toContain("Step one");
  });

  test("writeFile creates a support file without a baseHash and needs one to overwrite", async () => {
    const world = await createWorld();
    await seed(world);
    const created = await world.runtime.skillsApi.writeFile(
      { name: "deploy", path: "references/notes.md", content: "first" },
      asHost(),
    );
    expect(created.status).toBe("applied");
    expect(world.fs.text(`${DEPLOY}/references/notes.md`)).toBe("first");
    const noBase = await rejection(
      world.runtime.skillsApi.writeFile(
        { name: "deploy", path: "references/notes.md", content: "second" },
        asHost(),
      ),
    );
    expect(noBase.data.code).toBe("invalid_input");
    const hash = (await world.runtime.skillsApi.view({ name: "deploy" })).treeHash;
    await world.runtime.skillsApi.writeFile(
      { name: "deploy", path: "references/notes.md", content: "second", baseHash: hash },
      asHost(),
    );
    expect(world.fs.text(`${DEPLOY}/references/notes.md`)).toBe("second");
    const viewed = await world.runtime.skillsApi.view({
      name: "deploy",
      file: "references/notes.md",
    });
    expect(viewed.content).toBe("second");
    expect(viewed.files).toContain("references/notes.md");
  });

  test("remove archives by default and only the user deletes permanently", async () => {
    const world = await createWorld();
    const { hash } = await seed(world);
    const denied = await rejection(
      world.runtime.skillsApi.remove(
        { name: "deploy", baseHash: hash, mode: "delete" },
        asModel("main"),
      ),
    );
    expect(denied.data.code).toBe("invalid_input");
    const removed = await world.runtime.skillsApi.remove(
      { name: "deploy", baseHash: hash },
      asHost(),
    );
    expect(removed).toMatchObject({ status: "applied", indexChanged: true });
    expect(world.fs.has(DEPLOY)).toBe(false);
    const archived = [...world.fs.files(`${USER_SKILLS}/.archive`).keys()];
    expect(archived).toHaveLength(1);
    expect(archived[0]).toMatch(/\.archive\/deploy-\d{8}T\d{6}Z\/SKILL\.md$/);
    expect((await world.runtime.skillsApi.list({})).skills).toHaveLength(0);

    const again = await seed(world);
    const deleted = await world.runtime.skillsApi.remove(
      { name: "deploy", baseHash: again.hash, mode: "delete" },
      asHost(),
    );
    expect(deleted.status).toBe("applied");
    expect([...world.fs.files(`${USER_SKILLS}/.archive`).keys()]).toHaveLength(1);
  });

  test("remove with a file path removes that file only", async () => {
    const world = await createWorld();
    await seed(world);
    await world.runtime.skillsApi.writeFile(
      { name: "deploy", path: "references/a.md", content: "a" },
      asHost(),
    );
    const hash = (await world.runtime.skillsApi.view({ name: "deploy" })).treeHash;
    await world.runtime.skillsApi.remove(
      { name: "deploy", baseHash: hash, file: "references/a.md" },
      asHost(),
    );
    expect(world.fs.has(`${DEPLOY}/references/a.md`)).toBe(false);
    expect(world.fs.has(`${DEPLOY}/SKILL.md`)).toBe(true);
    const missing = await rejection(
      world.runtime.skillsApi.remove(
        {
          name: "deploy",
          baseHash: (await world.runtime.skillsApi.view({ name: "deploy" })).treeHash,
          file: "references/a.md",
        },
        asHost(),
      ),
    );
    expect(missing.data.code).toBe("not_found");
  });

  test("read only scope", async () => {
    const world = await createWorld({ extensionRoots: [{ dir: "/ext/skills", extension: "kit" }] });
    putSkill(world.fs, "/ext/skills", "provided");
    putSkill(world.fs, USER_SKILLS, "other");
    world.fs.put(
      `${USER_SKILLS}/single.md`,
      "---\nname: single\ndescription: Single file.\n---\nBody\n",
    );
    await world.runtime.skillsApi.reindex({});
    const listed = await world.runtime.skillsApi.list({});
    expect(listed.skills.map((skill) => `${skill.scope}:${skill.name}`).toSorted()).toContain(
      "extension:provided",
    );
    const hash = (await world.runtime.skillsApi.view({ name: "provided" })).treeHash;
    const edit = await rejection(
      world.runtime.skillsApi.edit({ name: "provided", baseHash: hash, body: "x" }, asHost()),
    );
    expect(edit.data.code).toBe("read_only_scope");
    const single = listed.skills.find((skill) => skill.name === "single");
    expect(single).toBeDefined();
    const singleEdit = await rejection(
      world.runtime.skillsApi.edit(
        { name: "single", baseHash: single?.treeHash ?? "0".repeat(64), body: "x" },
        asHost(),
      ),
    );
    expect(singleEdit.data.code).toBe("read_only_scope");
    const missing = await rejection(
      world.runtime.skillsApi.edit({ name: "nope", baseHash: hash, body: "x" }, asHost()),
    );
    expect(missing.data.code).toBe("not_found");
  });
});

describe("skill manage dispatch", () => {
  test("manage maps each action to its operation and reports missing fields", async () => {
    const world = await createWorld();
    const api = world.runtime.skillsApi;
    expect(await code(api.manage({ action: "create", name: "x" }, asHost()))).toBe("invalid_input");
    expect(await code(api.manage({ action: "edit", name: "x" }, asHost()))).toBe("invalid_input");
    expect(
      await code(api.manage({ action: "patch", name: "x", baseHash: "0".repeat(64) }, asHost())),
    ).toBe("invalid_input");
    expect(await code(api.manage({ action: "write_file", name: "x" }, asHost()))).toBe(
      "invalid_input",
    );
    expect(await code(api.manage({ action: "remove", name: "x" }, asHost()))).toBe("invalid_input");

    const created = await api.manage(
      { action: "create", name: "via-manage", description: "d", body: "b" },
      asHost(),
    );
    expect(created.status).toBe("applied");
    const hash = (await api.view({ name: "via-manage" })).treeHash;
    await api.manage(
      { action: "write_file", name: "via-manage", path: "templates/t.md", content: "t" },
      asHost(),
    );
    const next = (await api.view({ name: "via-manage" })).treeHash;
    expect(next).not.toBe(hash);
    await api.manage(
      {
        action: "patch",
        name: "via-manage",
        baseHash: next,
        edits: [{ oldText: "b", newText: "c" }],
      },
      asHost(),
    );
    const viewed = await api.view({ name: "via-manage" });
    expect(viewed.content).toBe("c");
    await api.manage({ action: "remove", name: "via-manage", baseHash: viewed.treeHash }, asHost());
    expect(world.fs.has(`${USER_SKILLS}/via-manage`)).toBe(false);
  });
});

describe("skill write actors and extras", () => {
  test("approval evidence only from an extension and overrideScan only from the host", async () => {
    const world = await createWorld();
    const evidence = { source: "grp.queue", ref: "p:1", decidedAt: 1 };
    const fromHost = await rejection(
      world.runtime.skillsApi.create(
        { name: "x", description: "d", body: "b", approval: evidence },
        asHost(),
      ),
    );
    expect(fromHost.data.code).toBe("invalid_input");
    const fromModel = await rejection(
      world.runtime.skillsApi.create(
        { name: "x", description: "d", body: "b", approval: evidence },
        asModel("main"),
      ),
    );
    expect(fromModel.data.code).toBe("invalid_input");
    const override = await rejection(
      world.runtime.skillsApi.create(
        { name: "x", description: "d", body: "b", overrideScan: true },
        asExtension("grp"),
      ),
    );
    expect(override.data.code).toBe("invalid_input");
    expect(world.fs.has(`${USER_SKILLS}/x`)).toBe(false);
  });

  test("project skills are written by the user or with approval evidence, never by an agent", async () => {
    const approvals = scriptedApprovals();
    const world = await createWorld({ approvals });
    world.setLayers([userLayer({ "l2.knowledge.write.trustedEvidenceSources": ["grp.queue"] })]);
    const input = { name: "proj", description: "d", body: "b", scope: "project" } as const;
    const agent = await rejection(world.runtime.skillsApi.create(input, asModel("main")));
    expect(agent.data.code).toBe("denied");
    const extension = await rejection(world.runtime.skillsApi.create(input, asExtension("grp")));
    expect(extension.data.code).toBe("denied");
    expect(approvals.requests).toHaveLength(0);
    const user = await world.runtime.skillsApi.create(input, asHost());
    expect(user.status).toBe("applied");
    expect(world.fs.has(`${PROJECT_SKILLS}/proj/SKILL.md`)).toBe(true);
    const withEvidence = await world.runtime.skillsApi.create(
      { ...input, name: "proj2", approval: { source: "grp.queue", ref: "p:1", decidedAt: 1 } },
      asExtension("grp"),
    );
    expect(withEvidence).toMatchObject({ status: "applied", approvedBy: "evidence" });
    expect((await world.runtime.skillsApi.list({})).skills.map((skill) => skill.scope)).toEqual([
      "project",
      "project",
    ]);
  });

  test("an agent create waits for approval, is tagged agent and can be rolled back", async () => {
    const approvals = scriptedApprovals();
    const world = await createWorld({ approvals });
    const created = await world.runtime.skillsApi.create(
      { name: "learned", description: "d", body: "b" },
      asModel("main", { requestId: "call-1" }),
    );
    expect(created).toMatchObject({ status: "applied", approvedBy: "approval" });
    expect(approvals.requests).toHaveLength(1);
    const listed = await world.runtime.skillsApi.list({});
    expect(listed.skills[0]).toMatchObject({ name: "learned", createdBy: "agent" });
    const entry = (await world.runtime.ledgerApi.list({}, asHost())).entries[0];
    expect(entry).toMatchObject({ actor: { kind: "agent", agent: "main" }, op: "skill.create" });
  });

  test("a denied agent create leaves nothing behind", async () => {
    const approvals = scriptedApprovals();
    approvals.answerWith({ kind: "deny", feedback: undefined });
    const world = await createWorld({ approvals });
    const denied = await rejection(
      world.runtime.skillsApi.create(
        { name: "learned", description: "d", body: "b" },
        asModel("main"),
      ),
    );
    expect(denied.data.code).toBe("approval_denied");
    expect(world.fs.has(`${USER_SKILLS}/learned`)).toBe(false);
    expect((await world.runtime.ledgerApi.list({}, asHost())).entries).toHaveLength(0);
  });

  test("a subagent create is queued and the user's approval applies it as agent-made", async () => {
    const world = await createWorld();
    const queued = await world.runtime.skillsApi.create(
      { name: "queued-skill", description: "From a subagent.", body: "Body." },
      asModel("subagent", { requestId: "sub-1" }),
    );
    expect(queued.status).toBe("queued");
    expect(world.fs.has(`${USER_SKILLS}/queued-skill`)).toBe(false);
    const proposals = await world.runtime.ledgerApi.proposals({ status: "pending" });
    expect(proposals.proposals[0]).toMatchObject({
      op: "skill.create",
      baseHash: null,
      target: { kind: "skill", name: "queued-skill", scope: "user" },
    });
    expect(proposals.proposals[0]?.preview).toContain("+name: queued-skill");
    const decided = await world.runtime.ledgerApi.decide(
      { proposalId: queued.proposalId ?? "", decision: "approve" },
      asHost(),
    );
    expect(decided.outcome).toMatchObject({ status: "applied", approvedBy: "approval" });
    expect(world.fs.text(`${USER_SKILLS}/queued-skill/SKILL.md`)).toContain("Body.");
    // 승인한 제안으로 만든 스킬도 에이전트가 만든 것으로 표시된다
    expect((await world.runtime.skillsApi.list({})).skills[0]?.createdBy).toBe("agent");
    // 같은 requestId를 다시 부르면 첫 결과(대기열)가 돌아온다
    const again = await world.runtime.skillsApi.create(
      { name: "queued-skill", description: "From a subagent.", body: "Body." },
      asModel("subagent", { requestId: "sub-1" }),
    );
    expect(again).toEqual(queued);
  });

  test("a queued edit goes stale when the skill changed after the proposal", async () => {
    const world = await createWorld();
    const { hash } = await seed(world);
    const queued = await world.runtime.skillsApi.edit(
      { name: "deploy", baseHash: hash, body: "agent version" },
      asModel("background"),
    );
    expect(queued.status).toBe("queued");
    await world.runtime.skillsApi.writeFile(
      { name: "deploy", path: "references/x.md", content: "x" },
      asHost(),
    );
    const error = await rejection(
      world.runtime.ledgerApi.decide(
        { proposalId: queued.proposalId ?? "", decision: "approve" },
        asHost(),
      ),
    );
    expect(error.data.code).toBe("base_stale");
    expect((await world.runtime.ledgerApi.proposals({ status: "stale" })).proposals).toHaveLength(
      1,
    );
    expect(world.fs.text(`${DEPLOY}/SKILL.md`)).toContain("Step one");
  });

  test("idempotent request id", async () => {
    const world = await createWorld();
    const input = { name: "once", description: "d", body: "b" };
    const first = await world.runtime.skillsApi.create(input, asHost({ requestId: "r-1" }));
    const second = await world.runtime.skillsApi.create(input, asHost({ requestId: "r-1" }));
    expect(second).toEqual(first);
    expect((await world.runtime.ledgerApi.list({}, asHost())).entries).toHaveLength(1);
  });

  test("with skills switched off writes are unavailable", async () => {
    const world = await createWorld();
    world.setLayers([userLayer({ "l2.knowledge.skills.enabled": false })]);
    const error = await rejection(
      world.runtime.skillsApi.create({ name: "x", description: "d", body: "b" }, asHost()),
    );
    expect(error.data.code).toBe("unavailable");
  });
});

describe("skill ledger round trip", () => {
  test("every skill operation lands in the ledger and rolls back to its before hash", async () => {
    const world = await createWorld();
    const api = world.runtime.skillsApi;
    const hashes: string[] = [];
    const hashNow = async (): Promise<string> => (await api.view({ name: "deploy" })).treeHash;
    const created = await api.create({ name: "deploy", description: "d", body: "v1" }, asHost());
    hashes.push(await hashNow());
    const edited = await api.edit(
      { name: "deploy", baseHash: hashes[0] ?? "", body: "v2" },
      asHost(),
    );
    hashes.push(await hashNow());
    const patched = await api.patch(
      { name: "deploy", baseHash: hashes[1] ?? "", edits: [{ oldText: "v2", newText: "v3" }] },
      asHost(),
    );
    hashes.push(await hashNow());
    const written = await api.writeFile(
      { name: "deploy", path: "scripts/run.sh", content: "echo hi" },
      asHost(),
    );
    hashes.push(await hashNow());
    const removed = await api.remove({ name: "deploy", baseHash: hashes[3] ?? "" }, asHost());
    const ids = [created, edited, patched, written, removed].map(
      (outcome) => outcome.ledgerId ?? "",
    );
    const entries = (await world.runtime.ledgerApi.list({}, asHost())).entries;
    expect(entries.map((entry) => entry.op).toReversed()).toEqual([
      "skill.create",
      "skill.edit",
      "skill.patch",
      "skill.write_file",
      "skill.archive",
    ]);
    expect(entries.every((entry) => entry.actor.kind === "user")).toBe(true);
    // 마지막부터 거꾸로 되돌린다
    await eachAsync([4, 3, 2, 1], async (index) => {
      await world.runtime.ledgerApi.rollback({ ledgerId: ids[index] ?? "" }, asHost());
      expect(await hashNow()).toBe(hashes[index - 1] ?? "");
      return undefined;
    });
    const all = (await world.runtime.ledgerApi.list({}, asHost())).entries;
    expect(all.filter((entry) => entry.op === "rollback")).toHaveLength(4);
  });
});
