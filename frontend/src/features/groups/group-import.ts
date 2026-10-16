import { apiFetch } from "../../lib/apiFetch";
import type { CustomerGroup } from "../delivery/types";
export const emailPattern =
  /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
export interface ImportGroup {
  name: string;
  emails: string[];
  recipientNames: Record<string, string>;
}
export interface ImportIssue {
  row: number;
  email: string;
  reason: string;
}
export function previewImport(
  rows: string[][],
  mapping: {
    email: number;
    name: number;
    group: number;
    header: boolean;
    target: string;
  },
  existing: CustomerGroup[],
) {
  const groups = new Map<string, ImportGroup>(),
    issues: ImportIssue[] = [];
  let duplicates = 0;
  const seen = new Map(
    existing.map((g) => [
      g.name,
      new Set(g.emails.map((e) => e.toLowerCase())),
    ]),
  );
  rows.slice(mapping.header ? 1 : 0).forEach((row, i) => {
    if (!row.some((cell) => cell.trim())) return;
    const email = (row[mapping.email] ?? "").trim().toLowerCase(),
      name = (row[mapping.name] ?? "").trim(),
      group =
        (mapping.group >= 0 ? row[mapping.group] : mapping.target)?.trim() ??
        "";
    let reason = "";
    if (!group || group.length > 120)
      reason = "Grup adı gerekli; en fazla 120 karakter.";
    else if (!emailPattern.test(email)) reason = "Geçersiz e-posta";
    else if (name.length > 120) reason = "Ad soyad en fazla 120 karakter.";
    if (reason) {
      issues.push({ row: i + (mapping.header ? 2 : 1), email, reason });
      return;
    }
    const addresses = seen.get(group) ?? new Set<string>();
    seen.set(group, addresses);
    if (addresses.has(email)) {
      duplicates++;
      return;
    }
    addresses.add(email);
    const item = groups.get(group) ?? {
      name: group,
      emails: [],
      recipientNames: {},
    };
    item.emails.push(email);
    item.recipientNames[email] = name;
    groups.set(group, item);
  });
  const overLimit = [...seen]
    .filter(([, emails]) => emails.size > 200)
    .map(([name]) => name);
  return {
    groups: [...groups.values()],
    issues,
    duplicates,
    overLimit,
    total: [...groups.values()].reduce((n, g) => n + g.emails.length, 0),
  };
}
export async function groupRequest(path: string, body: unknown) {
  const response = await apiFetch(`/api/v1/customer-groups/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(
      (await response.json().catch(() => ({}))).message ??
        "İşlem tamamlanamadı.",
    );
  return response;
}
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function exportGroups(
  ids: string[],
  format: "csv" | "xlsx",
  template = false,
) {
  downloadBlob(
    await (await groupRequest("export", { ids, format, template })).blob(),
    `${template ? "ornek-alicilar" : "dagitim-gruplari"}.${format}`,
  );
}
