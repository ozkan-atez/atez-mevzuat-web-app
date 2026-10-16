import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Drawer,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  Progress,
} from "antd";
import { ReloadOutlined, FilterOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";
import { getUsage, getUsageDetails } from "./api";
import type {
  ConversationUsage,
  UsageDetail,
  UsageDetails,
  UsageFilters,
  UsageSummary,
} from "./api";
import "./workspace.css";
import "./usage.css";

const { Title, Text, Paragraph } = Typography;
const number = (value: number | null) =>
  value === null ? "—" : value.toLocaleString("tr-TR");
export const usageTimestamp = (value: string) =>
  new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    dateStyle: "short",
    timeStyle: "medium",
  }).format(
    new Date(
      value.endsWith("Z") || /[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`,
    ),
  );
function initialFilters(): UsageFilters {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  const to = `${part("year")}-${part("month")}-${part("day")}`;
  return { from: `${to.slice(0, 7)}-01`, to, page: 1, recordedOnly: "true" };
}
const modes: Record<string, string> = {
  CHAT: "Genel sohbet",
  WEB: "Web araştırması",
  BROWSER: "Tarayıcı araştırması",
  REVISION: "Rapor revizyonu",
  NO_MODEL: "AI çağrısı yapılmadı",
  ANALYSIS: "Analiz",
  SCAN: "Kaynak taraması",
  TEMPLATE: "Şablon AI",
  RESEARCH: "Araştırma",
};
const statuses: Record<string, string> = {
  RUNNING: "Sürüyor",
  COMPLETED: "Tamamlandı",
  FAILED: "Başarısız",
  CANCELLED: "Durduruldu",
  UNMEASURED: "Ölçüm yok",
};
const userLabel = (name: string | null, email: string | null) =>
  name || email || "Kimlik kaydı yok";

function UsageDrawer({
  row,
  filters,
  onClose,
}: {
  row: ConversationUsage | null;
  filters: UsageFilters;
  onClose: () => void;
}) {
  const [data, setData] = useState<UsageDetails | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    setPage(1);
  }, [row]);
  useEffect(() => {
    if (!row) return;
    let current = true;
    setLoading(true);
    setData(null);
    setError(null);
    void getUsageDetails({
      ...filters,
      conversationId: row.conversationId,
      type: row.conversationType,
      page,
    })
      .then(
        (value) => {
          if (current) setData(value);
        },
        (caught) => {
          if (current)
            setError(
              caught instanceof Error ? caught.message : "Çağrılar alınamadı.",
            );
        },
      )
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [row, filters, page, refresh]);
  return (
    <Drawer
      title={row?.title ?? "Çağrı ayrıntıları"}
      open={Boolean(row)}
      onClose={onClose}
      size="large"
      styles={{ wrapper: { width: "min(1100px, 100vw)" } }}
    >
      <Paragraph type="secondary">
        Seçili dönemdeki çağrılar · Türkiye saati (UTC+3). Token değerleri
        sağlayıcının bildirimidir. “—” ölçümün bildirilmediğini gösterir.
      </Paragraph>
      {row?.target && (
        <Paragraph>
          <Link to={row.target}>İlgili kaydı aç →</Link>
        </Paragraph>
      )}
      {error && (
        <Alert
          type="error"
          showIcon
          title={error}
          action={
            <Button onClick={() => setRefresh((value) => value + 1)}>
              Yeniden dene
            </Button>
          }
        />
      )}
      <Table<UsageDetail>
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={data?.rows ?? []}
        scroll={{ x: 980 }}
        locale={{
          emptyText: error
            ? "Çağrılar yüklenemedi."
            : "Bu dönemde çağrı kaydı yok.",
        }}
        pagination={{
          current: page,
          pageSize: 50,
          total: data?.total ?? 0,
          showSizeChanger: false,
          onChange: setPage,
        }}
        expandable={{
          expandedRowRender: (call) => (
            <div className="atez-usage-detail">
              <Text>Çağrı: {call.id}</Text>
              <Text>Mesaj: {call.messageId}</Text>
              <Text>
                Bitiş:{" "}
                {call.completedAt
                  ? usageTimestamp(call.completedAt)
                  : "Kaydedilmedi"}
              </Text>
              <Text>
                Önbellek: {number(call.cachedTokens)} · Düşünme:{" "}
                {number(call.reasoningTokens)}
              </Text>
              <Text type="secondary">
                Önbellek ve düşünme tokenları sağlayıcının toplamına yeniden
                eklenmez.
              </Text>
            </div>
          ),
        }}
        columns={[
          {
            title: "Başlangıç",
            dataIndex: "startedAt",
            render: usageTimestamp,
            width: 160,
          },
          {
            title: "Kullanıcı",
            render: (_, call) => (
              <div>
                {userLabel(call.userName, call.userEmail)}
                {call.userName && call.userEmail && (
                  <small className="atez-usage-secondary">
                    {call.userEmail}
                  </small>
                )}
              </div>
            ),
          },
          {
            title: "İşlem / model",
            render: (_, call) => (
              <div>
                {modes[call.mode] ?? call.mode}
                <small className="atez-usage-secondary">
                  {call.model ?? "—"}
                </small>
              </div>
            ),
          },
          {
            title: "Girdi",
            dataIndex: "inputTokens",
            align: "right",
            render: number,
          },
          {
            title: "Çıktı",
            dataIndex: "outputTokens",
            align: "right",
            render: number,
          },
          {
            title: "Toplam",
            dataIndex: "totalTokens",
            align: "right",
            render: number,
          },
          {
            title: "Durum",
            render: (_, call) => (
              <Space orientation="vertical" size={2}>
                <Tag
                  color={
                    call.status === "FAILED"
                      ? "error"
                      : call.status === "COMPLETED"
                        ? "success"
                        : "default"
                  }
                >
                  {statuses[call.status] ?? call.status}
                </Tag>
                {call.totalTokens === null && call.status !== "UNMEASURED" && (
                  <Text type="secondary">
                    {call.inputTokens !== null || call.outputTokens !== null
                      ? "Kısmi ölçüm"
                      : "Ölçüm yok"}
                  </Text>
                )}
              </Space>
            ),
          },
        ]}
      />
    </Drawer>
  );
}

const categories: Record<string, string> = {
  GENERAL: "Genel sohbet",
  REPORT: "Rapor revizyonu",
  AUTOMATION: "Otomasyon",
  OPERATION: "Rapor ve analiz",
  TEMPLATE: "Şablon AI",
  RESEARCH: "Araştırma",
};
export function UsagePage() {
  const [filters, setFilters] = useState<UsageFilters>(initialFilters);
  const [draft, setDraft] = useState<UsageFilters>(filters);
  const [advanced, setAdvanced] = useState(false);
  const [data, setData] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<ConversationUsage | null>(null);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    void getUsage(filters)
      .then(
        (value) => {
          if (current) setData(value);
        },
        (caught) => {
          if (current) {
            setData(null);
            setError(
              caught instanceof Error
                ? caught.message
                : "Kullanım verisi alınamadı.",
            );
          }
        },
      )
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [filters, refresh]);
  const summary = data?.summary;
  const compact = (value: number | null | undefined) =>
    value == null
      ? "—"
      : new Intl.NumberFormat("tr-TR", {
          notation: "compact",
          maximumFractionDigits: 1,
        }).format(value);
  const apply = () => {
    setSelected(null);
    setFilters({ ...draft, page: 1 });
  };
  return (
    <div className="atez-demo-page atez-usage-page">
      <div className="atez-demo-heading">
        <div>
          <Title level={1}>Kullanım</Title>
          <Paragraph type="secondary">
            Otomasyonlar, raporlar ve sohbetlerdeki AI tüketimini tek yerden
            takip edin.
          </Paragraph>
        </div>
        <Space wrap>
          <Input
            aria-label="Kullanım ayı"
            type="month"
            value={filters.from?.slice(0, 7)}
            onChange={(event) => {
              const month = event.target.value;
              if (!/^\d{4}-\d{2}$/.test(month)) return;
              const [year, m] = month.split("-").map(Number);
              const to = new Date(Date.UTC(year, m, 0))
                .toISOString()
                .slice(0, 10);
              const next = { ...filters, from: month + "-01", to, page: 1 };
              setFilters(next);
              setDraft(next);
              setSelected(null);
            }}
          />
          <Button
            aria-label="Filtreler"
            icon={<FilterOutlined />}
            onClick={() => setAdvanced(!advanced)}
            aria-expanded={advanced}
          >
            Filtreler
          </Button>
          <Button
            aria-label="Kullanımı yenile"
            icon={<ReloadOutlined />}
            onClick={() => setRefresh((v) => v + 1)}
          />
        </Space>
      </div>
      {advanced && (
        <form
          className="atez-usage-filters"
          onSubmit={(event) => {
            event.preventDefault();
            apply();
          }}
        >
          <label>
            Başlangıç
            <Input
              aria-label="Başlangıç tarihi"
              type="date"
              value={draft.from}
              onChange={(event) =>
                setDraft({ ...draft, from: event.target.value })
              }
            />
          </label>
          <label>
            Bitiş
            <Input
              aria-label="Bitiş tarihi"
              type="date"
              value={draft.to}
              min={draft.from}
              onChange={(event) =>
                setDraft({ ...draft, to: event.target.value })
              }
            />
          </label>
          <label>
            İşlem türü
            <Select
              aria-label="İşlem türü"
              value={draft.type || ""}
              onChange={(type) => setDraft({ ...draft, type })}
              options={[
                { value: "", label: "Tüm işlemler" },
                ...Object.entries(categories).map(([value, label]) => ({
                  value,
                  label,
                })),
              ]}
            />
          </label>
          {data?.teamAccess && (
            <label>
              Kullanıcı
              <Select
                aria-label="Kullanıcı"
                showSearch
                optionFilterProp="label"
                value={draft.userId || ""}
                onChange={(userId) => setDraft({ ...draft, userId })}
                options={[
                  { value: "", label: "Tüm kullanıcılar" },
                  ...data.users.map((user) => ({
                    value: user.id!,
                    label: userLabel(user.name, user.email),
                  })),
                ]}
              />
            </label>
          )}
          <label className="atez-usage-search">
            İşlem ara
            <Input
              aria-label="İşlem ara"
              placeholder="Sohbet, otomasyon veya işlem adı"
              value={draft.query ?? ""}
              onChange={(event) =>
                setDraft({ ...draft, query: event.target.value })
              }
            />
          </label>
          <Button
            type="primary"
            htmlType="submit"
            disabled={Boolean(draft.from && draft.to && draft.from > draft.to)}
          >
            Uygula
          </Button>
        </form>
      )}
      {error && (
        <Alert
          type="error"
          showIcon
          title={error}
          action={
            <Button onClick={() => setRefresh((v) => v + 1)}>
              Yeniden dene
            </Button>
          }
        />
      )}
      <div className="atez-metric-grid usage-summary" aria-busy={loading}>
        {[
          [
            "Toplam token",
            summary?.totalTokens,
            data?.teamAccess ? "Çalışma alanı toplamı" : "Kendi kullanımınız",
          ],
          [
            "Otomasyonlar",
            summary?.automationTokens,
            "Zamanlanmış tarama ve analizler",
          ],
          [
            "Sohbet & revizyon",
            summary?.chatTokens,
            "Sohbet, web araştırması ve düzenlemeler",
          ],
          [
            "Diğer AI işlemleri",
            summary?.otherTokens,
            "Manuel rapor, analiz ve şablonlar",
          ],
        ].map(([label, value, note]) => (
          <Card key={String(label)}>
            <Text type="secondary">{label}</Text>
            <div
              className="atez-metric-value"
              title={typeof value === "number" ? number(value) : "Ölçüm yok"}
            >
              {loading
                ? "…"
                : compact(typeof value === "number" ? value : null)}
            </div>
            <Text type="secondary">{note}</Text>
          </Card>
        ))}
      </div>
      <Card
        title="İşlem bazında kullanım"
        extra={
          <Text type="secondary">
            {summary?.callCount ?? 0} AI çağrısı · Sağlayıcının bildirdiği
            değerler
          </Text>
        }
      >
        <Table<ConversationUsage>
          rowKey={(row) => `${row.conversationType}:${row.conversationId}`}
          loading={loading}
          dataSource={data?.rows ?? []}
          scroll={{ x: 800 }}
          locale={{
            emptyText: error
              ? "Kullanım verisi yüklenemedi."
              : "Bu dönemde kayıtlı AI kullanımı yok.",
          }}
          pagination={{
            current: filters.page ?? 1,
            pageSize: 20,
            total: data?.total ?? 0,
            showSizeChanger: false,
            onChange: (page) => setFilters({ ...filters, page }),
            hideOnSinglePage: true,
            showTotal: (total) => `${total} işlem`,
          }}
          columns={[
            {
              title: "İşlem",
              width: 330,
              render: (_, row) => (
                <div>
                  <Button
                    type="link"
                    className="atez-usage-title"
                    aria-label={`${row.title} çağrı ayrıntıları`}
                    onClick={() => setSelected(row)}
                  >
                    {row.title}
                  </Button>
                  <small className="atez-usage-secondary">
                    {categories[row.conversationType] ?? row.conversationType} ·{" "}
                    <time dateTime={row.lastAt}>
                      {usageTimestamp(row.lastAt)}
                    </time>
                  </small>
                </div>
              ),
            },
            {
              title: "Başlatan",
              render: (_, row) =>
                row.conversationType === "AUTOMATION" ? (
                  <Tag>Otomasyon</Tag>
                ) : (
                  row.users.map((user, i) => (
                    <div key={user.id ?? i}>
                      {userLabel(user.name, user.email)}
                      {user.name && user.email && (
                        <small className="atez-usage-secondary">
                          {user.email}
                        </small>
                      )}
                    </div>
                  ))
                ),
            },
            {
              title: "Model",
              render: (_, row) =>
                row.models?.map((model) => <div key={model}>{model}</div>) ??
                "—",
            },
            {
              title: "Token",
              align: "right",
              render: (_, row) => (
                <div>
                  <strong>{number(row.totalTokens)}</strong>
                  {row.unmeasuredCount > 0 && (
                    <small className="atez-usage-secondary">Kısmi ölçüm</small>
                  )}
                </div>
              ),
            },
            {
              title: "Pay",
              width: 160,
              render: (_, row) =>
                row.totalTokens !== null && summary?.totalTokens ? (
                  <Progress
                    percent={
                      Math.round(
                        (row.totalTokens / summary.totalTokens) * 1000,
                      ) / 10
                    }
                    size="small"
                    strokeColor="var(--atez-accent)"
                  />
                ) : (
                  "—"
                ),
            },
          ]}
        />
      </Card>
      <Paragraph className="usage-footnote" type="secondary">
        {data?.from} — {data?.to} · Türkiye saati. Geçmişte ölçülmemiş işlemler
        toplamı etkilemez.{" "}
        {Boolean(summary?.unmeasuredCount) &&
          `${number(summary!.unmeasuredCount)} çağrıda ölçüm kısmi veya eksik. `}
        Parasal maliyet hesaplanmaz.
      </Paragraph>
      <UsageDrawer
        row={selected}
        filters={filters}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
