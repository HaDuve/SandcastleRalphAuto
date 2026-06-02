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

export function appendLogChunk(log: string, chunk: string): string {
  const MAX_LOG_CHARS = 512_000;
  const next = log + chunk;
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
