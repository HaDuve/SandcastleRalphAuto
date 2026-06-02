import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PanelHeader } from "../../dashboard/src/PanelHeader.js";

describe("PanelHeader", () => {
  it("renders a Refresh button that calls onRefresh", async () => {
    const onRefresh = vi.fn();
    render(<PanelHeader title="Queue" onRefresh={onRefresh} />);

    const button = screen.getByRole("button", { name: /refresh queue/i });
    expect(button).toHaveTextContent("Refresh");
    expect(button).toBeEnabled();
    button.click();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("shows an inline spinner and disables Refresh while refreshing", () => {
    render(<PanelHeader title="Log" onRefresh={() => {}} refreshing />);

    const button = screen.getByRole("button", { name: /refresh log/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).not.toHaveTextContent("Refresh");
    expect(button.querySelector(".refresh-spinner")).not.toBeNull();
  });

  it("restores the Refresh label when refreshing settles", () => {
    const { rerender } = render(
      <PanelHeader title="History" onRefresh={() => {}} refreshing />,
    );

    rerender(<PanelHeader title="History" onRefresh={() => {}} refreshing={false} />);

    const button = screen.getByRole("button", { name: /refresh history/i });
    expect(button).toBeEnabled();
    expect(button).toHaveTextContent("Refresh");
    expect(button).not.toHaveAttribute("aria-busy");
  });

  it("keeps Refresh disabled when refreshDisabled without showing a spinner", () => {
    render(<PanelHeader title="Queue" onRefresh={() => {}} refreshDisabled />);

    const button = screen.getByRole("button", { name: /refresh queue/i });
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("Refresh");
    expect(button.querySelector(".refresh-spinner")).toBeNull();
  });
});
