import { Bug } from "@xeon/contracts";
import { stat } from "node:fs/promises";

/** JSON Lines 한 줄을 객체로 읽는다. 객체가 아니면 테스트 픽스처 오류(Bug) */
export function parseLine(line: string): Record<string, unknown> {
  const value: unknown = JSON.parse(line);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Bug("log line is not a JSON object", { cause: line });
  }
  const record: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) record[key] = entry;
  return record;
}

export function eventOf(line: string): string {
  const event = parseLine(line)["event"];
  return typeof event === "string" ? event : "";
}

/** 경로가 있으면 true */
export async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}
