import { expect, test } from "bun:test";
import { imageThumbOf, rememberUploadedImage } from "../../src/views/image-thumbs.ts";

test("an uploaded image data source is remembered under the host blob placeholder", () => {
  rememberUploadedImage({ kind: "data", data: "QUJD", mime: "image/png" }, [
    { type: "image", data: "blob:sha256:t1" },
    { type: "text" },
  ]);
  expect(imageThumbOf("blob:sha256:t1")).toBe("data:image/png;base64,QUJD");
});

test("path sources and non-image data are not remembered", () => {
  rememberUploadedImage({ kind: "path" }, [{ type: "image", data: "blob:sha256:t2" }]);
  rememberUploadedImage({ kind: "data", data: "eA==", mime: "text/plain" }, [
    { type: "image", data: "blob:sha256:t3" },
  ]);
  expect([imageThumbOf("blob:sha256:t2"), imageThumbOf("blob:sha256:t3")]).toEqual([null, null]);
});
