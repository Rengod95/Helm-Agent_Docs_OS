import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { EngineScreen } from "../../../src/views/workbench/engine-screen.tsx";
import { inContexts, screenStore } from "./support.tsx";

describe("엔진 화면", () => {
  test("연결 상태와 세 단추를 보인다", () => {
    const html = renderToString(inContexts(<EngineScreen />, screenStore()));
    expect(html).toContain("연결 상태");
    for (const text of ["다시 연결", "엔진 다시 시작", "진단 복사"]) expect(html).toContain(text);
  });
});
