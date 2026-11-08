import { zodResolver } from "@hookform/resolvers/zod";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { LocationInput } from "#shared/locations.js";
import { WeekdayHoursEditor } from "./WeekdayHoursEditor";

function Harness({
  onValid,
}: {
  onValid: (v: z.output<typeof LocationInput>) => void;
}) {
  const form = useForm<
    z.input<typeof LocationInput>,
    unknown,
    z.output<typeof LocationInput>
  >({
    resolver: zodResolver(LocationInput),
    defaultValues: {
      name: "Gebäude 21",
      kind: "customer_area",
      openingHours: [],
    },
  });
  return (
    <form onSubmit={form.handleSubmit(onValid)} noValidate>
      <WeekdayHoursEditor
        control={form.control}
        register={form.register}
        errors={form.formState.errors}
      />
      <button type="submit">Speichern</button>
    </form>
  );
}

afterEach(cleanup);

describe("WeekdayHoursEditor", () => {
  it("adds and removes ranges per weekday", async () => {
    render(<Harness onValid={() => {}} />);
    expect(screen.getAllByText("geschlossen")).toHaveLength(7);
    await userEvent.click(
      screen.getByRole("button", { name: "Zeitraum hinzufügen (Montag)" }),
    );
    expect(screen.getByLabelText("Montag, Beginn Zeitraum 1")).toBeTruthy();
    expect(screen.getAllByText("geschlossen")).toHaveLength(6);
    await userEvent.click(
      screen.getByRole("button", { name: /Montag: Zeitraum .* entfernen/ }),
    );
    expect(screen.getAllByText("geschlossen")).toHaveLength(7);
  });

  it("shows the overlap message from the shared schema and blocks submit", async () => {
    const onValid = vi.fn();
    render(<Harness onValid={onValid} />);
    const add = screen.getByRole("button", {
      name: "Zeitraum hinzufügen (Dienstag)",
    });
    await userEvent.click(add);
    await userEvent.click(add);
    // second range 11:00–15:00 overlaps the default 08:00–17:00
    fireEvent.change(screen.getByLabelText("Dienstag, Beginn Zeitraum 2"), {
      target: { value: "11:00" },
    });
    fireEvent.change(screen.getByLabelText("Dienstag, Ende Zeitraum 2"), {
      target: { value: "15:00" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(
      await screen.findByText(/Überschneidet sich mit 08:00–17:00/),
    ).toBeTruthy();
    expect(onValid).not.toHaveBeenCalled();
  });
});
