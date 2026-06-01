import type { ReactNode } from "react";

export type DashboardLayoutProps = {
  picker: ReactNode;
  runOutcome: ReactNode;
  phaseStepper: ReactNode;
  active: ReactNode;
  log: ReactNode;
  queue: ReactNode;
  history: ReactNode;
};

export function DashboardLayout({
  picker,
  runOutcome,
  phaseStepper,
  active,
  log,
  queue,
  history,
}: DashboardLayoutProps) {
  return (
    <div className="dashboard">
      <aside className="dashboard-sidebar">{picker}</aside>
      <main className="dashboard-main">
        <section aria-label="Run outcome" className="dashboard-section">
          {runOutcome}
        </section>
        <section aria-label="Phase stepper" className="dashboard-section">
          {phaseStepper}
        </section>
        <section aria-label="Active" className="dashboard-section">
          {active}
        </section>
        <section aria-label="Log" className="dashboard-section">
          {log}
        </section>
        <section aria-label="Queue" className="dashboard-section">
          {queue}
        </section>
        <section aria-label="History" className="dashboard-section">
          {history}
        </section>
      </main>
    </div>
  );
}
