import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScheduleWeek } from "#shared/schedule.js";
import { session } from "@/auth/session";
import { json, mockApi, renderRoutes } from "@/test-support/api";
import * as f from "@/test-support/schedule-fixtures";
import { CopyList } from "./CopyList";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  session.reset();
});

const week = ScheduleWeek.parse(f.week());
const ID = "01a1bb3f-0000-7000-8000-000000000091";
const copy = (o: object = {}) => ({
  id: ID,
  sourceStart: "2026-11-09",
  targetStarts: ["2026-11-23", "2026-11-16"],
  locationIds: [f.G21, f.G5],
  copied: 24,
  remaining: 18,
  actorEmail: "anke@example.org",
  createdAt: "2026-11-10T13:03:00.000Z",
  undoneAt: null,
  version: 1,
  ...o,
});
const render = () =>
  renderRoutes("/x", { "/x": <CopyList week={week} editable /> });

describe("CopyList", () => {
  it("shows a line per copy and undoes after confirmation", async () => {
    let body: unknown = null;
    mockApi(
      {
        "GET /schedule/copies": json(200, { items: [copy()] }),
        [`POST /schedule/copies/${ID}/undo`]: (init) => {
          body = JSON.parse(String(init.body));
          return json(200, { removed: 18, copy: copy({ version: 2 }) });
        },
      },
      ["schedule.manage"],
    );
    render();
    await userEvent.click(
      screen.getByRole("button", { name: "Übernahmen anzeigen" }),
    );
    const line = await screen.findByText("KW 46 → KW 47, 48");
    expect(line.parentElement?.textContent).toContain(
      "Gebäude 21, Gebäude 5 · 24 übernommen, 18 noch vorhanden",
    );
    await userEvent.click(
      screen.getByRole("button", { name: /rückgängig machen/ }),
    );
    expect(
      screen.getByText(
        /18 Einteilungen ab heute entfernen\? Vergangene Tage bleiben\./,
      ),
    ).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: "Ja, entfernen" }),
    );
    await vi.waitFor(() => expect(body).toEqual({ version: 1 }));
  });

  it("shows undone copies without an undo button", async () => {
    mockApi(
      {
        "GET /schedule/copies": json(200, {
          items: [copy({ undoneAt: "2026-11-10T14:00:00.000Z", remaining: 0 })],
        }),
      },
      ["schedule.manage"],
    );
    render();
    await userEvent.click(
      screen.getByRole("button", { name: "Übernahmen anzeigen" }),
    );
    expect(await screen.findByText(/zurückgenommen am/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /rückgängig/ })).toBeNull();
  });
});
