import type { OutputTruncator } from "@xeon/core-tools";

// core-tools의 출력 절단 함수(OutputTruncator). review.decisions-2 D-08은 구현을 platform-exec에 두고 xeon.exec로 받게 하지만
// platform-exec는 아직 truncateHead·formatSize를 내놓지 않아 core-tools가 시작하지 못한다. ToolsPluginOptions.truncator는
// 조립 루트가 넘기는 자리라 그 자리에 앞부분 보존 절단(줄·바이트 중 먼저 걸리는 쪽, 줄을 자르지 않음)을 임시로 둔다 [미결].
// platform-exec가 함수를 내놓으면 이 파일을 지우고 toolsPlugin의 기본 경로(xeon.exec)를 쓴다.

const DEFAULT_MAX_LINES = 2000;
const DEFAULT_MAX_BYTES = 51_200;

const encoder = new TextEncoder();

function byteLength(text: string): number {
  return encoder.encode(text).length;
}

export function createHostTruncator(): OutputTruncator {
  return {
    truncateHead(content, options) {
      const maxLines = options?.maxLines ?? DEFAULT_MAX_LINES;
      const maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;
      const lines = content.split("\n");
      const totalBytes = byteLength(content);
      if (lines.length <= maxLines && totalBytes <= maxBytes) {
        return {
          content,
          truncated: false,
          truncatedBy: null,
          totalLines: lines.length,
          totalBytes,
          outputLines: lines.length,
          outputBytes: totalBytes,
        };
      }
      const kept: string[] = [];
      let bytes = 0;
      let truncatedBy: "lines" | "bytes" = lines.length > maxLines ? "lines" : "bytes";
      for (const line of lines) {
        if (kept.length >= maxLines) {
          truncatedBy = "lines";
          break;
        }
        // 줄 사이의 "\n" 한 바이트를 더한다
        const lineBytes = byteLength(line) + (kept.length > 0 ? 1 : 0);
        if (bytes + lineBytes > maxBytes) {
          truncatedBy = "bytes";
          break;
        }
        kept.push(line);
        bytes += lineBytes;
      }
      return {
        content: kept.join("\n"),
        truncated: true,
        truncatedBy,
        totalLines: lines.length,
        totalBytes,
        outputLines: kept.length,
        outputBytes: bytes,
      };
    },
    formatSize: (bytes) => (bytes < 1024 ? `${bytes}B` : `${(bytes / 1024).toFixed(1)}KB`),
  };
}
