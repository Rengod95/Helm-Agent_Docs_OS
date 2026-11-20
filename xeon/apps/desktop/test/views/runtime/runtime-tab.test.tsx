import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { HandlerFailureEntry, TransitionEntry } from "@fresnel/client/workbench";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { DriveFrameView } from "@fresnel/contracts/extensions";
import type { ExtListEntry, GroupStatusWire } from "@fresnel/contracts/wire";
import { renderToString } from "react-dom/server";
import { thr, trn } from "../../state/helpers.ts";
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

/** "지금 Driving 중" 칸(플러그인 순서 표의 첫 칸)의 마크업 */
function holderLineOf(lock: string): string {
  return under(lock, t("desktop.runtime.lock.holder"));
}

/** 구역(section)의 마크업 */
function sectionOf(html: string, title: string): string {
  const start = html.indexOf(`aria-label="${title}"`);
  if (start === -1) return "";
  const end = html.indexOf("</section>", start);
  return html.slice(start, end === -1 ? undefined : end);
}

/** 구역 안 목록 항목(li)마다 글 하나. 항목의 순서를 그대로 따른다 */
function listTextOf(section: string): string[] {
  return [...section.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((m) => textOf(m[1] ?? ""));
}

/** 로컬 시각 HH:MM:SS의 `at`. 지역 시각으로 만들어 어느 시간대에서도 같은 시각을 읽는다 */
const at = (hour: number, minute: number, second: number): string =>
  new Date(2026, 10, 4, hour, minute, second).toISOString();

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

/** 주도권 스택의 프레임. `depth`는 코어 0, 플러그인 프레임 1부터다 */
function frame(plugin: string, state: DriveFrameView["state"], depth: number): DriveFrameView {
  return {
    depth,
    plugin,
    versionId: "1.0.0",
    leaseId: `lease-${plugin}`,
    state,
    used: { turns: 0, spawns: 0, tokens: 0 },
    limits: {},
  };
}

/** 코어 루프 프레임(맨 아래) */
const CORE: DriveFrameView = {
  depth: 0,
  plugin: null,
  versionId: null,
  leaseId: null,
  state: "waiting",
  used: { turns: 0, spawns: 0, tokens: 0 },
  limits: {},
};

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
    readonly transitions?: readonly TransitionEntry[];
  } = {},
): string {
  return renderToString(
    <RuntimeBody
      threadId={over.threadId === undefined ? THREAD : over.threadId}
      link={over.link ?? "live"}
      data={data}
      failures={over.failures ?? []}
      transitions={over.transitions ?? []}
    />,
  );
}

const HELM_HOLDER: RuntimeData = {
  entries: ready([entry("helm"), entry("review")]),
  drive: ready({
    groups: [group("helm", "holder"), group("review", "waiting")],
    frames: [CORE, frame("review", "waiting", 1), frame("helm", "driving", 2)],
  }),
};

describe("runtime-tab.drive-queue-matches-group-status", () => {
  test("runtime-tab.drive-queue-matches-group-status: [코어, review waiting, helm driving]은 보유 helm, 대기 review로 그린다", () => {
    const html = body(HELM_HOLDER);
    const lock = sectionOf(html, t("desktop.runtime.section.lock"));
    expect(textOf(holderLineOf(lock))).toContain("helm");
    expect(itemsUnder(lock, t("desktop.runtime.queue.title"))).toHaveLength(1);
    expect(itemsUnder(lock, t("desktop.runtime.queue.title"))[0]).toContain("review");
    expect(lock).not.toContain(t("desktop.runtime.lock.mismatch"));
  });

  test("runtime-tab.drive-queue-matches-group-status: 맨 위 프레임이 review면 보유는 review, 대기는 helm이다", () => {
    const html = body({
      entries: ready([entry("review"), entry("helm")]),
      drive: ready({
        groups: [group("review", "holder"), group("helm", "waiting")],
        frames: [CORE, frame("helm", "waiting", 1), frame("review", "driving", 2)],
      }),
    });
    const lock = sectionOf(html, t("desktop.runtime.section.lock"));
    expect(textOf(holderLineOf(lock))).toContain("review");
    expect(textOf(holderLineOf(lock))).not.toContain("helm");
    expect(itemsUnder(lock, t("desktop.runtime.queue.title"))[0]).toContain("helm");
  });

  test("runtime-tab.drive-queue-matches-group-status: group.list의 보유 그룹과 맨 위 프레임이 다르면 경고를 보인다", () => {
    const html = body({
      entries: ready([]),
      drive: ready({
        groups: [group("helm", "holder")],
        frames: [CORE, frame("review", "driving", 1)],
      }),
    });
    expect(html).toContain(t("desktop.runtime.lock.mismatch"));
  });

  test("runtime-tab.drive-queue-matches-group-status: drive 오류인 그룹은 오류 구역에 든다", () => {
    const html = body({
      entries: ready([]),
      drive: ready({ groups: [group("work", "error")], frames: [CORE] }),
    });
    const lock = sectionOf(html, t("desktop.runtime.section.lock"));
    expect(itemsUnder(lock, t("desktop.runtime.errored.title"))[0]).toContain("work");
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
    const html = body({ entries: ready([]), drive: ready({ groups: [], frames: [CORE] }) });
    expect(sectionOf(html, t("desktop.runtime.section.exts"))).toContain(
      t("desktop.runtime.exts.empty"),
    );
  });

  test("전환 기록이 없으면 빈 글을 보이고 실패 구역은 기록을 묶어 보인다", () => {
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
      t("desktop.runtime.transitions.empty"),
    );
    const failures = sectionOf(html, t("desktop.runtime.section.failures"));
    expect(failures).toContain("review");
    expect(textOf(failures)).toContain("boom");
    expect(failures).toContain('data-slot="table"');
  });

  test("대화가 없으면 전환 기록 구역도 빈 글을 보인다", () => {
    const html = body(HELM_HOLDER, { threadId: null, transitions: [] });
    expect(sectionOf(html, t("desktop.runtime.section.transitions"))).toContain(
      t("desktop.runtime.empty.thread"),
    );
  });
});

describe("runtime-tab.transitions: 전환 기록 줄", () => {
  const RECORDS: readonly TransitionEntry[] = [
    {
      seq: 3,
      at: at(14, 2, 41),
      turnId: trn(2),
      subject: "helm",
      change: { kind: "lease.acquired", leaseEpoch: 1 },
    },
    {
      seq: 4,
      at: at(14, 2, 42),
      turnId: null,
      subject: "review",
      change: { kind: "lease.released", reason: "waiting" },
    },
    {
      seq: 5,
      at: at(14, 2, 43),
      turnId: trn(2),
      subject: "work",
      change: { kind: "lease.rejected", reason: "wait_limit" },
    },
    {
      seq: 6,
      at: at(14, 2, 44),
      turnId: null,
      subject: "review",
      change: { kind: "scope.changed", status: "disabled", reason: "safe_mode" },
    },
  ];

  test("최근 것이 먼저 오고 줄마다 시각, 턴 꼬리, 글, 대상이 정해진 글로 나온다", () => {
    const html = body(HELM_HOLDER, { transitions: RECORDS });
    expect(listTextOf(sectionOf(html, t("desktop.runtime.section.transitions")))).toEqual([
      `14:02:44 ${t("desktop.runtime.transitions.scope.disabled.safeMode")} review`,
      `14:02:43 ${t("desktop.runtime.transitions.turn", { turn: "000002" })} ${t("desktop.runtime.transitions.rejected.waitLimit")} work`,
      `14:02:42 ${t("desktop.runtime.transitions.released.waiting")} review`,
      `14:02:41 ${t("desktop.runtime.transitions.turn", { turn: "000002" })} ${t("desktop.runtime.transitions.acquired")} helm`,
    ]);
  });

  test("켜기·끄기 적용은 상태와 사유마다 다른 글이다", () => {
    const html = body(HELM_HOLDER, {
      transitions: [
        {
          seq: 7,
          at: at(9, 0, 0),
          turnId: null,
          subject: "review",
          change: { kind: "scope.changed", status: "enabled", reason: "request" },
        },
        {
          seq: 8,
          at: at(9, 0, 1),
          turnId: null,
          subject: "review",
          change: { kind: "scope.changed", status: "disabled", reason: "auto_disable" },
        },
      ],
    });
    expect(listTextOf(sectionOf(html, t("desktop.runtime.section.transitions")))).toEqual([
      `09:00:01 ${t("desktop.runtime.transitions.scope.disabled.autoDisable")} review`,
      `09:00:00 ${t("desktop.runtime.transitions.scope.enabled.request")} review`,
    ]);
  });

  test("연결이 끊겨도 거울에 받은 전환 기록은 그대로 보인다", () => {
    const html = body(HELM_HOLDER, { link: "offline", transitions: RECORDS });
    expect(listTextOf(sectionOf(html, t("desktop.runtime.section.transitions")))).toHaveLength(4);
  });
});

describe("런타임 탭 맨 위: 알림 자리는 첫 구역 위에 온다", () => {
  test("notices를 주면 그 그림이 첫 구역(주도 락)보다 앞에 한 번 나온다", () => {
    const html = renderToString(
      <RuntimeBody
        threadId={THREAD}
        link="live"
        data={HELM_HOLDER}
        failures={[]}
        transitions={[]}
        notices={<p>NOTICE-SLOT</p>}
      />,
    );
    const notice = html.indexOf("NOTICE-SLOT");
    const first = html.indexOf(`aria-label="${t("desktop.runtime.section.lock")}"`);
    expect(notice).toBeGreaterThan(-1);
    expect(notice).toBeLessThan(first);
    expect(html.indexOf("NOTICE-SLOT", notice + 1)).toBe(-1);
  });

  test("notices가 없으면 첫 구역이 그림의 맨 앞이다", () => {
    const html = body(HELM_HOLDER);
    expect(html.indexOf("<section")).toBe(
      html.indexOf(`<section aria-label="${t("desktop.runtime.section.lock")}"`),
    );
  });
});

describe("런타임 목록의 Drive 역할(lcM6f)", () => {
  test("역할은 칩이 아니라 띠·카드와 같은 상태 글이다: 쥔 플러그인은 멈춘 그라데이션 Driving, 기다림은 조용한 글", () => {
    const html = body(HELM_HOLDER);
    const roles = [
      ...html.matchAll(/<span[^>]*data-slot="runtime-drive-role"[^>]*>([^<]*)<\/span>/g),
    ].map((m) => {
      const tag = m[0];
      return [
        m[1] ?? "",
        /data-look="([a-z]+)"/.exec(tag)?.[1] ?? null,
        tag.includes("drive-word"),
        tag.includes("data-wave"),
      ];
    });
    expect(roles).toEqual([
      [t("desktop.runtime.role.holder"), "driving", true, false],
      [t("desktop.runtime.role.waiting"), "quiet", false, false],
    ]);
    expect(html).not.toContain('data-slot="chip"');
  });
});
