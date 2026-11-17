import { cleanup, fireEvent, screen, within } from "@testing-library/react";
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
    // shifts are managed in the location now (16bb5be3)
    expect(
      within(tuesday).queryByRole("button", { name: /anpassen/ }),
    ).toBeNull();
    expect(
      within(tuesday).queryByRole("button", { name: /zurücksetzen/ }),
    ).toBeNull();
    expect(
      within(tuesday).queryByRole("button", { name: /hinzufügen/ }),
    ).toBeNull();
    expect(
      within(tuesday)
        .getByRole("link", {
          name: "Di 17.11.: Ausnahmen im Standort bearbeiten",
        })
        .getAttribute("href"),
    ).toBe(`/standorte/${f.G21}?datum=2026-11-17#ausnahmen`);
  });
});

describe("SchedulePage – assigning in the timeline (16bb5be3)", () => {
  // range starts at 07:00 (opening 07:30), 40 px per hour, timeline top = 0 in jsdom
  const y = (t: string) =>
    ((Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) - 7 * 60) * 40) / 60;
  const timelineOf = async (name: string) => {
    const day = (
      await screen.findAllByRole("region", { name })
    )[0] as HTMLElement;
    return { day, line: within(day).getByTestId("timeline") };
  };
  const click = (el: HTMLElement, t: string) => {
    fireEvent.pointerDown(el, { button: 0, clientY: y(t), pointerId: 1 });
    fireEvent.pointerUp(el, { button: 0, clientY: y(t), pointerId: 1 });
  };
  const setup = (o: object = {}) => {
    mockApi(
      { [`GET /schedule/week?start=${f.MON}`]: json(200, f.week(o)) },
      PERMS,
    );
    render();
  };

  it("a click on an empty spot opens the dialog with the whole shift", async () => {
    setup();
    const { line } = await timelineOf("Di 17.11.");
    click(line, "10:00");
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("07:30–19:00");
    expect(
      (within(dialog).getByLabelText("Von") as HTMLInputElement).value,
    ).toBe("07:30");
    expect(
      (within(dialog).getByLabelText("Bis") as HTMLInputElement).value,
    ).toBe("19:00");
    expect(within(dialog).queryByLabelText("Schicht")).toBeNull();
  });

  it("overlapping shifts preselect the larger gap and stay switchable", async () => {
    setup({
      assignments: [f.asg({ date: "2026-11-17", employeeId: f.BEN })],
      locations: [
        {
          ...f.week().locations[0],
          staffingWindows: [
            { weekday: "tue", start: "07:30", end: "19:00", people: 1 },
            { weekday: "tue", start: "08:00", end: "10:00", people: 1 },
          ],
        },
      ],
    });
    const { line } = await timelineOf("Di 17.11.");
    click(line, "09:00");
    const dialog = await screen.findByRole("dialog");
    const select = within(dialog).getByLabelText(
      "Schicht",
    ) as HTMLSelectElement;
    expect(select.value).toBe("08:00-10:00");
    await userEvent.selectOptions(select, "07:30-19:00");
    expect(
      (within(dialog).getByLabelText("Bis") as HTMLInputElement).value,
    ).toBe("19:00");
  });

  it("a click outside every shift shows a hint instead of the dialog", async () => {
    setup();
    // Wednesday is open but has no demand
    const { day, line } = await timelineOf("Mi 18.11.");
    click(line, "10:00");
    expect(within(day).getByRole("status").textContent).toBe(
      "keine Schicht zu dieser Zeit",
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("dragging snaps to 30 minutes and is cut to the shift", async () => {
    setup();
    const { line } = await timelineOf("Di 17.11.");
    const at = (t: string) => ({ button: 0, clientY: y(t), pointerId: 1 });
    fireEvent.pointerDown(line, at("10:10"));
    fireEvent.pointerMove(line, at("12:00"));
    expect(within(line).getByTestId("drag-preview").textContent).toBe(
      "10:00–12:00",
    );
    // upwards, above the shift start (07:30)
    fireEvent.pointerMove(line, at("07:05"));
    fireEvent.pointerUp(line, at("07:05"));
    const dialog = await screen.findByRole("dialog");
    expect(
      (within(dialog).getByLabelText("Von") as HTMLInputElement).value,
    ).toBe("07:30");
    expect(
      (within(dialog).getByLabelText("Bis") as HTMLInputElement).value,
    ).toBe("10:30");
    expect(within(dialog).getByRole("status").textContent).toBe(
      "Zeitraum auf die Schicht 07:30–19:00 gekürzt.",
    );
  });

  it("a click on a bar opens its details, not the dialog", async () => {
    setup({
      assignments: [
        f.asg({
          date: "2026-11-17",
          employeeId: f.BEN,
          start: "08:00",
          end: "12:00",
        }),
      ],
    });
    const { day } = await timelineOf("Di 17.11.");
    const bar = within(day).getByRole("button", {
      name: "Brandt, Ben, 08:00–12:00",
    });
    fireEvent.pointerDown(bar, {
      button: 0,
      clientY: y("09:00"),
      pointerId: 1,
    });
    fireEvent.pointerUp(bar, { button: 0, clientY: y("09:00"), pointerId: 1 });
    await userEvent.click(bar);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      within(day).getByRole("button", { name: "Brandt, Ben austeilen" }),
    ).toBeTruthy();
  });

  it("past days do not react to clicks", async () => {
    setup();
    const { line } = await timelineOf("Mo 16.11.");
    click(line, "10:00");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(line.className).not.toContain("cursor-crosshair");
  });

  it("phones only read: no +, no click handling", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: false,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    setup();
    const { day, line } = await timelineOf("Di 17.11.");
    expect(within(day).queryByRole("button", { name: /einteilen/ })).toBeNull();
    click(line, "10:00");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(day).queryByRole("status")).toBeNull();
  });
});
