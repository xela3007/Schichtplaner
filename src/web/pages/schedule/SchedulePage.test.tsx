import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { session } from "@/auth/session";
import { json, mockApi, renderRoutes } from "@/test-support/api";
import * as f from "@/test-support/schedule-fixtures";
import { SchedulePage } from "./SchedulePage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  session.reset();
});
const PERMS = ["schedule.manage"];
const render = () =>
  renderRoutes(`/schichtplan?woche=${f.MON}`, {
    "/schichtplan": <SchedulePage />,
  });

describe("SchedulePage", () => {
  it("shows shifts, assignments, coverage, past days read-only and the hours table", async () => {
    mockApi(
      {
        [`GET /schedule/week?start=${f.MON}`]: json(
          200,
          f.week({
            assignments: [
              f.asg({ employeeId: f.BEN, start: "07:30", end: "12:00" }),
            ],
          }),
        ),
      },
      PERMS,
    );
    render();
    const monday = (
      await screen.findAllByRole("region", { name: "Mo 16.11." })
    )[0] as HTMLElement;
    expect(within(monday).getByText("07:30–19:00 · Soll 2")).toBeTruthy();
    expect(within(monday).getByText("Brandt, Ben")).toBeTruthy();
    expect(within(monday).getByText("07:30–12:00")).toBeTruthy(); // partial shift
    expect(
      within(monday).getByText("Lücke 07:30–12:00 (1 fehlt)"),
    ).toBeTruthy();
    expect(
      within(monday).getByText("Lücke 12:00–19:00 (2 fehlt)"),
    ).toBeTruthy();
    // Monday is before "today" (17.11.) → read-only
    expect(within(monday).getByText("abgeschlossen")).toBeTruthy();
    expect(
      within(monday).queryByRole("button", { name: /einteilen/ }),
    ).toBeNull();
    const tuesday = screen.getAllByRole("region", {
      name: "Di 17.11.",
    })[0] as HTMLElement;
    expect(within(tuesday).getByText("heute")).toBeTruthy();
    expect(
      within(tuesday).getByRole("button", {
        name: "Di 17.11. 07:30–19:00 einteilen",
      }),
    ).toBeTruthy();
    // hours: 4,5 h gross, no break
    const table = screen.getByRole("table");
    expect(
      within(table).getByRole("row", { name: /Brandt, Ben/ }).textContent,
    ).toContain("4,5 Std.");
    expect(
      screen.getByText("Kein Besetzungsbedarf hinterlegt.", { exact: false }),
    ).toBeTruthy();
  });

  it("marks outdated assignments and conflicts", async () => {
    mockApi(
      {
        [`GET /schedule/week?start=${f.MON}`]: json(
          200,
          f.week({
            today: "2026-11-10",
            assignments: [
              f.asg({
                date: "2026-11-17",
                shiftStart: "08:00",
                shiftEnd: "16:00",
                start: "08:00",
                end: "16:00",
              }),
              f.asg({
                id: "01a1bb3f-0000-7000-8000-000000000072",
                employeeId: f.CARL,
                date: "2026-11-17",
                start: "07:30",
                end: "19:00",
              }),
            ],
          }),
        ),
      },
      PERMS,
    );
    render();
    const tuesday = (
      await screen.findAllByRole("region", { name: "Di 17.11." })
    )[0] as HTMLElement;
    expect(within(tuesday).getByText("passt nicht mehr")).toBeTruthy();
    expect(
      within(tuesday).getByText("Konflikt: abwesend: Urlaub"),
    ).toBeTruthy();
  });

  it("removes an assignment after confirmation", async () => {
    const fetch = mockApi(
      {
        [`GET /schedule/week?start=${f.MON}`]: json(
          200,
          f.week({
            assignments: [
              f.asg({ date: "2026-11-17", start: "08:00", end: "15:00" }),
            ],
          }),
        ),
        "DELETE /schedule/assignments/01a1bb3f-0000-7000-8000-000000000071?version=1":
          new Response(null, { status: 204 }),
      },
      PERMS,
    );
    render();
    await userEvent.click(
      await screen.findByRole("button", { name: "Müller, Anna austeilen" }),
    );
    expect(fetch.mock.calls.some(([, i]) => i?.method === "DELETE")).toBe(
      false,
    );
    await userEvent.click(screen.getByRole("button", { name: "Ja" }));
    await vi.waitFor(() =>
      expect(fetch.mock.calls.some(([, i]) => i?.method === "DELETE")).toBe(
        true,
      ),
    );
  });

  it("is refused without schedule.manage", async () => {
    mockApi({}, ["employees.manage"]);
    render();
    expect(
      await screen.findByText(
        "Dir fehlt das Recht, den Schichtplan zu pflegen.",
      ),
    ).toBeTruthy();
  });
});
