import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { session } from "@/auth/session";
import { json, mockApi, renderRoutes } from "@/test-support/api";
import * as f from "@/test-support/employee-fixtures";
import { EmployeeDetailPage } from "./EmployeeDetailPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  session.reset();
});

function setup(employee: object, history: object[] = []) {
  mockApi({
    [`GET /employees/${f.ANNA}`]: json(200, employee),
    [`GET /employees/${f.ANNA}/history`]: json(200, { entries: history }),
    "GET /contract-types": json(200, f.contractTypes),
    "GET /qualifications": json(200, f.qualifications),
    "GET /system-accesses": json(200, f.systems),
    "GET /locations?includeInactive=true": json(200, f.locations),
  });
  renderRoutes(`/mitarbeiter/${f.ANNA}`, {
    "/mitarbeiter/:id": <EmployeeDetailPage />,
  });
}

describe("EmployeeDetailPage (dc6c6578)", () => {
  it("shows a missing mobile number and the mode with releases", async () => {
    setup(
      {
        ...f.anna,
        mobile: null,
        locationMode: "only_selected",
        locations: [
          {
            locationId: f.G21,
            trained: true,
            preference: "preferred",
            released: true,
          },
        ],
      },
      [
        {
          id: "01a1bb3f-0000-7000-8000-000000000099",
          action: "updated",
          actor: "planerin@example.org",
          at: "2026-11-17T09:00:00.000Z",
          changes: {
            locationMode: {
              from: "all_except_blocked",
              to: "only_selected",
            },
          },
        },
      ],
    );
    const profile = (await screen.findByText("Handynummer")).parentElement;
    expect(profile?.textContent).toContain("–");
    expect(
      screen.getByText("nur an ausgewählten Standorten", { exact: false }),
    ).toBeTruthy();
    const g21 = screen.getByText("Gebäude 21").closest("li") as HTMLElement;
    expect(within(g21).getByText("freigegeben")).toBeTruthy();
    expect(within(g21).getByText("bevorzugt")).toBeTruthy();
    const g5 = screen.getByText("Gebäude 5").closest("li") as HTMLElement;
    expect(within(g5).getByText("nicht freigegeben")).toBeTruthy();
  });

  it("keeps the old view for all_except_blocked", async () => {
    setup(f.anna);
    expect(
      await screen.findByText("an allen Standorten außer gesperrten", {
        exact: false,
      }),
    ).toBeTruthy();
    expect(screen.queryByText("nicht freigegeben")).toBeNull();
  });
});
