import { describe, expect, test } from "bun:test";
import {
  hasWordCharacter,
  userWrittenText,
  withoutAttachmentTags,
} from "../../src/conversation/index.ts";

describe("userWrittenText", () => {
  test("기록된 모양(글 이음 + 뒤의 이미지)에서 이름 줄과 첨부 태그를 뺀다", () => {
    const content = [
      {
        type: "text",
        text: '이 이미지는 무슨 색이고, 파일은 무엇인지 한 문장으로.\nred.png\n<attachment name="calc.py">\ndef add(a, b):\n    return a + b\n</attachment>',
      },
      { type: "image" },
    ];
    expect(userWrittenText(content)).toBe("이 이미지는 무슨 색이고, 파일은 무엇인지 한 문장으로.");
  });

  test("턴 입력 모양(이미지 뒤 이름 파트)도 같다", () => {
    const content = [
      { type: "text", text: "설명해줘." },
      { type: "image" },
      { type: "text", text: "small.jpg" },
    ];
    expect(userWrittenText(content)).toBe("설명해줘.");
  });

  test("이미지가 없으면 .png로 끝나는 글도 남긴다", () => {
    expect(userWrittenText([{ type: "text", text: "logo.png" }])).toBe("logo.png");
  });

  test("닫는 태그 없는 첨부와 URL 첨부를 지운다", () => {
    expect(
      userWrittenText(
        '봐 줘\n<attachment name="big.bin" path="/a/big.bin"/>\n<attachment url="https://x.dev/a"/>',
      ),
    ).toBe("봐 줘");
  });

  test("첨부만 있으면 빈 글", () => {
    expect(userWrittenText([{ type: "image" }, { type: "text", text: "a.png" }])).toBe("");
  });

  test("withoutAttachmentTags는 태그 밖 글을 그대로 둔다", () => {
    expect(withoutAttachmentTags('a <attachment name="b">c</attachment> d')).toBe("a  d");
  });
});

describe("hasWordCharacter", () => {
  test("문장부호만 있으면 거짓", () => {
    expect([",", "…!", "  ", "가", "a1", "😀"].map(hasWordCharacter)).toEqual([
      false,
      false,
      false,
      true,
      true,
      true,
    ]);
  });
});
