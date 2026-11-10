import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScheduleWeek } from "#shared/schedule.js";
import { session } from "@/auth/session";
import { json, mockApi, renderRoutes } from "@/test-support/api";
import * as f from "@/test-support/schedule-fixtures";
import { CopyWeekDialog } from "./CopyWeekDialog";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  session.reset();
});

const week = ScheduleWeek.parse(f.week()); // starts Mon 16.11.2026

function render() {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-10T09:00:00Z") });
  const onClose = vi.fn();
  renderRoutes("/x", {
    "/x": <CopyWeekDialog week={week} onClose={onClose} />,
  });
  return onClose;
}
const target = (kw: number) =>
  screen.getByRole("checkbox", {
    name: new RegExp(`^KW ${kw} `),
  }) as HTMLInputElement;

describe("CopyWeekDialog", () => {
  it("defaults: shown week as source, all locations, no targets", () => {
    mockApi({}, ["schedule.manage"]);
    render();
    expect(
      (screen.getByLabelText("Quellwoche") as HTMLSelectElement).value,
    ).toBe(f.MON);
    for (const name of ["Gebäude 21", "Gebäude 5"])
      expect(
        (screen.getByRole("checkbox", { name }) as HTMLInputElement).checked,
      ).toBe(true);
    // the 8 weeks after the source
    expect(target(48)).toBeTruthy();
    expect(target(2)).toBeTruthy(); // 8th week after: KW 2 / 2027 (2026 has 53 weeks)
    expect(target(48).checked).toBe(false);
  });

  it("allows at most 4 targets and sends the copy", async () => {
    let body: Record<string, unknown> = {};
    mockApi(
      {
        "POST /schedule/copies": (init) => {
          body = JSON.parse(String(init.body));
          return json(201, {
            copy: null,
            copied: 7,
            alreadyPresent: 2,
            skipped: [],
          });
        },
      },
      ["schedule.manage"],
    );
    render();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    for (const kw of [48, 49, 50, 51]) await user.click(target(kw));
    expect(target(52).disabled).toBe(true);
    expect(screen.getByText("höchstens 4 Zielwochen")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Übernehmen" }));
    expect(
      await screen.findByText("7 Einteilungen übernommen", { exact: false }),
    ).toBeTruthy();
    expect(screen.getByText(/2 waren schon eingeteilt/)).toBeTruthy();
    expect(screen.getByText("Alles übernommen.")).toBeTruthy();
    expect(body).toEqual({
      sourceStart: f.MON,
      targetStarts: ["2026-11-23", "2026-11-30", "2026-12-07", "2026-12-14"],
      locationIds: [f.G21, f.G5],
    });
  });

  it("asks for a target before sending", async () => {
    const fetch = mockApi({}, ["schedule.manage"]);
    render();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole("button", { name: "Übernehmen" }));
    expect(
      await screen.findByText("Bitte mindestens eine Zielwoche wählen."),
    ).toBeTruthy();
    expect(fetch.mock.calls.some(([u]) => String(u).includes("copies"))).toBe(
      false,
    );
  });

  it("lists skipped assignments grouped by week", async () => {
    const skip = (date: string, message: string) => ({
      employeeId: f.ANNA,
      employeeName: "Müller, Anna",
      locationId: f.G21,
      locationName: "Gebäude 21",
      date,
      start: "07:30",
      end: "15:00",
      reason: "absence",
      message,
    });
    mockApi(
      {
        "POST /schedule/copies": json(201, {
          copy: null,
          copied: 1,
          alreadyPresent: 0,
          skipped: [
            skip("2026-11-23", "abwesend: Urlaub"),
            skip("2026-12-01", "abwesend: krank"),
          ],
        }),
      },
      ["schedule.manage"],
    );
    render();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(target(48));
    await user.click(screen.getByRole("button", { name: "Übernehmen" }));
    expect(await screen.findByText("Nicht übernommen (2)")).toBeTruthy();
    const kw48 = screen.getByRole("region", { name: "KW 48" });
    expect(kw48.textContent).toContain(
      "Mo 23.11. · Gebäude 21 · Müller, Anna 07:30–15:00 – abwesend: Urlaub",
    );
    expect(
      within(screen.getByRole("region", { name: "KW 49" })).getByText(
        /abwesend: krank/,
      ),
    ).toBeTruthy();
  });
});
