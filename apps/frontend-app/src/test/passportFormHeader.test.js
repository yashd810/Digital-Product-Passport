import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

import {
  buildPassportFormHeaderContext,
  resolveManagedSystemHeaderValue,
} from "../shared/passports/systemHeaderManagedValues";

describe("passport form managed header context", () => {
  test("the form renders managed headers through the declared context builder", () => {
    const source = readFileSync(
      new URL("../passports/form/PassportFormPage.js", import.meta.url),
      "utf8"
    );

    expect(source).toContain("buildPassportFormHeaderContext({");
    expect(source).not.toMatch(/\bgetFormValue\s*\(/);
    expect(source).toContain('className="pf-header-locked-pill">Standards header</span>');
    expect(source).not.toContain("entry.semanticId &&");
  });

  test("builds managed header values without relying on an undeclared render helper", () => {
    const context = buildPassportFormHeaderContext({
      formData: {
        dppSchemaVersion: "prEN 18223:2025",
        releaseStatus: "draft",
      },
      modelName: "Battery Model A",
      internalAliasId: "dppId-local-draft",
      passportType: "batteryPassportV1",
      systemHeader: { section: { key: "passportHeader", label: "Passport Header" } },
    });

    expect(context.passport).toMatchObject({
      modelName: "Battery Model A",
      internalAliasId: "dppId-local-draft",
      passportType: "batteryPassportV1",
    });
    expect(context.typeDef.semanticModelKey).toBe("batteryPassportV1");
    expect(context.typeDef.fieldsJson.dppSchemaVersion).toBe("prEN 18223:2025");
    expect(resolveManagedSystemHeaderValue("internalManagedInternalAliasId", context)).toBe("dppId-local-draft");
    expect(resolveManagedSystemHeaderValue("internalManagedContentSpecificationIds", context)).toEqual([
      "batteryPassportV1",
    ]);
  });
});
