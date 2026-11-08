import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { session } from "@/auth/session";
import { json, mockApi, renderRoutes } from "@/test-support/api";
import * as f from "@/test-support/employee-fixtures";
import { EmployeeFormPage } from "./EmployeeFormPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  session.reset();
});

const lists = {
  "GET /contract-types": json(200, f.contractTypes),
  "GET /qualifications": json(200, f.qualifications),
  "GET /system-accesses": json(200, f.systems),
  "GET /locations?includeInactive=true": json(200, f.locations),
};
const routes = {
  "/mitarbeiter/neu": <EmployeeFormPage />,
  "/mitarbeiter/:id/bearbeiten": <EmployeeFormPage />,
  "/mitarbeiter/:id": <p>Detailseite</p>,
};

describe("EmployeeFormPage", () => {
  it("shows required-field errors and sends nothing", async () => {
    const fetch = mockApi(lists);
    renderRoutes("/mitarbeiter/neu", routes);
    await userEvent.click(
      await screen.findByRole("button", { name: "Speichern" }),
    );
    expect(
      await screen.findByText("Bitte einen Vornamen angeben."),
    ).toBeTruthy();
    expect(screen.getByText("Bitte eine Handynummer angeben.")).toBeTruthy();
    expect(screen.getByText("Bitte einen Vertragstyp wählen.")).toBeTruthy();
    expect(fetch.mock.calls.some(([, init]) => init?.method === "POST")).toBe(
      false,
    );
  });

  it("creates an employee with normalised phone, hours in minutes and only non-default locations", async () => {
    let body: Record<string, unknown> = {};
    mockApi({
      ...lists,
      "POST /employees": (init) => {
        body = JSON.parse(String(init.body));
        return json(201, { ...f.anna, id: f.ANNA });
      },
    });
    renderRoutes("/mitarbeiter/neu", routes);
    await userEvent.type(await screen.findByLabelText("Vorname"), "Anna");
    await userEvent.type(screen.getByLabelText("Nachname"), "Müller");
    await userEvent.type(screen.getByLabelText("Handynummer"), "0151 23456789");
    await userEvent.selectOptions(screen.getByLabelText("Vertragstyp"), f.CT30);
    await userEvent.type(
      screen.getByLabelText("Abweichende Wochenstunden (optional)"),
      "32,5",
    );
    await userEvent.click(screen.getByLabelText("Kundenbereich"));
    await userEvent.click(screen.getByLabelText("Gebäude 21: eingearbeitet"));
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByText("Detailseite")).toBeTruthy();
    expect(body).toMatchObject({
      mobile: "+4915123456789",
      weeklyMinutesOverride: 1950,
      qualificationIds: [f.QKB],
      locations: [{ locationId: f.G21, trained: true, preference: "neutral" }],
    });
    // inactive qualification is not offered for a new employee
    expect(screen.queryByLabelText("Ersthelfer")).toBeNull();
  });

  it("Springer: trained checkboxes are checked and disabled", async () => {
    mockApi(lists);
    renderRoutes("/mitarbeiter/neu", routes);
    await userEvent.click(
      await screen.findByLabelText(
        "Springer – an allen Standorten eingearbeitet",
      ),
    );
    const box = screen.getByLabelText(
      "Gebäude 5: eingearbeitet (Springer)",
    ) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(true);
  });

  it("keeps an assigned inactive qualification visible; on conflict loads the current state on request", async () => {
    const withEh = { ...f.anna, qualificationIds: [f.QEH, f.QKB] };
    mockApi({
      ...lists,
      [`GET /employees/${f.ANNA}`]: json(200, withEh),
      [`PUT /employees/${f.ANNA}`]: json(409, {
        error: "version_conflict",
        current: { ...withEh, firstName: "Anne", version: 2 },
      }),
    });
    renderRoutes(`/mitarbeiter/${f.ANNA}/bearbeiten`, routes);
    const eh = (await screen.findByLabelText(/Ersthelfer/)) as HTMLInputElement;
    expect(eh.checked).toBe(true);
    expect(screen.getByText("(deaktiviert)")).toBeTruthy();
    const first = screen.getByLabelText("Vorname") as HTMLInputElement;
    await userEvent.clear(first);
    await userEvent.type(first, "Annika");
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(
      await screen.findByText(
        "Der Mitarbeiter wurde inzwischen von jemand anderem geändert",
      ),
    ).toBeTruthy();
    expect((screen.getByLabelText("Vorname") as HTMLInputElement).value).toBe(
      "Annika",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Aktuellen Stand laden" }),
    );
    expect((screen.getByLabelText("Vorname") as HTMLInputElement).value).toBe(
      "Anne",
    );
  });
});
