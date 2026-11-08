import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { session } from "@/auth/session";
import { json, mockApi, renderRoutes } from "@/test-support/api";
import { AvailabilitySection } from "./AvailabilitySection";

const E = "01a1bb3f-0000-7000-8000-000000000041";
const T = "2026-11-08T08:00:00.000Z";
const vacation = {
  id: "01a1bb3f-0000-7000-8000-000000000051",
  employeeId: E,
  kind: "vacation",
  startDate: "2026-10-05",
  endDate: "2026-10-16",
  startTime: null,
  endTime: null,
  note: "Mallorca",
  version: 1,
  updatedAt: T,
};
const wish = {
  ...vacation,
  id: "01a1bb3f-0000-7000-8000-000000000052",
  kind: "wish_off",
  startDate: "2026-11-20",
  endDate: "2026-11-20",
  note: null,
};
const rule = {
  id: "01a1bb3f-0000-7000-8000-000000000061",
  employeeId: E,
  weekdays: ["mon", "tue", "wed", "thu", "fri"],
  startTime: "16:00",
  endTime: null,
  version: 1,
  updatedAt: T,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  session.reset();
});

const render = () =>
  renderRoutes("/x", { "/x": <AvailabilitySection employeeId={E} /> });

describe("AvailabilitySection", () => {
  it("lists absences and rules; Wunsch frei is marked weich", async () => {
    mockApi({
      [`GET /employees/${E}/availability`]: json(200, {
        absences: [vacation, wish],
        rules: [rule],
      }),
    });
    render();
    expect(await screen.findByText("05.10.–16.10.2026")).toBeTruthy();
    expect(screen.getByText("– Mallorca")).toBeTruthy();
    expect(screen.getByText("Wunsch frei · weich")).toBeTruthy();
    expect(screen.getByText("Nicht verfügbar: Mo–Fr ab 16:00")).toBeTruthy();
  });

  it("adds a single-day absence with times; hourly only for one day", async () => {
    let body: Record<string, unknown> = {};
    mockApi({
      [`GET /employees/${E}/availability`]: json(200, {
        absences: [],
        rules: [],
      }),
      [`POST /employees/${E}/absences`]: (init) => {
        body = JSON.parse(String(init.body));
        return json(201, { ...vacation, ...body });
      },
    });
    render();
    await userEvent.click(
      await screen.findByRole("button", { name: "Abwesenheit hinzufügen" }),
    );
    await userEvent.selectOptions(screen.getByLabelText("Art"), "appointment");
    await userEvent.type(screen.getByLabelText("Von"), "2026-11-10");
    await userEvent.type(
      screen.getByLabelText("Bis (leer = ein Tag)"),
      "2026-11-12",
    );
    const hourly = screen.getByLabelText(
      /nur stundenweise/,
    ) as HTMLInputElement;
    expect(hourly.disabled).toBe(true);
    await userEvent.clear(screen.getByLabelText("Bis (leer = ein Tag)"));
    expect(hourly.disabled).toBe(false);
    await userEvent.click(hourly);
    await userEvent.type(screen.getByLabelText("Von (Uhrzeit)"), "14:00");
    await userEvent.type(screen.getByLabelText("Bis (Uhrzeit)"), "16:00");
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await vi.waitFor(() =>
      expect(body).toMatchObject({
        kind: "appointment",
        startDate: "2026-11-10",
        endDate: "2026-11-10",
        startTime: "14:00",
        endTime: "16:00",
      }),
    );
  });

  it("deletes only after confirmation, with the loaded version", async () => {
    const fetch = mockApi({
      [`GET /employees/${E}/availability`]: json(200, {
        absences: [vacation],
        rules: [],
      }),
      [`DELETE /absences/${vacation.id}?version=1`]: new Response(null, {
        status: 204,
      }),
    });
    render();
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Abwesenheit 05.10.–16.10.2026 löschen",
      }),
    );
    expect(screen.getByText(/lässt sich nicht rückgängig machen/)).toBeTruthy();
    expect(fetch.mock.calls.some(([, i]) => i?.method === "DELETE")).toBe(
      false,
    );
    await userEvent.click(screen.getByRole("button", { name: "Ja, löschen" }));
    await vi.waitFor(() =>
      expect(fetch.mock.calls.some(([, i]) => i?.method === "DELETE")).toBe(
        true,
      ),
    );
  });

  it("adds a rule via the Mo–Fr shortcut and 'ab'", async () => {
    let body: Record<string, unknown> = {};
    mockApi({
      [`GET /employees/${E}/availability`]: json(200, {
        absences: [],
        rules: [],
      }),
      [`POST /employees/${E}/availability-rules`]: (init) => {
        body = JSON.parse(String(init.body));
        return json(201, rule);
      },
    });
    render();
    await userEvent.click(
      await screen.findByRole("button", { name: "Regel hinzufügen" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Mo–Fr" }));
    await userEvent.click(screen.getByLabelText("ab"));
    await userEvent.type(screen.getByLabelText("Ab (Uhrzeit)"), "16:00");
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await vi.waitFor(() =>
      expect(body).toEqual({
        weekdays: ["mon", "tue", "wed", "thu", "fri"],
        startTime: "16:00",
        endTime: null,
      }),
    );
  });
});
