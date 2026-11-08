import { beforeEach, describe, expect, it } from "vitest";
import { makeTestApp } from "../test-support/fakes.js";
import { client, memberAuth } from "../test-support/http.js";

let ctx: ReturnType<typeof makeTestApp>;
let call: ReturnType<typeof client>;
let ct: string;
let ehs: string;
let kb: string;
let vms: string;
let g21: string;
let g5: string;

beforeEach(async () => {
  ctx = makeTestApp();
  call = client(ctx.app);
  ct = (
    await call("POST", "/contract-types", {
      name: "30-Std.-Vertrag",
      weeklyMinutes: 1800,
    })
  ).body.id;
  ehs = (await call("POST", "/qualifications", { name: "Ersthelfer" })).body.id;
  kb = (await call("POST", "/qualifications", { name: "Kundenbereich" })).body
    .id;
  vms = (await call("POST", "/system-accesses", { name: "VMS" })).body.id;
  const hours = [{ weekday: "mon", start: "08:00", end: "17:00" }];
  g21 = (
    await call("POST", "/locations", {
      name: "Gebäude 21",
      kind: "customer_area",
      openingHours: hours,
    })
  ).body.id;
  g5 = (
    await call("POST", "/locations", {
      name: "Gebäude 5",
      kind: "reception",
      openingHours: hours,
    })
  ).body.id;
});

const anna = () => ({
  firstName: "Anna",
  lastName: "Müller",
  mobile: "0151 23456789",
  email: "anna@example.org",
  personnelNo: "P-1",
  contractTypeId: ct,
  weeklyMinutesOverride: 1920,
  qualificationIds: [kb],
  systemAccessIds: [vms],
  locations: [
    { locationId: g21, trained: true, preference: "preferred" },
    { locationId: g5, trained: false, preference: "blocked" },
  ],
  note: "keine Spätschicht",
});

describe("permissions", () => {
  it("401 without login, 403 without employees.manage", async () => {
    expect((await ctx.app.request("/employees")).status).toBe(401);
    expect(
      (await call("GET", "/employees", undefined, await memberAuth())).status,
    ).toBe(403);
    expect(
      (await call("POST", "/employees", anna(), await memberAuth())).status,
    ).toBe(403);
  });
});

describe("create and update", () => {
  it("round-trips all fields incl. join data, phone normalised", async () => {
    const created = await call("POST", "/employees", anna());
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      mobile: "+4915123456789",
      qualificationIds: [kb],
      systemAccessIds: [vms],
      weeklyMinutesOverride: 1920,
      active: true,
      version: 1,
    });
    expect(created.body.locations).toHaveLength(2);
    const got = await call("GET", `/employees/${created.body.id}`);
    expect(got.body).toEqual(created.body);
  });

  it("required fields and invalid phone → validation_failed with fields", async () => {
    const res = await call("POST", "/employees", {
      ...anna(),
      firstName: "",
      mobile: "12",
    });
    expect(res.status).toBe(400);
    expect(res.body.issues.map((i: { field: string }) => i.field)).toEqual(
      expect.arrayContaining(["firstName", "mobile"]),
    );
  });

  it("unknown ids and NEW inactive entries → invalid_reference", async () => {
    await call("POST", `/qualifications/${ehs}/deactivate`, { version: 1 });
    const res = await call("POST", "/employees", {
      ...anna(),
      qualificationIds: [ehs],
      contractTypeId: g21,
    });
    expect(res.body.error).toBe("invalid_reference");
    expect(res.body.issues.map((i: { field: string }) => i.field)).toEqual([
      "contractTypeId",
      "qualificationIds.0",
    ]);
  });

  it("an entry deactivated after assignment may stay on the profile", async () => {
    const created = (
      await call("POST", "/employees", { ...anna(), qualificationIds: [ehs] })
    ).body;
    await call("POST", `/qualifications/${ehs}/deactivate`, { version: 1 });
    const updated = await call("PUT", `/employees/${created.id}`, {
      ...anna(),
      qualificationIds: [ehs],
      version: 1,
    });
    expect(updated.status).toBe(200);
    expect(updated.body.qualificationIds).toEqual([ehs]);
  });

  it("version conflict changes nothing", async () => {
    const created = (await call("POST", "/employees", anna())).body;
    await call("PUT", `/employees/${created.id}`, {
      ...anna(),
      firstName: "Anne",
      version: 1,
    });
    const stale = await call("PUT", `/employees/${created.id}`, {
      ...anna(),
      lastName: "X",
      version: 1,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.current).toMatchObject({
      firstName: "Anne",
      lastName: "Müller",
      version: 2,
    });
    expect(
      (await call("GET", `/employees/${created.id}/history`)).body.entries,
    ).toHaveLength(2);
  });

  it("data for a deactivated location survives a profile save and is back after reactivation", async () => {
    const created = (await call("POST", "/employees", anna())).body;
    await call("POST", `/locations/${g5}/deactivate`, { version: 1 });
    // the form only sends active locations
    const updated = await call("PUT", `/employees/${created.id}`, {
      ...anna(),
      locations: [{ locationId: g21, trained: true, preference: "neutral" }],
      version: 1,
    });
    expect(updated.body.locations).toEqual(
      expect.arrayContaining([
        { locationId: g21, trained: true, preference: "neutral" },
        { locationId: g5, trained: false, preference: "blocked" },
      ]),
    );
  });

  it("deactivate / reactivate keeps all data; 404 for unknown and malformed ids", async () => {
    const created = (await call("POST", "/employees", anna())).body;
    const off = await call("POST", `/employees/${created.id}/deactivate`, {
      version: 1,
    });
    expect(off.body).toMatchObject({ active: false, qualificationIds: [kb] });
    expect(
      (
        await call("POST", `/employees/${created.id}/reactivate`, {
          version: 2,
        })
      ).body.active,
    ).toBe(true);
    expect((await call("GET", "/employees/nope")).status).toBe(404);
    expect((await call("GET", `/employees/${g21}`)).status).toBe(404);
  });
});

describe("history", () => {
  it("records changes, but phone and e-mail only as markers", async () => {
    const created = (await call("POST", "/employees", anna())).body;
    await call("PUT", `/employees/${created.id}`, {
      ...anna(),
      mobile: "+43 664 1234567",
      note: "neu",
      version: 1,
    });
    const { entries } = (await call("GET", `/employees/${created.id}/history`))
      .body;
    expect(entries.map((e: { action: string }) => e.action)).toEqual([
      "updated",
      "created",
    ]);
    expect(entries[0].changes.mobile).toEqual({ from: null, to: null });
    expect(entries[0].changes.note).toEqual({
      from: "keine Spätschicht",
      to: "neu",
    });
    expect(JSON.stringify(entries)).not.toContain("664");
    expect(JSON.stringify(entries)).not.toContain("anna@example.org");
  });
});
