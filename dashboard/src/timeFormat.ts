export type TimestampInput = string | number;

export type FormatTimestampOptions = {
  /**
   * Default: browser local timezone.
   * Tests can set this for deterministic output.
   */
  timeZone?: string;
};

function parseTimestamp(value: TimestampInput): Date | null {
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string | null {
  const found = parts.find((p) => p.type === type);
  return found ? found.value : null;
}

function formatOffsetLabel(date: Date): string {
  // getTimezoneOffset is minutes behind UTC (e.g. UTC+7 => -420)
  const minutes = -date.getTimezoneOffset();
  const sign = minutes >= 0 ? "+" : "-";
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `UTC${sign}${hh}:${mm}`;
}

export function formatTimestampLocal(
  value: TimestampInput | null | undefined,
  options: FormatTimestampOptions = {},
): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const date = parseTimestamp(value);
  if (!date) {
    return null;
  }

  const formatter = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: options.timeZone,
    timeZoneName: "short",
  });

  const parts = formatter.formatToParts(date);
  const yyyy = part(parts, "year");
  const mm = part(parts, "month");
  const dd = part(parts, "day");
  const hh = part(parts, "hour");
  const min = part(parts, "minute");
  const ss = part(parts, "second");

  if (!yyyy || !mm || !dd || !hh || !min || !ss) {
    return null;
  }

  const tz = part(parts, "timeZoneName") ?? formatOffsetLabel(date);

  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss} ${tz}`;
}

export function formatTimestampRangeLocal(
  startedAt: string | null | undefined,
  endedAt: string | null | undefined,
  options: FormatTimestampOptions = {},
): string | null {
  const start = formatTimestampLocal(startedAt ?? null, options);
  const end = formatTimestampLocal(endedAt ?? null, options);

  if (!start || !end) {
    return null;
  }

  return `${start} → ${end}`;
}
