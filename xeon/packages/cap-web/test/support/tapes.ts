import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  readHostedSearchTape,
  tapeHostedSearch,
  type FakeHostedSearch,
} from "../../src/testing/fake-hosted-search.ts";

/** `test/fixtures/tapes/<이름>.json`을 읽어 재생 포트를 만든다. 파일이 틀리면 시험이 바로 실패한다 */
export function hostedTape(name: string): FakeHostedSearch {
  const text = readFileSync(
    join(import.meta.dir, "..", "fixtures", "tapes", `${name}.json`),
    "utf8",
  );
  const tape = readHostedSearchTape(text);
  if (!tape.ok) throw new Error(`tape ${name} is invalid: ${tape.error.kind}`);
  return tapeHostedSearch(tape.value);
}
