import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScheduleWeek } from "#shared/schedule.js";
import { session } from "@/auth/session";
import { json, mockApi, renderRoutes } from "@/test-support/api";
import * as f from "@/test-support/schedule-fixtures";
import { AssignDialog } from "./AssignDialog";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  session.reset();
});

const week = ScheduleWeek.parse(f.week());
const shift = {
  location: week.locations[0] as (typeof week.locations)[number],
  date: "2026-11-17",
  start: "07:30",
  end: "19:00",
};

function render(onClose = vi.fn()) {
  renderRoutes("/x", {
    "/x": <AssignDialog week={week} shift={shift} onClose={onClose} />,
  });
  return onClose;
}

describe("AssignDialog", () => {
  it("ranks candidates and disables blocked ones with the reason", async () => {
    mockApi({}, ["schedule.manage"]);
    render();
    const list = screen.getByRole("list", { name: "Mitarbeiter" });
    const buttons = within(list).getAllByRole("button");
    // Ben fits; Anna blocked by "ab 16:00" for 07:30–19:00; Carl on vacation
    expect(buttons[0]?.textContent).toContain("Brandt, Ben");
    const anna = within(list).getByRole("button", {
      name: /Müller, Anna/,
    }) as HTMLButtonElement;
    expect(anna.disabled).toBe(true);
    expect(anna.textContent).toContain("nicht verfügbar Mo–Fr ab 16:00");
    expect(
      (
        within(list).getByRole("button", {
          name: /Abwesend, Carl/,
        }) as HTMLButtonElement
      ).textContent,
    ).toContain("abwesend: Urlaub");
    expect(buttons[0]?.textContent).toContain("noch 30 Std. frei");
  });

  it("partial time unblocks Anna and is sent with the shift anchor", async () => {
    let body: Record<string, unknown> = {};
    mockApi(
      {
        "POST /schedule/assignments": (init) => {
          body = JSON.parse(String(init.body));
          return json(
            201,
            f.asg({ ...body, id: "01a1bb3f-0000-7000-8000-000000000079" }),
          );
        },
      },
      ["schedule.manage"],
    );
    const onClose = render();
    const to = screen.getByLabelText("Bis");
    await userEvent.clear(to);
    await userEvent.type(to, "15:30");
    const anna = screen.getByRole("button", {
      name: /Müller, Anna/,
    }) as HTMLButtonElement;
    expect(anna.disabled).toBe(false);
    await userEvent.click(anna);
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(body).toMatchObject({
      employeeId: f.ANNA,
      start: "07:30",
      end: "15:30",
      shiftStart: "07:30",
      shiftEnd: "19:00",
    });
  });

  it("shows server refusals inline and validates times", async () => {
    mockApi(
      {
        "POST /schedule/assignments": json(409, {
          error: "overlap",
          reasons: [
            {
              code: "overlap",
              message: "Gleichzeitig schon anders eingeteilt.",
            },
          ],
        }),
      },
      ["schedule.manage"],
    );
    render();
    await userEvent.click(screen.getByRole("button", { name: /Brandt, Ben/ }));
    expect(
      await screen.findByText(
        "Nicht eingeteilt: Gleichzeitig schon anders eingeteilt.",
      ),
    ).toBeTruthy();
    const from = screen.getByLabelText("Von");
    await userEvent.clear(from);
    await userEvent.type(from, "06:00");
    expect(
      screen.getByText("Liegt außerhalb der Öffnungszeiten und der Schicht."),
    ).toBeTruthy();
  });
});
