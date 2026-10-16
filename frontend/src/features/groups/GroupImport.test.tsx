import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, it, expect, vi } from "vitest";
import { GroupImport } from "./GroupImport";
vi.mock("./group-import", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./group-import")>()),
  groupRequest: vi.fn(async () => ({
    json: async () => ({
      sheets: [
        {
          name: "Liste",
          rows: [
            ["Grup", "Ad Soyad", "E-posta"],
            ["Yeni", "Ayşe", "ayse@example.com"],
            ["Yeni", "Tekrar", "AYSE@example.com"],
            ["Yeni", "Hatalı", "bad"],
          ],
        },
      ],
    }),
  })),
}));
afterEach(cleanup);
describe("import wizard", () => {
  it("requires preview before applying and shows rejected rows", async () => {
    const apply = vi.fn().mockResolvedValue(undefined),
      close = vi.fn(),
      user = userEvent.setup();
    render(<GroupImport groups={[]} onApply={apply} onClose={close} />);
    await user.type(screen.getByRole("textbox"), "liste");
    await user.click(
      screen.getByRole("button", { name: "Yapıştırılan listeyi oku" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Önizlemeyi aç" }),
    );
    expect(
      screen.getByText(
        "1 yeni alıcı · 1 tekrar atlanacak · 1 hatalı satır atlanacak",
      ),
    ).toBeTruthy();
    expect(apply).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "1 alıcıyı kaydet" }));
    expect(apply).toHaveBeenCalledWith([
      {
        name: "Yeni",
        emails: ["ayse@example.com"],
        recipientNames: { "ayse@example.com": "Ayşe" },
      },
    ]);
    expect(close).toHaveBeenCalled();
  });
  it("cancels without saving", async () => {
    const apply = vi.fn(),
      close = vi.fn(),
      user = userEvent.setup();
    render(<GroupImport groups={[]} onApply={apply} onClose={close} />);
    await user.click(screen.getByRole("button", { name: "Vazgeç" }));
    expect(close).toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });
});
