import { describe, expect, test } from "bun:test";
import type { TargetEntry } from "@fresnel/client";
import { renderToString } from "react-dom/server";
import {
  connectionReducer,
  INITIAL_CONNECTION_STATE,
  type ConnectionAction,
  type ConnectionState,
} from "../../src/views/pages/connection/connection-model.ts";
import {
  ConnectionScreenView,
  type ConnectionScreenHandlers,
} from "../../src/views/pages/connection/connection-view.tsx";

// 연결 화면의 서버 렌더. 상태는 reducer로 만들고 동작 핸들러는 아무것도 하지 않는 것으로 둔다.
// 클릭과 키 입력은 DOM이 없어 시험하지 못한다(뜻은 connection-model.test.ts가 본다).

const NOOP = (): void => {};
const handlers: ConnectionScreenHandlers = {
  select: NOOP,
  query: NOOP,
  connect: NOOP,
  retry: NOOP,
  backToLocal: NOOP,
  remove: NOOP,
  openForm: NOOP,
  closeForm: NOOP,
  formField: NOOP,
  submitForm: NOOP,
  dismissNotice: NOOP,
  confirmStop: NOOP,
  restart: NOOP,
  setServiceMode: NOOP,
  setStopConfirm: NOOP,
  openExtensions: NOOP,
};

function stateAfter(...actions: readonly ConnectionAction[]): ConnectionState {
  return actions.reduce(connectionReducer, INITIAL_CONNECTION_STATE);
}

function html(state: ConnectionState): string {
  return renderToString(
    <ConnectionScreenView state={state} engine={null} locale="ko" handlers={handlers} />,
  );
}

function targets(count: number): TargetEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    label: `box-${i}`,
    address: `unix:/run/box${i}.sock`,
  }));
}

describe("connection screen server render", () => {
  test("an empty target list that has loaded says there are no remote targets and offers adding one", () => {
    const loaded = stateAfter({
      type: "targetsChanged",
      items: [],
      notice: null,
      added: null,
    });
    const markup = html(loaded);
    expect(markup).toContain("원격 대상이 없어요");
    expect(markup).toContain("원격 대상 추가");
    expect(markup).toContain("이 컴퓨터(앱 안)");
    expect(markup).not.toContain('type="search"');
    expect(markup).not.toContain("대상을 읽고 있어요");
  });

  test("a list that is still loading says so and does not claim the list is empty", () => {
    const markup = html(INITIAL_CONNECTION_STATE);
    expect(markup).toContain("대상을 읽고 있어요");
    expect(markup).not.toContain("원격 대상이 없어요");
  });

  test("past the threshold the list shows the search box", () => {
    const long = stateAfter({
      type: "targetsChanged",
      items: targets(21),
      notice: null,
      added: null,
    });
    expect(html(long)).toContain('type="search"');
    const short = stateAfter({
      type: "targetsChanged",
      items: targets(20),
      notice: null,
      added: null,
    });
    expect(html(short)).not.toContain('type="search"');
  });

  test("a non-loopback address in the add form shows the SSH tunnel or private network guidance", () => {
    const refused = stateAfter(
      { type: "targetsChanged", items: [], notice: null, added: null },
      { type: "formOpened" },
      { type: "formFailed", errors: { label: false, address: "non_loopback" } },
    );
    expect(html(refused)).toContain("SSH 터널이나 사설망을 써요");
  });
});
