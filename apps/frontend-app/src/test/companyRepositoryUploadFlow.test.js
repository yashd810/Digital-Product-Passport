import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const source = readFileSync(
  new URL("../user/dashboard/repository/CompanyRepository.js", import.meta.url),
  "utf8",
);

describe("company repository upload flow", () => {
  test("keeps file and symbol uploads out of their root folders", () => {
    expect(source.match(/const canUpload = currentFolder !== null;/g)).toHaveLength(2);
    expect(source.match(/<UploadFolderRequired itemLabel=/g)).toHaveLength(2);
    expect(source).toContain("Open a folder before uploading a symbol");
    expect(source).toContain("Open a folder before uploading a PDF");
  });

  test("stages PDF selection before the upload is submitted", () => {
    expect(source).toContain("const handleFileChange = (e) => {");
    expect(source).toContain('className="repo-upload-card"');
    expect(source).toContain('onSubmit={handleUpload} className="sym-upload-form"');
    expect(source).toContain('fd.append("parentId", currentFolder);');
    expect(source).not.toContain('fileInputRef.current?.click()');
  });
});
