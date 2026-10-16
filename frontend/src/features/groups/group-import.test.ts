import { describe, it, expect } from "vitest";
import { previewImport } from "./group-import";
import type { CustomerGroup } from "../delivery/types";
const existing = [
  { name: "İthalat", emails: ["ayse@example.com"] },
] as CustomerGroup[];
const mapping = { email: 2, name: 1, group: 0, header: true, target: "" };
describe("import preview", () => {
  it("separates invalid rows and duplicates, preserving cross-group memberships", () => {
    const result = previewImport(
      [
        ["Grup", "Ad Soyad", "E-posta"],
        ["İthalat", "Ayşe", "AYSE@example.com"],
        ["İthalat", "Burcu", "burcu@example.com"],
        ["İthalat", "Burcu", "burcu@example.com"],
        ["Yönetim", "Burcu", "burcu@example.com"],
        ["İthalat", "", "bad"],
      ],
      mapping,
      existing,
    );
    expect(result.total).toBe(2);
    expect(result.duplicates).toBe(2);
    expect(result.issues).toEqual([
      { row: 6, email: "bad", reason: "Geçersiz e-posta" },
    ]);
    expect(result.groups).toHaveLength(2);
  });
  it("blocks aggregate limits including existing members", () => {
    const result = previewImport(
      [["person@example.com"]],
      {
        ...mapping,
        header: false,
        email: 0,
        name: -1,
        group: -1,
        target: "Test",
      },
      [
        {
          name: "Test",
          emails: Array.from({ length: 200 }, (_, i) => `p${i}@example.com`),
        },
      ] as CustomerGroup[],
    );
    expect(result.overLimit).toEqual(["Test"]);
  });
  it("supports headerless single-column paste and optional names", () => {
    const result = previewImport(
      [[" A@example.com "]],
      {
        ...mapping,
        header: false,
        email: 0,
        name: -1,
        group: -1,
        target: "Yeni",
      },
      [],
    );
    expect(result.groups[0]).toEqual({
      name: "Yeni",
      emails: ["a@example.com"],
      recipientNames: { "a@example.com": "" },
    });
  });
});
