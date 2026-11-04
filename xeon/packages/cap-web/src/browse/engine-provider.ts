import {
  assertNever,
  attemptAsync,
  err,
  ok,
  parse,
  rethrow,
  type Result,
} from "@fresnel/contracts";
import {
  BrowsePageSchema,
  BrowseSnapshotSchema,
  type BrowseActInput,
  type BrowsePage,
  type BrowseSnapshot,
  type BrowserOpenOptions,
  type BrowserSessionHandle,
  type BrowserStep,
  type CapabilityError,
  type ProviderAvailabilityWeb,
  type WebBrowseProvider,
  type WebProviderManifest,
} from "@fresnel/contracts/capabilities";
import type {
  BrowserEnginePort,
  EngineError,
  EngineOpenOptions,
  EngineSession,
  EngineSnapshot,
} from "../ports/browser-engine.ts";
import {
  checkedScreenshot,
  clip,
  DEFAULT_WAIT_MS,
  FORM_ROLES,
  invalidInput,
  linesOfMatches,
  MAX_FAILURE_TEXT,
  MAX_NAME,
  MAX_REFS,
  MAX_ROLE,
  MAX_SCROLL_PRESSES,
  MAX_TITLE,
  MAX_URL,
  neverAborted,
  providerError,
  TAB_ID,
} from "./shared.ts";

// L2.web.spec §4.10.4a. 로컬 브라우저 엔진(Stagehand 4.3.0, 로컬 Chrome) provider. 첫 내장 `web.browse` 후보이고
// `playwright-mcp`가 폴백이다. 엔진 포트는 XPath로 요소를 가리킨다. 이 provider는 스냅샷의 frame-node id마다
// `e<N>` ref를 붙이고 ref → XPath 표를 스냅샷마다 새로 만든다. 그래서 마지막 스냅샷에 없는 ref는 `ref_invalid`다.
//
// 한 엔진 세션은 브라우저 하나를 쓰므로 열린 세션은 하나만 허용한다. 실패는 `CapabilityError`로 던진다(mcp-provider와 같다).

const PROVIDER_ID = "stagehand";
/** 스크롤 한 번이 움직이는 픽셀 수 [가정: 엔진의 scroll 단위는 CSS 픽셀이고 한 번은 대략 반 화면이다] */
const SCROLL_STEP_PX = 500;
/** 방향별 (가로, 세로) 부호. 아래와 오른쪽이 양수다 */
const SCROLL_AXES: Readonly<Record<"up" | "down" | "left" | "right", readonly [number, number]>> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};
/** `formattedTree`의 한 줄: 들여쓰기, frame-node id, 나머지(역할과 선택적 이름). 예: `  [0-11] button: Pay now` */
const TREE_LINE = /^(\s*)\[([^\]]+)\] (.+)$/;

/** ref 표의 한 줄. XPath는 엔진이 요소 경로를 준 ref에만 있다 */
interface Row {
  readonly role: string;
  readonly name: string | undefined;
  readonly xpath: string | undefined;
}

interface Captured {
  readonly page: BrowsePage;
  readonly snapshot: BrowseSnapshot;
  readonly rows: ReadonlyMap<string, Row>;
}

interface TreeLine {
  readonly indent: string;
  readonly id: string;
  readonly role: string;
  readonly name: string | undefined;
}

function manifestOf(): WebProviderManifest {
  return {
    name: PROVIDER_ID,
    displayName: "Stagehand",
    services: ["browse"],
    endpoints: [],
    auth: { kind: "none", secrets: [] },
    pricing: {
      asOf: "2026-11-04",
      sourceUrl: "https://github.com/browserbase/stagehand",
      currency: "USD",
      units: {},
    },
    termsFlags: {
      cachePolicy: "none",
      mayTrainOn: "unknown",
      redistribution: "unknown",
    },
    // [가정] 엔진의 원격 텔레메트리는 어댑터 설정이 정한다. 확인하기 전까지 보낸다고 적는다
    privacy: { zdr: "unknown", sendsTelemetry: true },
    limits: {},
  };
}

/** 호출 옵션을 포트 옵션으로 옮긴다. 허용 주소(`allowedOrigins`)는 앞단이 검사하므로 넘기지 않는다 */
function engineOptionsOf(options: BrowserOpenOptions): EngineOpenOptions {
  return {
    headless: options.headless,
    profile: options.profile,
    ...(options.proxy === undefined ? {} : { proxy: options.proxy }),
  };
}

function engineError(error: EngineError, what: string): CapabilityError {
  switch (error.kind) {
    case "unavailable":
      return providerError("unavailable", true, error.message);
    case "aborted":
      return providerError("aborted", false, "The operation was aborted.");
    case "failed":
      return providerError(
        "upstream_error",
        true,
        `stagehand ${what} failed: ${clip(error.message, MAX_FAILURE_TEXT)}`,
      );
    default:
      return assertNever(error, "stagehand engine error");
  }
}

/** 엔진 결과를 값으로 바꾼다. 실패는 `CapabilityError`로 던진다 */
function valueOf<T>(reply: Result<T, EngineError>, what: string): T {
  if (!reply.ok) throw engineError(reply.error, what);
  return reply.value;
}

/** 동작 대상의 ref. 좌표 대상은 이 provider가 다루지 않는다 */
function refOfTarget(target: BrowseActInput["target"]): string | undefined {
  if (target === undefined) return undefined;
  if ("ref" in target) return target.ref;
  throw invalidInput("stagehand acts only on ref targets (for example e12), not coordinates.");
}

/** 스냅샷 줄 하나를 읽는다. 역할이 없거나 모양이 다르면 undefined다 */
function treeLineOf(line: string): TreeLine | undefined {
  const match = TREE_LINE.exec(line);
  if (match === null) return undefined;
  const [, indent = "", id = "", rest = ""] = match;
  const colon = rest.indexOf(":");
  const role = (colon < 0 ? rest : rest.slice(0, colon)).trim();
  const name = colon < 0 ? "" : rest.slice(colon + 1).trim();
  if (id === "" || role === "") return undefined;
  return {
    indent,
    id,
    role: clip(role, MAX_ROLE),
    name: name === "" ? undefined : clip(name, MAX_NAME),
  };
}

/**
 * 엔진 스냅샷에서 페이지 상태와 ref 표를 만든다. ref는 `e1`부터 줄 순서대로 붙인다.
 * 텍스트는 mcp 스냅샷과 같은 꼴(`- 역할 "이름" [ref=eN]`)이고, 링크의 주소는 자식 줄(`- /url: 주소`)로 싣는다.
 */
function captureOf(
  tree: EngineSnapshot,
  revision: number,
): Result<Captured, { readonly kind: "unrecognized" }> {
  const lines = tree.formattedTree
    .split("\n")
    .flatMap((line) => {
      const parsed = treeLineOf(line);
      return parsed === undefined ? [] : [parsed];
    })
    .slice(0, MAX_REFS);
  const refs: { ref: string; role: string; name?: string }[] = [];
  const rows = new Map<string, Row>();
  const text: string[] = [];
  for (const [index, line] of lines.entries()) {
    const ref = `e${index + 1}`;
    refs.push({ ref, role: line.role, ...(line.name === undefined ? {} : { name: line.name }) });
    rows.set(ref, { role: line.role, name: line.name, xpath: tree.xpathMap[line.id] });
    const label = line.name === undefined ? line.role : `${line.role} "${line.name}"`;
    const href = tree.urlMap[line.id];
    text.push(`${line.indent}- ${label} [ref=${ref}]${href === undefined ? "" : ":"}`);
    if (href !== undefined) text.push(`${line.indent}  - /url: ${clip(href, MAX_URL)}`);
  }
  const page = parse(BrowsePageSchema, {
    url: tree.url,
    title: clip(tree.title, MAX_TITLE),
    tabId: TAB_ID,
  });
  const snapshot = parse(BrowseSnapshotSchema, {
    format: "aria-yaml",
    kind: "full",
    revision,
    text: text.join("\n"),
    refs,
  });
  if (!page.ok || !snapshot.ok) return err({ kind: "unrecognized" });
  return ok({ page: page.value, snapshot: snapshot.value, rows });
}

/**
 * Stagehand 엔진을 `web.browse` provider로 감싼다. 호출자가 `BrowseCandidate`로 등록할 때 origin을 정한다.
 * 한 번에 열린 세션은 하나다. 세션을 닫으면(`close`) 다음 `open`을 받는다.
 */
export function createEngineBrowseProvider(port: BrowserEnginePort): WebBrowseProvider {
  let liveSession: symbol | undefined;

  function openSession(token: symbol, engine: EngineSession): BrowserSessionHandle {
    let closed = false;
    let revision = 0;
    let rows: ReadonlyMap<string, Row> = new Map();

    function assertOpen(): void {
      if (closed) {
        throw providerError("not_found", false, "The stagehand session is closed. Open a new one.");
      }
    }

    function rowOf(ref: string): Row {
      const row = rows.get(ref);
      if (row === undefined) {
        throw providerError("ref_invalid", false, `ref ${ref} is not in the last snapshot.`);
      }
      return row;
    }

    /** 동작 대상의 XPath. ref가 없으면 `invalid_input`, 엔진이 요소 경로를 주지 않은 ref면 `unsupported`다 */
    function xpathFor(ref: string | undefined, action: string): string {
      if (ref === undefined) throw invalidInput(`${action} needs a ref target.`);
      const xpath = rowOf(ref).xpath;
      if (xpath === undefined) {
        throw providerError(
          "unsupported",
          false,
          `ref ${ref} has no element path in the engine snapshot.`,
        );
      }
      return xpath;
    }

    /** 엔진 스냅샷을 읽고 ref 표를 새로 만든다. 이 값이 이후 동작의 기준이다 */
    async function takeSnapshot(signal: AbortSignal): Promise<Captured> {
      const tree = valueOf(await engine.snapshot(signal), "snapshot");
      const captured = captureOf(tree, revision + 1);
      if (!captured.ok) {
        throw providerError(
          "upstream_error",
          true,
          "stagehand answered without a valid page state.",
        );
      }
      revision = captured.value.snapshot.revision;
      rows = captured.value.rows;
      return captured.value;
    }

    /** 동작 뒤의 단계. 스냅샷을 새로 읽고, 그 사이 일어난 최상위 문서 이동을 붙인다 */
    async function stepAfter(signal: AbortSignal): Promise<BrowserStep> {
      const current = await takeSnapshot(signal);
      return { page: current.page, snapshot: current.snapshot, navigations: engine.navigations() };
    }

    return {
      async navigate(url, signal) {
        assertOpen();
        valueOf(await engine.goto(url, signal), "navigate");
        return stepAfter(signal);
      },

      async act(input, signal) {
        assertOpen();
        const ref = refOfTarget(input.target);
        switch (input.action) {
          case "navigate": {
            if (input.url === undefined) throw invalidInput("navigate needs a url.");
            valueOf(await engine.goto(input.url, signal), "navigate");
            return stepAfter(signal);
          }
          case "click": {
            valueOf(await engine.click(xpathFor(ref, "click"), signal), "click");
            return stepAfter(signal);
          }
          case "type":
          case "fill": {
            if (input.text === undefined) throw invalidInput(`${input.action} needs text.`);
            // 대상 ref가 있으면 그 요소에 값을 채운다. 대상이 없는 type은 초점이 있는 요소에 친다
            if (ref === undefined && input.action === "type") {
              valueOf(await engine.typeText(input.text, signal), "type");
            } else {
              valueOf(
                await engine.fill(xpathFor(ref, input.action), input.text, signal),
                input.action,
              );
            }
            return stepAfter(signal);
          }
          case "key": {
            if (input.key === undefined) throw invalidInput("key needs a key name.");
            valueOf(await engine.pressKey(input.key, signal), "key");
            return stepAfter(signal);
          }
          case "scroll": {
            const distance = Math.min(input.amount ?? 1, MAX_SCROLL_PRESSES) * SCROLL_STEP_PX;
            const [axisX, axisY] = SCROLL_AXES[input.direction ?? "down"];
            valueOf(await engine.scroll(axisX * distance, axisY * distance, signal), "scroll");
            return stepAfter(signal);
          }
          case "select": {
            if (input.values === undefined) throw invalidInput("select needs values.");
            valueOf(
              await engine.selectOption(xpathFor(ref, "select"), input.values, signal),
              "select",
            );
            return stepAfter(signal);
          }
          case "wait": {
            valueOf(await engine.waitMs(input.timeoutMs ?? DEFAULT_WAIT_MS, signal), "wait");
            return stepAfter(signal);
          }
          case "hover":
          case "back":
          case "forward":
          case "upload":
          case "evaluate":
            throw providerError(
              "unsupported",
              false,
              `stagehand does not support ${input.action}.`,
            );
          default:
            return assertNever(input.action, "stagehand act");
        }
      },

      async read(request, signal) {
        assertOpen();
        const current = await takeSnapshot(signal);
        switch (request.mode) {
          case "snapshot":
            return { page: current.page, snapshot: current.snapshot };
          case "text":
            return {
              page: current.page,
              text: valueOf(await engine.readText(undefined, signal), "read"),
            };
          case "find": {
            if (request.query === undefined) throw invalidInput("find needs a query.");
            return { page: current.page, text: linesOfMatches(current.snapshot, request.query) };
          }
          case "screenshot": {
            const shot = checkedScreenshot(valueOf(await engine.screenshot(signal), "screenshot"));
            if (shot === undefined) {
              throw providerError(
                "upstream_error",
                true,
                "stagehand returned a screenshot that is not PNG or JPEG within the size limit.",
              );
            }
            return { page: current.page, screenshot: shot };
          }
          default:
            return assertNever(request.mode, "stagehand read");
        }
      },

      async describe(target, signal) {
        assertOpen();
        const row = rowOf(target.ref);
        const base = { role: row.role, ...(row.name === undefined ? {} : { name: row.name }) };
        // 교차 출처 폼 확인(§4.10.3)에는 폼의 action이 필요하다. 폼을 제출할 수 있는 요소만 엔진에 묻는다
        if (!FORM_ROLES.has(row.role) || row.xpath === undefined) return base;
        const action = await engine.formAction(row.xpath, signal);
        // 조회가 실패하면 formAction 없이 돌려준다(mcp-provider와 같다)
        if (!action.ok || action.value === undefined) return base;
        return { ...base, formAction: clip(action.value, MAX_URL) };
      },

      async close() {
        if (closed) return;
        closed = true;
        try {
          // 닫기 결과는 쓰지 않는다. 실패해도 슬롯은 비운다
          await engine.close(neverAborted());
        } finally {
          if (liveSession === token) liveSession = undefined;
        }
      },
    };
  }

  return {
    id: PROVIDER_ID,
    manifest: manifestOf(),
    async isAvailable(signal): Promise<ProviderAvailabilityWeb> {
      const probe = await port.available(signal);
      return probe.ok ? { ok: true } : { ok: false, reason: "unreachable", detail: probe.detail };
    },
    async open(options, signal) {
      if (liveSession !== undefined) {
        throw providerError("unavailable", false, "stagehand supports one session");
      }
      // 슬롯은 포트를 부르기 전에 잡는다. 두 `open`이 겹쳐도 하나만 연다
      const token = Symbol("stagehand session");
      liveSession = token;
      const opened = await attemptAsync(() => port.open(engineOptionsOf(options), signal));
      if (!opened.ok) {
        liveSession = undefined;
        rethrow(opened.error.cause);
      }
      if (!opened.value.ok) {
        liveSession = undefined;
        throw engineError(opened.value.error, "open");
      }
      return openSession(token, opened.value.value);
    },
  };
}
