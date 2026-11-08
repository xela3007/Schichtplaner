import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { session } from "@/auth/session";
import { json, mockApi, renderRoutes } from "@/test-support/api";
import { AvailabilityWeekPage } from "./AvailabilityWeekPage";

const T = "2026-11-08T08:00:00.000Z";
const A = "01a1bb3f-0000-7000-8000-000000000041";
const B = "01a1bb3f-0000-7000-8000-000000000042";
const week = (start: string) => ({
  start,
  employees: [
    { id: B, firstName: "Ben", lastName: "Alt", personnelNo: null },
    { id: A, firstName: "Anna", lastName: "Müller", personnelNo: "P-1" },
  ],
  absences:
    start === "2026-11-02"
      ? [
          {
            id: "01a1bb3f-0000-7000-8000-000000000051",
            employeeId: A,
            kind: "vacation",
            startDate: "2026-10-28",
            endDate: "2026-11-03",
            startTime: null,
            endTime: null,
            note: null,
            version: 1,
            updatedAt: T,
          },
        ]
      : [],
  rules: [
    {
      id: "01a1bb3f-0000-7000-8000-000000000061",
      employeeId: B,
      weekdays: ["tue"],
      startTime: null,
      endTime: null,
      version: 1,
      updatedAt: T,
    },
  ],
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  session.reset();
});

const PERMS = ["availability.manage"];

describe("AvailabilityWeekPage", () => {
  it("normalises to Monday, shows absences and rules in the grid and the phone list", async () => {
    mockApi(
      {
        "GET /availability/week?start=2026-11-02": json(
          200,
          week("2026-11-02"),
        ),
        "GET /availability/week?start=2026-11-09": json(
          200,
          week("2026-11-09"),
        ),
      },
      PERMS,
    );
    renderRoutes("/abwesenheiten?woche=2026-11-04", {
      "/abwesenheiten": <AvailabilityWeekPage />,
    });
    expect(await screen.findByText("KW 45 · 02.11.–08.11.2026")).toBeTruthy();
    const table = await screen.findByRole("table");
    const annaRow = within(table).getByRole("row", { name: /Müller, Anna/ });
    // vacation on Mon + Tue of this week
    expect(within(annaRow).getAllByText("Urlaub")).toHaveLength(2);
    const benRow = within(table).getByRole("row", { name: /Alt, Ben/ });
    expect(within(benRow).getAllByText("Regel: ganztägig")).toHaveLength(1);
    // phone list: a day without entries
    expect(screen.getAllByText("Niemand fehlt.").length).toBeGreaterThan(0);

    await userEvent.click(
      screen.getByRole("button", { name: "Nächste Woche →" }),
    );
    expect(await screen.findByText("KW 46 · 09.11.–15.11.2026")).toBeTruthy();
    await vi.waitFor(() =>
      expect(
        within(screen.getByRole("table")).queryByText("Urlaub"),
      ).toBeNull(),
    );
  });

  it("is refused without availability.manage", async () => {
    mockApi({}, ["employees.manage"]);
    renderRoutes("/abwesenheiten", {
      "/abwesenheiten": <AvailabilityWeekPage />,
    });
    expect(
      await screen.findByText("Dir fehlt das Recht, Abwesenheiten zu pflegen."),
    ).toBeTruthy();
  });
});
