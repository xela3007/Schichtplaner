import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScheduleWeek } from "#shared/schedule.js";
import { session } from "@/auth/session";
import { json, mockApi, renderRoutes } from "@/test-support/api";
import * as f from "@/test-support/schedule-fixtures";
import { ShiftEditor } from "./ShiftEditor";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  session.reset();
});

const T = "2026-11-08T08:00:00.000Z";
const week = ScheduleWeek.parse(f.week());
const location = week.locations[0] as (typeof week.locations)[number];
const OV = "01a1bb3f-0000-7000-8000-000000000091";
const changed = {
  id: OV,
  locationId: f.G21,
  date: "2026-11-17",
  kind: "changed" as const,
  baseStart: "07:30",
  baseEnd: "19:00",
  start: "07:30",
  end: "15:00",
  people: 1,
  version: 2,
  updatedAt: T,
};
const ovJson = (o: object) => json(201, { ...changed, ...o });

function render(
  shift?: Parameters<typeof ShiftEditor>[0]["shift"],
  onDone = vi.fn(),
) {
  renderRoutes("/x", {
    "/x": (
      <ShiftEditor
        location={location}
        date="2026-11-17"
        shift={shift}
        onDone={onDone}
      />
    ),
  });
  return onDone;
}

describe("ShiftEditor", () => {
  it("adjusting a standard shift posts a changed override; the confirmation lists names and retries", async () => {
    const bodies: Record<string, unknown>[] = [];
    let first = true;
    mockApi(
      {
        "POST /schedule/overrides": (init) => {
          bodies.push(JSON.parse(String(init.body)));
          if (first) {
            first = false;
            return json(409, {
              error: "has_assignments",
              count: 1,
              names: ["Anna Müller"],
            });
          }
          return ovJson({});
        },
      },
      ["schedule.manage"],
    );
    const onDone = render({
      start: "07:30",
      end: "19:00",
      people: 1,
      source: "standard",
    });
    const to = screen.getByLabelText("Bis");
    await userEvent.clear(to);
    await userEvent.type(to, "15:00");
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(
      await screen.findByText(/1 Einteilung passt nicht mehr \(Anna Müller\)/),
    ).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: "Ja, entfernen und speichern" }),
    );
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(bodies[0]).toMatchObject({
      kind: "changed",
      baseStart: "07:30",
      baseEnd: "19:00",
      start: "07:30",
      end: "15:00",
      people: 1,
    });
    expect(bodies[1]).toMatchObject({ removeAssignments: true });
  });

  it("cancel and reset on a changed shift use PUT and DELETE with the version", async () => {
    const fetch = mockApi(
      {
        [`PUT /schedule/overrides/${OV}`]: () =>
          json(200, {
            ...changed,
            kind: "cancelled",
            start: null,
            end: null,
            people: null,
          }),
        [`DELETE /schedule/overrides/${OV}?version=2`]: new Response(null, {
          status: 204,
        }),
      },
      ["schedule.manage"],
    );
    const shift = {
      start: "07:30",
      end: "15:00",
      people: 1,
      source: "changed" as const,
      base: { start: "07:30", end: "19:00" },
      override: changed,
    };
    render(shift);
    await userEvent.click(screen.getByRole("button", { name: "Entfällt" }));
    await vi.waitFor(() =>
      expect(
        fetch.mock.calls.some(
          ([u, i]) =>
            u === `/schedule/overrides/${OV}` &&
            JSON.parse(String(i?.body)).cancelled === true,
        ),
      ).toBe(true),
    );
    cleanup();
    render(shift);
    await userEvent.click(
      screen.getByRole("button", { name: "Auf Standard zurücksetzen" }),
    );
    await vi.waitFor(() =>
      expect(fetch.mock.calls.some(([, i]) => i?.method === "DELETE")).toBe(
        true,
      ),
    );
  });

  it("new shift posts an added override; an added shift offers delete, not cancel", async () => {
    let body: Record<string, unknown> = {};
    mockApi(
      {
        "POST /schedule/overrides": (init) => {
          body = JSON.parse(String(init.body));
          return ovJson({ kind: "added" });
        },
      },
      ["schedule.manage"],
    );
    render(undefined);
    const people = screen.getByLabelText("Personen");
    await userEvent.clear(people);
    await userEvent.type(people, "2");
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await vi.waitFor(() =>
      expect(body).toMatchObject({
        kind: "added",
        start: "17:00",
        end: "21:00",
        people: 2,
      }),
    );
    cleanup();
    render({
      start: "17:00",
      end: "21:00",
      people: 2,
      source: "added",
      override: { ...changed, kind: "added", baseStart: null, baseEnd: null },
    });
    expect(
      screen.getByRole("button", { name: "Schicht löschen" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Entfällt" })).toBeNull();
  });
});
