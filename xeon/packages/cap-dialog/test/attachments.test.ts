import { describe, expect, test } from "bun:test";
import { CapabilityError } from "@xeon/contracts/capabilities";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { ScopeStack } from "@xeon/contracts/settings";
import { createAttachmentsApi } from "../src/attachments/service.ts";
import type { AttachmentFiles } from "../src/ports/files.ts";
import { callOptions, harness, newThread } from "./support/harness.ts";
import { fakeImages, memoryBlobs, pngBytes, toBase64 } from "./support/images.ts";

async function rejection(promise: Promise<unknown>): Promise<CapabilityError> {
  try {
    await promise;
  } catch (caught) {
    if (caught instanceof CapabilityError) return caught;
    throw caught;
  }
  throw new Error("expected a CapabilityError");
}

function setup(options: { images?: boolean; layers?: ScopeStack } = {}) {
  const blobs = memoryBlobs();
  const images = fakeImages(blobs);
  const h = harness({
    blobs,
    images: options.images === false ? undefined : images,
    ...(options.layers === undefined ? {} : { layers: options.layers }),
  });
  return { h, blobs, images, api: createAttachmentsApi(h.deps) };
}

const LIMIT = (bytes: number) => ({
  layers: [
    { scope: "user" as const, values: new Map([["l2.dialog.attachments.maxBytes", bytes]]) },
  ],
});

describe("첨부 한도", () => {
  test("maxBytes를 넘으면 attachment_too_large다(경로, 붙여넣기)", async () => {
    const { h, api, blobs } = setup(LIMIT(1024));
    h.files.put("/home/a.bin", new Uint8Array(2000));
    const path = await rejection(api.add({ source: { kind: "path", path: "/home/a.bin" } }));
    expect(path.data).toMatchObject({
      code: "attachment_too_large",
      detail: { size: 2000, limit: 1024 },
    });
    const data = await rejection(
      api.add({
        source: {
          kind: "data",
          data: toBase64(new Uint8Array(2000)),
          mime: "application/octet-stream",
        },
      }),
    );
    expect(data.data.code).toBe("attachment_too_large");
    expect(blobs.puts).toBe(0);
  });

  test("이미지가 처리기 한도를 넘으면 attachment_too_large이고 한도를 알린다", async () => {
    const { h, api, images } = setup();
    h.files.put("/home/big.png", pngBytes(4, 3, 200));
    images.failWith = { code: "image_too_large", detail: { maxBytes: 4096 } };
    const error = await rejection(api.add({ source: { kind: "path", path: "/home/big.png" } }));
    expect(error.data).toMatchObject({
      code: "attachment_too_large",
      detail: { size: 200, limit: 4096 },
    });
  });
});

describe("이미지 첨부", () => {
  test("이미지는 workspace.images를 거쳐 ImageContent와 이름 텍스트가 된다", async () => {
    const { h, api, images, blobs } = setup();
    const bytes = pngBytes(4, 3, 64);
    h.files.put("/home/user/shots/a.png", bytes);
    const { attachment, parts } = await api.add(
      { source: { kind: "path", path: "/home/user/shots/a.png" } },
      callOptions(newThread()),
    );
    expect(images.calls).toHaveLength(1);
    expect(images.calls[0]).toMatchObject({
      mimeType: "image/png",
      source: { kind: "file", name: "a.png" },
    });
    const sha = [...blobs.stored.keys()][0] ?? "";
    expect(attachment).toEqual({
      kind: "image",
      name: "a.png",
      mime: "image/png",
      size: 64,
      blob: { type: "blob", sha256: sha, size: 64, mediaType: "image/png" },
      path: "/home/user/shots/a.png",
      url: null,
      image: { width: 4, height: 3, resized: false },
    });
    expect(parts).toEqual([
      { type: "image", data: `blob:sha256:${sha}`, mimeType: "image/png" },
      { type: "text", text: "a.png" },
    ]);
  });

  test("붙여넣은 이미지는 paste 원천으로 등록하고 리사이즈 여부를 싣는다", async () => {
    const { api, images } = setup();
    images.resized = true;
    const { attachment } = await api.add({
      source: { kind: "data", data: toBase64(pngBytes()), mime: "image/png", name: "clip.png" },
    });
    expect(images.calls[0]?.source).toEqual({ kind: "paste", name: "clip.png" });
    expect(attachment).toMatchObject({
      kind: "image",
      name: "clip.png",
      path: null,
      image: { width: 4, height: 3, resized: true },
    });
  });

  test("workspace.images가 없거나 unavailable이면 원본을 그대로 등록하고 크기는 모른다", async () => {
    const absent = setup({ images: false });
    const bytes = pngBytes(4, 3, 64);
    const { attachment } = await absent.api.add({
      source: { kind: "data", data: toBase64(bytes), mime: "image/png", name: "p.png" },
    });
    expect(attachment).toMatchObject({ kind: "image", blob: { size: 64 }, image: null });
    expect(absent.blobs.puts).toBe(1);

    const down = setup();
    down.images.failWith = { code: "unavailable" };
    const { attachment: second } = await down.api.add({
      source: { kind: "data", data: toBase64(bytes), mime: "image/png", name: "p.png" },
    });
    expect(second).toMatchObject({ kind: "image", image: null });
    expect(down.h.lines.map((line) => line.event)).toContain("dialog.images_unavailable");
  });

  test("지원하지 않는 이미지 형식은 attachment_type_unsupported다", async () => {
    const { h, api, images } = setup();
    h.files.put("/home/old.bmp", new Uint8Array(64));
    images.failWith = { code: "image_unsupported" };
    const error = await rejection(api.add({ source: { kind: "path", path: "/home/old.bmp" } }));
    expect(error.data.code).toBe("attachment_type_unsupported");
  });

  test("이미지가 아닌데 이미지 확장자인 파일은 처리기가 거부한다", async () => {
    const { h, api, images } = setup();
    h.files.put("/home/fake.png", new TextEncoder().encode("not an image"));
    images.failWith = { code: "image_decode_failed" };
    const error = await rejection(api.add({ source: { kind: "path", path: "/home/fake.png" } }));
    expect(error.data.code).toBe("attachment_type_unsupported");
  });

  test("그 밖의 이미지 오류는 그대로 올린다", async () => {
    const { h, api, images } = setup();
    h.files.put("/home/a.png", pngBytes());
    images.failWith = { code: "internal" };
    const error = await rejection(api.add({ source: { kind: "path", path: "/home/a.png" } }));
    expect(error.data.code).toBe("internal");
  });
});

describe("텍스트와 바이너리 첨부", () => {
  test("텍스트 파일은 blob으로 저장하고 본문째 텍스트 파트가 된다", async () => {
    const { h, api, blobs } = setup();
    h.files.put("/home/notes.md", "안녕\n세계");
    const { attachment, parts } = await api.add({
      source: { kind: "path", path: "/home/notes.md" },
    });
    expect(attachment).toMatchObject({
      kind: "text",
      name: "notes.md",
      mime: "text/plain",
      path: "/home/notes.md",
      image: null,
    });
    expect(attachment.blob?.mediaType).toBe("text/plain");
    expect(parts).toEqual([
      {
        type: "text",
        text: '<attachment name="notes.md" path="/home/notes.md">\n안녕\n세계\n</attachment>',
      },
    ]);
    expect(blobs.puts).toBe(1);
  });

  test("256 KiB를 넘는 텍스트와 바이너리는 저장하지 않고 경로만 알린다", async () => {
    const { h, api, blobs } = setup();
    h.files.put("/home/big.txt", "x".repeat(256 * 1024 + 1));
    h.files.put("/home/data.bin", new Uint8Array([1, 2, 0, 3]));
    const paths = ["/home/big.txt", "/home/data.bin"];
    const added = await Promise.all(
      paths.map((path) => api.add({ source: { kind: "path", path } })),
    );
    for (const [index, { attachment, parts }] of added.entries()) {
      const path = paths[index] ?? "";
      expect(attachment).toMatchObject({ kind: "file", blob: null, path, image: null });
      expect(parts).toEqual([
        { type: "text", text: `<attachment name="${path.split("/").at(-1)}" path="${path}"/>` },
      ]);
    }
    expect(blobs.puts).toBe(0);
  });

  test("정확히 256 KiB인 텍스트는 본문째 넣는다", async () => {
    const { h, api } = setup();
    h.files.put("/home/edge.txt", "y".repeat(256 * 1024));
    const { attachment } = await api.add({ source: { kind: "path", path: "/home/edge.txt" } });
    expect(attachment.kind).toBe("text");
  });

  test("붙여넣은 텍스트는 받고 이미지도 텍스트도 아닌 데이터는 받지 않는다", async () => {
    const { api, blobs } = setup();
    const text = await api.add({
      source: {
        kind: "data",
        data: toBase64(new TextEncoder().encode("hi")),
        mime: "text/plain",
        name: "t.txt",
      },
    });
    expect(text.attachment).toMatchObject({ kind: "text", path: null });
    expect(text.parts[0]).toEqual({
      type: "text",
      text: '<attachment name="t.txt">\nhi\n</attachment>',
    });
    const binary = await rejection(
      api.add({
        source: {
          kind: "data",
          data: toBase64(new Uint8Array([0, 1, 2])),
          mime: "application/zip",
          name: "z.zip",
        },
      }),
    );
    expect(binary.data.code).toBe("attachment_type_unsupported");
    expect(blobs.puts).toBe(1);
  });

  test("붙여넣기 데이터가 base64가 아니면 attachment_type_unsupported다", async () => {
    const { api } = setup();
    const error = await rejection(
      api.add({ source: { kind: "data", data: "***", mime: "image/png" } }),
    );
    expect(error.data.code).toBe("attachment_type_unsupported");
  });

  test("속성 값의 따옴표와 줄바꿈은 걷는다", async () => {
    const { h, api } = setup();
    h.files.put('/home/we"ird.txt', "z");
    const { parts } = await api.add({ source: { kind: "path", path: '/home/we"ird.txt' } });
    expect(parts[0]).toMatchObject({ text: expect.stringContaining('name="we ird.txt"') });
  });
});

describe("URL과 경로 오류", () => {
  test("URL은 가져오지 않고 참조만 남긴다", async () => {
    const { h, api, blobs, images } = setup();
    const { attachment, parts } = await api.add({
      source: { kind: "url", url: "https://example.com/docs/guide.html?x=1" },
    });
    expect(attachment).toEqual({
      kind: "url",
      name: "guide.html",
      mime: null,
      size: null,
      blob: null,
      path: null,
      url: "https://example.com/docs/guide.html?x=1",
      image: null,
    });
    expect(parts).toEqual([
      { type: "text", text: '<attachment url="https://example.com/docs/guide.html?x=1"/>' },
    ]);
    expect(blobs.puts).toBe(0);
    expect(images.calls).toHaveLength(0);
    expect(h.files).toBeDefined();
  });

  test("호스트만 있는 URL의 이름은 호스트다", async () => {
    const { api } = setup();
    const { attachment } = await api.add({ source: { kind: "url", url: "https://example.com/" } });
    expect(attachment.name).toBe("example.com");
  });

  test("경로가 없으면 not_found, 권한이 없으면 denied, 디렉터리면 invalid_input이다", async () => {
    const { h, api } = setup();
    h.files.put("/home/denied/x.txt", "x");
    h.files.mkdir("/home/dir");
    expect(
      (await rejection(api.add({ source: { kind: "path", path: "/home/none.txt" } }))).data.code,
    ).toBe("not_found");
    expect(
      (await rejection(api.add({ source: { kind: "path", path: "/home/denied/x.txt" } }))).data
        .code,
    ).toBe("denied");
    expect(
      (await rejection(api.add({ source: { kind: "path", path: "/home/dir" } }))).data.code,
    ).toBe("invalid_input");
  });

  test("blob 저장소가 없으면 저장이 필요한 첨부는 unavailable이다", async () => {
    const h = harness({ blobs: null });
    const api = createAttachmentsApi(h.deps);
    h.files.put("/home/n.txt", "text");
    const error = await rejection(api.add({ source: { kind: "path", path: "/home/n.txt" } }));
    expect(error.data).toMatchObject({
      code: "unavailable",
      detail: { reason: "blob_store_missing" },
    });
  });

  test("blob 저장이 실패하면 unavailable이고 디스크 부족은 재시도할 수 있다", async () => {
    const { h, api, blobs } = setup();
    h.files.put("/home/n.txt", "text");
    blobs.fail = { kind: "disk_full" };
    const error = await rejection(api.add({ source: { kind: "path", path: "/home/n.txt" } }));
    expect(error.data).toMatchObject({ code: "unavailable", retryable: true });
  });
});

/** 작업 폴더를 정해 준 조립. 원천 파일 포트가 실제로 읽은 경로를 `read`에 남긴다 */
function withRoot(root: string | null) {
  const asked: (ThreadId | undefined)[] = [];
  const h = harness({
    blobs: memoryBlobs(),
    projectRoot: (threadId) => {
      asked.push(threadId);
      return root;
    },
  });
  const read: string[] = [];
  const files: AttachmentFiles = {
    fileInfo: (path, context) => {
      read.push(path);
      return h.files.fileInfo(path, context);
    },
    readBinaryFile: (path, context) => {
      read.push(path);
      return h.files.readBinaryFile(path, context);
    },
  };
  return { asked, read, h, api: createAttachmentsApi({ ...h.deps, files }) };
}

describe("상대 경로는 thread의 작업 폴더 기준이다", () => {
  const ROOT = "/home/user/proj";

  test("상대 경로는 thread의 작업 폴더에 이어 붙여 읽고, 이름과 경로도 해석한 값이다", async () => {
    const { asked, read, api, h } = withRoot(ROOT);
    const thread = newThread();
    h.files.put(`${ROOT}/notes/a.md`, "안녕");
    const { attachment, parts } = await api.add(
      { source: { kind: "path", path: "notes/a.md" } },
      callOptions(thread),
    );
    expect(asked).toEqual([thread]);
    expect(read).toEqual([`${ROOT}/notes/a.md`, `${ROOT}/notes/a.md`]);
    expect(attachment).toMatchObject({ kind: "text", name: "a.md", path: `${ROOT}/notes/a.md` });
    expect(parts).toEqual([
      {
        type: "text",
        text: `<attachment name="a.md" path="${ROOT}/notes/a.md">\n안녕\n</attachment>`,
      },
    ]);
  });

  test("절대 경로는 작업 폴더와 무관하게 그대로 읽는다", async () => {
    const { read, api, h } = withRoot(ROOT);
    h.files.put("/srv/data/b.md", "b");
    const { attachment } = await api.add(
      { source: { kind: "path", path: "/srv/data/b.md" } },
      callOptions(newThread()),
    );
    expect(read).toEqual(["/srv/data/b.md", "/srv/data/b.md"]);
    expect(attachment.path).toBe("/srv/data/b.md");
  });

  test("threadId가 없으면 상대 경로를 그대로 넘긴다", async () => {
    const { read, api, h } = withRoot(ROOT);
    h.files.put("notes/c.md", "c");
    await api.add({ source: { kind: "path", path: "notes/c.md" } });
    expect(read).toEqual(["notes/c.md", "notes/c.md"]);
  });

  test("작업 폴더가 없으면(null) 상대 경로를 그대로 넘긴다", async () => {
    const { read, api, h } = withRoot(null);
    h.files.put("notes/d.md", "d");
    await api.add({ source: { kind: "path", path: "notes/d.md" } }, callOptions(newThread()));
    expect(read).toEqual(["notes/d.md", "notes/d.md"]);
  });

  test("권한과 없음 검사는 해석한 경로에 한다", async () => {
    const { api, h } = withRoot(ROOT);
    h.files.put(`${ROOT}/denied/x.txt`, "x");
    const denied = await rejection(
      api.add({ source: { kind: "path", path: "denied/x.txt" } }, callOptions(newThread())),
    );
    expect(denied.data.code).toBe("denied");
    const missing = await rejection(
      api.add({ source: { kind: "path", path: "none.txt" } }, callOptions(newThread())),
    );
    expect(missing.data.code).toBe("not_found");
  });
});
