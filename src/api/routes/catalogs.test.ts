import { beforeEach, describe, expect, it } from "vitest";
import { makeTestApp } from "../test-support/fakes.js";
import { client, memberAuth } from "../test-support/http.js";

let ctx: ReturnType<typeof makeTestApp>;
let call: ReturnType<typeof client>;
beforeEach(() => {
  ctx = makeTestApp();
  call = client(ctx.app);
});

const CT = {
  name: "30-Std.-Vertrag",
  weeklyMinutes: 1800,
  allowedShiftMinutes: [360, 480],
  maxDailyMinutes: 480,
};

describe("permissions", () => {
  it("401 without login, 403 without employees.manage", async () => {
    for (const path of [
      "/contract-types",
      "/qualifications",
      "/system-accesses",
    ]) {
      expect((await ctx.app.request(path)).status, path).toBe(401);
      expect(
        (await call("GET", path, undefined, await memberAuth())).status,
        path,
      ).toBe(403);
      expect(
        (await call("POST", path, { name: "x" }, await memberAuth())).status,
        path,
      ).toBe(403);
    }
  });
});

describe("qualifications / system accesses", () => {
  it("create, case-insensitive name_taken, rename, deactivate/reactivate", async () => {
    for (const base of ["/qualifications", "/system-accesses"]) {
      const created = await call("POST", base, { name: "Ersthelfer" });
      expect(created.status).toBe(201);
      expect(
        (await call("POST", base, { name: "ersthelfer" })).body.error,
      ).toBe("name_taken");
      const id = created.body.id;
      const renamed = await call("PUT", `${base}/${id}`, {
        name: "Erste Hilfe",
        version: 1,
      });
      expect(renamed.body).toMatchObject({ name: "Erste Hilfe", version: 2 });
      const off = await call("POST", `${base}/${id}/deactivate`, {
        version: 2,
      });
      expect(off.body.active).toBe(false);
      expect(
        (await call("POST", `${base}/${id}/reactivate`, { version: 2 })).body
          .error,
      ).toBe("version_conflict");
      expect((await call("GET", base)).body.items).toHaveLength(1);
    }
  });

  it("400 for empty names, 404 for unknown ids", async () => {
    expect(
      (await call("POST", "/qualifications", { name: "  " })).body.error,
    ).toBe("validation_failed");
    expect(
      (await call("PUT", "/qualifications/nope", { name: "x", version: 1 }))
        .status,
    ).toBe(404);
  });
});

describe("contract types", () => {
  it("creates with defaults and validates hour consistency", async () => {
    const created = await call("POST", "/contract-types", CT);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      typicalShiftMinutes: null,
      inUse: false,
      active: true,
    });
    const bad = await call("POST", "/contract-types", {
      name: "x",
      weeklyMinutes: 1200,
      allowedShiftMinutes: [600],
      maxDailyMinutes: 480,
    });
    expect(bad.body.issues[0].field).toBe("allowedShiftMinutes");
  });

  it("hours are locked while used — also by an inactive employee; renaming still works", async () => {
    const ct = (await call("POST", "/contract-types", CT)).body;
    const emp = await call("POST", "/employees", {
      firstName: "Anna",
      lastName: "Müller",
      mobile: "0151 23456789",
      contractTypeId: ct.id,
    });
    await call("POST", `/employees/${emp.body.id}/deactivate`, { version: 1 });
    const list = (await call("GET", "/contract-types")).body.items;
    expect(list[0].inUse).toBe(true);
    const locked = await call("PUT", `/contract-types/${ct.id}`, {
      ...CT,
      weeklyMinutes: 1920,
      version: 1,
    });
    expect(locked.status).toBe(409);
    expect(locked.body.error).toBe("contract_type_in_use");
    const renamed = await call("PUT", `/contract-types/${ct.id}`, {
      ...CT,
      name: "30 Std.",
      version: 1,
    });
    expect(renamed.body).toMatchObject({ name: "30 Std.", version: 2 });
    expect(
      (await call("PUT", `/contract-types/${ct.id}`, { ...CT, version: 1 }))
        .body.error,
    ).toBe("version_conflict");
  });

  it("unused types can change hours", async () => {
    const ct = (await call("POST", "/contract-types", CT)).body;
    const res = await call("PUT", `/contract-types/${ct.id}`, {
      ...CT,
      weeklyMinutes: 1920,
      version: 1,
    });
    expect(res.body.weeklyMinutes).toBe(1920);
  });
});
