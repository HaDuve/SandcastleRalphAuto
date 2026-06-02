export type DashboardTile = "phaseStepper" | "active" | "log" | "queue" | "history";

export type TileErrors = Record<DashboardTile, string | null>;

export const EMPTY_TILE_ERRORS: TileErrors = {
  phaseStepper: null,
  active: null,
  log: null,
  queue: null,
  history: null,
};

export const AUTO_REFRESH_INTERVAL_MS = 30_000;
