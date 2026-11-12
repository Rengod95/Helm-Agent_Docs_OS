import { createHash } from "node:crypto";
import { createConnection } from "node:net";
import {
  wireError,
  type SecretListEntry,
  type SecretReferencesResult,
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

export interface FakeSecretStore {
  readonly handlers: FakeHandlers;
  /** 이름 → 저장된 값 바이트(시험이 검사하는 용도) */
  readonly stored: Map<string, Uint8Array>;
  /** 호스트가 source.read()로 받은 배열의 참조. CLI가 쓴 뒤 0으로 덮었는지 본다 */
  readonly received: Uint8Array[];
  readonly metaCalls: Record<string, unknown>[];
  readonly beginEntryCalls: Record<string, unknown>[];
  /** secret.references가 받은 이름 */
  readonly referenceCalls: string[];
}

/** 시험이 넣는 실패. `refuseChannel`이면 로컬 채널을 쓰는 요청을 `secret.localOnly`로 거절한다 */
export interface FakeSecretFailures {
  readonly remove?: Error;
  readonly refuseChannel?: boolean;
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
    handlers: {
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
        // 호스트는 값을 자기 쪽에 복사해 둔다. CLI 쪽 배열은 CLI가 덮는다
        stored.set(name, value.slice());
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
