import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Input,
  Modal,
  Select,
  Space,
  Steps,
  Table,
  Typography,
} from "antd";
import type { CustomerGroup } from "../delivery/types";
import {
  downloadBlob,
  groupRequest,
  previewImport,
  type ImportGroup,
} from "./group-import";
export function GroupImport({
  groups,
  target,
  onClose,
  onApply,
}: {
  groups: CustomerGroup[];
  target?: string;
  onClose: () => void;
  onApply: (groups: ImportGroup[]) => Promise<void>;
}) {
  const [sheets, setSheets] = useState<{ name: string; rows: string[][] }[]>(
      [],
    ),
    [sheet, setSheet] = useState(0),
    [header, setHeader] = useState(true),
    [email, setEmail] = useState(0),
    [name, setName] = useState(-1),
    [group, setGroup] = useState(-1),
    [destination, setDestination] = useState(target ?? ""),
    [paste, setPaste] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [step, setStep] = useState(0);
  const rows = sheets[sheet]?.rows ?? [];
  const preview = useMemo(
    () =>
      previewImport(
        rows,
        { email, name, group, header, target: destination },
        groups,
      ),
    [rows, email, name, group, header, destination, groups],
  );
  const columns = Array.from(
    { length: Math.max(0, ...rows.map((r) => r.length)) },
    (_, i) => ({
      value: i,
      label: header
        ? `${i + 1}. ${rows[0]?.[i] || "Başlıksız"}`
        : `Sütun ${i + 1}`,
    }),
  );
  async function read(filename: string, bytes: Uint8Array) {
    setBusy(true);
    setError("");
    try {
      let binary = "";
      bytes.forEach((b) => (binary += String.fromCharCode(b)));
      const result = await (
        await groupRequest("parse-file", { filename, content: btoa(binary) })
      ).json();
      setSheets(result.sheets);
      setSheet(0);
      guess(result.sheets[0]?.rows[0] ?? []);
      setStep(1);
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }
  function guess(first: string[]) {
    setEmail(
      Math.max(
        0,
        first.findIndex((v) => /e.?posta|email/i.test(v)),
      ),
    );
    setName(first.findIndex((v) => /ad soyad|name/i.test(v)));
    setGroup(target ? -1 : first.findIndex((v) => /^grup$|^group$/i.test(v)));
  }
  return (
    <Modal
      open
      title="Alıcıları içe aktar"
      width={900}
      onCancel={() => {
        if (!busy) onClose();
      }}
      footer={
        <Space>
          <Button disabled={busy} onClick={onClose}>
            Vazgeç
          </Button>
          {step > 0 && (
            <Button disabled={busy} onClick={() => setStep(step - 1)}>
              Geri
            </Button>
          )}
          {step === 1 && (
            <Button
              type="primary"
              disabled={!rows.length || (!destination.trim() && group < 0)}
              onClick={() => setStep(2)}
            >
              Önizlemeyi aç
            </Button>
          )}
          {step === 2 && (
            <Button
              type="primary"
              loading={busy}
              disabled={
                !preview.total ||
                !!preview.overLimit.length ||
                preview.groups.length > 50
              }
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await onApply(preview.groups);
                  onClose();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {preview.total} alıcıyı {target ? "taslağa ekle" : "kaydet"}
            </Button>
          )}
        </Space>
      }
    >
      <Steps
        size="small"
        current={step}
        items={[
          { title: "Dosya seç" },
          { title: "Sütunları eşleştir" },
          { title: "Kontrol et" },
        ]}
      />
      <div className="group-import-body">
        {error && <Alert type="error" message={error} showIcon />}
        {step === 0 && (
          <>
            <div className="group-upload">
              <Typography.Title level={4}>
                Excel listenizi buraya getirin
              </Typography.Title>
              <p>XLSX, CSV veya TSV · En fazla 5 MB · Grup başına 200 alıcı</p>
              <input
                aria-label="Alıcı dosyası seç"
                type="file"
                accept=".xlsx,.csv,.tsv"
                disabled={busy}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 5_000_000) {
                    setError("Dosya en fazla 5 MB olabilir.");
                    return;
                  }
                  await read(
                    file.name,
                    new Uint8Array(await file.arrayBuffer()),
                  );
                }}
              />
            </div>
            <Typography.Text strong>
              Veya Excel’den kopyalayıp yapıştırın
            </Typography.Text>
            <Input.TextArea
              rows={5}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder={"Ad Soyad\tE-posta\nAyşe Yılmaz\tayse@example.com"}
            />
            <Button
              loading={busy}
              disabled={!paste.trim()}
              onClick={() =>
                void read("yapistir.tsv", new TextEncoder().encode(paste))
              }
            >
              Yapıştırılan listeyi oku
            </Button>
          </>
        )}
        {step === 1 && (
          <>
            <label>
              Çalışma sayfası
              <Select
                value={sheet}
                options={sheets.map((s, i) => ({ value: i, label: s.name }))}
                onChange={(v) => {
                  setSheet(v);
                  guess(sheets[v].rows[0] ?? []);
                }}
              />
            </label>
            <Checkbox
              checked={header}
              onChange={(e) => setHeader(e.target.checked)}
            >
              İlk satır sütun başlıklarını içeriyor
            </Checkbox>
            <div className="group-mapping">
              <label>
                E-posta *
                <Select value={email} options={columns} onChange={setEmail} />
              </label>
              <label>
                Ad soyad
                <Select
                  value={name}
                  options={[{ value: -1, label: "Kullanma" }, ...columns]}
                  onChange={setName}
                />
              </label>
              {!target && (
                <label>
                  Grup sütunu
                  <Select
                    value={group}
                    options={[
                      { value: -1, label: "Tek gruba ekle" },
                      ...columns,
                    ]}
                    onChange={setGroup}
                  />
                </label>
              )}
            </div>
            {group < 0 && (
              <label>
                Hedef grup
                <Input
                  list="group-destinations"
                  value={destination}
                  disabled={!!target}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder="Mevcut veya yeni grup adı"
                />
                <datalist id="group-destinations">
                  {groups.map((g) => (
                    <option key={g.id} value={g.name} />
                  ))}
                </datalist>
              </label>
            )}
            <Table
              size="small"
              pagination={false}
              scroll={{ x: true }}
              dataSource={rows
                .slice(0, 5)
                .map((r, i) => ({ key: i, cells: r }))}
              columns={columns.map((c) => ({
                title: `Sütun ${c.value + 1}`,
                render: (_, r) => r.cells[c.value],
              }))}
            />
          </>
        )}
        {step === 2 && (
          <>
            <Alert
              type="info"
              showIcon
              message={`${preview.total} yeni alıcı · ${preview.duplicates} tekrar atlanacak · ${preview.issues.length} hatalı satır atlanacak`}
              description="Mevcut alıcılar korunur. Yalnızca geçerli ve yeni adresler eklenir."
            />
            {!!preview.overLimit.length && (
              <Alert
                type="error"
                message={`200 alıcı sınırı aşılıyor: ${preview.overLimit.join(", ")}. Listeyi küçültün.`}
              />
            )}{" "}
            {preview.groups.length > 50 && (
              <Alert
                type="error"
                message="Tek seferde en fazla 50 grup aktarılabilir."
              />
            )}
            <Table
              size="small"
              rowKey="name"
              expandable={{
                expandedRowRender: (item) => (
                  <Table
                    size="small"
                    rowKey="email"
                    dataSource={item.emails.map((email) => ({
                      email,
                      name: item.recipientNames[email],
                    }))}
                    columns={[
                      { title: "Ad soyad", dataIndex: "name" },
                      { title: "E-posta", dataIndex: "email" },
                    ]}
                    pagination={{ pageSize: 10 }}
                  />
                ),
              }}
              dataSource={preview.groups}
              columns={[
                { title: "Grup", dataIndex: "name" },
                { title: "Eklenecek alıcı", render: (_, r) => r.emails.length },
                {
                  title: "Örnek adresler",
                  render: (_, r) => r.emails.slice(0, 3).join(", "),
                },
              ]}
              pagination={{ pageSize: 5 }}
            />
            {!!preview.issues.length && (
              <>
                <Button
                  onClick={() =>
                    downloadBlob(
                      new Blob(
                        [
                          "\uFEFF" +
                            [
                              "Satır\tE-posta\tNeden",
                              ...preview.issues.map(
                                (i) =>
                                  `${i.row}\t${i.email.replace(/[\t\r\n]/g, " ")}\t${i.reason}`,
                              ),
                            ].join("\n"),
                        ],
                        { type: "text/plain;charset=utf-8" },
                      ),
                      "hatali-satirlar.txt",
                    )
                  }
                >
                  Hatalı satırları indir
                </Button>
                <Table
                  size="small"
                  rowKey="row"
                  dataSource={preview.issues}
                  columns={[
                    { title: "Satır", dataIndex: "row" },
                    { title: "E-posta", dataIndex: "email" },
                    { title: "Neden", dataIndex: "reason" },
                  ]}
                  pagination={{ pageSize: 5 }}
                />
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
