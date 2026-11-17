import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { session } from "@/auth/session";
import { json, mockApi, renderRoutes } from "@/test-support/api";
import * as f from "@/test-support/schedule-fixtures";
import { ExceptionsCard } from "./ExceptionsCard";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-17T10:00:00+01:00"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  session.reset();
});

const T = "2026-11-08T08:00:00.000Z";
const location = {
  id: f.G21,
  name: "Gebäude 21",
  kind: "customer_area" as const,
  openingHours: [],
  active: true,
  version: 1,
  updatedAt: T,
};
const cancelled = {
  id: "01a1bb3f-0000-7000-8000-000000000093",
  locationId: f.G21,
  date: "2026-11-23",
  kind: "cancelled",
  baseStart: "07:30",
  baseEnd: "19:00",
  start: null,
  end: null,
  people: null,
  version: 1,
  updatedAt: T,
};
const added = {
  ...cancelled,
  id: "01a1bb3f-0000-7000-8000-000000000094",
  date: "2026-11-18",
  kind: "added",
  baseStart: null,
  baseEnd: null,
  start: "17:00",
  end: "21:00",
  people: 1,
};
const LIST = `GET /schedule/overrides?locationId=${f.G21}`;
const WEEK = `GET /schedule/week?start=${f.MON}`;

const render = (path = `/standorte/${f.G21}`, loc = location) =>
  renderRoutes(path, { "/standorte/:id": <ExceptionsCard location={loc} /> });

describe("ExceptionsCard", () => {
  it("lists exceptions from today on with their labels", async () => {
    mockApi({ [LIST]: json(200, { overrides: [added, cancelled] }) }, [
      "schedule.manage",
    ]);
    render();
    const list = await screen.findByRole("list", {
      name: "Ausnahmen ab heute",
    });
    const rows = within(list).getAllByRole("listitem");
    expect(rows[0]?.textContent).toContain("Mi 18.11.");
    expect(rows[0]?.textContent).toContain("17:00–21:00");
    expect(rows[0]?.textContent).toContain("zusätzlich");
    expect(rows[0]?.textContent).toContain("Soll 1");
    expect(rows[1]?.textContent).toContain("Mo 23.11.");
    expect(rows[1]?.textContent).toContain("entfällt");
  });

  it("shows the empty state and nothing for inactive locations", async () => {
    mockApi({ [LIST]: json(200, { overrides: [] }) }, ["schedule.manage"]);
    render();
    expect(await screen.findByText("Keine Ausnahmen ab heute.")).toBeTruthy();
    cleanup();
    const fetch = mockApi({}, ["schedule.manage"]);
    render(undefined, { ...location, active: false });
    expect(
      screen.getByText("Inaktive Standorte haben keine Ausnahmen."),
    ).toBeTruthy();
    expect(
      fetch.mock.calls.some(([u]) => String(u).startsWith("/schedule")),
    ).toBe(false);
  });

  it("opens the date from the deep link and cancels a shift after confirming names", async () => {
    let body: Record<string, unknown> = {};
    let calls = 0;
    mockApi(
      {
        [LIST]: json(200, { overrides: [] }),
        [WEEK]: json(200, f.week()),
        "POST /schedule/overrides": (init) => {
          body = JSON.parse(String(init.body));
          calls++;
          if (!body.removeAssignments)
            return json(409, {
              error: "has_assignments",
              count: 1,
              names: ["Brandt, Ben"],
            });
          return json(201, {
            ...cancelled,
            date: "2026-11-17",
          });
        },
      },
      ["schedule.manage"],
    );
    render(`/standorte/${f.G21}?datum=2026-11-17`);
    const day = await screen.findByRole("region", {
      name: "Schichten am Di 17.11.",
    });
    expect(within(day).getByText("07:30–19:00 · Soll 1")).toBeTruthy();
    await userEvent.click(
      within(day).getByRole("button", {
        name: "Di 17.11. 07:30–19:00 anpassen",
      }),
    );
    await userEvent.click(
      within(day).getByRole("button", { name: "Entfällt" }),
    );
    expect(
      (
        await within(day).findByRole("group", {
          name: "Einteilungen entfernen",
        })
      ).textContent,
    ).toContain("Brandt, Ben");
    await userEvent.click(
      within(day).getByRole("button", { name: "Ja, entfernen und speichern" }),
    );
    await vi.waitFor(() => expect(calls).toBe(2));
    expect(body).toMatchObject({
      kind: "cancelled",
      locationId: f.G21,
      date: "2026-11-17",
      baseStart: "07:30",
      baseEnd: "19:00",
      removeAssignments: true,
    });
  });

  it("adds an additional shift on a chosen date", async () => {
    let body: Record<string, unknown> = {};
    mockApi(
      {
        [LIST]: json(200, { overrides: [] }),
        [WEEK]: json(200, f.week()),
        "POST /schedule/overrides": (init) => {
          body = JSON.parse(String(init.body));
          return json(201, { ...added, date: "2026-11-19" });
        },
      },
      ["schedule.manage"],
    );
    render();
    const field = await screen.findByLabelText("Datum");
    expect(field.getAttribute("min")).toBe("2026-11-17");
    await userEvent.type(field, "2026-11-19");
    await userEvent.click(
      screen.getByRole("button", { name: "Ausnahme hinzufügen" }),
    );
    const day = await screen.findByRole("region", {
      name: "Schichten am Do 19.11.",
    });
    expect(within(day).getByText("kein Bedarf an diesem Tag")).toBeTruthy();
    await userEvent.click(
      within(day).getByRole("button", {
        name: "Do 19.11. zusätzliche Schicht hinzufügen",
      }),
    );
    await userEvent.click(
      within(day).getByRole("button", { name: "Speichern" }),
    );
    await vi.waitFor(() =>
      expect(body).toMatchObject({
        kind: "added",
        date: "2026-11-19",
        start: "17:00",
        end: "21:00",
        people: 1,
      }),
    );
  });

  it("ignores a deep link into the past", async () => {
    mockApi({ [LIST]: json(200, { overrides: [] }) }, ["schedule.manage"]);
    render(`/standorte/${f.G21}?datum=2026-11-10`);
    await screen.findByText("Keine Ausnahmen ab heute.");
    expect((screen.getByLabelText("Datum") as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("region")).toBeNull();
  });
});
