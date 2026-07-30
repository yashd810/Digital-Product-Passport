import { describe, expect, test } from "vitest";

import { calcCompleteness } from "../user/dashboard/passports/utils/passportListHelpers";

describe("passport list completeness", () => {
  test("measures required fields instead of optional battery details", () => {
    const types = [{
      typeName: "batteryPassportV1",
      fieldsJson: {
        sections: [{
          fields: [
            { key: "modelName", type: "text", minCount: 1 },
            { key: "optionalMaterialShare", type: "text", minCount: 0 },
          ],
        }],
      },
    }];

    expect(calcCompleteness({ passportType: "batteryPassportV1", modelName: "B4ST" }, types)).toBe(100);
    expect(calcCompleteness({ passportType: "batteryPassportV1", optionalMaterialShare: "20" }, types)).toBe(0);
  });
});
