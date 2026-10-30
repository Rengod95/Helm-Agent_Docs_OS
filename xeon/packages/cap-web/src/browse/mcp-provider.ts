import { assertNever, err, ok, parse, type Result } from "@xeon/contracts";
import {
  BrowsePageSchema,
  BrowseSnapshotSchema,
  CapabilityError,
  WebBrowse,
  type BrowsePage,
  type BrowseSnapshot,
  type BrowserSessionHandle,
  type BrowserStep,
  type ProviderAvailabilityWeb,
  type WebBrowseProvider,
  type WebProviderManifest,
} from "@xeon/contracts/capabilities";
import { Type, type Static } from "typebox";
import type { BrowserMcpError, BrowserMcpPort, BrowserMcpResult } from "../ports/browser-mcp.ts";

// L2.web.spec §4.10.4a. 기본 브라우저 경로. Playwright MCP 서버의 도구를 `WebBrowseProvider`의 좁은 세션 핸들로 옮긴다.
// 도구 이름과 인자는 이 저장소에서 검증하지 않은 가정이다 [가정: Playwright MCP 도구 스키마]. 응답은 Markdown이라
// 페이지 주소, 제목, 스냅샷 ref를 정규식으로 읽고 TypeBox `parse`로 검사한다.
//
// 한 MCP 서버는 브라우저 컨텍스트 하나를 가진다. 그래서 이 provider는 열린 세션을 한 번에 하나만 허용한다.
// 실패는 `CapabilityError`로 던진다. provider 계약(`WebBrowseProvider`)이 던지기를 요구하고, 앞단의 `failureOfThrown`이
// 그 값을 `WebFailure`로 바꾼다. 그래서 이 파일의 `method` 값은 자리표시다.

const PROVIDER_ID = "playwright-mcp";
const TAB_ID = "t1";
/** 스크롤 한 번이 누르는 키 수의 상한. `amount`가 이보다 커도 이만큼만 누른다 [가정] */
const MAX_SCROLL_PRESSES = 20;
/** 스냅샷 ref 상한(`BrowseSnapshot.refs`의 maxItems) */
const MAX_REFS = 4000;
/** 도구 실패 문구를 오류 메시지에 싣는 길이 */
const MAX_FAILURE_TEXT = 500;
const MAX_TITLE = 512;
const MAX_ROLE = 64;
const MAX_NAME = 256;
const MAX_SCREENSHOT_DATA = 2_000_000;
/** 스크린샷의 픽셀 크기는 도구 응답에 없다. 1×1로 둔다 [가정] */
const UNKNOWN_SIZE = 1;
const DEFAULT_WAIT_MS = 1000;

const SCROLL_KEYS: Readonly<Record<"up" | "down" | "left" | "right", string>> = {
  up: "PageUp",
  down: "PageDown",
  left: "ArrowLeft",
  right: "ArrowRight",
};

const PAGE_URL = /^- Page URL: (.*)$/m;
const PAGE_TITLE = /^- Page Title: (.*)$/m;
const SNAPSHOT_BLOCK = /```yaml\n([\s\S]*?)\n?```/;
/** 스냅샷 줄: `- button "Pay now" [ref=e3]`. 역할과 이름(있으면)과 ref를 잡는다 */
const REF_LINE = /^\s*- (\w[\w-]*)(?: "([^"]*)")?.*\[ref=(e\d{1,6})\]/;
const REF_MARK = /\[ref=(e\d{1,6})\]/;

const ScreenshotSchema = Type.Object({
  mediaType: Type.Union([Type.Literal("image/png"), Type.Literal("image/jpeg")]),
  data: Type.String({ maxLength: MAX_SCREENSHOT_DATA }),
  width: Type.Integer({ minimum: 1 }),
  height: Type.Integer({ minimum: 1 }),
});

type ToolArgs = Readonly<Record<string, string | number | boolean | readonly string[]>>;
type RefEntry = BrowseSnapshot["refs"][number];

interface Captured {
  readonly page: BrowsePage;
  readonly snapshot: BrowseSnapshot;
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max);
}

function neverAborted(): AbortSignal {
  return new AbortController().signal;
}

/** 제공자 오류 값. `retryable`은 호출 쪽이 다시 시도해도 되는지다 */
function providerError(code: string, retryable: boolean, message: string): CapabilityError {
  return new CapabilityError({
    capability: WebBrowse.id,
    method: "browse",
    code,
    message,
    retryable,
  });
}

function invalidInput(message: string): CapabilityError {
  return providerError("invalid_input", false, message);
}

function portError(error: BrowserMcpError): CapabilityError {
  switch (error.kind) {
    case "unavailable":
      return providerError("unavailable", true, error.message);
    case "aborted":
      return providerError("aborted", false, "The operation was aborted.");
    default:
      return assertNever(error, "playwright-mcp port error");
  }
}

/** 도구 한 번 호출. 포트 실패와 `isError` 응답은 오류로 던진다 */
async function callTool(
  port: BrowserMcpPort,
  tool: string,
  args: ToolArgs,
  signal: AbortSignal,
): Promise<BrowserMcpResult> {
  const reply = await port.callTool(tool, args, signal);
  if (!reply.ok) throw portError(reply.error);
  if (reply.value.isError) {
    throw providerError(
      "upstream_error",
      true,
      `playwright-mcp ${tool} failed: ${clip(reply.value.text, MAX_FAILURE_TEXT)}`,
    );
  }
  return reply.value;
}

/** 스냅샷 줄 하나에서 ref 항목을 만든다. ref 줄이 아니면 undefined */
function refEntryOf(line: string): RefEntry | undefined {
  const match = REF_LINE.exec(line);
  if (match === null) return undefined;
  const [, role, name, ref] = match;
  if (role === undefined || ref === undefined) return undefined;
  return name === undefined || name === ""
    ? { ref, role: clip(role, MAX_ROLE) }
    : { ref, role: clip(role, MAX_ROLE), name: clip(name, MAX_NAME) };
}

function refsOf(yaml: string): RefEntry[] {
  return yaml
    .split("\n")
    .flatMap((line) => {
      const entry = refEntryOf(line);
      return entry === undefined ? [] : [entry];
    })
    .slice(0, MAX_REFS);
}

/**
 * 도구 응답 Markdown에서 페이지 상태를 읽는다. 주소, 제목, yaml 블록이 모두 있어야 하고, 그 값들은 TypeBox로 검사한다.
 * 검사에 실패하면 `unrecognized`다.
 */
function captureOf(
  text: string,
  revision: number,
): Result<Captured, { readonly kind: "unrecognized" }> {
  const url = PAGE_URL.exec(text)?.[1];
  const title = PAGE_TITLE.exec(text)?.[1];
  const yaml = SNAPSHOT_BLOCK.exec(text)?.[1];
  if (url === undefined || title === undefined || yaml === undefined) {
    return err({ kind: "unrecognized" });
  }
  const page = parse(BrowsePageSchema, {
    url,
    title: clip(title, MAX_TITLE),
    tabId: TAB_ID,
  });
  const snapshot = parse(BrowseSnapshotSchema, {
    format: "aria-yaml",
    kind: "full",
    revision,
    text: yaml,
    refs: refsOf(yaml),
  });
  if (!page.ok || !snapshot.ok) return err({ kind: "unrecognized" });
  return ok({ page: page.value, snapshot: snapshot.value });
}

function stepOf(captured: Captured): BrowserStep {
  return {
    page: captured.page,
    snapshot: captured.snapshot,
    navigations: [captured.page.url],
  };
}

/** `find`: 질의가 역할이나 이름에 든(대소문자 무시) ref의 줄만 남긴다 */
function linesOfMatches(snapshot: BrowseSnapshot, query: string): string {
  const needle = query.toLowerCase();
  const hits = new Set(
    snapshot.refs
      .filter(
        (entry) =>
          entry.role.toLowerCase().includes(needle) ||
          (entry.name ?? "").toLowerCase().includes(needle),
      )
      .map((entry) => entry.ref),
  );
  return snapshot.text
    .split("\n")
    .filter((line) => {
      const ref = REF_MARK.exec(line)?.[1];
      return ref !== undefined && hits.has(ref);
    })
    .join("\n");
}

async function pressTimes(
  port: BrowserMcpPort,
  key: string,
  times: number,
  signal: AbortSignal,
): Promise<void> {
  if (times <= 0) return;
  await callTool(port, "browser_press_key", { key }, signal);
  await pressTimes(port, key, times - 1, signal);
}

async function screenshotOf(
  port: BrowserMcpPort,
  signal: AbortSignal,
): Promise<Static<typeof ScreenshotSchema>> {
  const reply = await callTool(port, "browser_take_screenshot", {}, signal);
  const [image] = reply.images;
  if (image === undefined) {
    throw providerError("upstream_error", true, "playwright-mcp returned no screenshot.");
  }
  const shot = parse(ScreenshotSchema, {
    mediaType: image.mediaType,
    data: image.data,
    width: UNKNOWN_SIZE,
    height: UNKNOWN_SIZE,
  });
  if (!shot.ok) {
    throw providerError(
      "upstream_error",
      true,
      "playwright-mcp returned a screenshot that is not PNG or JPEG within the size limit.",
    );
  }
  return shot.value;
}

function manifestOf(): WebProviderManifest {
  return {
    name: PROVIDER_ID,
    displayName: "Playwright MCP",
    services: ["browse"],
    endpoints: [],
    auth: { kind: "none", secrets: [] },
    pricing: {
      asOf: "2026-10-29",
      sourceUrl: "https://github.com/microsoft/playwright-mcp",
      currency: "USD",
      units: {},
    },
    termsFlags: {
      cachePolicy: "none",
      mayTrainOn: false,
      redistribution: "unknown",
    },
    privacy: { zdr: "unknown", sendsTelemetry: false },
    limits: {},
  };
}

/**
 * Playwright MCP를 `web.browse` provider로 감싼다. 호출자가 `BrowseCandidate`로 등록할 때 origin을 정한다.
 * 한 번에 열린 세션은 하나다. 세션을 닫으면(`close`) 다음 `open`을 받는다.
 */
export function createMcpBrowseProvider(port: BrowserMcpPort): WebBrowseProvider {
  let liveSession: symbol | undefined;

  function openSession(token: symbol): BrowserSessionHandle {
    let closed = false;
    let revision = 0;
    let refs = new Map<string, RefEntry>();

    function assertOpen(): void {
      if (closed) {
        throw providerError(
          "not_found",
          false,
          "The playwright-mcp session is closed. Open a new one.",
        );
      }
    }

    function entryOf(ref: string): RefEntry {
      const entry = refs.get(ref);
      if (entry === undefined) {
        throw providerError("ref_invalid", false, `ref ${ref} is not in the last snapshot.`);
      }
      return entry;
    }

    /** 도구 응답에서 페이지 상태를 읽고 ref 표를 새로 만든다. 이 값이 이후 동작의 기준이다 */
    async function takeSnapshot(signal: AbortSignal): Promise<Captured> {
      const reply = await callTool(port, "browser_snapshot", {}, signal);
      const captured = captureOf(reply.text, revision + 1);
      if (!captured.ok) {
        throw providerError(
          "upstream_error",
          true,
          "playwright-mcp answered without a valid page state.",
        );
      }
      revision = captured.value.snapshot.revision;
      refs = new Map<string, RefEntry>(
        captured.value.snapshot.refs.map((entry): [string, RefEntry] => [entry.ref, entry]),
      );
      return captured.value;
    }

    /** ref가 가리키는 요소를 도구 인자로 쓸 때의 설명. 이름을 알면 `button "Pay now"`, 모르면 ref 자체다 */
    async function actOnRef(
      tool: string,
      ref: string | undefined,
      extra: ToolArgs,
      signal: AbortSignal,
    ): Promise<BrowserStep> {
      if (ref === undefined) throw invalidInput(`${tool} needs a ref target.`);
      const entry = entryOf(ref);
      const element = entry.name === undefined ? entry.ref : `${entry.role} "${entry.name}"`;
      await callTool(port, tool, { element, ref, ...extra }, signal);
      return stepOf(await takeSnapshot(signal));
    }

    return {
      async navigate(url, signal) {
        assertOpen();
        await callTool(port, "browser_navigate", { url }, signal);
        return stepOf(await takeSnapshot(signal));
      },

      async act(input, signal) {
        assertOpen();
        const target = input.target;
        if (target !== undefined && !("ref" in target)) {
          throw invalidInput(
            "playwright-mcp acts only on ref targets (for example e12), not coordinates.",
          );
        }
        const ref = target !== undefined && "ref" in target ? target.ref : undefined;
        switch (input.action) {
          case "navigate": {
            if (input.url === undefined) throw invalidInput("navigate needs a url.");
            await callTool(port, "browser_navigate", { url: input.url }, signal);
            return stepOf(await takeSnapshot(signal));
          }
          case "click":
            return actOnRef("browser_click", ref, {}, signal);
          case "type":
          case "fill": {
            if (input.text === undefined) throw invalidInput(`${input.action} needs text.`);
            return actOnRef("browser_type", ref, { text: input.text, submit: false }, signal);
          }
          case "hover":
            return actOnRef("browser_hover", ref, {}, signal);
          case "select": {
            if (input.values === undefined) throw invalidInput("select needs values.");
            return actOnRef("browser_select_option", ref, { values: input.values }, signal);
          }
          case "key": {
            if (input.key === undefined) throw invalidInput("key needs a key name.");
            await callTool(port, "browser_press_key", { key: input.key }, signal);
            return stepOf(await takeSnapshot(signal));
          }
          case "scroll": {
            const key = SCROLL_KEYS[input.direction ?? "down"];
            const presses = Math.min(input.amount ?? 1, MAX_SCROLL_PRESSES);
            await pressTimes(port, key, presses, signal);
            return stepOf(await takeSnapshot(signal));
          }
          case "wait": {
            const seconds = Math.max(1, Math.ceil((input.timeoutMs ?? DEFAULT_WAIT_MS) / 1000));
            await callTool(port, "browser_wait_for", { time: seconds }, signal);
            return stepOf(await takeSnapshot(signal));
          }
          case "back":
            await callTool(port, "browser_navigate_back", {}, signal);
            return stepOf(await takeSnapshot(signal));
          case "evaluate": {
            if (input.text === undefined) throw invalidInput("evaluate needs a script.");
            await callTool(port, "browser_evaluate", { function: input.text }, signal);
            return stepOf(await takeSnapshot(signal));
          }
          case "forward":
            throw providerError("unsupported", false, "playwright-mcp has no forward tool.");
          case "upload":
            throw providerError(
              "unsupported",
              false,
              "playwright-mcp does not support file upload.",
            );
          default:
            return assertNever(input.action, "playwright-mcp act");
        }
      },

      async read(request, signal) {
        assertOpen();
        const current = await takeSnapshot(signal);
        switch (request.mode) {
          case "snapshot":
            return { page: current.page, snapshot: current.snapshot };
          case "text":
            return { page: current.page, text: current.snapshot.text };
          case "find": {
            if (request.query === undefined) throw invalidInput("find needs a query.");
            return { page: current.page, text: linesOfMatches(current.snapshot, request.query) };
          }
          case "screenshot":
            return {
              page: current.page,
              screenshot: await screenshotOf(port, signal),
            };
          default:
            return assertNever(request.mode, "playwright-mcp read");
        }
      },

      describe(target) {
        // 실패는 거부로 돌려준다. 동기 throw를 쓰지 않으려고 executor 안에서 확인한다
        return new Promise<{ readonly role: string; readonly name?: string }>((resolve) => {
          assertOpen();
          const entry = entryOf(target.ref);
          resolve(
            entry.name === undefined
              ? { role: entry.role }
              : { role: entry.role, name: entry.name },
          );
        });
      },

      async close() {
        if (closed) return;
        closed = true;
        try {
          // 닫기 결과는 쓰지 않는다. 실패해도 슬롯은 비운다
          await port.callTool("browser_close", {}, neverAborted());
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
    open(options) {
      if (options.profile !== "ephemeral") {
        return Promise.reject(
          providerError("unsupported", false, "playwright-mcp runs only the ephemeral profile."),
        );
      }
      if (liveSession !== undefined) {
        return Promise.reject(
          providerError("unavailable", false, "playwright-mcp supports one session"),
        );
      }
      const token = Symbol("playwright-mcp session");
      liveSession = token;
      return Promise.resolve(openSession(token));
    },
  };
}
