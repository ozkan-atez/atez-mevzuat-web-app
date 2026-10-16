import ExcelJS from "exceljs";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { PrismaDeliveryRepository } from "./infrastructure/prisma-delivery-repository";
import { customerGroupCreateSchema } from "./delivery.schemas";

export function parseDelimited(text: string): string[][] {
  text = text.replace(/^\uFEFF/, "");
  const first = text.split(/\r?\n/)[0] ?? "";
  const counts = new Map([
    ["\t", 0],
    [";", 0],
    [",", 0],
  ]);
  let inQuotes = false;
  for (let i = 0; i < first.length; i++) {
    const ch = first[i]!;
    if (ch === '\"') {
      if (inQuotes && first[i + 1] === '\"') i++;
      else inQuotes = !inQuotes;
    } else if (!inQuotes && counts.has(ch)) counts.set(ch, counts.get(ch)! + 1);
  }
  const separator = [...counts].sort((a, b) => b[1] - a[1])[0]![0];
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && char === separator) {
      row.push(cell);
      cell = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (quoted) throw new Error("CSV içinde kapanmamış tırnak bulundu.");
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}
export function csvCell(value: string) {
  const safe = /^[\s]*[=+@-]/.test(value) ? "'" + value : value;
  return '"' + safe.replace(/"/g, '""') + '"';
}
export async function groupFileRoutes(
  app: FastifyInstance,
  repository: PrismaDeliveryRepository,
) {
  app.post("/parse-file", { bodyLimit: 7_000_000 }, async (request, reply) => {
    const parsed = z
      .object({ filename: z.string(), content: z.string().max(6_900_000) })
      .safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ message: "Geçerli bir dosya seçin." });
    try {
      const { filename, content } = parsed.data;
      const bytes = Buffer.from(content, "base64");
      if (bytes.length > 5_000_000)
        throw new Error("Dosya en fazla 5 MB olabilir.");
      let sheets: { name: string; rows: string[][] }[];
      if (/\.xlsx$/i.test(filename)) {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(bytes as any);
        sheets = workbook.worksheets.map((sheet) => {
          if (sheet.rowCount > 10001 || sheet.columnCount > 100)
            throw new Error("En fazla 10.000 satır ve 100 sütun desteklenir.");
          const rows: string[][] = [];
          sheet.eachRow({ includeEmpty: true }, (row) => {
            const cells: string[] = [];
            for (let i = 1; i <= sheet.columnCount; i++) {
              const cell = row.getCell(i);
              if (cell.type === ExcelJS.ValueType.Formula)
                throw new Error(
                  "Formülleri değer olarak yapıştırıp yeniden deneyin.",
                );
              cells.push(cell.text);
            }
            rows.push(cells);
          });
          return { name: sheet.name, rows };
        });
      } else if (/\.(csv|tsv|txt)$/i.test(filename))
        sheets = [
          { name: "Liste", rows: parseDelimited(bytes.toString("utf8")) },
        ];
      else
        throw new Error(
          "XLSX, CSV veya TSV dosyası seçin. Eski XLS dosyasını XLSX olarak kaydedin.",
        );
      if (
        sheets.some(
          (s) => s.rows.length > 10001 || s.rows.some((r) => r.length > 100),
        )
      )
        throw new Error("En fazla 10.000 satır ve 100 sütun desteklenir.");
      return { sheets };
    } catch (error) {
      return reply
        .code(400)
        .send({
          message: error instanceof Error ? error.message : "Dosya okunamadı.",
        });
    }
  });
  app.post("/import", { bodyLimit: 7_000_000 }, async (request, reply) => {
    const parsed = z
      .object({
        groups: z
          .array(
            customerGroupCreateSchema.pick({
              name: true,
              emails: true,
              recipientNames: true,
            }),
          )
          .min(1)
          .max(50),
      })
      .safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({
          message:
            "En fazla 50 grup ve grup başına 200 geçerli alıcı eklenebilir.",
        });
    try {
      return {
        groups: await repository.importGroups(
          parsed.data.groups.map((group) => ({
            ...group,
            emails: group.emails.map((e) => e.toLowerCase()),
            recipientNames: group.recipientNames ?? {},
          })),
        ),
      };
    } catch (error) {
      return reply
        .code(409)
        .send({
          message:
            error instanceof Error
              ? error.message
              : "Aktarım tamamlanamadı; tekrar deneyin.",
        });
    }
  });
  app.post("/export", async (request, reply) => {
    const parsed = z
      .object({
        ids: z.array(z.string()).max(1000),
        format: z.enum(["csv", "xlsx"]),
        template: z.boolean().optional(),
      })
      .safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ message: "Dışa aktarma seçimi geçersiz." });
    const groups = parsed.data.template
      ? []
      : (await repository.listCustomerGroups()).filter((g) =>
          parsed.data.ids.includes(g.id),
        );
    const rows = [
      ["Grup", "Ad Soyad", "E-posta"],
      ...groups.flatMap((g) =>
        g.emails.map((email) => [g.name, g.recipientNames[email] ?? "", email]),
      ),
    ];
    if (parsed.data.template)
      rows.push(["Örnek grup", "Ayşe Yılmaz", "ayse@example.com"]);
    reply.header(
      "Content-Disposition",
      `attachment; filename="dagitim-gruplari.${parsed.data.format}"`,
    );
    if (parsed.data.format === "csv")
      return reply
        .type("text/csv; charset=utf-8")
        .send(
          "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n"),
        );
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Alıcılar");
    sheet.addRows(rows);
    sheet.getRow(1).font = { bold: true };
    sheet.columns.forEach((column) => (column.width = 32));
    return reply
      .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .send(Buffer.from(await workbook.xlsx.writeBuffer()));
  });
}
