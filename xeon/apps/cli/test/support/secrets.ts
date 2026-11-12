import { createHash } from "node:crypto";
import { createConnection } from "node:net";
import {
  wireError,
  type SecretListEntry,
  type SecretReferencesResult,
  type WireError,
} from "@fresnel/contracts/wire";
import { secretName } from "./ids.ts";
import type { FakeHandlers } from "./fake-server.ts";
import type { Harness } from "./harness.ts";

// 가짜 시크릿 관리 처리기. 맡긴 값 입력·열람 수단(Harness.outOfBand)을 호스트처럼 꺼내 쓴다.
// `channel`이 있으면 호스트가 CLI의 로컬 채널에 실제 소켓으로 연결해 값을 읽거나 쓴다(서비스 접속 흉내).
// 값은 이 파일 안의 stored에만 둔다. 와이어 응답에는 싣지 않는다.

/** 채널에 연결해 EOF까지 읽는다. 연결이 실패하거나 0바이트면 undefined다(호스트의 input_empty·input_cancelled와 같다) */
function readFromChannel(path: string): Promise<Uint8Array | undefined> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const socket = createConnection(path);
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.on("end", () => {
      const joined = Buffer.concat(chunks);
      resolve(joined.length === 0 ? undefined : new Uint8Array(joined));
    });
    socket.on("error", () => resolve(undefined));
  });
}

/** 채널에 값을 쓰고 닫는다(열람). 쓰지 못하면 거짓이다 */
function writeToChannel(path: string, bytes: Uint8Array): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(path);
    socket.on("error", () => resolve(false));
    socket.on("finish", () => resolve(true));
    socket.end(bytes);
  });
}

/** 열쇠 보관 상태의 가짜(`secret.keyStatus`). identity는 없다 */
interface FakeKeyState {
  source: "auto" | "auto-file" | "keychain" | "file";
  in: "none" | "keychain" | "file";
  filePath: string;
  keychainUsable: boolean;
  fallbackUnconfirmed: boolean;
  fileMissing: boolean;
}

export interface FakeSecretStore {
  readonly handlers: FakeHandlers;
  /** 이름 → 저장된 값 바이트(시험이 검사하는 용도) */
  readonly stored: Map<string, Uint8Array>;
  /** 호스트가 source.read()로 받은 배열의 참조. 호스트가 쓴 뒤 0으로 덮었는지 본다 */
  readonly received: Uint8Array[];
  readonly metaCalls: Record<string, unknown>[];
  readonly beginEntryCalls: Record<string, unknown>[];
  /** secret.references가 받은 이름 */
  readonly referenceCalls: string[];
  /** 지금 열쇠 보관 상태. `secret.keyMove`가 바꾼다 */
  readonly keyState: FakeKeyState;
  /** `secret.keyMove`가 받은 목표 쪽 */
  readonly keyMoves: string[];
}

/** 시험이 넣는 실패. `refuseChannel`이면 로컬 채널을 쓰는 요청을 `secret.localOnly`로 거절한다 */
export interface FakeSecretFailures {
  readonly remove?: Error;
  readonly refuseChannel?: boolean;
  /** `secret.beginEntry`가 값을 받기 전에 돌려줄 wire 오류(종류 코드 시험). 값은 읽지 않는다 */
  readonly beginEntry?: WireError;
  /**
   * `auto`가 OS 키 저장소를 쓸 수 없어 앱 파일로 떨어졌고 사람이 확인하지 않은 상태다. 호스트처럼 값을 먼저 읽고(`source.read()`)
   * 그 뒤 `fallback_unconfirmed`로 실패한다. `secret.keyMove`로 앱 파일을 고르면 풀린다
   */
  readonly fallbackUnconfirmed?: boolean;
  /** `secret.keyMove`가 옛 쪽을 지우지 못했다고 답한다(`oldRemoved: false`) */
  readonly keyOldKept?: boolean;
  /** `secret.keyMove`를 원격 접속처럼 `secret.localOnly`로 거절한다 */
  readonly keyMoveRefused?: boolean;
}

export function fakeSecrets(
  harness: () => Harness,
  initial: readonly SecretListEntry[] = [],
  failures: FakeSecretFailures = {},
  references: Readonly<Record<string, SecretReferencesResult>> = {},
): FakeSecretStore {
  const entries = new Map<string, SecretListEntry>(initial.map((entry) => [entry.name, entry]));
  const stored = new Map<string, Uint8Array>();
  const received: Uint8Array[] = [];
  const metaCalls: Record<string, unknown>[] = [];
  const beginEntryCalls: Record<string, unknown>[] = [];
  const referenceCalls: string[] = [];
  const keyState: FakeKeyState = {
    source: "auto",
    in: "none",
    filePath: "/cfg/secrets/age/keys.txt",
    keychainUsable: failures.fallbackUnconfirmed !== true,
    fallbackUnconfirmed: failures.fallbackUnconfirmed === true,
    fileMissing: false,
  };
  const keyMoves: string[] = [];
  const entryOf = (name: unknown): SecretListEntry => {
    const found = typeof name === "string" ? entries.get(name) : undefined;
    if (found === undefined) {
      throw wireError("internal", {
        details: { secret: { kind: "secret_missing", where: "meta" } },
      });
    }
    return found;
  };
  return {
    stored,
    received,
    metaCalls,
    beginEntryCalls,
    referenceCalls,
    keyState,
    keyMoves,
    handlers: {
      "secret.keyStatus": () => ({ ...keyState }),
      "secret.keyMove": (params) => {
        if (failures.keyMoveRefused === true) {
          throw wireError("secret.localOnly", { message: "keyMove: refused" });
        }
        const target = params["to"] === "keychain" ? "keychain" : "file";
        keyMoves.push(target);
        // 옮길 열쇠가 없거나 이미 그 쪽에 있으면 옮기지 않고 설정만 바꾼다(L0.secrets.spec §4.7 (b))
        const moved = keyState.in !== "none" && keyState.in !== target;
        if (moved) keyState.in = target;
        keyState.source = target;
        keyState.fallbackUnconfirmed = false;
        return {
          moved,
          created: moved,
          oldRemoved: failures.keyOldKept !== true,
          source: target,
        };
      },
      "secret.list": (params) => ({
        secrets: Array.from(entries.values()).map((entry) =>
          params["meta"] === true ? entry : { name: entry.name, status: entry.status },
        ),
      }),
      "secret.meta": (params) => {
        metaCalls.push({ ...params });
        const current = entryOf(params["name"]);
        return { secret: current };
      },
      "secret.remove": (params) => {
        if (failures.remove !== undefined) throw failures.remove;
        const existed = entries.delete(String(params["name"]));
        return { removed: existed };
      },
      "secret.references": (params) => {
        const name = String(params["name"]);
        referenceCalls.push(name);
        return references[name] ?? { settingKeys: [], activeLeases: 0, sessions: [] };
      },
      "secret.test": (params) => {
        const name = String(params["name"]);
        const registered = entries.has(name);
        const value = stored.get(name);
        // 값이 있으면 길이와 SHA-256 앞 8자만 알린다. 값 자체는 어디에도 싣지 않는다
        return {
          state: registered ? "registered" : "missing",
          decryptable: registered,
          length: registered && value !== undefined ? value.length : null,
          sha256Prefix:
            registered && value !== undefined
              ? createHash("sha256").update(value).digest("hex").slice(0, 8)
              : null,
        };
      },
      "secret.beginEntry": async (params) => {
        beginEntryCalls.push({ ...params });
        if (failures.beginEntry !== undefined) throw failures.beginEntry;
        const name = String(params["name"]);
        const action = String(params["action"]);
        const { outOfBand } = harness();
        const offer = outOfBand.entries.find((o) => o.name === name && o.action === action);
        let value: Uint8Array | undefined;
        if (offer !== undefined) {
          const read = await offer.source.read();
          if (!read.ok) return { started: false };
          received.push(read.value);
          value = read.value;
        } else if (typeof params["channel"] === "string") {
          if (failures.refuseChannel === true) {
            throw wireError("secret.localOnly", { message: "beginEntry: refused" });
          }
          value = await readFromChannel(params["channel"]);
          if (value === undefined) return { started: false };
          received.push(value);
        } else {
          return { started: false };
        }
        // 값을 읽은 뒤 쓰기 전에 열쇠를 찾는다. 앱 파일 폴백을 사람이 확인하지 않았으면 값을 덮고 그 오류로 실패한다
        if (keyState.fallbackUnconfirmed) {
          value.fill(0);
          throw wireError("secret.keyUnavailable", {
            message: "beginEntry: key_unavailable",
            details: { key: "file", reason: "fallback_unconfirmed" },
          });
        }
        // 호스트는 값을 자기 쪽에 복사해 두고, 쓴 뒤 자기 사본을 덮는다. CLI 쪽 배열은 CLI가 덮는다
        stored.set(name, value.slice());
        value.fill(0);
        if (!entries.has(name)) {
          entries.set(name, {
            name: secretName(name),
            status: "valid",
            meta: {
              name: secretName(name),
              desc: "새 시크릿",
              provider: "sops",
              ref: `dev/${name.toUpperCase()}`,
              scope: "user",
              expiresAt: null,
              use: { modes: ["runtime-http"], tools: [], hosts: [] },
              approval: "none",
              ttlSeconds: 300,
              maxUses: 10,
            },
          });
        }
        return { started: true };
      },
      "secret.beginReveal": async (params) => {
        const { outOfBand, clock } = harness();
        const value = stored.get(String(params["name"]));
        if (typeof params["channel"] === "string") {
          if (failures.refuseChannel === true) {
            throw wireError("secret.localOnly", { message: "beginReveal: refused" });
          }
          // 사람 확인 표시가 없으면 열지 않는다(호스트의 reauth 규칙)
          if (params["reauth"] !== "tty-confirm" || value === undefined) return { started: false };
          return { started: await writeToChannel(params["channel"], value) };
        }
        const offer = outOfBand.reveals.find((o) => o.name === params["name"]);
        if (offer === undefined || value === undefined) return { started: false };
        if (clock.now() - offer.reauth.verifiedAt > 60_000) return { started: false };
        const bytes = value.slice();
        await offer.show({ bytes, text: () => new TextDecoder().decode(bytes) });
        bytes.fill(0);
        return { started: true };
      },
    },
  };
}
