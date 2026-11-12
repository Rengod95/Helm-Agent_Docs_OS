import { describe, expect, test } from "bun:test";
import {
  groupToolCalls,
  previewOf,
  summarizeToolArgs,
  toolCategoryOf,
} from "../../src/state/engine/tool-summary.ts";

describe("summarizeToolArgs: 도구별 입력 → 요약", () => {
  test("bash: 명령과 초 단위 timeout. timeout이 없으면 null", () => {
    expect(summarizeToolArgs("bash", { command: "bun test", timeout: 30 })).toEqual({
      kind: "command",
      command: "bun test",
      timeoutSec: 30,
    });
    expect(summarizeToolArgs("bash", { command: "ls" })).toEqual({
      kind: "command",
      command: "ls",
      timeoutSec: null,
    });
  });

  test("read: 경로와 범위. offset이나 limit이 하나라도 있으면 범위가 있다", () => {
    expect(summarizeToolArgs("read", { path: "a.ts" })).toEqual({
      kind: "read",
      path: "a.ts",
      range: null,
    });
    expect(summarizeToolArgs("read", { path: "a.ts", offset: 10 })).toEqual({
      kind: "read",
      path: "a.ts",
      range: { offset: 10, limit: null },
    });
    expect(summarizeToolArgs("read", { path: "a.ts", offset: 1, limit: 50 })).toEqual({
      kind: "read",
      path: "a.ts",
      range: { offset: 1, limit: 50 },
    });
  });

  test("write, edit: 경로만 본다. edit의 편집 목록은 요약에 없다", () => {
    expect(summarizeToolArgs("write", { path: "out.md", content: "본문" })).toEqual({
      kind: "write",
      path: "out.md",
    });
    expect(
      summarizeToolArgs("edit", {
        path: "src/x.ts",
        edits: [{ oldText: "a", newText: "b" }],
      }),
    ).toEqual({ kind: "edit", path: "src/x.ts" });
  });

  test("ls: 경로가 없으면 null이다", () => {
    expect(summarizeToolArgs("ls", {})).toEqual({ kind: "list", path: null });
    expect(summarizeToolArgs("ls", { path: "src" })).toEqual({ kind: "list", path: "src" });
  });

  test("grep, find, knowledge_search: 찾기 대상과 질의를 나눈다", () => {
    expect(summarizeToolArgs("grep", { pattern: "foo", path: "src", glob: "*.ts" })).toEqual({
      kind: "search",
      target: "content",
      pattern: "foo",
      path: "src",
      glob: "*.ts",
    });
    expect(summarizeToolArgs("grep", { pattern: "bar" })).toEqual({
      kind: "search",
      target: "content",
      pattern: "bar",
      path: null,
      glob: null,
    });
    expect(summarizeToolArgs("find", { pattern: "**/*.spec.ts", limit: 5 })).toEqual({
      kind: "search",
      target: "files",
      pattern: "**/*.spec.ts",
      path: null,
      glob: null,
    });
    expect(summarizeToolArgs("knowledge_search", { query: "캐우스틱", limit: 3 })).toEqual({
      kind: "search",
      target: "knowledge",
      pattern: "캐우스틱",
      path: null,
      glob: null,
    });
  });

  test("task_write: ops를 순서대로 항목으로 바꾼다. 없는 값은 null", () => {
    expect(
      summarizeToolArgs("task_write", {
        ops: [
          {
            op: "create",
            ref: "a",
            content: "설계 쓰기",
            activeForm: "설계 쓰는 중",
            status: "in_progress",
          },
          { op: "create", content: "시험 쓰기" },
          { op: "update", id: "@a", status: "completed" },
          { op: "update", id: "t_2", content: "시험 고치기", owner: null },
          { op: "link", id: "@b", blockedBy: ["@a"] },
          { op: "unlink", id: "@b", blockedBy: ["@a"] },
        ],
      }),
    ).toEqual({
      kind: "tasks",
      items: [
        { op: "create", ref: "a", content: "설계 쓰기", status: "in_progress" },
        { op: "create", ref: null, content: "시험 쓰기", status: null },
        { op: "update", ref: "@a", content: null, status: "completed" },
        { op: "update", ref: "t_2", content: "시험 고치기", status: null },
        { op: "link", ref: "@b", content: null, status: null },
        { op: "unlink", ref: "@b", content: null, status: null },
      ],
    });
  });

  test("memory_manage: 한 건(add, replace, remove)과 batch", () => {
    expect(
      summarizeToolArgs("memory_manage", { store: "user", action: "add", text: "정은 강릉 출신" }),
    ).toEqual({
      kind: "memory",
      op: "add",
      store: "user",
      entryId: null,
      text: "정은 강릉 출신",
      ops: [],
    });
    expect(
      summarizeToolArgs("memory_manage", {
        store: "env",
        action: "replace",
        entryId: "m_3",
        text: "빌드는 bun",
        baseHash: "0".repeat(64),
      }),
    ).toEqual({
      kind: "memory",
      op: "replace",
      store: "env",
      entryId: "m_3",
      text: "빌드는 bun",
      ops: [],
    });
    expect(
      summarizeToolArgs("memory_manage", { store: "env", action: "remove", entryId: "m_4" }),
    ).toEqual({
      kind: "memory",
      op: "remove",
      store: "env",
      entryId: "m_4",
      text: null,
      ops: [],
    });
    expect(
      summarizeToolArgs("memory_manage", {
        store: "user",
        action: "batch",
        ops: [
          { action: "remove", entryId: "m_1" },
          { action: "add", text: "새 항목" },
        ],
      }),
    ).toEqual({
      kind: "memory",
      op: "batch",
      store: "user",
      entryId: null,
      text: null,
      ops: [
        { action: "remove", entryId: "m_1", text: null },
        { action: "add", entryId: null, text: "새 항목" },
      ],
    });
  });

  test("web_*: 질의와 주소를 나눈다. 없는 값은 null이나 빈 배열", () => {
    expect(summarizeToolArgs("web_search", { query: "bun 1.2 changelog", limit: 5 })).toEqual({
      kind: "web",
      op: "search",
      query: "bun 1.2 changelog",
      urls: [],
    });
    expect(summarizeToolArgs("web_fetch", { url: "https://example.com/a" })).toEqual({
      kind: "web",
      op: "fetch",
      query: null,
      urls: ["https://example.com/a"],
    });
    expect(summarizeToolArgs("web_fetch", { urls: ["https://a.test", "https://b.test"] })).toEqual({
      kind: "web",
      op: "fetch",
      query: null,
      urls: ["https://a.test", "https://b.test"],
    });
    expect(
      summarizeToolArgs("web_research", {
        question: "Bun의 테스트 러너 차이",
        seedUrls: ["https://bun.sh/docs"],
      }),
    ).toEqual({
      kind: "web",
      op: "research",
      query: "Bun의 테스트 러너 차이",
      urls: ["https://bun.sh/docs"],
    });
    expect(summarizeToolArgs("web_research", { question: "질문만" })).toEqual({
      kind: "web",
      op: "research",
      query: "질문만",
      urls: [],
    });
    expect(summarizeToolArgs("web_browse_open", { url: "https://example.com" })).toEqual({
      kind: "web",
      op: "browse_open",
      query: null,
      urls: ["https://example.com"],
    });
    expect(summarizeToolArgs("web_browse_open", {})).toEqual({
      kind: "web",
      op: "browse_open",
      query: null,
      urls: [],
    });
    expect(summarizeToolArgs("web_browse_act", { sessionId: "s1", action: "click" })).toEqual({
      kind: "web",
      op: "browse_act",
      query: null,
      urls: [],
    });
    expect(
      summarizeToolArgs("web_browse_read", { sessionId: "s1", mode: "find", query: "로그인" }),
    ).toEqual({
      kind: "web",
      op: "browse_read",
      query: "로그인",
      urls: [],
    });
    expect(summarizeToolArgs("web_browse_close", { sessionId: "s1" })).toEqual({
      kind: "web",
      op: "browse_close",
      query: null,
      urls: [],
    });
  });

  test("agent: 정의 이름과 맡긴 일(task). background가 없으면 false", () => {
    expect(summarizeToolArgs("agent", { agent: "explore", task: "모듈 구조를 찾는다" })).toEqual({
      kind: "agent",
      agent: "explore",
      task: "모듈 구조를 찾는다",
      background: false,
    });
    expect(
      summarizeToolArgs("agent", { agent: "review", task: "변경 검토", background: true }),
    ).toEqual({
      kind: "agent",
      agent: "review",
      task: "변경 검토",
      background: true,
    });
  });

  test("표에 없는 도구는 generic이고 인자 JSON을 그대로 준다", () => {
    expect(summarizeToolArgs("render_chart", { name: "pdf" })).toEqual({
      kind: "generic",
      text: '{"name":"pdf"}',
    });
    expect(summarizeToolArgs("ask_user", {})).toEqual({ kind: "generic", text: "{}" });
  });

  test("skill_view는 스킬 이름(지원 파일이면 이름/파일)을 읽는 경로다", () => {
    expect(summarizeToolArgs("skill_view", { name: "pdf" })).toEqual({
      kind: "read",
      path: "pdf",
      range: null,
    });
    expect(summarizeToolArgs("skill_view", { name: "pdf", file: "ref/forms.md" })).toEqual({
      kind: "read",
      path: "pdf/ref/forms.md",
      range: null,
    });
  });

  test("generic 글은 400글자 이내로 줄이고 끝에 …을 붙인다", () => {
    const summary = summarizeToolArgs("skill_view", { text: "a".repeat(500) });
    // `{"text":"` 아홉 글자 뒤 a 390개로 400글자, 끝의 …까지 합쳐 400글자다
    expect(summary).toEqual({ kind: "generic", text: `{"text":"${"a".repeat(390)}…` });
  });
});

describe("summarizeToolArgs: 모양이 틀리면 generic", () => {
  test("객체가 아닌 인자는 generic이다(null, 문자열, 배열, 숫자)", () => {
    expect(summarizeToolArgs("bash", null)).toEqual({ kind: "generic", text: "null" });
    expect(summarizeToolArgs("bash", "ls")).toEqual({ kind: "generic", text: '"ls"' });
    expect(summarizeToolArgs("bash", ["bun test"])).toEqual({
      kind: "generic",
      text: '["bun test"]',
    });
    expect(summarizeToolArgs("read", 7)).toEqual({ kind: "generic", text: "7" });
    expect(summarizeToolArgs("bash", undefined)).toEqual({ kind: "generic", text: "" });
  });

  test("필수 필드가 없거나 타입이 틀린 인자는 generic이다", () => {
    expect(summarizeToolArgs("bash", { command: 3 })).toEqual({
      kind: "generic",
      text: '{"command":3}',
    });
    expect(summarizeToolArgs("bash", { command: "x", timeout: "30" })).toEqual({
      kind: "generic",
      text: '{"command":"x","timeout":"30"}',
    });
    expect(summarizeToolArgs("read", { offset: 1 })).toEqual({
      kind: "generic",
      text: '{"offset":1}',
    });
    expect(summarizeToolArgs("read", { path: "a.ts", offset: null })).toEqual({
      kind: "generic",
      text: '{"path":"a.ts","offset":null}',
    });
    expect(summarizeToolArgs("read", { path: "a.ts", limit: 1.5 })).toEqual({
      kind: "generic",
      text: '{"path":"a.ts","limit":1.5}',
    });
    expect(summarizeToolArgs("write", { path: 1 })).toEqual({
      kind: "generic",
      text: '{"path":1}',
    });
    expect(summarizeToolArgs("ls", { path: ["a"] })).toEqual({
      kind: "generic",
      text: '{"path":["a"]}',
    });
    expect(summarizeToolArgs("grep", { pattern: "x", glob: 5 })).toEqual({
      kind: "generic",
      text: '{"pattern":"x","glob":5}',
    });
  });

  test("task_write: ops가 배열이 아니거나 항목 하나라도 틀리면 generic이다", () => {
    const cases: unknown[] = [
      { ops: "create" },
      { ops: [{ op: "create" }] },
      { ops: [{ op: "update", id: "@a", status: "done" }] },
      { ops: [{ op: "bogus", content: "x" }] },
      { ops: [null] },
      { ops: [{ op: "link", id: "@a", blockedBy: "@b" }] },
      { ops: [{ op: "create", content: "정상" }, { op: "update" }] },
    ];
    for (const args of cases) {
      expect(summarizeToolArgs("task_write", args)).toEqual({
        kind: "generic",
        text: JSON.stringify(args),
      });
    }
  });

  test("memory_manage: 저장소, 동작, batch 항목을 확인한다", () => {
    expect(summarizeToolArgs("memory_manage", { store: "team", action: "add", text: "x" })).toEqual(
      {
        kind: "generic",
        text: '{"store":"team","action":"add","text":"x"}',
      },
    );
    expect(summarizeToolArgs("memory_manage", { store: "user", action: "upsert" })).toEqual({
      kind: "generic",
      text: '{"store":"user","action":"upsert"}',
    });
    expect(summarizeToolArgs("memory_manage", { store: "user", action: "batch" })).toEqual({
      kind: "generic",
      text: '{"store":"user","action":"batch"}',
    });
    expect(
      summarizeToolArgs("memory_manage", {
        store: "user",
        action: "batch",
        ops: [{ action: "add", text: 5 }],
      }),
    ).toEqual({
      kind: "generic",
      text: '{"store":"user","action":"batch","ops":[{"action":"add","text":5}]}',
    });
  });

  test("web_*: 필수 질의나 세션 id가 없으면 generic이다", () => {
    expect(summarizeToolArgs("web_search", { query: 5 })).toEqual({
      kind: "generic",
      text: '{"query":5}',
    });
    expect(summarizeToolArgs("web_fetch", {})).toEqual({ kind: "generic", text: "{}" });
    expect(summarizeToolArgs("web_fetch", { urls: "https://a.test" })).toEqual({
      kind: "generic",
      text: '{"urls":"https://a.test"}',
    });
    expect(summarizeToolArgs("web_browse_act", { action: "click" })).toEqual({
      kind: "generic",
      text: '{"action":"click"}',
    });
    expect(summarizeToolArgs("web_browse_read", { sessionId: "s1", query: 3 })).toEqual({
      kind: "generic",
      text: '{"sessionId":"s1","query":3}',
    });
  });

  test("agent: 맡긴 일이 없거나 background가 불리언이 아니면 generic이다", () => {
    expect(summarizeToolArgs("agent", { agent: "explore" })).toEqual({
      kind: "generic",
      text: '{"agent":"explore"}',
    });
    expect(summarizeToolArgs("agent", { agent: "explore", task: "x", background: "yes" })).toEqual({
      kind: "generic",
      text: '{"agent":"explore","task":"x","background":"yes"}',
    });
  });

  test("상속된 이름(constructor, __proto__)은 표에 없는 도구다", () => {
    expect(summarizeToolArgs("constructor", { a: 1 })).toEqual({
      kind: "generic",
      text: '{"a":1}',
    });
    expect(summarizeToolArgs("__proto__", {})).toEqual({ kind: "generic", text: "{}" });
    expect(toolCategoryOf("constructor")).toBe("other");
    expect(toolCategoryOf("__proto__")).toBe("other");
  });
});

describe("summarizeToolArgs: MCP 이름", () => {
  test("서버 이름을 넘기면 mcp 요약이다. 도구 이름은 광고된 그대로다", () => {
    expect(summarizeToolArgs("search_issues", { q: "x" }, "linear")).toEqual({
      kind: "mcp",
      server: "linear",
      tool: "search_issues",
      args: '{"q":"x"}',
    });
  });

  test("서버 이름이 없거나 빈 문자열이면 MCP가 아니다", () => {
    expect(summarizeToolArgs("search_issues", { q: "x" }, null)).toEqual({
      kind: "generic",
      text: '{"q":"x"}',
    });
    expect(summarizeToolArgs("search_issues", { q: "x" }, "")).toEqual({
      kind: "generic",
      text: '{"q":"x"}',
    });
  });

  test("mcp__서버__도구 모양의 이름은 분해하지 않는다(권한 규칙 키이지 기계 이름이 아니다)", () => {
    expect(summarizeToolArgs("mcp__linear__search_issues", { q: "x" })).toEqual({
      kind: "generic",
      text: '{"q":"x"}',
    });
    expect(toolCategoryOf("mcp__linear__search_issues")).toBe("other");
  });
});

describe("toolCategoryOf", () => {
  test("도구 이름마다 범주가 정해져 있다", () => {
    expect(
      [
        "read",
        "skill_view",
        "session_read",
        "session_scroll",
        "ls",
        "grep",
        "find",
        "knowledge_search",
        "bash",
        "edit",
        "write",
        "web_search",
        "web_fetch",
        "web_research",
        "web_browse_open",
        "web_browse_act",
        "web_browse_read",
        "web_browse_close",
        "agent",
        "task_write",
        "memory_manage",
        "skill_manage",
        "mcp_servers",
        "mcp_list_resources",
        "mcp_read_resource",
        "ask_user",
        "search_issues",
      ].map((name) => [name, toolCategoryOf(name)]),
    ).toEqual([
      ["read", "read"],
      ["skill_view", "read"],
      ["session_read", "read"],
      ["session_scroll", "read"],
      ["ls", "search"],
      ["grep", "search"],
      ["find", "search"],
      ["knowledge_search", "search"],
      ["bash", "command"],
      ["edit", "edit"],
      ["write", "write"],
      ["web_search", "web"],
      ["web_fetch", "web"],
      ["web_research", "web"],
      ["web_browse_open", "web"],
      ["web_browse_act", "web"],
      ["web_browse_read", "web"],
      ["web_browse_close", "web"],
      ["agent", "agent"],
      ["task_write", "tasks"],
      ["memory_manage", "memory"],
      ["skill_manage", "memory"],
      ["mcp_servers", "mcp"],
      ["mcp_list_resources", "mcp"],
      ["mcp_read_resource", "mcp"],
      ["ask_user", "other"],
      ["search_issues", "other"],
    ]);
  });
});

describe("previewOf", () => {
  test("max글자 이하면 그대로, 넘으면 max글자 이내로 자르고 …을 붙인다", () => {
    expect(previewOf("abc", 3)).toBe("abc");
    expect(previewOf("abcd", 3)).toBe("ab…");
    expect(previewOf("abcd", 1)).toBe("…");
    expect(previewOf("abcd", 0)).toBe("");
    expect(previewOf("", 0)).toBe("");
  });

  test("글자는 코드 포인트 단위다. 이모지가 둘로 갈리지 않는다", () => {
    expect(previewOf("😀😀😀", 2)).toBe("😀…");
    expect(previewOf("가나다", 3)).toBe("가나다");
    expect(previewOf("가나다라", 3)).toBe("가나…");
  });
});

describe("groupToolCalls", () => {
  test("파일 읽기 6번과 명령 2번: 처음 나온 순서대로 세고 읽기의 고유 경로를 센다", () => {
    expect(
      groupToolCalls([
        { toolName: "read", args: { path: "a.ts" } },
        { toolName: "read", args: { path: "b.ts" } },
        { toolName: "read", args: { path: "a.ts" } },
        { toolName: "bash", args: { command: "bun test" } },
        { toolName: "read", args: { path: "c.ts", offset: 1, limit: 10 } },
        { toolName: "read", args: { path: "d.ts" } },
        { toolName: "read", args: { path: "b.ts" } },
        { toolName: "bash", args: { command: "just check" } },
      ]),
    ).toEqual({
      counts: [
        { category: "read", count: 6, distinct: 4 },
        { category: "command", count: 2, distinct: null },
      ],
      total: 8,
    });
  });

  test("처음 나온 순서가 범주 순서를 정한다", () => {
    expect(
      groupToolCalls([
        { toolName: "bash", args: { command: "ls" } },
        { toolName: "read", args: { path: "a.ts" } },
        { toolName: "grep", args: { pattern: "x" } },
        { toolName: "bash", args: { command: "pwd" } },
      ]),
    ).toEqual({
      counts: [
        { category: "command", count: 2, distinct: null },
        { category: "read", count: 1, distinct: 1 },
        { category: "search", count: 1, distinct: null },
      ],
      total: 4,
    });
  });

  test("쓰기와 편집은 범주마다 고유 경로를 센다", () => {
    expect(
      groupToolCalls([
        { toolName: "write", args: { path: "a.ts", content: "" } },
        { toolName: "edit", args: { path: "a.ts" } },
        { toolName: "edit", args: { path: "b.ts" } },
        { toolName: "edit", args: { path: "a.ts" } },
        { toolName: "write", args: { path: "c.ts", content: "" } },
      ]),
    ).toEqual({
      counts: [
        { category: "write", count: 2, distinct: 2 },
        { category: "edit", count: 3, distinct: 2 },
      ],
      total: 5,
    });
  });

  test("path가 없거나 모양이 틀린 호출은 개수에 들지만 고유 경로에는 들지 않는다", () => {
    expect(
      groupToolCalls([
        { toolName: "read", args: { path: "a.ts" } },
        { toolName: "read", args: {} },
        { toolName: "read", args: null },
        { toolName: "read", args: { path: "a.ts" } },
      ]),
    ).toEqual({
      counts: [{ category: "read", count: 4, distinct: 1 }],
      total: 4,
    });
    expect(groupToolCalls([{ toolName: "read", args: {} }])).toEqual({
      counts: [{ category: "read", count: 1, distinct: 0 }],
      total: 1,
    });
  });

  test("MCP 서버를 넘긴 호출은 mcp로 세고, 이름만 있는 MCP 도구는 other다", () => {
    expect(
      groupToolCalls([
        { toolName: "search_issues", args: { q: "x" }, mcpServer: "linear" },
        { toolName: "search_issues", args: { q: "y" }, mcpServer: "linear" },
        { toolName: "mcp_servers", args: {} },
        { toolName: "search_issues", args: {}, mcpServer: null },
      ]),
    ).toEqual({
      counts: [
        { category: "mcp", count: 3, distinct: null },
        { category: "other", count: 1, distinct: null },
      ],
      total: 4,
    });
  });

  test("웹, 하위 에이전트, 작업 목록, 기억은 개수만 센다", () => {
    expect(
      groupToolCalls([
        { toolName: "web_search", args: { query: "a" } },
        { toolName: "web_fetch", args: { url: "https://a.test" } },
        { toolName: "agent", args: { agent: "explore", task: "x" } },
        { toolName: "task_write", args: { ops: [{ op: "create", content: "x" }] } },
        { toolName: "memory_manage", args: { store: "user", action: "add", text: "x" } },
        { toolName: "web_fetch", args: { url: "https://a.test" } },
      ]),
    ).toEqual({
      counts: [
        { category: "web", count: 3, distinct: null },
        { category: "agent", count: 1, distinct: null },
        { category: "tasks", count: 1, distinct: null },
        { category: "memory", count: 1, distinct: null },
      ],
      total: 6,
    });
  });

  test("호출이 없으면 빈 묶음이다", () => {
    expect(groupToolCalls([])).toEqual({ counts: [], total: 0 });
  });
});
