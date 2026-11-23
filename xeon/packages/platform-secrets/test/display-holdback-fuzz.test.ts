import { describe, expect, test } from "bun:test";
import type { MaskRange } from "@fresnel/contracts/conversation";
import { createRedactor } from "../src/redactor.ts";
import { fakeValue, seededRandom } from "./support/random.ts";

// maskFix (AGE-75). 무작위로 이어 붙인 글에서 두 가지를 본다(시드 고정).
// 1) 전체 글의 가림 위치를 기준으로, 모든 앞부분에서 보이는 글에 가림 위치 4개가 이어지지 않는다.
// 2) 심어 둔 시크릿 자리는 화면 가림 구간이 모두 덮고 mask()도 지운다.
// 값은 전부 지어낸 것이다.

const RUN = 4;
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const PRIV = ["PRI", "VATE"].join("");

function secretOf(random: () => number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) out += UPPER[Math.floor(random() * UPPER.length)] ?? "A";
  return out;
}

interface Piece {
  readonly text: string;
  readonly secretAt: number;
  readonly secret: string;
}

/** 시크릿이 박힌 조각 하나. secretAt은 조각 안의 시작 자리 */
function pieceFor(kind: number, secret: string): Piece {
  const shapes: readonly (readonly [string, string])[] = [
    ["token=qrstuvwx&Authorization: Bearer ", ""],
    ["token=qrstuvwx;Authorization: Bearer ", " rest"],
    ["Authorization: Bearer ", ""],
    ["password=", "&x=1"],
    [String.raw`{\"api_key\": \"`, String.raw`\", \"n\": 1}`],
    [String.raw`{\\\"api_key\\\": \\\"`, String.raw`\\\", \\\"n\\\": 1}`],
    ['{"client_secret": "', '", "n": 1}'],
    ["postgres://app:", "@db.internal/main"],
    ["sk-", ""],
    ["ghp_", ""],
    [`-----BEGIN RSA ${PRIV} KEY-----\n`, `\n-----END RSA ${PRIV} KEY-----`],
    ["-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\ntoken=", ""],
    ["-----BEGIN rsa key----- note ", ""],
  ];
  const shape = shapes[kind % shapes.length];
  const [lead, tail] = shape ?? ["", ""];
  const body = lead.startsWith("sk-") || lead.startsWith("ghp_") ? secret.padEnd(40, "Q") : secret;
  const real = lead.startsWith("ghp_") ? body.slice(0, 36) : body;
  return { text: `${lead}${real}${tail}`, secretAt: lead.length, secret: real };
}

function maskedPositions(ranges: readonly MaskRange[], length: number): boolean[] {
  const covered = Array.from({ length }, () => false);
  for (const range of ranges) {
    for (let i = range.start; i < range.end && i < length; i += 1) covered[i] = true;
  }
  return covered;
}

describe("holdback: random compositions against the final mask", () => {
  test("no run of masked positions shows at any prefix, and planted secrets are covered", () => {
    const random = seededRandom(7101);
    for (let round = 0; round < 80; round += 1) {
      const redactor = createRedactor();
      let text = "";
      const planted: { start: number; secret: string }[] = [];
      const count = 1 + Math.floor(random() * 3);
      for (let i = 0; i < count; i += 1) {
        const secret = secretOf(random, 16 + Math.floor(random() * 12));
        const piece = pieceFor(Math.floor(random() * 13), secret);
        text += fakeValue(random, Math.floor(random() * 12), false) + (random() < 0.5 ? " " : "\n");
        planted.push({ start: text.length + piece.secretAt, secret: piece.secret });
        text += piece.text;
      }

      const fullRanges = redactor.displayRanges(text);
      const masked = maskedPositions(fullRanges, text.length);
      // 2) 심어 둔 시크릿은 모두 가림 구간 안이고 mask()가 지운다. 개인 키 모양은 끝 줄이 있을 때만 가려진다
      const finalText = redactor.mask(text).text;
      for (const { start, secret } of planted) {
        for (let i = start; i < start + secret.length; i += 1) {
          expect(masked[i]).toBe(true);
        }
        expect(finalText.includes(secret.slice(0, RUN * 2))).toBe(false);
      }

      // 1) 모든 앞부분
      for (let n = 0; n <= text.length; n += 1) {
        const prefix = text.slice(0, n);
        const cut = redactor.displayVisibleLength(prefix);
        expect(cut).toBeGreaterThanOrEqual(0);
        expect(cut).toBeLessThanOrEqual(n);
        const shownRanges = redactor.displayRanges(prefix.slice(0, cut));
        const hidden = maskedPositions(shownRanges, cut);
        let run = 0;
        for (let i = 0; i < cut; i += 1) {
          run = masked[i] === true && !hidden[i] ? run + 1 : 0;
          if (run >= RUN) {
            throw new Error(
              `round ${String(round)} n=${String(n)}: ${String(RUN)} masked positions show`,
            );
          }
        }
      }
    }
  });
});
