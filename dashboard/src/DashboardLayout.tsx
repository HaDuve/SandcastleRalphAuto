import type { ReactNode } from "react";

export type DashboardLayoutProps = {
  picker: ReactNode;
  queue: ReactNode;
  active: ReactNode;
  stream: ReactNode;
  history: ReactNode;
};

export function DashboardLayout({ picker, queue, active, stream, history }: DashboardLayoutProps) {
  return (
    <div className="dashboard">
      <aside className="dashboard-sidebar">{picker}</aside>
      <main className="dashboard-main">
        <section aria-label="Queue" className="dashboard-panel">
          {queue}
        </section>
        <section aria-label="Active" className="dashboard-panel">
          {active}
        </section>
        <section aria-label="Stream" className="dashboard-panel">
          {stream}
        </section>
        <section aria-label="History" className="dashboard-panel">
          {history}
        </section>
      </main>
    </div>
  );
}
