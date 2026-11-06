import { expect, test } from "bun:test";
import { startWaitNotice } from "../src/render/wait-notice.ts";

function collect(): { written: string[]; write: (text: string) => Promise<void> } {
  const written: string[] = [];
  return {
    written,
    write: (text) => {
      written.push(text);
      return Promise.resolve();
    },
  };
}

const later = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("writes the notice once when nothing was printed before the deadline", async () => {
  const out = collect();
  startWaitNotice({
    afterMs: 10,
    hasOutput: () => false,
    write: out.write,
    text: "wait\n",
    onWriteFailure: () => {},
  });
  await later(40);
  expect(out.written).toEqual(["wait\n"]);
});

test("stays quiet when output had started or the turn ended first", async () => {
  const out = collect();
  startWaitNotice({
    afterMs: 10,
    hasOutput: () => true,
    write: out.write,
    text: "wait\n",
    onWriteFailure: () => {},
  });
  const stopped = startWaitNotice({
    afterMs: 10,
    hasOutput: () => false,
    write: out.write,
    text: "wait\n",
    onWriteFailure: () => {},
  });
  stopped.stop();
  await later(40);
  expect(out.written).toEqual([]);
});
