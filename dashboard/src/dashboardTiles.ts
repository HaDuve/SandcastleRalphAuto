export type DashboardTile = "phaseStepper" | "log" | "queue" | "history";

export type TileErrors = Record<DashboardTile, string | null>;

export type TileRefreshing = Record<DashboardTile, boolean>;

export const EMPTY_TILE_ERRORS: TileErrors = {
  phaseStepper: null,
  log: null,
  queue: null,
  history: null,
};

export const EMPTY_TILE_REFRESHING: TileRefreshing = {
  phaseStepper: false,
  log: false,
  queue: false,
  history: false,
};

export const AUTO_REFRESH_INTERVAL_MS = 30_000;
