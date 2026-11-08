import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { session } from "@/auth/session";
import { json, mockApi, renderRoutes } from "@/test-support/api";
import * as f from "@/test-support/employee-fixtures";
import { CatalogsPage } from "./CatalogsPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  session.reset();
});

describe("CatalogsPage", () => {
  it("locks the hours of a contract type in use, name stays editable", async () => {
    mockApi({
      "GET /contract-types": json(200, f.contractTypes),
      "GET /qualifications": json(200, f.qualifications),
      "GET /system-accesses": json(200, f.systems),
    });
    renderRoutes("/mitarbeiter/listen", {
      "/mitarbeiter/listen": <CatalogsPage />,
    });
    expect(
      await screen.findByText(
        /30 Std\.\/Woche · max\. 8 Std\.\/Tag · Schichten 6 \/ 8 Std\./,
      ),
    ).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: "30-Std.-Vertrag bearbeiten" }),
    );
    expect(
      (screen.getByLabelText("Soll-Wochenstunden") as HTMLInputElement)
        .disabled,
    ).toBe(true);
    expect(
      (
        screen.getByLabelText(
          "Erlaubte Schichtlängen in Std. (optional)",
        ) as HTMLInputElement
      ).value,
    ).toBe("6; 8");
    expect((screen.getByLabelText("Name") as HTMLInputElement).disabled).toBe(
      false,
    );
    expect(screen.getByText(/Wird von Mitarbeitern genutzt/)).toBeTruthy();
  });

  it("hides deactivated entries unless shown; reports duplicate names at the field", async () => {
    mockApi({
      "GET /contract-types": json(200, { items: [] }),
      "GET /qualifications": json(200, f.qualifications),
      "GET /system-accesses": json(200, f.systems),
      "POST /qualifications": json(409, { error: "name_taken" }),
    });
    renderRoutes("/mitarbeiter/listen", {
      "/mitarbeiter/listen": <CatalogsPage />,
    });
    expect(await screen.findByText("Kundenbereich")).toBeTruthy();
    expect(screen.queryByText("Ersthelfer")).toBeNull();
    await userEvent.click(
      screen.getAllByLabelText("Deaktivierte anzeigen")[1] as HTMLElement,
    );
    expect(screen.getByText("Ersthelfer")).toBeTruthy();
    await userEvent.type(
      screen.getByLabelText("Neue Qualifikation"),
      "kundenbereich",
    );
    await userEvent.click(
      screen.getAllByRole("button", { name: "Hinzufügen" })[0] as HTMLElement,
    );
    expect(
      await screen.findByText("Diesen Namen gibt es in der Liste schon."),
    ).toBeTruthy();
  });
});
