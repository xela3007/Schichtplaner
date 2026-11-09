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
    expect(
      within(monday).getByRole("button", { name: "Brandt, Ben, 07:30–12:00" })
        .textContent,
    ).toContain("Ben B.");
    // partial shift: the bar carries its own times (07:30–12:00, asserted above)
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
    // the bar opens its details; "Austeilen" lives there
    await userEvent.click(
      await screen.findByRole("button", { name: "Müller, Anna, 08:00–15:00" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Müller, Anna austeilen" }),
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

  it("draws overlapping assignments side by side and hatches gaps", async () => {
    mockApi(
      {
        [`GET /schedule/week?start=${f.MON}`]: json(
          200,
          f.week({
            assignments: [
              f.asg({ date: "2026-11-17", start: "07:30", end: "12:00" }),
              f.asg({
                id: "01a1bb3f-0000-7000-8000-000000000072",
                employeeId: f.BEN,
                date: "2026-11-17",
                start: "10:00",
                end: "19:00",
              }),
            ],
          }),
        ),
      },
      PERMS,
    );
    render();
    const anna = await screen.findByRole("button", {
      name: "Müller, Anna, 07:30–12:00",
    });
    const ben = screen.getByRole("button", {
      name: "Brandt, Ben, 10:00–19:00",
    });
    // two lanes: each bar takes half the width, in different lanes
    expect(anna.style.width).toContain("50%");
    expect(ben.style.width).toBe(anna.style.width);
    expect(anna.style.left).not.toBe(ben.style.left);
    // Tue needs 1: 10:00–12:00 is overstaffed, nothing missing
    const tuesday = (
      await screen.findAllByRole("region", { name: "Di 17.11." })
    )[0] as HTMLElement;
    expect(within(tuesday).queryByText(/^fehlt/)).toBeNull();
    // Mon needs 2 and has nobody → hatched gap "fehlt 2"
    const monday = screen.getAllByRole("region", {
      name: "Mo 16.11.",
    })[0] as HTMLElement;
    expect(within(monday).getByText("fehlt 2")).toBeTruthy();
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

describe("SchedulePage – day overrides", () => {
  it("labels added and changed shifts, strikes cancelled ones and offers no assign on them", async () => {
    const T = "2026-11-08T08:00:00.000Z";
    const base = { locationId: f.G21, version: 1, updatedAt: T };
    mockApi(
      {
        [`GET /schedule/week?start=${f.MON}`]: json(
          200,
          f.week({
            today: "2026-11-10",
            overrides: [
              {
                ...base,
                id: "01a1bb3f-0000-7000-8000-000000000091",
                date: "2026-11-16",
                kind: "changed",
                baseStart: "07:30",
                baseEnd: "19:00",
                start: "07:30",
                end: "15:00",
                people: 2,
              },
              {
                ...base,
                id: "01a1bb3f-0000-7000-8000-000000000092",
                date: "2026-11-16",
                kind: "added",
                baseStart: null,
                baseEnd: null,
                start: "17:00",
                end: "21:00",
                people: 1,
              },
              {
                ...base,
                id: "01a1bb3f-0000-7000-8000-000000000093",
                date: "2026-11-17",
                kind: "cancelled",
                baseStart: "07:30",
                baseEnd: "19:00",
                start: null,
                end: null,
                people: null,
              },
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
    expect(
      within(monday).getByText("angepasst (normal 07:30–19:00)"),
    ).toBeTruthy();
    expect(within(monday).getByText("zusätzlich")).toBeTruthy();
    expect(
      within(monday).getByRole("button", {
        name: "Mo 16.11. 17:00–21:00 einteilen",
      }),
    ).toBeTruthy();
    const tuesday = screen.getAllByRole("region", {
      name: "Di 17.11.",
    })[0] as HTMLElement;
    expect(within(tuesday).getByText("entfällt")).toBeTruthy();
    expect(
      within(tuesday).queryByRole("button", { name: /einteilen/ }),
    ).toBeNull();
    expect(
      within(tuesday).getByRole("button", {
        name: "Di 17.11. 07:30–19:00 auf Standard zurücksetzen",
      }),
    ).toBeTruthy();
  });
});
