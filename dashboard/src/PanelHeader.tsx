import type { ReactNode } from "react";

export type PanelHeaderProps = {
  title: string;
  onRefresh?: () => void;
  refreshDisabled?: boolean;
  error?: string | null;
  actions?: ReactNode;
};

export function PanelHeader({
  title,
  onRefresh,
  refreshDisabled = false,
  error = null,
  actions,
}: PanelHeaderProps) {
  return (
    <div className="panel-header">
      <div className="panel-header-row">
        <h2>{title}</h2>
        <div className="panel-header-actions">
          {actions}
          {onRefresh ? (
            <button
              type="button"
              aria-label={`Refresh ${title}`}
              disabled={refreshDisabled}
              onClick={onRefresh}
            >
              Refresh
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
