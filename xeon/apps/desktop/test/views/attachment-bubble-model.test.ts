import { expect, test } from "bun:test";
import { bubbleOf } from "../../src/views/attachment-bubble-model.ts";

test("a text attachment tag becomes a file chip and the body stays out of the bubble", () => {
  const view = bubbleOf([
    { type: "text", text: "요약해줘" },
    { type: "text", text: '<attachment name="att.txt" path="/w/att.txt">\nhello\n</attachment>' },
  ]);
  expect(view.text).toBe("요약해줘");
  expect(view.attachments).toEqual([{ kind: "file", name: "att.txt", detail: "/w/att.txt" }]);
});

test("a self-closing tag with only a path is named by the last path segment", () => {
  const view = bubbleOf([{ type: "text", text: '<attachment path="/w/dir/big.bin"/>' }]);
  expect(view.text).toBe("");
  expect(view.attachments).toEqual([{ kind: "file", name: "big.bin", detail: "/w/dir/big.bin" }]);
});

test("an image part with real bytes becomes a thumbnail named by the text after it", () => {
  const view = bubbleOf([
    { type: "text", text: "이게 뭐야" },
    { type: "image", data: "QUJD", mimeType: "image/png" },
    { type: "text", text: "red.png" },
  ]);
  expect(view.text).toBe("이게 뭐야");
  expect(view.attachments).toEqual([
    { kind: "image", name: "red.png", src: "data:image/png;base64,QUJD" },
  ]);
});

test("an image with only the host blob placeholder has no thumbnail source", () => {
  const view = bubbleOf([
    { type: "image", data: "blob:sha256:abc", mimeType: "image/jpeg" },
    { type: "text", text: "a.jpg" },
  ]);
  expect(view).toEqual({ text: "", attachments: [{ kind: "image", name: "a.jpg", src: null }] });
});

test("plain string content has no attachments", () => {
  expect(bubbleOf("안녕")).toEqual({ text: "안녕", attachments: [] });
});
