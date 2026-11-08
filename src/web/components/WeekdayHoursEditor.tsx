import {
  type Control,
  type FieldErrors,
  type UseFormRegister,
  useFieldArray,
} from "react-hook-form";
import type { z } from "zod";
import type { LocationInput } from "#shared/locations.js";
import { WEEKDAY_LABELS, WEEKDAYS } from "#shared/locations.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type FormValues = z.input<typeof LocationInput>;

type Props = {
  control: Control<FormValues, unknown, z.output<typeof LocationInput>>;
  register: UseFormRegister<FormValues>;
  errors: FieldErrors<FormValues>;
};

/** Opening hours per weekday; several ranges per day; errors come from the shared schema. */
export function WeekdayHoursEditor({ control, register, errors }: Props) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: "openingHours",
  });

  return (
    <fieldset className="grid gap-3">
      <legend className="mb-1 text-sm font-medium">Öffnungszeiten</legend>
      {WEEKDAYS.map((day) => {
        const entries = fields
          .map((field, index) => ({ field, index }))
          .filter(({ field }) => field.weekday === day);
        return (
          <div
            key={day}
            className="grid gap-2 rounded-md border p-3 sm:grid-cols-[8rem_1fr] sm:items-start"
          >
            <div className="pt-2 text-sm font-medium">
              {WEEKDAY_LABELS[day]}
            </div>
            <div className="grid gap-2">
              {entries.length === 0 && (
                <p className="pt-2 text-sm text-muted-foreground">
                  geschlossen
                </p>
              )}
              {entries.map(({ field, index }, position) => {
                const err = errors.openingHours?.[index];
                const message =
                  err?.start?.message ?? err?.end?.message ?? err?.message;
                const startId = `oh-${index}-start`;
                const endId = `oh-${index}-end`;
                return (
                  <div key={field.id} className="grid gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <label htmlFor={startId} className="sr-only">
                        {`${WEEKDAY_LABELS[day]}, Beginn Zeitraum ${position + 1}`}
                      </label>
                      <Input
                        id={startId}
                        type="time"
                        className="w-32"
                        aria-invalid={message ? true : undefined}
                        {...register(`openingHours.${index}.start` as const)}
                      />
                      <span aria-hidden="true">–</span>
                      <label htmlFor={endId} className="sr-only">
                        {`${WEEKDAY_LABELS[day]}, Ende Zeitraum ${position + 1}`}
                      </label>
                      <Input
                        id={endId}
                        type="time"
                        className="w-32"
                        aria-invalid={message ? true : undefined}
                        {...register(`openingHours.${index}.end` as const)}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => remove(index)}
                        aria-label={`${WEEKDAY_LABELS[day]}: Zeitraum ${field.start}–${field.end} entfernen`}
                      >
                        Entfernen
                      </Button>
                    </div>
                    {message && (
                      <p role="alert" className="text-sm text-destructive">
                        {message}
                      </p>
                    )}
                  </div>
                );
              })}
              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    append({ weekday: day, start: "08:00", end: "17:00" })
                  }
                >
                  {`Zeitraum hinzufügen (${WEEKDAY_LABELS[day]})`}
                </Button>
              </div>
            </div>
          </div>
        );
      })}
    </fieldset>
  );
}
