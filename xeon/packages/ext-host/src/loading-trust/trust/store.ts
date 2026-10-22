// Forked from earendil-works/pi packages/coding-agent/src/core/trust-manager.ts
// at cdaf6c227d4718a72b59ccd02152c9614df44cfc (pi 1.1.0). MIT License, Copyright (c) 2025 Mario Zechner. See LICENSE.pi.
// Changes: see docs/xeon/X/loading-trust/spec.md §4.7.1 and PATCHES.md.
import { dirname } from "node:path";
import { attemptAsync, err, ok, parse, parseJson, type Result } from "@xeon/contracts";
import type {
  TrustChoice,
  TrustOption,
  TrustStoreBackend,
  TrustUpdate,
} from "@xeon/contracts/extensions";
import { Type, type Static } from "typebox";

// XEON-PATCH: verdict-type
/** 결정 3값. `undecided`는 저장하지 않는다(X.loading-trust.spec §4.7.3) */
export type TrustVerdict = "allow" | "deny" | "undecided";

// XEON-PATCH: trust-file-schema
/** 저장 파일 형식. pi trust.json(`Record<path, boolean | null>`)에 버전과 출처를 더했다 */
const TrustFileSchema = Type.Object({
  version: Type.Literal(1),
  entries: Type.Record(
    Type.String({ minLength: 1, maxLength: 4096 }),
    Type.Object({
      verdict: Type.Union([Type.Literal("allow"), Type.Literal("deny")]),
      /** ISO 8601 */
      decidedAt: Type.String(),
      via: Type.Union([Type.Literal("prompt"), Type.Literal("point"), Type.Literal("command")]),
    }),
  ),
});
type TrustFile = Static<typeof TrustFileSchema>;

type TrustEntries = TrustFile["entries"];

export type TrustLookup =
  | { readonly kind: "found"; readonly verdict: "allow" | "deny"; readonly path: string }
  | { readonly kind: "none" }
  | { readonly kind: "corrupt"; readonly reason: string };

// XEON-PATCH: store-errors
/**
 * `setMany`의 실패. 손상된 파일에는 쓰지 않아 기존 결정을 잃지 않는다(`corrupt`).
 * 백엔드 쓰기 실패는 `io`다. pi는 두 경우 모두 던졌다
 */
export type TrustStoreError =
  | { readonly kind: "corrupt"; readonly reason: string }
  | { readonly kind: "io"; readonly cause: unknown };

/** `backend.update`의 콜백 안에서 손상을 알리는 값. 콜백은 값을 돌려줘야 해서 던지고 `setMany`가 `corrupt`로 바꾼다 */
class CorruptDuringUpdate extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`trust store is corrupt: ${reason}`);
    this.reason = reason;
  }
}

const BOM = "﻿";

// XEON-PATCH: strip-bom-local
function stripBom(text: string): string {
  return text.startsWith(BOM) ? text.slice(1) : text;
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 저장 파일 본문을 읽는다. 파일이 없으면 빈 항목이다. pi 형식(버전 없는 `Record<path, boolean | null>`)은
 * 손상으로 보지 않고 같은 의미로 변환한다(`allow`/`deny`, `null`은 건너뜀)
 */
// XEON-PATCH: corrupt-as-value
function readEntries(text: string | null, migratedAt: string): Result<TrustEntries, string> {
  if (text === null) return ok({});
  const json = parseJson(stripBom(text));
  if (!json.ok) return err("not valid JSON");
  const parsed = json.value;
  if (!isPlainObject(parsed)) return err("expected an object");
  if (!("version" in parsed)) return readPiFormat(parsed, migratedAt);
  const checked = parse(TrustFileSchema, parsed);
  if (!checked.ok) {
    const first = checked.error.issues[0];
    return err(first === undefined ? "schema mismatch" : `${first.path} ${first.message}`);
  }
  return ok(checked.value.entries);
}

// XEON-PATCH: pi-v0-format
function readPiFormat(
  data: Readonly<Record<string, unknown>>,
  migratedAt: string,
): Result<TrustEntries, string> {
  const entries: Record<string, TrustEntries[string]> = {};
  for (const [path, value] of Object.entries(data)) {
    if (value === null) continue;
    if (value !== true && value !== false) {
      return err(`value for ${JSON.stringify(path)} must be true, false, or null`);
    }
    entries[path] = {
      verdict: value ? "allow" : "deny",
      decidedAt: migratedAt,
      via: "prompt",
    };
  }
  return ok(entries);
}

/** 키를 사전순으로 정렬해 쓴다(pi `writeTrustFile` 규칙 유지) */
function serialize(entries: ReadonlyMap<string, TrustEntries[string]>): string {
  const sorted = Object.fromEntries(
    [...entries].toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  return `${JSON.stringify({ version: 1, entries: sorted }, null, 2)}\n`;
}

export class ProjectTrustStore {
  readonly #backend: TrustStoreBackend;
  readonly #normalize: (path: string) => Promise<string>;
  readonly #clock: { now(): number };

  // XEON-PATCH: injected-normalize
  /** normalize는 심볼릭 링크를 푼 정규 경로를 돌려준다(`LoaderFs.realpath` 기반). 클록은 `decidedAt`에 쓴다 */
  constructor(
    backend: TrustStoreBackend,
    normalize: (path: string) => Promise<string>,
    clock: { now(): number },
  ) {
    this.#backend = backend;
    this.#normalize = normalize;
    this.#clock = clock;
  }

  /** 저장소 키로 쓰는 정규 경로 */
  canonical(path: string): Promise<string> {
    return this.#normalize(path);
  }

  // XEON-PATCH: async-backend
  /** cwd에서 위로 올라가며 가장 가까운 항목을 찾는다(pi `findNearestTrustEntry`) */
  async lookup(cwd: string): Promise<TrustLookup> {
    const read = await this.#backend.read();
    if (!read.ok) return { kind: "corrupt", reason: read.reason };
    const entries = readEntries(read.text, new Date(this.#clock.now()).toISOString());
    if (!entries.ok) return { kind: "corrupt", reason: entries.error };
    let current = await this.#normalize(cwd);
    for (;;) {
      const entry = entries.value[current];
      if (entry !== undefined) return { kind: "found", verdict: entry.verdict, path: current };
      const parent = dirname(current);
      if (parent === current) return { kind: "none" };
      current = parent;
    }
  }

  /**
   * 갱신을 하나의 읽기-수정-쓰기로 적용한다. 잠금과 원자 교체는 백엔드가 맡는다(pi `proper-lockfile` 삭제).
   * 파일이 손상이면 쓰지 않고 `corrupt`를 돌려준다
   */
  // XEON-PATCH: no-lockfile
  async setMany(updates: readonly TrustUpdate[]): Promise<Result<void, TrustStoreError>> {
    // 경로 정규화는 잠금 밖에서 먼저 한다(비동기 포트이고 잠금 안 콜백은 동기 함수여야 한다)
    const normalized = await Promise.all(
      updates.map(async (update) => ({ path: await this.#normalize(update.path), update })),
    );
    const decidedAt = new Date(this.#clock.now()).toISOString();
    const outcome = await attemptAsync(() =>
      this.#backend.update((current) => {
        const entries = readEntries(current, decidedAt);
        if (!entries.ok) throw new CorruptDuringUpdate(entries.error);
        const next = new Map(Object.entries(entries.value));
        for (const { path, update } of normalized) {
          if (update.verdict === null) {
            next.delete(path);
          } else {
            next.set(path, { verdict: update.verdict, decidedAt, via: update.via });
          }
        }
        return serialize(next);
      }),
    );
    if (outcome.ok) return ok(undefined);
    const cause = outcome.error.cause;
    if (cause instanceof CorruptDuringUpdate) return err({ kind: "corrupt", reason: cause.reason });
    return err({ kind: "io", cause });
  }
}

const folder = (verdict: "allow" | "deny"): TrustChoice => ({ kind: "folder", verdict });
const session = (verdict: "allow" | "deny"): TrustChoice => ({ kind: "session", verdict });

// XEON-PATCH: options-localized
/**
 * pi `getProjectTrustOptions` 포크. 선택지 다섯 개와 저장할 갱신을 돌려준다(X.loading-trust.spec §4.7.3 표).
 * `label`은 표시 문구가 아니라 L4가 현지화할 식별자다. 상위 폴더(`parent`)가 없으면 그 선택지를 뺀다.
 * 세션 선택지는 저장하지 않는다(`updates` 비어 있음, 호출자가 `sessionMemory`에 둔다)
 */
export function trustOptions(projectRoot: string, parent: string | null): readonly TrustOption[] {
  const options: TrustOption[] = [
    {
      choice: folder("allow"),
      label: "trust-folder",
      updates: [{ path: projectRoot, verdict: "allow", via: "prompt" }],
      savedPath: projectRoot,
    },
  ];
  if (parent !== null) {
    options.push({
      choice: { kind: "parent", verdict: "allow" },
      label: "trust-parent",
      updates: [
        { path: parent, verdict: "allow", via: "prompt" },
        { path: projectRoot, verdict: null, via: "prompt" },
      ],
      savedPath: parent,
    });
  }
  options.push(
    { choice: session("allow"), label: "trust-session", updates: [], savedPath: null },
    {
      choice: folder("deny"),
      label: "deny-folder",
      updates: [{ path: projectRoot, verdict: "deny", via: "prompt" }],
      savedPath: projectRoot,
    },
    { choice: session("deny"), label: "deny-session", updates: [], savedPath: null },
  );
  return options;
}
