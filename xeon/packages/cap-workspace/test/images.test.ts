import { describe, expect, test } from "bun:test";
import { ImageBlobRefSchema, WorkspaceFiles, WorkspaceImages } from "@xeon/contracts/capabilities";
import { BlobRefSchema } from "@xeon/contracts/records";
import type { ScopeStack } from "@xeon/contracts/settings";
import { createFilesApi, createWorkspaceService } from "../src/service.ts";
import { readWorkspaceSettings } from "../src/settings.ts";
import { callTool, type AdaptedResult } from "./support/adapter.ts";
import { rejection } from "./support/assertions.ts";
import { depsFor } from "./support/fakes.ts";
import {
  animatedPngBytes,
  bmpBytes,
  gifBytes,
  jpegBytes,
  memoryBlobs,
  pngBytes,
  toBase64,
  webpBytes,
} from "./support/images.ts";
import { memoryEnv } from "./support/memory-env.ts";

function layersOf(values: Record<string, number>): ScopeStack {
  return [{ scope: "user", values: new Map(Object.entries(values)) }];
}

function setup(layers: ScopeStack = []) {
  const env = memoryEnv({ cwd: "/work" });
  env.mkdir("/work");
  const blobs = memoryBlobs();
  const deps = depsFor(env, {
    blobs,
    settings: () => readWorkspaceSettings(layers),
  });
  return { env, blobs, service: createWorkspaceService(deps), files: createFilesApi(deps) };
}

describe("workspace.images register", () => {
  test("register passes inline image within limit", async () => {
    const { service, blobs } = setup();
    const cases = [
      { bytes: pngBytes(4, 3), mime: "image/png", size: { width: 4, height: 3 } },
      { bytes: jpegBytes(8, 7), mime: "image/jpeg", size: { width: 8, height: 7 } },
      { bytes: gifBytes(5, 6), mime: "image/gif", size: { width: 5, height: 6 } },
      { bytes: webpBytes(10, 12), mime: "image/webp", size: { width: 10, height: 12 } },
    ];
    const images = await Promise.all(
      cases.map((item) =>
        service.images.register({ data: toBase64(item.bytes), mimeType: item.mime }),
      ),
    );
    for (const [index, item] of cases.entries()) {
      const image = images[index];
      if (image === undefined) throw new Error("missing image");
      expect(image.mimeType).toBe(item.mime);
      expect(image.size).toEqual(item.size);
      expect(image.blob).toMatchObject({
        type: "blob",
        size: item.bytes.length,
        mediaType: item.mime,
      });
      expect(blobs.stored.get(image.blob.sha256)).toEqual(item.bytes);
    }
  });

  test("the detected format wins over the declared mime type", async () => {
    const { service } = setup();
    const image = await service.images.register({
      data: toBase64(jpegBytes()),
      mimeType: "image/png",
    });
    expect(image.mimeType).toBe("image/jpeg");
  });

  test("register rejects oversize without processor", async () => {
    const { service, blobs } = setup();
    const big = pngBytes(4, 3, 10_000);
    const error = await rejection(
      service.images.register({
        data: toBase64(big),
        mimeType: "image/png",
        limits: { maxWidth: 2000, maxHeight: 2000, maxBytes: 4096 },
      }),
    );
    expect(error.data.code).toBe("image_too_large");
    expect(blobs.puts).toBe(0);
  });

  test("register rejects unsupported format", async () => {
    const { service, blobs } = setup();
    const error = await rejection(
      service.images.register({ data: toBase64(bmpBytes()), mimeType: "image/bmp" }),
    );
    expect(error.data.code).toBe("image_unsupported");
    expect(blobs.puts).toBe(0);
  });

  test("register rejects input over maxInputBytes", async () => {
    const { service, blobs } = setup(layersOf({ "l2.workspace.images.maxInputBytes": 1024 }));
    const error = await rejection(
      service.images.register({
        data: toBase64(pngBytes(4, 3, 2000)),
        mimeType: "image/png",
      }),
    );
    expect(error.data.code).toBe("invalid_input");
    expect(error.data.detail).toMatchObject({ reason: "input_too_large", limit: 1024 });
    expect(blobs.puts).toBe(0);
  });

  test("register rejects data that is not an image or not base64", async () => {
    const { service } = setup();
    const text = await rejection(
      service.images.register({
        data: toBase64(new TextEncoder().encode("hello world")),
        mimeType: "image/png",
      }),
    );
    expect(text.data.code).toBe("image_decode_failed");
    const notBase64 = await rejection(
      service.images.register({ data: "not base64!!", mimeType: "image/png" }),
    );
    expect(notBase64.data.code).toBe("image_decode_failed");
    const animated = await rejection(
      service.images.register({ data: toBase64(animatedPngBytes()), mimeType: "image/png" }),
    );
    expect(animated.data.code).toBe("image_decode_failed");
  });

  test("same bytes same blob", async () => {
    const { service, blobs } = setup();
    const data = toBase64(pngBytes(4, 3, 100));
    const first = await service.images.register({ data, mimeType: "image/png" });
    const second = await service.images.register({
      data,
      mimeType: "image/png",
      source: { kind: "paste", name: "again.png" },
    });
    expect(second.blob.sha256).toBe(first.blob.sha256);
    expect(blobs.stored.size).toBe(1);
  });

  test("a store failure and a missing store are unavailable", async () => {
    const { service, blobs } = setup();
    blobs.fail = { kind: "disk_full" };
    const full = await rejection(
      service.images.register({ data: toBase64(pngBytes()), mimeType: "image/png" }),
    );
    expect(full.data).toMatchObject({
      code: "unavailable",
      retryable: true,
      detail: { by: "store", reason: "disk_full" },
    });

    const bare = createWorkspaceService(depsFor(memoryEnv({ cwd: "/work" })));
    const missing = await rejection(
      bare.images.register({ data: toBase64(pngBytes()), mimeType: "image/png" }),
    );
    expect(missing.data).toMatchObject({
      code: "unavailable",
      detail: { reason: "blob_store_missing" },
    });
  });

  test("resize needs a processor", async () => {
    const { service } = setup();
    const error = await rejection(
      service.images.resize({
        blob: { type: "blob", sha256: "0".repeat(64), size: 1, mediaType: null },
        mimeType: "image/png",
        limits: { maxWidth: 100, maxHeight: 100, maxBytes: 2048 },
      }),
    );
    expect(error.data.code).toBe("unsupported");
  });
});

describe("workspace.images load", () => {
  test("loads an image file inside the root", async () => {
    const { service, env } = setup();
    env.put("/work/pics/a.png", pngBytes(4, 3, 64));
    const image = await service.images.load({ path: "pics/a.png" });
    expect(image).toMatchObject({ mimeType: "image/png", size: { width: 4, height: 3 } });
  });

  test("denies a path outside the root and rejects directories and big files", async () => {
    const { service, env } = setup(layersOf({ "l2.workspace.images.maxInputBytes": 1024 }));
    env.put("/outside.png", pngBytes());
    env.put("/work/big.png", pngBytes(4, 3, 4096));
    env.mkdir("/work/dir");
    const outside = await rejection(service.images.load({ path: "../outside.png" }));
    expect(outside.data.code).toBe("denied");
    const directory = await rejection(service.images.load({ path: "dir" }));
    expect(directory.data.code).toBe("invalid_input");
    const big = await rejection(service.images.load({ path: "big.png" }));
    expect(big.data).toMatchObject({
      code: "invalid_input",
      detail: { reason: "input_too_large" },
    });
    const missing = await rejection(service.images.load({ path: "nope.png" }));
    expect(missing.data.code).toBe("not_found");
  });
});

describe("read of image files", () => {
  test("read image returns placeholder", async () => {
    const { files, env } = setup();
    env.put("/work/shot.png", pngBytes(4, 3, 64));
    const first = await files.read({ path: "shot.png" });
    expect(first.kind).toBe("image");
    if (first.kind !== "image") return;
    expect(first.path).toBe("/work/shot.png");

    const adapted: AdaptedResult = await callTool(WorkspaceFiles, files, "read", {
      path: "shot.png",
    });
    expect(adapted.isError).toBe(false);
    const image = adapted.content?.content.find((part) => part.type === "image");
    expect(image?.type === "image" ? image.data : "").toBe(
      `blob:sha256:${first.image.blob.sha256}`,
    );

    const second = await files.read({ path: "shot.png" });
    expect(second.kind === "image" ? second.image.blob.sha256 : "").toBe(first.image.blob.sha256);
  });

  test("a bmp read is image_unsupported and a non-image binary is still read_binary", async () => {
    const { files, env } = setup();
    env.put("/work/old.bmp", bmpBytes());
    env.put("/work/data.bin", new Uint8Array([1, 2, 0, 3, 4]));
    const bmp = await rejection(files.read({ path: "old.bmp" }));
    expect(bmp.data.code).toBe("image_unsupported");
    const binary = await rejection(files.read({ path: "data.bin" }));
    expect(binary.data.code).toBe("read_binary");
  });

  test("without a blob store images are binary files", async () => {
    const env = memoryEnv({ cwd: "/work" });
    env.mkdir("/work");
    env.put("/work/shot.png", pngBytes(4, 3, 64));
    const files = createFilesApi(depsFor(env));
    const error = await rejection(files.read({ path: "shot.png" }));
    expect(error.data.code).toBe("read_binary");
  });

  test("an oversize image read is image_too_large", async () => {
    const { files, env } = setup(layersOf({ "l2.workspace.images.maxBytes": 2048 }));
    env.put("/work/huge.png", pngBytes(4, 3, 10_000));
    const error = await rejection(files.read({ path: "huge.png" }));
    expect(error.data.code).toBe("image_too_large");
  });
});

describe("definitions", () => {
  test("blob ref shape matches records", () => {
    expect(JSON.parse(JSON.stringify(ImageBlobRefSchema))).toEqual(
      JSON.parse(JSON.stringify(BlobRefSchema)),
    );
  });

  test("workspace.images has no tools", () => {
    expect(WorkspaceImages.tools).toEqual([]);
  });
});
