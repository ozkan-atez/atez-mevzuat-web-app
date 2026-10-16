import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { GroupsPage } from "./GroupsPage";
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  can: vi.fn(() => true),
}));
vi.mock("../auth/AuthProvider", () => ({ useCan: mocks.can }));
vi.mock("../delivery/api", () => ({
  listCustomerGroups: mocks.list,
  createCustomerGroup: mocks.create,
  updateCustomerGroup: mocks.update,
  deleteCustomerGroup: vi.fn(),
}));
afterEach(cleanup);
beforeEach(() => {
  mocks.can.mockReturnValue(true);
  mocks.list.mockResolvedValue([
    {
      id: "g1",
      name: "İthalat",
      description: "Operasyon ekibi",
      emails: ["ayse@example.com"],
      recipientNames: { "ayse@example.com": "Ayşe" },
      isActive: true,
      updatedAt: "2026-10-13",
      createdAt: "2026-10-13",
    },
  ]);
});
describe("GroupsPage", () => {
  it("searches groups and saves named recipients", async () => {
    const user = userEvent.setup();
    render(<GroupsPage />);
    await screen.findByRole("button", { name: "İthalat" });
    await user.type(screen.getByLabelText("Gruplarda ara"), "bulunmayan");
    expect(screen.queryByRole("button", { name: "İthalat" })).toBeNull();
    await user.clear(screen.getByLabelText("Gruplarda ara"));
    await user.click(screen.getByRole("button", { name: "Grubu aç" }));
    await user.type(screen.getByLabelText("Alıcı adı"), "Burcu");
    await user.type(
      screen.getByLabelText("Alıcı e-postası"),
      "burcu@example.com",
    );
    await user.click(screen.getByRole("button", { name: /^Ekle$/ }));
    expect(mocks.update).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Grubu kaydet" }));
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith(
        "g1",
        expect.objectContaining({
          emails: ["ayse@example.com", "burcu@example.com"],
          recipientNames: {
            "ayse@example.com": "Ayşe",
            "burcu@example.com": "Burcu",
          },
        }),
      ),
    );
  });
  it("does not expose import/export/edit controls without management permission", async () => {
    mocks.can.mockReturnValue(false);
    render(<GroupsPage />);
    await screen.findByText("Operasyon ekibi");
    expect(screen.queryByRole("button", { name: "İçe aktar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Yeni grup" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Dışa aktar/ })).toBeNull();
  });
});
