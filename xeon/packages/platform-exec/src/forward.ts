import type { FileSystem } from "@xeon/contracts/services";

/** `cwd`와 `cleanup`을 뺀 파일 연산 모음 */
export type FileMethods = Omit<FileSystem, "cwd" | "cleanup">;

/** 파일 연산은 안쪽 env에 그대로 넘긴다 */
export function forwardFileSystem(inner: FileSystem): FileMethods {
  return {
    id: inner.id,
    absolutePath: (path, context) => inner.absolutePath(path, context),
    joinPath: (parts, context) => inner.joinPath(parts, context),
    readTextFile: (path, context) => inner.readTextFile(path, context),
    openTextLineReader: (path, context) => inner.openTextLineReader(path, context),
    readTextLines: (path, options, context) => inner.readTextLines(path, options, context),
    readBinaryFile: (path, context) => inner.readBinaryFile(path, context),
    openBinaryReader: (path, options, context) => inner.openBinaryReader(path, options, context),
    writeFile: (path, content, context) => inner.writeFile(path, content, context),
    appendFile: (path, content, context) => inner.appendFile(path, content, context),
    truncateFile: (path, size, context) => inner.truncateFile(path, size, context),
    flushFile: (path, context) => inner.flushFile(path, context),
    renameFile: (source, destination, context) => inner.renameFile(source, destination, context),
    fileInfo: (path, context) => inner.fileInfo(path, context),
    listDir: (path, context) => inner.listDir(path, context),
    openDirReader: (path, context) => inner.openDirReader(path, context),
    watch: (targets, onChange, context) => inner.watch(targets, onChange, context),
    canonicalPath: (path, context) => inner.canonicalPath(path, context),
    exists: (path, context) => inner.exists(path, context),
    createDir: (path, options, context) => inner.createDir(path, options, context),
    remove: (path, options, context) => inner.remove(path, options, context),
    createTempDir: (prefix, context) => inner.createTempDir(prefix, context),
    createTempFile: (options, context) => inner.createTempFile(options, context),
  };
}
