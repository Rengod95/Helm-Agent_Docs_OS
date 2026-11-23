import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { WireError, type HostConnection, type ProfileCostFigures } from "@fresnel/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// M5c §3.4, §4.1, §4.4.8 (int, 실제 엔진): 프로필 삭제와 복제, 미리 보기, 기본 프로필 값, 기본 값 되돌리기.
// 대화가 가리키는 프로필은 `blocks.applied`(대화를 읽는 쪽)와 `profile.preview`의 대화 수로 다시 읽는다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const PERMISSION = "l1.tools.permissionMode";
/** 코드 플러그인에 선언된 재료가 없으므로 비용은 알 수 없다(§4.2.8) */
const UNKNOWN_COST: ProfileCostFigures = {
  always: null,
  drive: null,
  onDemand: null,
  toolCount: null,
  basis: "unknown",
};

interface Engine {
  readonly connection: HostConnection;
  close(): Promise<void>;
}

/** 실제 엔진을 임시 홈에 세우고 hello까지 맞춘 연결을 돌려준다. `close`가 연결, 엔진, 홈을 정리한다 */
async function openEngine(): Promise<Engine> {
  const home = useEngineHome();
  const host = await startInProcessHost({ devChecks: true, defaultGroups: false });
  const connection = createHostConnection(host.client);
  await connection.request("host.hello", HELLO_PARAMS);
  return {
    connection,
    async close() {
      await connection.close();
      await host.close();
      home.dispose();
    },
  };
}

/** 실패한 호출의 와이어 오류. 와이어 오류가 아니면 시험을 실패시킨다 */
async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  const caught = await rejectionOf(call);
  if (caught instanceof WireError) return caught;
  throw new Error("expected the request to fail with a WireError");
}

/** 대화가 지금 읽는 프로필 id. 가리키는 프로필이 없으면 `default`다 */
async function profileOf(connection: HostConnection, threadId: string): Promise<string> {
  return (await connection.request("blocks.applied", { threadId })).profileId;
}

/** 내용이 `review`인 저장 프로필의 입력. 권한 모드는 `default`로 둔다 */
const REVIEW = {
  id: "review",
  title: "Review",
  plugins: [{ name: "cap-knowledge" }],
  settings: [{ key: PERMISSION, value: "default" }],
  startDrive: null,
};

realTest(
  "profile.delete reassigns the open threads that used it: each reads as default afterwards, and default now counts them",
  async () => {
    const engine = await openEngine();
    const { connection } = engine;
    try {
      const saved = await connection.request("profile.put", { profile: REVIEW, baseRev: null });
      const first = await connection.request("thread.create", { profileId: "review" });
      const second = await connection.request("thread.create", { profileId: "review" });
      // 기본 값을 저장하지 않으려면 명시적으로 `default`를 준다. 주지 않으면 같은 폴더·프로젝트의 최근 대화 값을 따른다(§4.4.8)
      const plain = await connection.request("thread.create", { profileId: "default" });
      expect([
        await profileOf(connection, first.threadId),
        await profileOf(connection, second.threadId),
        await profileOf(connection, plain.threadId),
      ]).toEqual(["review", "review", "default"]);
      expect((await connection.request("profile.preview", { id: "review" })).threadsUsing).toBe(2);
      expect((await connection.request("profile.preview", { id: "default" })).threadsUsing).toBe(1);

      const deleted = await connection.request("profile.delete", { id: "review" });
      // 결과의 개정은 지운 뒤 목록의 개정과 같다. 참조하던 대화 수는 지우기 전에 센 값이다
      expect(deleted).toEqual({
        rev: (await connection.request("profile.list", {})).rev,
        reassignedThreads: 2,
      });
      expect(
        (await connection.request("profile.list", {})).profiles.map((item) => item.id),
      ).toEqual(["default"]);
      expect(saved.profile.rev).toBe(1);

      // 대화를 다시 읽으면 기본 프로필이다. 지운 프로필이 가리키던 대화도 같다
      expect([
        await profileOf(connection, first.threadId),
        await profileOf(connection, second.threadId),
        await profileOf(connection, plain.threadId),
      ]).toEqual(["default", "default", "default"]);
      // 기본 프로필을 쓰는 대화 수에 옮겨 간 두 대화가 든다
      expect((await connection.request("profile.preview", { id: "default" })).threadsUsing).toBe(3);

      // 지운 프로필은 읽히지 않고, 그 이름으로는 대화를 새로 만들거나 바꿀 수 없다
      expect(await wireErrorOf(connection.request("profile.get", { id: "review" }))).toMatchObject({
        data: { kind: "profile.notFound", details: { id: "review" } },
      });
      expect(
        await wireErrorOf(
          connection.request("thread.setProfile", {
            threadId: first.threadId,
            profileId: "review",
          }),
        ),
      ).toMatchObject({ data: { kind: "profile.notFound", details: { id: "review" } } });
      expect(
        await wireErrorOf(connection.request("thread.create", { profileId: "review" })),
      ).toMatchObject({ data: { kind: "profile.notFound", details: { id: "review" } } });
      expect(await profileOf(connection, first.threadId)).toBe("default");
      expect(
        (await connection.request("thread.list", {})).threads.map((thread) => thread.threadId),
      ).toHaveLength(3);
    } finally {
      await engine.close();
    }
  },
  60_000,
);

realTest(
  "profile.delete refuses the built-in default and an unknown id, and changes neither the list nor the threads",
  async () => {
    const engine = await openEngine();
    const { connection } = engine;
    try {
      await connection.request("profile.put", { profile: REVIEW, baseRev: null });
      const thread = await connection.request("thread.create", { profileId: "review" });
      const before = await connection.request("profile.list", {});
      expect(
        await wireErrorOf(connection.request("profile.delete", { id: "default" })),
      ).toMatchObject({ data: { kind: "profile.builtinProtected", details: { id: "default" } } });
      expect(
        await wireErrorOf(connection.request("profile.delete", { id: "ghost" })),
      ).toMatchObject({ data: { kind: "profile.notFound", details: { id: "ghost" } } });
      expect(await connection.request("profile.list", {})).toEqual(before);
      expect(await profileOf(connection, thread.threadId)).toBe("review");
    } finally {
      await engine.close();
    }
  },
  30_000,
);

realTest(
  "profile.clone copies the plugins and settings of a stored profile into a new one at rev 1 and leaves the source as it was; a taken id is conflict",
  async () => {
    const engine = await openEngine();
    const { connection } = engine;
    try {
      const saved = await connection.request("profile.put", { profile: REVIEW, baseRev: null });
      const cloned = await connection.request("profile.clone", {
        id: "review",
        newId: "review-copy",
        title: "Copy",
      });
      expect(cloned.profile).toEqual({
        id: "review-copy",
        title: "Copy",
        builtin: false,
        plugins: REVIEW.plugins,
        settings: REVIEW.settings,
        startDrive: null,
        updatedAt: cloned.profile.updatedAt,
        rev: 1,
      });
      // 저장된 복제본은 결과와 같고, 원본은 그대로다
      expect((await connection.request("profile.get", { id: "review-copy" })).profile).toEqual(
        cloned.profile,
      );
      expect((await connection.request("profile.get", { id: "review" })).profile).toEqual(
        saved.profile,
      );
      expect(
        (await connection.request("profile.list", {})).profiles.map((item) => item.id),
      ).toEqual(["default", "review", "review-copy"]);

      expect(
        await wireErrorOf(
          connection.request("profile.clone", { id: "review", newId: "review", title: "x" }),
        ),
      ).toMatchObject({ data: { kind: "profile.conflict", details: { id: "review", rev: 1 } } });
      expect(
        await wireErrorOf(
          connection.request("profile.clone", { id: "review", newId: "default", title: "x" }),
        ),
      ).toMatchObject({ data: { kind: "profile.builtinProtected", details: { id: "default" } } });
      expect(
        await wireErrorOf(
          connection.request("profile.clone", { id: "ghost", newId: "zz", title: "x" }),
        ),
      ).toMatchObject({ data: { kind: "profile.notFound", details: { id: "ghost" } } });
    } finally {
      await engine.close();
    }
  },
  30_000,
);

realTest(
  "profile.preview of a stored profile lists the common set first, the profile's plugins after, and counts the threads that use it",
  async () => {
    const engine = await openEngine();
    const { connection } = engine;
    try {
      await connection.request("profile.common.put", {
        common: { plugins: [{ name: "cap-web" }], settings: [] },
        baseRev: 0,
      });
      // 프로필이 공통 묶음과 겹치는 `cap-web`을 또 적으면 처음 자리(공통 묶음)를 남긴다
      await connection.request("profile.put", {
        profile: { ...REVIEW, plugins: [{ name: "cap-knowledge" }, { name: "cap-web" }] },
        baseRev: null,
      });
      const preview = await connection.request("profile.preview", { id: "review" });
      expect(preview.resolved).toEqual([{ name: "cap-web" }, { name: "cap-knowledge" }]);
      expect(preview.issues).toEqual([]);
      expect(preview.cost).toEqual({
        total: UNKNOWN_COST,
        byPlugin: [
          { plugin: "cap-web", cost: UNKNOWN_COST },
          { plugin: "cap-knowledge", cost: UNKNOWN_COST },
        ],
      });
      expect(preview.missingRequired).toEqual([]);
      expect(preview.threadsUsing).toBe(0);
      // 대화 없이 저장된 프로필을 보면 기준은 같은 저장 값이라 바뀌는 것이 없다(전역 값과 견주지 않는다)
      expect(preview.permission).toBeUndefined();
      // 기준 대화가 없으므로 도구 변화는 없고 캐시 영향은 `none`이다
      expect(preview.toolsChanged).toBeUndefined();
      expect(preview.cacheImpact).toBe("none");
      expect(preview.dropsDrive).toBeNull();

      const first = await connection.request("thread.create", { profileId: "review" });
      await connection.request("thread.create", { profileId: "review" });
      expect((await connection.request("profile.preview", { id: "review" })).threadsUsing).toBe(2);
      expect(first.profileId).toBe("review");

      expect(
        await wireErrorOf(connection.request("profile.preview", { id: "ghost" })),
      ).toMatchObject({ data: { kind: "profile.notFound", details: { id: "ghost" } } });
    } finally {
      await engine.close();
    }
  },
  60_000,
);

realTest(
  "profile.preview of a draft against a thread compares the permission with the value the thread reads, and names a start driver that is not in the list",
  async () => {
    const engine = await openEngine();
    const { connection } = engine;
    try {
      await connection.request("profile.put", { profile: REVIEW, baseRev: null });
      const onReview = await connection.request("thread.create", { profileId: "review" });
      const onDefault = await connection.request("thread.create", { profileId: "default" });
      const draft = {
        id: "review",
        title: "Draft",
        plugins: [{ name: "cap-knowledge" }],
        settings: [{ key: PERMISSION, value: "acceptEdits" }],
        startDrive: null,
      };
      // 대화가 읽는 권한 모드가 기준이다. 저장된 `review`는 `default`, 기본 대화는 공장 값 `bypass`다
      expect(
        (await connection.request("profile.preview", { draft, threadId: onReview.threadId }))
          .permission,
      ).toEqual({ from: "default", to: "acceptEdits" });
      expect(
        (await connection.request("profile.preview", { draft, threadId: onDefault.threadId }))
          .permission,
      ).toEqual({ from: "bypass", to: "acceptEdits" });
      // 사용자 파일의 전역 값은 대화의 모드를 정하지 않는다: 기본 프로필(공장 값)을 쓰는 대화는 그대로 `bypass`다
      await connection.request("settings.set", {
        key: PERMISSION,
        value: "default",
        scope: "user",
      });
      const read = await connection.request("settings.get", {
        keys: [PERMISSION],
        threadId: onDefault.threadId,
      });
      expect(read.settings.find((setting) => setting.key === PERMISSION)?.value).toBe("bypass");
      // 입력창 칩으로 이 대화에만 정한 값(`launch`)은 프로필을 바꿔도 남으므로 바뀜을 싣지 않는다
      await connection.request("settings.set", {
        key: PERMISSION,
        value: "default",
        scope: "launch",
        threadId: onDefault.threadId,
      });
      expect(
        (await connection.request("profile.preview", { draft, threadId: onDefault.threadId }))
          .permission,
      ).toBeUndefined();

      // 시작 Drive가 목록 밖이면 오류 이슈다. 목록에 없는 이름은 알 수 없는 플러그인이다
      const bad = await connection.request("profile.preview", {
        draft: {
          id: "review",
          title: "Draft",
          plugins: [{ name: "cap-knowledge" }, { name: "ghost" }],
          settings: [],
          startDrive: "cap-web",
        },
      });
      expect(bad.issues).toEqual([
        { code: "plugin_unknown", severity: "error", plugin: "ghost" },
        { code: "driver_not_in_list", severity: "error", plugin: "cap-web" },
      ]);

      expect(
        await wireErrorOf(
          connection.request("profile.preview", {
            id: "review",
            threadId: "thr_01AAAAAAAAAAAAAAAAAAAAAAAA",
          }),
        ),
      ).toMatchObject({ data: { kind: "thread.notFound" } });
    } finally {
      await engine.close();
    }
  },
  60_000,
);

realTest(
  "profile.defaultFor follows the thread in the same folder, then the project's thread, and reads a deleted profile as default",
  async () => {
    const engine = await openEngine();
    const { connection } = engine;
    try {
      const base = realpathSync(mkdtempSync(join(tmpdir(), "xh-prof-default-")));
      try {
        const root = join(base, "main");
        const a = join(root, "a");
        const b = join(root, "b");
        const loose = join(base, "loose");
        // 한 프로젝트에 대화가 하나만 있는 두 번째 루트. 빈 폴더의 기본 값은 이 대화의 프로필이다
        const solo = join(base, "solo");
        const soloEmpty = join(solo, "empty");
        const soloOnly = join(solo, "only");
        for (const folder of [a, b, loose, soloEmpty, soloOnly])
          mkdirSync(folder, { recursive: true });

        await connection.request("profile.put", {
          profile: { ...REVIEW, id: "alpha", title: "Alpha" },
          baseRev: null,
        });
        await connection.request("profile.put", {
          profile: { ...REVIEW, id: "beta", title: "Beta", plugins: [{ name: "cap-web" }] },
          baseRev: null,
        });
        await connection.request("project.create", { root, name: "Main" });
        await connection.request("project.create", { root: solo, name: "Solo" });
        await connection.request("thread.create", { workspace: a, profileId: "alpha" });
        await connection.request("thread.create", { workspace: b, profileId: "beta" });
        await connection.request("thread.create", { workspace: soloOnly, profileId: "alpha" });

        // 같은 폴더의 대화가 있으면 그 값이다. 프로젝트의 다른 대화보다 먼저다
        expect(await connection.request("profile.defaultFor", { workspace: a })).toEqual({
          profileId: "alpha",
        });
        expect(await connection.request("profile.defaultFor", { workspace: b })).toEqual({
          profileId: "beta",
        });
        // 같은 폴더에 대화가 없으면 같은 프로젝트의 대화를 본다. 이 프로젝트에는 하나뿐이다
        expect(await connection.request("profile.defaultFor", { workspace: soloEmpty })).toEqual({
          profileId: "alpha",
        });
        // 어느 프로젝트에도 없는 폴더는 기본이다
        expect(await connection.request("profile.defaultFor", { workspace: loose })).toEqual({
          profileId: "default",
        });

        // 지운 프로필을 가리키던 대화는 기본으로 읽는다. 다른 대화의 값은 그대로다
        await connection.request("profile.delete", { id: "alpha" });
        expect(await connection.request("profile.defaultFor", { workspace: a })).toEqual({
          profileId: "default",
        });
        expect(await connection.request("profile.defaultFor", { workspace: soloEmpty })).toEqual({
          profileId: "default",
        });
        expect(await connection.request("profile.defaultFor", { workspace: b })).toEqual({
          profileId: "beta",
        });
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    } finally {
      await engine.close();
    }
  },
  60_000,
);

realTest(
  "profile.default.reset previews without writing, then deletes the stored default so the factory value returns; a second reset changes nothing",
  async () => {
    const engine = await openEngine();
    const { connection } = engine;
    try {
      const factory = (await connection.request("profile.list", {})).profiles[0];
      if (factory === undefined) throw new Error("the factory default is missing");
      // 기본 프로필은 코어 필수 단위(`cap-workspace`, `cap-dialog`)를 빼면 저장되지 않으므로 함께 적는다
      const stored = await connection.request("profile.put", {
        profile: {
          id: "default",
          title: "기본",
          plugins: [{ name: "cap-workspace" }, { name: "cap-dialog" }, { name: "cap-knowledge" }],
          settings: [{ key: PERMISSION, value: "default" }],
          startDrive: null,
        },
        baseRev: null,
      });
      const onDefault = await connection.request("thread.create", { profileId: "default" });
      expect(onDefault.profileId).toBe("default");

      const preview = await connection.request("profile.default.reset", { preview: true });
      expect(preview).toEqual({
        profile: stored.profile,
        changed: { plugins: true, settings: true },
        threadsUsing: 1,
      });
      // 미리 보기는 쓰지 않는다
      expect((await connection.request("profile.get", { id: "default" })).profile).toEqual(
        stored.profile,
      );

      const reset = await connection.request("profile.default.reset", {});
      expect(reset).toEqual({
        profile: factory,
        changed: { plugins: true, settings: true },
        threadsUsing: 1,
      });
      expect((await connection.request("profile.get", { id: "default" })).profile).toEqual(factory);
      // 목록의 `rev`는 저장소 전체의 개정이라 쓸 때마다 오른다. 기본 프로필의 개정은 공장 값의 0으로 돌아온다
      const listed = await connection.request("profile.list", {});
      expect(listed.profiles.find((item) => item.id === "default")?.rev).toBe(0);

      // 이미 공장 값이면 바뀌는 것이 없다
      expect(await connection.request("profile.default.reset", {})).toEqual({
        profile: factory,
        changed: { plugins: false, settings: false },
        threadsUsing: 1,
      });
    } finally {
      await engine.close();
    }
  },
  60_000,
);
