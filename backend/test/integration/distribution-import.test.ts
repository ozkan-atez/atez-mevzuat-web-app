import { afterAll, describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaDeliveryRepository } from "../../src/modules/delivery/infrastructure/prisma-delivery-repository";
const prisma = new PrismaClient(),
  repository = new PrismaDeliveryRepository(prisma);
const prefix = `groups-${crypto.randomUUID()}`;
afterAll(async () => {
  await prisma.customerGroup.deleteMany({
    where: { name: { startsWith: prefix } },
  });
  await prisma.$disconnect();
});
describe("atomic recipient imports", () => {
  it("rolls back all groups when one group exceeds the limit", async () => {
    const name = prefix + "-full";
    await prisma.customerGroup.create({
      data: {
        name,
        emails: Array.from({ length: 200 }, (_, i) => `p${i}@example.com`),
      },
    });
    await expect(
      repository.importGroups([
        {
          name: prefix + "-new",
          emails: ["new@example.com"],
          recipientNames: {},
        },
        { name, emails: ["extra@example.com"], recipientNames: {} },
      ]),
    ).rejects.toThrow("200");
    expect(
      await prisma.customerGroup.findUnique({
        where: { name: prefix + "-new" },
      }),
    ).toBeNull();
    expect(
      (await prisma.customerGroup.findUniqueOrThrow({ where: { name } }))
        .emails,
    ).toHaveLength(200);
  });
  it("retains legacy groups, saves names and resolves the same delivery addresses", async () => {
    const name = prefix + "-legacy";
    const group = await prisma.customerGroup.create({
      data: { name, emails: ["legacy@example.com"] },
    });
    const results = await repository.importGroups([
      {
        name,
        emails: ["new@example.com"],
        recipientNames: { "new@example.com": "İpek Şen" },
      },
    ]);
    expect(results[0]?.recipientNames["new@example.com"]).toBe("İpek Şen");
    expect(await repository.resolveGroupRecipients([group.id])).toEqual([
      "legacy@example.com",
      "new@example.com",
    ]);
  });
});
