import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { OpeningHours } from "#shared/locations.js";
import { StaffingOverview } from "./StaffingOverview";

afterEach(cleanup);

const hours: OpeningHours = [
  { weekday: "mon", start: "07:30", end: "17:00" },
  { weekday: "tue", start: "07:30", end: "19:00" },
];

describe("StaffingOverview", () => {
  it("adds overlaps, flags gaps and demand outside the opening hours", () => {
    render(
      <StaffingOverview
        openingHours={hours}
        windows={[
          { weekday: "mon", start: "07:30", end: "19:00", people: 2 },
          { weekday: "mon", start: "08:00", end: "10:00", people: 2 },
        ]}
      />,
    );
    expect(screen.getByText("07:30–08:00 · 2 Personen")).toBeTruthy();
    expect(screen.getByText("08:00–10:00 · 4 Personen")).toBeTruthy();
    expect(screen.getByText("10:00–17:00 · 2 Personen")).toBeTruthy();
    expect(screen.getByText("17:00–19:00 · 2 Personen")).toBeTruthy();
    expect(screen.getByText("außerhalb der Öffnungszeiten")).toBeTruthy();
    // Tuesday is open but has no demand
    expect(screen.getByText("07:30–19:00")).toBeTruthy();
    expect(screen.getByText("geöffnet, kein Bedarf hinterlegt")).toBeTruthy();
    // closed days
    expect(screen.getAllByText("geschlossen")).toHaveLength(5);
  });

  it("uses the singular for one person", () => {
    render(
      <StaffingOverview
        openingHours={hours}
        windows={[{ weekday: "mon", start: "07:30", end: "17:00", people: 1 }]}
      />,
    );
    expect(screen.getByText("07:30–17:00 · 1 Person")).toBeTruthy();
  });
});
