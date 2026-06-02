import type { ReactNode } from "react";

export type PanelHeaderProps = {
  title: string;
  onRefresh?: () => void;
  refreshDisabled?: boolean;
  refreshing?: boolean;
  error?: string | null;
  actions?: ReactNode;
};

export function PanelHeader({
  title,
  onRefresh,
  refreshDisabled = false,
  refreshing = false,
  error = null,
  actions,
}: PanelHeaderProps) {
  const refreshBusy = refreshing;
  const refreshButtonDisabled = refreshDisabled || refreshBusy;

  return (
    <div className="panel-header">
      <div className="panel-header-row">
        <h2>{title}</h2>
        <div className="panel-header-actions">
          {actions}
          {onRefresh ? (
            <button
              type="button"
              className="panel-refresh-button"
              aria-label={`Refresh ${title}`}
              aria-busy={refreshBusy || undefined}
              disabled={refreshButtonDisabled}
              onClick={onRefresh}
            >
              {refreshBusy ? (
                <span className="refresh-spinner" aria-hidden="true" />
              ) : (
                "Refresh"
              )}
            </button>
          ) : null}
        </div>
      </div>
      {error ? (
        <p className="panel-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
