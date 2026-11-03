import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { HandlerFailureEntry } from "@fresnel/client/workbench";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { ExtListEntry, GroupDriveLockResult, GroupStatusWire } from "@fresnel/contracts/wire";
import { renderToString } from "react-dom/server";
import { thr } from "../../state/helpers.ts";
import {
  RuntimeBody,
  type LinkState,
  type Load,
  type RuntimeData,
} from "../../../src/views/runtime/runtime-tab.tsx";

const THREAD = thr(1);

/** 태그를 뺀 글 */
const textOf = (html: string): string => html.replace(/<[^>]*>/g, "");

/** 구역 제목 바로 뒤부터 다음 소제목(h4) 전까지의 마크업. 구역 안의 목록을 읽을 때 쓴다 */
function under(html: string, heading: string): string {
  const start = html.indexOf(`>${heading}</h4>`);
  if (start === -1) return "";
  const rest = html.slice(start + heading.length + 6);
  const next = rest.indexOf("<h4");
  return next === -1 ? rest : rest.slice(0, next);
}

/** 목록 항목(li)마다 글 하나. 목록이 없으면 빈 배열 */
function itemsUnder(html: string, heading: string): string[] {
  return [...under(html, heading).matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((m) =>
    textOf(m[1] ?? ""),
  );
}

/** 보유 줄(`보유` 글 뒤의 문단)의 마크업 */
function holderLineOf(lock: string): string {
  const at = lock.indexOf(`>${t("desktop.runtime.lock.holder")}</span>`);
  if (at === -1) return "";
  return lock.slice(at, lock.indexOf("</p>", at));
}

/** 구역(section)의 마크업 */
function sectionOf(html: string, title: string): string {
  const start = html.indexOf(`aria-label="${title}"`);
  if (start === -1) return "";
  const end = html.indexOf("</section>", start);
  return html.slice(start, end === -1 ? undefined : end);
}

function group(
  id: string,
  drive: GroupStatusWire["drive"],
  over: Partial<GroupStatusWire> = {},
): GroupStatusWire {
  return {
    id,
    displayName: id,
    scope: "enabled",
    pendingToggle: null,
    usesDrive: true,
    drive,
    lastError: null,
    metrics: null,
    ...over,
  };
}

function lockOf(over: Partial<GroupDriveLockResult> = {}): GroupDriveLockResult {
  return {
    holder: null,
    leaseEpoch: 0,
    activeDriver: null,
    limits: { turns: 4, spawns: 4, tokens: null },
    used: { turns: 0, spawns: 0, tokens: 0 },
    candidates: [],
    lastRejected: null,
    ...over,
  };
}

function entry(name: string, over: Partial<ExtListEntry> = {}): ExtListEntry {
  return {
    name,
    displayName: name,
    layer: "L3",
    isGroup: true,
    version: "1.0.0",
    location: "/x",
    origin: "builtin",
    requestedGrade: "user",
    effectiveGrade: "user",
    tier: null,
    status: "enabled",
    plugins: [{ registrationId: name, layer: "L3", status: "enabled", inGroup: false }],
    diagnostics: [],
    autoDisabled: false,
    safeModeExcluded: null,
    hookCount: 2,
    ...over,
  };
}

const ready = <T,>(value: T): Load<T> => ({ kind: "ready", value });

function body(
  data: RuntimeData,
  over: {
    readonly link?: LinkState;
    readonly threadId?: ThreadId | null;
    readonly failures?: readonly HandlerFailureEntry[];
  } = {},
): string {
  return renderToString(
    <RuntimeBody
      threadId={over.threadId === undefined ? THREAD : over.threadId}
      link={over.link ?? "live"}
      data={data}
      failures={over.failures ?? []}
    />,
  );
}

const HELM_HOLDER: RuntimeData = {
  entries: ready([entry("helm"), entry("review"), entry("work")]),
  drive: ready({
    groups: [group("helm", "holder"), group("review", "waiting"), group("work", "rejected")],
    lock: lockOf({
      holder: "helm",
      leaseEpoch: 2,
      used: { turns: 1, spawns: 0, tokens: 120 },
      candidates: [{ registrationId: "review", waits: 1, waitLimit: 3 }],
    }),
  }),
};

describe("runtime-tab.drive-queue-matches-group-status", () => {
  test("runtime-tab.drive-queue-matches-group-status: helm 보유, review 대기, work 거절을 그대로 그린다", () => {
    const html = body(HELM_HOLDER);
    const lock = sectionOf(html, t("desktop.runtime.section.lock"));
    expect(textOf(holderLineOf(lock))).toContain("helm");
    expect(itemsUnder(lock, t("desktop.runtime.queue.title"))).toHaveLength(1);
    expect(itemsUnder(lock, t("desktop.runtime.queue.title"))[0]).toContain("review");
    expect(itemsUnder(lock, t("desktop.runtime.rejected.title"))).toHaveLength(1);
    expect(itemsUnder(lock, t("desktop.runtime.rejected.title"))[0]).toContain("work");
    expect(lock).not.toContain(t("desktop.runtime.lock.mismatch"));
  });

  test("runtime-tab.drive-queue-matches-group-status: 보유자가 helm이 아닌 review여도 같은 모양이다", () => {
    const html = body({
      entries: ready([entry("review"), entry("helm"), entry("work")]),
      drive: ready({
        groups: [group("review", "holder"), group("helm", "waiting"), group("work", "rejected")],
        lock: lockOf({
          holder: "review",
          candidates: [{ registrationId: "helm", waits: 0, waitLimit: 2 }],
        }),
      }),
    });
    const lock = sectionOf(html, t("desktop.runtime.section.lock"));
    expect(textOf(holderLineOf(lock))).toContain("review");
    expect(textOf(holderLineOf(lock))).not.toContain("helm");
    expect(itemsUnder(lock, t("desktop.runtime.queue.title"))[0]).toContain("helm");
    expect(itemsUnder(lock, t("desktop.runtime.rejected.title"))[0]).toContain("work");
  });

  test("runtime-tab.drive-queue-matches-group-status: 보유 그룹과 락 기록이 다르면 경고를 보인다", () => {
    const html = body({
      entries: ready([]),
      drive: ready({
        groups: [group("helm", "holder")],
        lock: lockOf({ holder: "review" }),
      }),
    });
    expect(html).toContain(t("desktop.runtime.lock.mismatch"));
  });
});

describe("runtime-tab 상태: 읽는 중, 구역별 오류, 끊김, 빈 상태", () => {
  test("읽는 중이면 구역마다 Skeleton을 그린다", () => {
    const html = body({ entries: { kind: "loading" }, drive: { kind: "loading" } });
    expect(sectionOf(html, t("desktop.runtime.section.lock"))).toContain('data-slot="skeleton"');
    expect(sectionOf(html, t("desktop.runtime.section.exts"))).toContain('data-slot="skeleton"');
  });

  test("주도 락만 실패하면 그 구역에만 오류 한 줄이 나오고 켜진 목록은 그대로 보인다", () => {
    const html = body({
      entries: ready([entry("helm")]),
      drive: { kind: "error" },
    });
    expect(sectionOf(html, t("desktop.runtime.section.lock"))).toContain(
      t("desktop.runtime.lock.failed"),
    );
    const exts = sectionOf(html, t("desktop.runtime.section.exts"));
    expect(exts).not.toContain(t("desktop.runtime.exts.failed"));
    expect(textOf(exts)).toContain("helm");
  });

  test("연결이 끊기면 두 구역 모두 끊김 글을 보이고 값을 읽지 않는다", () => {
    const html = body(HELM_HOLDER, { link: "offline" });
    expect(html.split(t("desktop.runtime.offline"))).toHaveLength(3);
    expect(html).not.toContain("review");
  });

  test("대화가 없으면 주도 락 구역이 빈 글을 보인다", () => {
    const html = body(HELM_HOLDER, { threadId: null });
    expect(sectionOf(html, t("desktop.runtime.section.lock"))).toContain(
      t("desktop.runtime.empty.thread"),
    );
  });

  test("켜진 그룹과 확장이 없으면 빈 글을 보인다", () => {
    const html = body({ entries: ready([]), drive: ready({ groups: [], lock: lockOf() }) });
    expect(sectionOf(html, t("desktop.runtime.section.exts"))).toContain(
      t("desktop.runtime.exts.empty"),
    );
  });

  test("전환 기록은 아직 연결되지 않았다는 글을 보이고 실패 구역은 기록을 묶어 보인다", () => {
    const html = body(HELM_HOLDER, {
      failures: [
        {
          owner: "ext:review",
          point: "turn.end",
          result: "error",
          message: "boom",
          consecutive: 2,
        },
      ],
    });
    expect(sectionOf(html, t("desktop.runtime.section.transitions"))).toContain(
      t("desktop.runtime.transitions.unavailable"),
    );
    const failures = sectionOf(html, t("desktop.runtime.section.failures"));
    expect(failures).toContain("review");
    expect(textOf(failures)).toContain("boom");
    expect(failures).toContain('data-slot="table"');
  });
});
