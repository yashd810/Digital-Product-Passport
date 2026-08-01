import { describe, expect, test } from "vitest";

import { calcCompleteness } from "../user/dashboard/passports/utils/passportListHelpers";

describe("passport list completeness", () => {
  test("measures all author-entered fields, including optional and file fields", () => {
    const types = [{
      typeName: "batteryPassportV1",
      fieldsJson: {
        systemHeader: {
          fieldMappings: [{
            slotKey: "uniqueProductIdentifier",
            sourceType: "managed",
            managedKey: "internalManagedUniqueProductIdentifier",
          }],
        },
        sections: [{
          fields: [
            { key: "modelName", type: "text", minCount: 1 },
            { key: "optionalMaterialShare", type: "text", minCount: 0 },
            { key: "declaration", type: "file", minCount: 0 },
            { key: "uniqueProductIdentifier", type: "text", minCount: 0 },
            { key: "liveTemperature", type: "number", dynamic: true, minCount: 0 },
          ],
        }],
      },
    }];

    expect(calcCompleteness({ passportType: "batteryPassportV1", modelName: "B4ST" }, types)).toBe(33);
    expect(calcCompleteness({
      passportType: "batteryPassportV1",
      modelName: "B4ST",
      optionalMaterialShare: "20",
      declaration: "/repository-files/declaration.pdf",
    }, types)).toBe(100);
  });
});
