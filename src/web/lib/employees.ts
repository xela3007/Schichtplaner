import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import {
  CatalogList,
  ContractTypeInput,
  ContractTypeList,
} from "#shared/catalogs.js";
import { EmployeeInput, EmployeeList } from "#shared/employees.js";
import { LocationList } from "#shared/locations.js";
import { apiFetch } from "@/lib/api";

// --- Hours ↔ minutes (UI uses German decimal hours, the API minutes) --------
/** 450 → "7,5 Std." */
export function formatHours(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "—";
  return `${(minutes / 60).toLocaleString("de-DE", { maximumFractionDigits: 2 })} Std.`;
}
/** 450 → "7,5" (for inputs) */
export function hoursInput(minutes: number | null | undefined): string {
  return minutes === null || minutes === undefined
    ? ""
    : (minutes / 60).toLocaleString("de-DE", {
        maximumFractionDigits: 2,
        useGrouping: false,
      });
}
/** "7,5" → 450, "" → null, garbage → NaN (the schema reports it). */
export function parseHours(input: string | null | undefined): number | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  if (!/^\d+([.,]\d{1,2})?$/.test(s)) return Number.NaN;
  return Math.round(Number(s.replace(",", ".")) * 60);
}

// --- Form schemas: UI strings → minutes → the SAME schema the API uses ------
export const ContractTypeForm = z
  .object({
    name: z.string(),
    weeklyMinutes: z.string(),
    typicalShiftMinutes: z.string(),
    allowedShiftMinutes: z.string(),
    maxDailyMinutes: z.string(),
  })
  .transform(
    (v): z.input<typeof ContractTypeInput> => ({
      name: v.name,
      weeklyMinutes: parseHours(v.weeklyMinutes) ?? Number.NaN,
      typicalShiftMinutes: parseHours(v.typicalShiftMinutes),
      allowedShiftMinutes: v.allowedShiftMinutes
        .split(/[;\s]+/)
        .filter(Boolean)
        .map((x) => parseHours(x) ?? Number.NaN),
      maxDailyMinutes: parseHours(v.maxDailyMinutes),
    }),
  )
  .pipe(ContractTypeInput);
export type ContractTypeFormIn = z.input<typeof ContractTypeForm>;

export const EmployeeForm = z
  .object({
    firstName: z.string(),
    lastName: z.string(),
    mobile: z.string(),
    email: z.string(),
    personnelNo: z.string(),
    contractTypeId: z.string(),
    weeklyMinutesOverride: z.string(),
    isFloater: z.boolean(),
    qualificationIds: z.array(z.string()),
    systemAccessIds: z.array(z.string()),
    locations: z.array(
      z.object({
        locationId: z.string(),
        trained: z.boolean(),
        preference: z.enum(["preferred", "neutral", "blocked"]),
      }),
    ),
    note: z.string(),
  })
  .transform(
    (v): z.input<typeof EmployeeInput> => ({
      ...v,
      weeklyMinutesOverride: parseHours(v.weeklyMinutesOverride),
    }),
  )
  .pipe(EmployeeInput);
export type EmployeeFormIn = z.input<typeof EmployeeForm>;

// --- Queries -----------------------------------------------------------------
export const useContractTypes = () =>
  useQuery({
    queryKey: ["contract-types"],
    queryFn: () =>
      apiFetch("/contract-types", { schema: ContractTypeList, auth: true }),
  });
export const useCatalog = (kind: "qualifications" | "system-accesses") =>
  useQuery({
    queryKey: [kind],
    queryFn: () => apiFetch(`/${kind}`, { schema: CatalogList, auth: true }),
  });
export const useEmployees = () =>
  useQuery({
    queryKey: ["employees"],
    queryFn: () => apiFetch("/employees", { schema: EmployeeList, auth: true }),
  });
/** All locations incl. inactive — callers show active ones only. */
export const useAllLocations = () =>
  useQuery({
    queryKey: ["locations", { includeInactive: true }],
    queryFn: () =>
      apiFetch("/locations?includeInactive=true", {
        schema: LocationList,
        auth: true,
      }),
  });

export const nameOf = (
  list: { id: string; name: string }[] | undefined,
  id: string,
) => list?.find((x) => x.id === id)?.name ?? "unbekannt";
