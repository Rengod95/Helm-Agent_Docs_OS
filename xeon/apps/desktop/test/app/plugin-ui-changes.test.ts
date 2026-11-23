import { describe, expect, test } from "bun:test";
import type { HostConnection } from "@fresnel/contracts/wire";
import { subscribePluginUiChanges } from "../../src/app/commands.ts";
import type { Session } from "../../src/app/session.ts";
import { fakeConnection } from "../state/fake-connection.ts";

// 확장 바뀜 알림(`ext.ui.changed`)이 재연결 뒤에도 화면에 닿는지 본다. 연결 두 개(낡은 것과 새 것)를 번갈아 붙여,
// 낡은 연결의 알림은 닿지 않고 새 연결의 알림은 닿는 것을 값으로 본다.

/** 세션 대역: 지금 연결을 바꿀 수 있고, 연결이 열릴 때 부르는 listener를 기억한다 */
function fakeSession(first: HostConnection | null): {
  readonly session: Pick<Session, "connection" | "onConnection">;
  open(connection: HostConnection): void;
  readonly listening: () => number;
} {
  let current = first;
  const listeners = new Set<(connection: HostConnection) => void>();
  return {
    session: {
      connection: () => current,
      onConnection(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    open(connection) {
      current = connection;
      for (const listener of listeners) listener(connection);
    },
    listening: () => listeners.size,
  };
}

describe("the plugin UI change subscription follows the connection across a reconnect", () => {
  test("a reconnect calls the listener once with null, and only the new connection's notifications reach it", () => {
    const first = fakeConnection({});
    const second = fakeConnection({});
    const sess = fakeSession(first.connection);
    const seen: (string | null)[] = [];
    const stop = subscribePluginUiChanges(sess.session, (extension) => {
      seen.push(extension);
    });
    first.emit("ext.ui.changed", { extension: "kanban" });
    expect(seen).toEqual(["kanban"]);

    sess.open(second.connection);
    expect(seen).toEqual(["kanban", null]);

    first.emit("ext.ui.changed", { extension: "notes" });
    second.emit("ext.ui.changed", { extension: "kanban" });
    expect(seen).toEqual(["kanban", null, "kanban"]);

    stop();
    expect(sess.listening()).toBe(0);
    second.emit("ext.ui.changed", { extension: "kanban" });
    expect(seen).toEqual(["kanban", null, "kanban"]);
  });

  test("without a connection at subscribe time, the first opening calls the listener with null", () => {
    const conn = fakeConnection({});
    const sess = fakeSession(null);
    const seen: (string | null)[] = [];
    const stop = subscribePluginUiChanges(sess.session, (extension) => {
      seen.push(extension);
    });
    expect(seen).toEqual([]);

    sess.open(conn.connection);
    expect(seen).toEqual([null]);
    conn.emit("ext.ui.changed", { extension: "kanban" });
    expect(seen).toEqual([null, "kanban"]);

    stop();
    expect(sess.listening()).toBe(0);
  });
});
