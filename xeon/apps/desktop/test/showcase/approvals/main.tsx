// 샌드박스 밖 쓰기 승인 카드 전시 화면(시험 전용, 제품 코드가 import하지 않는다, DP-204·205).
// 모델 키 없이 실제 요청을 만들 수 없어 엔진이 내는 body 모양 그대로 거울에 넣고 실제 카드 부품(ApprovalCardList)으로 그린다.
// 주소의 `?theme=dark|light`가 테마를, `?scene=cards|chip`이 장면을 정한다. cards는 트랜스크립트 폭(736)과 받은 요청 폭(360) 두 열,
// chip은 "이 대화에서 계속 허용"을 고른 대화의 입력창 권한 칩과 그 메뉴다. 첫 그림이 끝나면 `document.body.dataset.ready = "1"`이다.
import { setActiveLocale } from "@fresnel/client/i18n";
import { parse } from "@fresnel/contracts";
import {
  ApprovalRequestedPayloadSchema,
  type ApprovalRequestedPayload,
} from "@fresnel/contracts/records";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { DurableFact } from "../../../src/state/engine/input.ts";
import type { EngineMirror } from "../../../src/state/engine/index.ts";
import type { ReadonlyStore } from "../../../src/state/shared/readonly-store.ts";
import { createUiStore } from "../../../src/state/ui/store.ts";
import { ApprovalCardList } from "../../../src/views/approval-card/approval-card.tsx";
import { PermissionModeChip } from "../../../src/views/composer-chips.tsx";
import { Providers } from "../../../src/views/providers.tsx";
import { SUB, evt, openedHarness, summary, thr } from "../../state/helpers.ts";
import { fakeCommands } from "../../views/fake-commands.ts";

const params = new URLSearchParams(window.location.search);
setActiveLocale(params.get("lang") === "en" ? "en" : "ko");
document.documentElement.dataset["theme"] = params.get("theme") === "light" ? "light" : "dark";
const scene = params.get("scene") === "chip" ? "chip" : "cards";

const T = thr(1);
const origin = { threadId: T, turnId: null, stepId: null, toolCallId: null, caller: "main" };

function request(
  key: string,
  toolName: string,
  args: Record<string, unknown>,
  extra: {
    readonly ruleId?: string | null;
    readonly remember?: string[];
    readonly title?: string;
  } = {},
): ApprovalRequestedPayload {
  const parsed = parse(ApprovalRequestedPayloadSchema, {
    origin,
    surfaceThreadId: T,
    requestedAt: Date.now() - 60_000,
    requestKey: key,
    title: extra.title ?? "Allow writing outside the workspace?",
    remember: extra.remember ?? ["once", "thread"],
    body: {
      kind: "tool",
      tool: {
        toolName,
        risk: "write",
        args,
        argsHash: key,
        ruleId: extra.ruleId === undefined ? "sandbox.write_access" : extra.ruleId,
      },
    },
  });
  if (!parsed.ok) throw new Error(`showcase request ${key} is not valid`);
  return parsed.value;
}

const HOME = "/Users/mina";
const REQUESTS: readonly ApprovalRequestedPayload[] = [
  request("bash", "bash", {
    subject: "write_access",
    tool: "bash",
    command: "npm install -g pnpm@9",
    writePaths: [`${HOME}/.npm/_cacache/index-v5/3f/a1`],
    allowRoots: [`${HOME}/.npm`],
    homeWide: false,
  }),
  request("long", "bash", {
    subject: "write_access",
    tool: "bash",
    command:
      "cargo build --release --target aarch64-apple-darwin && cp target/aarch64-apple-darwin/release/fresnel-helper ~/Library/Application\\ Support/Fresnel/bin/",
    writePaths: [
      `${HOME}/Library/Application Support/Fresnel/bin/fresnel-helper`,
      `${HOME}/.cargo/registry/cache/index.crates.io-6f17d22bba15001f/serde-1.0.210.crate`,
      `${HOME}/.cargo/registry/src/index.crates.io-6f17d22bba15001f/serde-1.0.210/Cargo.toml`,
      `${HOME}/.cargo/.package-cache`,
      `${HOME}/.cargo/registry/index/index.crates.io-6f17d22bba15001f/.cache/se/rd/serde`,
    ],
    allowRoots: [`${HOME}/Library/Application Support/Fresnel`, `${HOME}/.cargo`],
    homeWide: false,
  }),
  request("home", "write", {
    subject: "write_access",
    tool: "write",
    writePaths: [`${HOME}/release-notes.md`],
    allowRoots: [HOME],
    homeWide: true,
  }),
  request(
    "edit",
    "edit",
    {
      subject: "write_access",
      tool: "edit",
      writePaths: ["/etc/hosts.local"],
      allowRoots: ["/etc/hosts.local"],
      homeWide: false,
    },
    { remember: ["once"] },
  ),
  request(
    "plain",
    "bash",
    { command: "rm -rf build && make" },
    { ruleId: null, remember: ["once"], title: 'Allow tool "bash"?' },
  ),
];

function frozen<S>(state: S): ReadonlyStore<S> {
  return { getState: () => state, getInitialState: () => state, subscribe: () => () => {} };
}

function mirror(): EngineMirror {
  const h = openedHarness();
  h.store.ingest({ type: "threads", threads: [summary(T, { title: "릴리스 빌드" })] });
  REQUESTS.forEach((payload, index) => {
    const seq = 6 + index;
    const fact: DurableFact = {
      type: "approval.requested",
      seq,
      eventId: evt(seq),
      threadId: T,
      turnId: null,
      at: "t",
      request: payload,
    };
    h.store.ingest({
      type: "batch",
      sub: SUB,
      from: seq - 1,
      to: seq,
      caughtUp: true,
      facts: [fact],
    });
  });
  h.store.flush();
  return h.store.read.getState();
}

function Cards(props: { readonly ids: EngineMirror["approvals"]["ids"] }): ReactNode {
  return (
    <main
      data-showcase="approvals"
      style={{ minHeight: "100%", padding: 32, background: "var(--cs-color-surface-base)" }}
      className="flex items-start gap-8"
    >
      <section data-showcase-column="transcript" className="w-184 shrink-0">
        <ApprovalCardList ids={props.ids} within={T} />
      </section>
      <section data-showcase-column="inbox" className="w-90 shrink-0">
        <ApprovalCardList ids={props.ids.slice(0, 3)} />
      </section>
    </main>
  );
}

function Chip(): ReactNode {
  return (
    <main
      data-showcase="chip"
      style={{ minHeight: "100%", padding: 32, background: "var(--cs-color-surface-base)" }}
      className="flex items-end gap-16 pt-96"
    >
      <PermissionModeChip
        mode="default"
        bypassAllowed
        disabled={false}
        writeAccess
        onChange={() => {}}
      />
      <PermissionModeChip mode="acceptEdits" bypassAllowed disabled={false} onChange={() => {}} />
    </main>
  );
}

const host = document.getElementById("root");
if (host !== null) {
  const state = mirror();
  createRoot(host).render(
    <Providers engine={frozen(state)} ui={createUiStore().read} commands={fakeCommands()}>
      {scene === "chip" ? <Chip /> : <Cards ids={state.approvals.ids} />}
    </Providers>,
  );
  requestAnimationFrame(() => {
    document.body.dataset["ready"] = "1";
  });
}
