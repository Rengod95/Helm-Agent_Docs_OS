import { afterEach, describe, expect, test } from "bun:test";
import type { CallOptions } from "@xeon/contracts/capabilities";
import { DEFAULT_KNOWLEDGE_SETTINGS, withTrustedEvidence } from "../src/settings.ts";
import { scriptedApprovals } from "./support/approvals.ts";
import { asHost, rejection, threadIdOf } from "./support/helpers.ts";
import { contextOf } from "./support/plans.ts";
import {
  closeWorlds,
  createWorld,
  PROJECT_SKILLS,
  USER_SKILLS,
  userLayer,
} from "./support/world.ts";

// M3-REQ-104(L2.knowledge.spec §4.5.1): 내장 그룹이 자기 대기열의 사람 승인을 증거로 싣는다. 조립 루트가 선언한 출처(여기서는
// `learning.queue`)는 설정과 합쳐 믿고, 증거는 호출 확장이 출처의 첫 마디와 같을 때만 유효하다. 믿는 증거가 있으면 L2는 승인
// 요청을 내지 않는다(승인이 한 번이다). 프로젝트 범위 쓰기는 사용자나 증거가 있는 확장만 한다(D-M3-09).

afterEach(closeWorlds);

const THREAD = threadIdOf(1);
const EVIDENCE = { source: "learning.queue", ref: "prop_1:1", decidedAt: 1 } as const;

function asExtension(extension: string, extra: Partial<CallOptions> = {}): CallOptions {
  return { context: contextOf(THREAD, { kind: "extension", extension }), ...extra };
}

describe("withTrustedEvidence", () => {
  test("adds the declared sources to the setting value without duplicates", () => {
    const base = {
      ...DEFAULT_KNOWLEDGE_SETTINGS,
      write: { ...DEFAULT_KNOWLEDGE_SETTINGS.write, trustedEvidenceSources: ["kit.queue"] },
    };
    expect(
      withTrustedEvidence(base, ["learning.queue", "kit.queue"]).write.trustedEvidenceSources,
    ).toEqual(["kit.queue", "learning.queue"]);
  });

  test("returns the settings as they are when nothing is declared", () => {
    expect(withTrustedEvidence(DEFAULT_KNOWLEDGE_SETTINGS, undefined)).toBe(
      DEFAULT_KNOWLEDGE_SETTINGS,
    );
    expect(withTrustedEvidence(DEFAULT_KNOWLEDGE_SETTINGS, [])).toBe(DEFAULT_KNOWLEDGE_SETTINGS);
  });

  test("the default has no trusted source: L2 does not name any group", () => {
    expect(DEFAULT_KNOWLEDGE_SETTINGS.write.trustedEvidenceSources).toEqual([]);
  });
});

describe("learning.queue evidence declared by the assembly", () => {
  const input = { name: "learned", description: "d", body: "b" } as const;

  test("with the source declared the write applies with one approval (the user's decision) and no L2 request", async () => {
    const approvals = scriptedApprovals();
    const world = await createWorld({ approvals, trustedEvidenceSources: ["learning.queue"] });
    const done = await world.runtime.skillsApi.create(
      { ...input, approval: EVIDENCE },
      asExtension("learning", { requestId: "learning:apply:prop_1:1" }),
    );
    expect(done).toMatchObject({ status: "applied", approvedBy: "evidence" });
    expect(approvals.requests).toHaveLength(0);
    const entry = (await world.runtime.ledgerApi.list({}, asHost())).entries[0];
    expect(entry).toMatchObject({
      actor: { kind: "extension", extension: "learning" },
      approvedBy: "evidence",
      evidence: EVIDENCE,
    });
    expect(world.fs.has(`${USER_SKILLS}/learned/SKILL.md`)).toBe(true);
  });

  test("without the declaration the same call asks the user a second time", async () => {
    const approvals = scriptedApprovals();
    const world = await createWorld({ approvals });
    const done = await world.runtime.skillsApi.create(
      { ...input, approval: EVIDENCE },
      asExtension("learning", { requestId: "learning:apply:prop_1:1" }),
    );
    expect(done).toMatchObject({ status: "applied", approvedBy: "approval" });
    expect(approvals.requests).toHaveLength(1);
  });

  test("another extension cannot borrow the source: the first segment must be the caller", async () => {
    const approvals = scriptedApprovals();
    const world = await createWorld({ approvals, trustedEvidenceSources: ["learning.queue"] });
    const done = await world.runtime.skillsApi.create(
      { ...input, approval: EVIDENCE },
      asExtension("intruder", { requestId: "intruder-1" }),
    );
    expect(done).toMatchObject({ status: "applied", approvedBy: "approval" });
    expect(approvals.requests).toHaveLength(1);
  });

  test("the setting and the declaration both count", async () => {
    const approvals = scriptedApprovals();
    const world = await createWorld({ approvals, trustedEvidenceSources: ["learning.queue"] });
    world.setLayers([userLayer({ "l2.knowledge.write.trustedEvidenceSources": ["kit.queue"] })]);
    const kit = await world.runtime.skillsApi.create(
      {
        ...input,
        name: "kit-skill",
        approval: { source: "kit.queue", ref: "p:1", decidedAt: 1 },
      },
      asExtension("kit", { requestId: "kit-1" }),
    );
    const learning = await world.runtime.skillsApi.create(
      { ...input, approval: EVIDENCE },
      asExtension("learning", { requestId: "learning-1" }),
    );
    expect([kit.approvedBy, learning.approvedBy]).toEqual(["evidence", "evidence"]);
    expect(approvals.requests).toHaveLength(0);
  });
});

describe("project scope needs the user's approval evidence", () => {
  const project = { name: "shared", description: "d", body: "b", scope: "project" } as const;

  test("a model, an extension without evidence and a forged source are denied; the declared source is accepted", async () => {
    const approvals = scriptedApprovals();
    const world = await createWorld({ approvals, trustedEvidenceSources: ["learning.queue"] });
    const skills = world.runtime.skillsApi;
    const model = await rejection(
      skills.create(project, { context: contextOf(THREAD, { kind: "model", agent: "main" }) }),
    );
    expect(model.data.code).toBe("denied");
    const bare = await rejection(skills.create(project, asExtension("learning")));
    expect(bare.data.code).toBe("denied");
    const forged = await rejection(
      skills.create(
        { ...project, approval: { source: "learning.other", ref: "p:1", decidedAt: 1 } },
        asExtension("learning"),
      ),
    );
    expect(forged.data.code).toBe("denied");
    const borrowed = await rejection(
      skills.create({ ...project, approval: EVIDENCE }, asExtension("intruder")),
    );
    expect(borrowed.data.code).toBe("denied");
    expect(world.fs.has(`${PROJECT_SKILLS}/shared/SKILL.md`)).toBe(false);

    const accepted = await skills.create(
      { ...project, approval: EVIDENCE },
      asExtension("learning", { requestId: "learning:apply:prop_2:1" }),
    );
    expect(accepted).toMatchObject({ status: "applied", approvedBy: "evidence" });
    expect(world.fs.has(`${PROJECT_SKILLS}/shared/SKILL.md`)).toBe(true);
    expect(approvals.requests).toHaveLength(0);
  });
});
