import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import ExcelJS from "exceljs";
import {
  groupFileRoutes,
  parseDelimited,
  csvCell,
} from "../../src/modules/delivery/group-files.routes";
import { requiredPermission } from "../../src/modules/auth/route-policy";
import { PrismaDeliveryRepository } from "../../src/modules/delivery/infrastructure/prisma-delivery-repository";

describe("distribution files", () => {
  it("reads Turkish CSV, escaped quotes, separators and multiline cells", () => {
    expect(
      parseDelimited(
        '\uFEFFAd Soyad;E-posta\r\n"Ayşe; \"\"Yılmaz\"\"";ayse@example.com\r\n"İki\nsatır";iki@example.com',
      ),
    ).toEqual([
      ["Ad Soyad", "E-posta"],
      ['Ayşe; "Yılmaz"', "ayse@example.com"],
      ["İki\nsatır", "iki@example.com"],
    ]);
    expect(() => parseDelimited('ad,email\n"bad')).toThrow();
  });
  it("protects CSV spreadsheet formulas", () =>
    expect(csvCell("=1+1")).toBe('"\'=1+1"'));
  it("requires configuration permission for every file operation", () => {
    for (const endpoint of ["parse-file", "import", "export"])
      expect(
        requiredPermission("POST", `/api/v1/customer-groups/${endpoint}`),
      ).toBe("config.manage");
  });
  it("round trips actual XLSX and CSV with recipient names", async () => {
    const app = Fastify();
    const group = {
      id: "g1",
      name: "İthalat",
      emails: ["ayse@example.com"],
      recipientNames: { "ayse@example.com": "Ayşe, Yılmaz" },
    };
    await groupFileRoutes(app, {
      listCustomerGroups: async () => [group],
    } as any);
    for (const format of ["xlsx", "csv"]) {
      const exported = await app.inject({
        method: "POST",
        url: "/export",
        payload: { ids: ["g1"], format },
      });
      expect(exported.statusCode).toBe(200);
      const parsed = await app.inject({
        method: "POST",
        url: "/parse-file",
        payload: {
          filename: `list.${format}`,
          content: exported.rawPayload.toString("base64"),
        },
      });
      expect(parsed.statusCode).toBe(200);
      expect(parsed.json().sheets[0].rows[1]).toEqual([
        "İthalat",
        "Ayşe, Yılmaz",
        "ayse@example.com",
      ]);
    }
    const book = new ExcelJS.Workbook();
    book.addWorksheet("Formül").getCell("A1").value = {
      formula: "1+1",
      result: 2,
    };
    const result = await app.inject({
      method: "POST",
      url: "/parse-file",
      payload: {
        filename: "formula.xlsx",
        content: Buffer.from(await book.xlsx.writeBuffer()).toString("base64"),
      },
    });
    expect(result.statusCode).toBe(400);
    await app.close();
  });
  it("rejects over-limit groups before persistence", async () => {
    const repository = { importGroups: vi.fn() };
    const app = Fastify();
    await groupFileRoutes(app, repository as any);
    const result = await app.inject({
      method: "POST",
      url: "/import",
      payload: {
        groups: [
          {
            name: "Test",
            emails: Array.from({ length: 201 }, (_, i) => `p${i}@example.com`),
          },
        ],
      },
    });
    expect(result.statusCode).toBe(400);
    expect(repository.importGroups).not.toHaveBeenCalled();
    await app.close();
  });
  it("merges without removing existing recipients and keeps delivery addresses", async () => {
    const existing = {
      id: "1",
      name: "Test",
      emails: ["a@example.com"],
      recipientNames: { "a@example.com": "Ayşe" },
      description: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const tx = {
      customerGroup: {
        findUnique: vi.fn().mockResolvedValue(existing),
        update: vi
          .fn()
          .mockImplementation(({ data }) => ({ ...existing, ...data })),
      },
    };
    const prisma = { $transaction: vi.fn((fn) => fn(tx)) };
    const repo = new PrismaDeliveryRepository(prisma as any);
    const groups = await repo.importGroups([
      {
        name: "Test",
        emails: ["a@example.com", "b@example.com"],
        recipientNames: { "b@example.com": "Burcu" },
      },
    ]);
    expect(groups[0]?.emails).toEqual(["a@example.com", "b@example.com"]);
    expect(groups[0]?.recipientNames).toEqual({
      "a@example.com": "Ayşe",
      "b@example.com": "Burcu",
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
  });
});
