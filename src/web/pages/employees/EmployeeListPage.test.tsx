import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { session } from "@/auth/session";
import { json, mockApi, renderRoutes } from "@/test-support/api";
import * as f from "@/test-support/employee-fixtures";
import { EmployeeListPage } from "./EmployeeListPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  session.reset();
});

function setup() {
  mockApi({
    "GET /employees": json(200, f.employees),
    "GET /contract-types": json(200, f.contractTypes),
    "GET /qualifications": json(200, f.qualifications),
    "GET /system-accesses": json(200, f.systems),
    "GET /locations?includeInactive=true": json(200, f.locations),
  });
  renderRoutes("/mitarbeiter", { "/mitarbeiter": <EmployeeListPage /> });
}

const names = () =>
  screen
    .queryAllByText(/^(Müller, Anna|Springer, Ben|Alt, Carl)$/)
    .map((n) => n.textContent);

describe("EmployeeListPage", () => {
  it("shows active employees only; search also finds inactive ones, marked", async () => {
    setup();
    expect(await screen.findByText("Müller, Anna")).toBeTruthy();
    expect(names()).toEqual(["Müller, Anna", "Springer, Ben"]);
    expect(
      screen.getAllByText("30-Std.-Vertrag · 30 Std./Woche", { exact: false }),
    ).toHaveLength(2);
    await userEvent.type(screen.getByLabelText("Suche"), "carl");
    expect(names()).toEqual(["Alt, Carl"]);
    expect(screen.getByText("ausgeschieden")).toBeTruthy();
  });

  it("filters by qualification and by training at a location (Springer count everywhere)", async () => {
    setup();
    await screen.findByText("Müller, Anna");
    await userEvent.selectOptions(
      screen.getByLabelText("Eingearbeitet an"),
      f.G5,
    );
    expect(names()).toEqual(["Springer, Ben"]);
    await userEvent.selectOptions(
      screen.getByLabelText("Eingearbeitet an"),
      f.G21,
    );
    expect(names()).toEqual(["Müller, Anna", "Springer, Ben"]);
    await userEvent.selectOptions(
      screen.getByLabelText("Qualifikation"),
      f.QKB,
    );
    expect(names()).toEqual(["Müller, Anna"]);
    // inactive qualifications are not offered as filter
    expect(screen.queryByRole("option", { name: "Ersthelfer" })).toBeNull();
  });
});
