import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Drawer,
  Dropdown,
  Empty,
  Input,
  Modal,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import {
  DownloadOutlined,
  PlusOutlined,
  SearchOutlined,
  TeamOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import {
  createCustomerGroup,
  deleteCustomerGroup,
  listCustomerGroups,
  updateCustomerGroup,
} from "../delivery/api";
import type { CustomerGroup } from "../delivery/types";
import { useCan } from "../auth/AuthProvider";
import { GroupImport } from "./GroupImport";
import { emailPattern, exportGroups, groupRequest } from "./group-import";
import "./groups.css";
interface Draft {
  id: string;
  name: string;
  description: string;
  emails: string[];
  recipientNames: Record<string, string>;
}
export function GroupsPage() {
  const canManage = useCan("config.manage");
  const [groups, setGroups] = useState<CustomerGroup[]>([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState("all"),
    [selected, setSelected] = useState<React.Key[]>([]),
    [draft, setDraft] = useState<Draft | null>(null),
    [dirty, setDirty] = useState(false),
    [importing, setImporting] = useState(false),
    [personName, setPersonName] = useState(""),
    [personEmail, setPersonEmail] = useState(""),
    [recipientSearch, setRecipientSearch] = useState("");
  const [modal, contextHolder] = Modal.useModal();
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setGroups(await listCustomerGroups());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  function edit(group?: CustomerGroup) {
    setDraft(
      group
        ? {
            id: group.id,
            name: group.name,
            description: group.description ?? "",
            emails: [...group.emails],
            recipientNames: { ...group.recipientNames },
          }
        : {
            id: "new",
            name: "",
            description: "",
            emails: [],
            recipientNames: {},
          },
    );
    setDirty(false);
    setPersonName("");
    setPersonEmail("");
    setRecipientSearch("");
    setError("");
  }
  function change(update: Partial<Draft>) {
    setDraft((d) => (d ? { ...d, ...update } : d));
    setDirty(true);
  }
  function close() {
    if (busy || importing) return;
    if (dirty) {
      modal.confirm({
        title: "Kaydedilmemiş değişiklikler var",
        content: "Değişiklikleri bırakıp kapatmak istiyor musunuz?",
        okText: "Değişiklikleri bırak",
        cancelText: "Düzenlemeye dön",
        onOk: () => setDraft(null),
      });
    } else setDraft(null);
  }
  async function action(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    try {
      await fn();
      setNotice(message);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function download(
    format: "csv" | "xlsx",
    template = false,
    ids?: string[],
  ) {
    try {
      await exportGroups(
        ids ??
          (selected.length ? selected.map(String) : groups.map((g) => g.id)),
        format,
        template,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const visible = groups.filter(
    (g) =>
      (status === "all" || g.isActive === (status === "active")) &&
      [
        g.name,
        g.description,
        ...g.emails,
        ...Object.values(g.recipientNames ?? {}),
      ]
        .join(" ")
        .toLocaleLowerCase("tr")
        .includes(query.toLocaleLowerCase("tr")),
  );
  const menu = (ids?: string[]) => ({
    items: [
      { key: "csv", label: "CSV olarak indir" },
      { key: "xlsx", label: "Excel olarak indir" },
    ],
    onClick: ({ key }: { key: string }) =>
      void download(key as "csv" | "xlsx", false, ids),
  });
  return (
    <div className="atez-groups">
      {contextHolder}
      <div className="atez-groups-header">
        <div>
          <span className="groups-eyebrow">ATEZ / DAĞITIM</span>
          <Typography.Title level={2}>
            <TeamOutlined /> Dağıtım grupları
          </Typography.Title>
          <Typography.Text type="secondary">
            Doğru bülteni doğru alıcılara ulaştırın. E-posta listelerinizi tek
            yerden yönetin.
          </Typography.Text>
        </div>
        {canManage && (
          <Space wrap>
            <Dropdown menu={menu()} disabled={!groups.length}>
              <Button icon={<DownloadOutlined />}>
                Dışa aktar{selected.length ? ` (${selected.length})` : ""}
              </Button>
            </Dropdown>
            <Button
              icon={<UploadOutlined />}
              onClick={() => {
                setDraft(null);
                setImporting(true);
              }}
            >
              İçe aktar
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => edit()}
            >
              Yeni grup
            </Button>
          </Space>
        )}
      </div>
      {error && !draft && (
        <Alert
          type="error"
          showIcon
          message={error}
          closable
          onClose={() => setError("")}
        />
      )}
      {notice && (
        <Alert
          type="success"
          showIcon
          message={notice}
          closable
          onClose={() => setNotice("")}
        />
      )}
      <div className="groups-summary">
        <Card>
          <Statistic title="Toplam grup" value={groups.length} />
        </Card>
        <Card>
          <Statistic
            title="Aktif grup"
            value={groups.filter((g) => g.isActive).length}
          />
        </Card>
        <Card>
          {canManage ? (
            <Statistic
              title="Benzersiz alıcı"
              value={new Set(groups.flatMap((g) => g.emails)).size}
            />
          ) : (
            <Statistic
              title="Toplam grup üyeliği"
              value={groups.reduce((n, g) => n + (g.recipientCount ?? 0), 0)}
            />
          )}
        </Card>
      </div>
      <Card className="groups-table-card">
        <div className="groups-toolbar">
          <div>
            <Typography.Title level={4}>E-posta grupları</Typography.Title>
            <Typography.Text type="secondary">
              {visible.length} grup · Grup başına en fazla 200 alıcı
            </Typography.Text>
          </div>
          <Space wrap>
            <Input
              prefix={<SearchOutlined />}
              allowClear
              aria-label="Gruplarda ara"
              placeholder="Grup veya e-posta ara"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Select
              aria-label="Grup durumu"
              value={status}
              onChange={setStatus}
              options={[
                { value: "all", label: "Tüm durumlar" },
                { value: "active", label: "Aktif" },
                { value: "inactive", label: "Pasif" },
              ]}
            />
          </Space>
        </div>
        <Table
          rowKey="id"
          loading={loading}
          dataSource={visible}
          scroll={{ x: 780 }}
          rowSelection={
            canManage
              ? { selectedRowKeys: selected, onChange: setSelected }
              : undefined
          }
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          locale={{
            emptyText: (
              <Empty
                description={
                  groups.length
                    ? "Aramanıza uygun grup yok."
                    : "İlk dağıtım grubunuzu oluşturun."
                }
              />
            ),
          }}
          columns={[
            {
              title: "Grup",
              sorter: (a, b) => a.name.localeCompare(b.name, "tr"),
              render: (_, g) => (
                <div>
                  <Button
                    className="group-name-button"
                    type="link"
                    disabled={!canManage}
                    onClick={() => edit(g)}
                  >
                    {g.name}
                  </Button>
                  <div className="group-description">
                    {g.description || "Açıklama eklenmemiş"}
                  </div>
                </div>
              ),
            },
            {
              title: "Alıcılar",
              render: (_, g) => (
                <div>
                  <strong>{g.recipientCount ?? g.emails.length} kişi</strong>
                  <div className="group-description">
                    {g.emails.slice(0, 2).join(", ")}
                    {g.emails.length > 2 ? " …" : ""}
                  </div>
                </div>
              ),
            },
            {
              title: "Durum",
              render: (_, g) => (
                <Tag color={g.isActive ? "success" : "default"}>
                  {g.isActive ? "Aktif" : "Pasif"}
                </Tag>
              ),
            },
            {
              title: "Son güncelleme",
              sorter: (a, b) => a.updatedAt.localeCompare(b.updatedAt),
              render: (_, g) =>
                new Date(g.updatedAt).toLocaleDateString("tr-TR"),
            },
            {
              title: "İşlemler",
              render: (_, g) =>
                canManage ? (
                  <Space>
                    <Switch
                      size="small"
                      checked={g.isActive}
                      disabled={busy}
                      aria-label={`${g.name} durumunu değiştir`}
                      onChange={() =>
                        void action(
                          () =>
                            updateCustomerGroup(g.id, {
                              isActive: !g.isActive,
                            }),
                          "Grup durumu güncellendi.",
                        )
                      }
                    />
                    <Button size="small" onClick={() => edit(g)}>
                      Grubu aç
                    </Button>
                    <Dropdown
                      menu={{
                        items: [
                          { key: "csv", label: "CSV indir" },
                          { key: "xlsx", label: "Excel indir" },
                          { key: "delete", label: "Grubu sil", danger: true },
                        ],
                        onClick: ({ key }) => {
                          if (key !== "delete") {
                            void download(key as "csv" | "xlsx", false, [g.id]);
                            return;
                          }
                          modal.confirm({
                            title: `“${g.name}” silinsin mi?`,
                            content: "Grup listeden kaldırılacak.",
                            okText: "Sil",
                            cancelText: "Vazgeç",
                            okButtonProps: { danger: true },
                            onOk: () =>
                              action(
                                () => deleteCustomerGroup(g.id),
                                "Grup silindi.",
                              ),
                          });
                        },
                      }}
                    >
                      <Button
                        size="small"
                        aria-label={`${g.name} diğer işlemler`}
                      >
                        •••
                      </Button>
                    </Dropdown>
                  </Space>
                ) : null,
            },
          ]}
        />
      </Card>
      {canManage && (
        <div className="groups-template">
          <div>
            <strong>Listeniz hazır mı?</strong>
            <p>
              Örnek şablonu indirin; grup, ad soyad ve e-posta sütunlarını
              doldurup içe aktarın.
            </p>
          </div>
          <Space>
            <Button onClick={() => void download("csv", true)}>
              CSV şablonu
            </Button>
            <Button onClick={() => void download("xlsx", true)}>
              Excel şablonu
            </Button>
          </Space>
        </div>
      )}
      <Drawer
        open={!!draft}
        title={draft?.id === "new" ? "Yeni dağıtım grubu" : draft?.name}
        size={Math.min(760, window.innerWidth)}
        onClose={close}
        maskClosable={!busy}
        footer={
          <Space className="group-drawer-footer">
            <Button disabled={busy} onClick={close}>
              Vazgeç
            </Button>
            <Button
              type="primary"
              loading={busy}
              disabled={
                !draft?.name.trim() ||
                !draft.emails.length ||
                draft.emails.length > 200
              }
              onClick={() => {
                if (!draft) return;
                void action(async () => {
                  const payload = {
                    name: draft.name.trim(),
                    description: draft.description.trim() || null,
                    emails: draft.emails,
                    recipientNames: draft.recipientNames,
                  };
                  if (draft.id === "new") await createCustomerGroup(payload);
                  else await updateCustomerGroup(draft.id, payload);
                  setDraft(null);
                }, "Grup kaydedildi.");
              }}
            >
              Grubu kaydet
            </Button>
          </Space>
        }
      >
        {draft && (
          <div className="group-editor">
            {error && <Alert type="error" message={error} showIcon />}
            <label>
              Grup adı *
              <Input
                maxLength={120}
                value={draft.name}
                disabled={busy}
                onChange={(e) => change({ name: e.target.value })}
                placeholder="Örn. Gümrük Operasyon"
              />
            </label>
            <label>
              Açıklama
              <Input.TextArea
                maxLength={500}
                rows={2}
                value={draft.description}
                disabled={busy}
                onChange={(e) => change({ description: e.target.value })}
                placeholder="Bu grubun kullanım amacı"
              />
            </label>
            <div className="groups-toolbar">
              <Typography.Title level={4}>
                Alıcılar <Tag>{draft.emails.length} / 200</Tag>
              </Typography.Title>
              <Button
                icon={<UploadOutlined />}
                disabled={!draft.name.trim() || busy}
                onClick={() => setImporting(true)}
              >
                Toplu ekle
              </Button>
            </div>
            <div className="group-person-add">
              <Input
                aria-label="Alıcı adı"
                placeholder="Ad soyad (isteğe bağlı)"
                value={personName}
                maxLength={120}
                onChange={(e) => setPersonName(e.target.value)}
              />
              <Input
                aria-label="Alıcı e-postası"
                placeholder="eposta@sirket.com"
                value={personEmail}
                onChange={(e) => setPersonEmail(e.target.value)}
                onPressEnter={() =>
                  document.getElementById("add-group-person")?.click()
                }
              />
              <Button
                id="add-group-person"
                disabled={busy}
                onClick={() => {
                  const email = personEmail.trim().toLowerCase();
                  if (!emailPattern.test(email)) {
                    setError("Geçerli bir e-posta adresi girin.");
                    return;
                  }
                  if (draft.emails.includes(email)) {
                    setError("Bu kişi grupta zaten var.");
                    return;
                  }
                  if (draft.emails.length >= 200) {
                    setError("Grup başına en fazla 200 alıcı eklenebilir.");
                    return;
                  }
                  change({
                    emails: [...draft.emails, email],
                    recipientNames: {
                      ...draft.recipientNames,
                      [email]: personName.trim(),
                    },
                  });
                  setPersonEmail("");
                  setPersonName("");
                  setError("");
                }}
              >
                Ekle
              </Button>
            </div>
            <Input
              prefix={<SearchOutlined />}
              placeholder="Alıcılarda ara"
              aria-label="Alıcılarda ara"
              value={recipientSearch}
              onChange={(e) => setRecipientSearch(e.target.value)}
            />
            <Table
              size="small"
              rowKey="email"
              dataSource={draft.emails
                .filter((email) =>
                  `${email} ${draft.recipientNames[email] ?? ""}`
                    .toLocaleLowerCase("tr")
                    .includes(recipientSearch.toLocaleLowerCase("tr")),
                )
                .map((email) => ({
                  email,
                  name: draft.recipientNames[email] ?? "",
                }))}
              pagination={{ pageSize: 8 }}
              columns={[
                {
                  title: "Ad soyad",
                  render: (_, r) => (
                    <Input
                      aria-label={`${r.email} adı`}
                      maxLength={120}
                      value={r.name}
                      disabled={busy}
                      placeholder="Ad soyad"
                      onChange={(e) =>
                        change({
                          recipientNames: {
                            ...draft.recipientNames,
                            [r.email]: e.target.value,
                          },
                        })
                      }
                    />
                  ),
                },
                { title: "E-posta", dataIndex: "email" },
                {
                  title: "",
                  render: (_, r) => (
                    <Button
                      type="text"
                      danger
                      disabled={busy}
                      onClick={() =>
                        change({
                          emails: draft.emails.filter((e) => e !== r.email),
                        })
                      }
                    >
                      Kaldır
                    </Button>
                  ),
                },
              ]}
            />
            <Typography.Text type="secondary">
              Değişiklikler “Grubu kaydet” ile uygulanır.
            </Typography.Text>
          </div>
        )}
      </Drawer>
      {importing && (
        <GroupImport
          groups={
            draft
              ? [
                  {
                    ...draft,
                    name: draft.name.trim(),
                    isActive: true,
                    createdAt: "",
                    updatedAt: "",
                  },
                ]
              : groups
          }
          target={draft?.name.trim()}
          onClose={() => setImporting(false)}
          onApply={async (imported) => {
            if (draft) {
              const item = imported[0];
              if (item)
                change({
                  emails: [...draft.emails, ...item.emails],
                  recipientNames: {
                    ...draft.recipientNames,
                    ...item.recipientNames,
                  },
                });
            } else {
              await groupRequest("import", { groups: imported });
              setNotice("Alıcılar gruplara eklendi.");
              await load();
            }
          }}
        />
      )}
    </div>
  );
}
