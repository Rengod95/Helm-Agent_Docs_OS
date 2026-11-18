import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { err, ok, type Result } from "@fresnel/contracts";
import type { PluginCard } from "@fresnel/contracts/extensions";
import type { PluginGetResult, PluginListFilter, PluginListResult } from "@fresnel/contracts/wire";
import { buildPluginCard, type BuildCardInput } from "../../../src/assembly/plugins/card.ts";
import { readPluginFolder } from "../../../src/assembly/plugins/folder-reader.ts";
import {
  withPendingReview,
  type PendingItemSource,
} from "../../../src/assembly/plugins/pending-overlay.ts";
import type { PluginPort, PluginPortFailure } from "../../../src/handlers/m5/plugins.ts";
import { removeTree, tempRoot, writeFiles } from "./support.ts";

// M5c §3.4: 리뷰 대기 항목이 있는 플러그인의 검토 칸은 `pending`과 그 항목 id다. 기반 서비스는 대기를 모르므로 조립에서 얹는다.

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) removeTree(root);
});

const SKILL = `---\nname: greeter\ndescription: "Say hello politely"\n---\nBody\n`;
const APPROVED_HASH = `sha256:${"a".repeat(64)}`;
const APPROVED_AT = "2026-11-01T00:00:00.000Z";
const OLD = "2026-11-01T09:00:00.000Z";
const NEW = "2026-11-05T09:00:00.000Z";
const LATER = "2026-11-10T09:00:00.000Z";
const PROJECT_ONE: BuildCardInput["origin"] = { kind: "project", projectId: "prj_one" };
const PROJECT_TWO: BuildCardInput["origin"] = { kind: "project", projectId: "prj_two" };
const NONE: PluginCard["review"] = {
  state: "none",
  currentHash: null,
  pendingItemId: null,
  approvedAt: null,
};
const HEALTH: BuildCardInput["health"] = { state: "idle", lastActiveAt: null, lastError: null };

/** 스킬 한 장짜리 카드. 폴더 이름이 카드 이름이다 */
function cardOf(
  name: string,
  origin: BuildCardInput["origin"] = { kind: "user" },
  review: PluginCard["review"] = NONE,
): PluginCard {
  const parent = tempRoot("pending-overlay-");
  roots.push(parent);
  const dir = join(parent, name);
  writeFiles(dir, { "SKILL.md": SKILL });
  const read = readPluginFolder(dir, { origin: "user" });
  if (!read.ok) throw new Error(`folder rejected: ${read.error.kind}`);
  return buildPluginCard({ folder: read.value, origin, review, usedBy: [], health: HEALTH });
}

/** 대기 항목 한 줄. 덧씌우기는 id, 이름, 후보 카드의 출처, 만든 시각만 본다 */
function pendingItem(
  itemId: string,
  name: string,
  origin: BuildCardInput["origin"],
  createdAt: string,
): { itemId: string; name: string; card: PluginCard; createdAt: string } {
  return { itemId, name, card: cardOf(name, origin), createdAt };
}

/** 기반 서비스 대역. 출처와 검토 칸 필터는 실제 서비스처럼 카드의 값으로 거른다 */
function baseOf(cards: readonly PluginCard[]): Pick<PluginPort, "list" | "get"> {
  return {
    list: (filter: PluginListFilter): Promise<Result<PluginListResult, PluginPortFailure>> => {
      const plugins = cards.filter(
        (card) =>
          (filter.origin === undefined || card.origin.kind === filter.origin) &&
          (filter.reviewState === undefined || card.review.state === filter.reviewState),
      );
      return Promise.resolve(ok({ plugins }));
    },
    get: (name: string): Promise<Result<PluginGetResult, PluginPortFailure>> => {
      const card = cards.find((item) => item.name === name);
      if (card === undefined) {
        const failure: PluginPortFailure = { kind: "unknown_plugin", name };
        return Promise.resolve(err(failure));
      }
      return Promise.resolve(
        ok({ card, versions: [], source: null, entries: [], settingsDefs: [] }),
      );
    },
  };
}

function pendingOf(
  items: readonly { itemId: string; name: string; card: PluginCard; createdAt: string }[],
): PendingItemSource {
  return { list: () => Promise.resolve(ok({ items })) };
}

test("대기 항목이 있는 이름은 검토 칸이 pending과 그 항목 id이고, 없는 이름은 그대로다. 검토본 해시와 승인 시각은 남는다", async () => {
  const base = baseOf([
    cardOf("alpha"),
    cardOf(
      "beta",
      { kind: "user" },
      {
        state: "approved",
        currentHash: APPROVED_HASH,
        pendingItemId: null,
        approvedAt: APPROVED_AT,
      },
    ),
    cardOf("gamma", PROJECT_ONE),
  ]);
  const pending = pendingOf([
    pendingItem("rvw_beta", "beta", { kind: "user" }, LATER),
    pendingItem("rvw_gamma", "gamma", PROJECT_ONE, LATER),
  ]);

  const listed = await withPendingReview(base, pending).list({});
  expect(listed.ok).toBe(true);
  if (!listed.ok) return;
  expect(listed.value.plugins.map((card) => [card.name, card.review])).toEqual([
    ["alpha", NONE],
    [
      "beta",
      {
        state: "pending",
        currentHash: APPROVED_HASH,
        pendingItemId: "rvw_beta",
        approvedAt: APPROVED_AT,
      },
    ],
    [
      "gamma",
      { state: "pending", currentHash: null, pendingItemId: "rvw_gamma", approvedAt: null },
    ],
  ]);
});

test("같은 검토본 키의 대기 항목이 여럿이면 가장 최근 것의 id를 싣는다", async () => {
  const base = baseOf([cardOf("beta")]);
  const pending = pendingOf([
    pendingItem("rvw_old", "beta", { kind: "user" }, OLD),
    pendingItem("rvw_new", "beta", { kind: "user" }, NEW),
  ]);

  const got = await withPendingReview(base, pending).get("beta");
  expect(got.ok).toBe(true);
  if (!got.ok) return;
  expect(got.value.card.review).toEqual({
    state: "pending",
    currentHash: null,
    pendingItemId: "rvw_new",
    approvedAt: null,
  });
});

test("출처가 다르면 같은 이름이어도 대기 항목을 얹지 않는다", async () => {
  const base = baseOf([cardOf("shared"), cardOf("solo", PROJECT_TWO)]);
  const pending = pendingOf([
    pendingItem("rvw_project", "shared", PROJECT_ONE, LATER),
    pendingItem("rvw_user", "solo", { kind: "user" }, LATER),
  ]);

  const listed = await withPendingReview(base, pending).list({});
  expect(listed.ok).toBe(true);
  if (!listed.ok) return;
  expect(listed.value.plugins.map((card) => [card.name, card.review])).toEqual([
    ["shared", NONE],
    ["solo", NONE],
  ]);
});

test("reviewState 필터는 대기를 얹은 뒤에 적용한다. pending은 대기 플러그인만, none과 approved는 대기 플러그인을 내지 않는다", async () => {
  // 기반 대역은 필터를 검토 칸 값으로 거른다. 필터를 기반에 그대로 넘기면 대기 플러그인(기반 칸은 none)이 빠진다
  const base = baseOf([
    cardOf("alpha", { kind: "user" }),
    cardOf(
      "beta",
      { kind: "user" },
      {
        state: "approved",
        currentHash: APPROVED_HASH,
        pendingItemId: null,
        approvedAt: APPROVED_AT,
      },
    ),
    cardOf("gamma", PROJECT_ONE),
  ]);
  const pending = pendingOf([
    pendingItem("rvw_beta", "beta", { kind: "user" }, LATER),
    pendingItem("rvw_gamma", "gamma", PROJECT_ONE, LATER),
  ]);
  const port = withPendingReview(base, pending);

  const waiting = await port.list({ reviewState: "pending" });
  expect(waiting.ok && waiting.value.plugins.map((card) => card.name)).toEqual(["beta", "gamma"]);
  const userWaiting = await port.list({ origin: "user", reviewState: "pending" });
  expect(userWaiting.ok && userWaiting.value.plugins.map((card) => card.name)).toEqual(["beta"]);

  const unreviewed = await port.list({ reviewState: "none" });
  expect(unreviewed.ok && unreviewed.value.plugins.map((card) => card.name)).toEqual(["alpha"]);

  const approved = await port.list({ reviewState: "approved" });
  expect(approved.ok && approved.value.plugins).toEqual([]);
});

test("plugin.get의 카드도 같은 칸을 얻는다. 없는 이름의 실패는 그대로 돌려준다", async () => {
  const port = withPendingReview(
    baseOf([cardOf("alpha")]),
    pendingOf([pendingItem("rvw_alpha", "alpha", { kind: "user" }, LATER)]),
  );

  const got = await port.get("alpha");
  expect(got.ok && got.value.card.review).toEqual({
    state: "pending",
    currentHash: null,
    pendingItemId: "rvw_alpha",
    approvedAt: null,
  });

  const missing = await port.get("missing");
  expect(missing).toEqual(err({ kind: "unknown_plugin", name: "missing" }));
});

test("대기 항목을 읽지 못하면 list와 get 모두 그 실패를 그대로 돌려준다. 기반 실패도 그대로다", async () => {
  const storeFailure: PluginPortFailure = { kind: "store", code: "io" };
  const broken: PendingItemSource = { list: () => Promise.resolve(err(storeFailure)) };
  const port = withPendingReview(baseOf([cardOf("alpha")]), broken);
  expect(await port.list({})).toEqual(err(storeFailure));
  expect(await port.get("alpha")).toEqual(err(storeFailure));

  const failingBase: Pick<PluginPort, "list" | "get"> = {
    list: () => Promise.resolve(err(storeFailure)),
    get: () => Promise.resolve(err(storeFailure)),
  };
  const basePort = withPendingReview(failingBase, pendingOf([]));
  expect(await basePort.list({})).toEqual(err(storeFailure));
  expect(await basePort.get("alpha")).toEqual(err(storeFailure));
});
