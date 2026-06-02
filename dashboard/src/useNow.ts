import { useEffect, useState } from "react";

export function useNow(intervalMs = 10_000): string {
  const [now, setNow] = useState(() => new Date().toISOString());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date().toISOString());
    }, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}
