export function lastLines(text: string, count: number): string {
  if (count <= 0) {
    return "";
  }
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines.slice(-count).join("\n");
}

const MAX_LOG_CHARS = 512_000;

export const LOG_SERVER_SECTION_HEADER = "=== Server ===\n";

export function appendLogChunk(log: string, chunk: string): string {
  const next = log + chunk;
  if (next.length <= MAX_LOG_CHARS) {
    return next;
  }
  return next.slice(-MAX_LOG_CHARS);
}

/** Inserts live server SSE text before the first phase section in an All-channel view. */
export function appendServerLogChunkInAllView(log: string, chunk: string): string {
  const headerIdx = log.indexOf(LOG_SERVER_SECTION_HEADER);
  if (headerIdx === -1) {
    return appendLogChunk(log, chunk);
  }
  const contentStart = headerIdx + LOG_SERVER_SECTION_HEADER.length;
  const afterServer = log.slice(contentStart);
  const phaseSection = afterServer.match(/\n=== [^=\n]+ ===\n/);
  const insertAt = phaseSection
    ? contentStart + (phaseSection.index ?? afterServer.length)
    : log.length;
  const next = log.slice(0, insertAt) + chunk + log.slice(insertAt);
  if (next.length <= MAX_LOG_CHARS) {
    return next;
  }
  return next.slice(-MAX_LOG_CHARS);
}

export type ScrollableLogBody = { scrollTop: number; scrollHeight: number };

/** Pin a log viewport to the newest lines (terminal tail). */
export function scrollLogBodyToTail(element: ScrollableLogBody): void {
  element.scrollTop = element.scrollHeight;
}
