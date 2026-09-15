# Rapor Revizyonu Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Yayımlanmış bir ATEZ bülteninin belirli alanlarının kesin biçimde değiştirilebilmesi. Kullanıcı hem bülten önizlemesinde alana tıklayıp yerinde düzenler, hem de alttaki docked asistana yazarak aynı sonucu alır. Değişiklikler bir taslakta birikir ve tek bir yeni `rNN` olarak yayımlanır.

**Architecture:** Mevcut `topic-analysis` modülü korunur; revizyon çekirdeği aynı modül içinde yeni bir taslak/yama katmanıyla genişletilir. İki giriş yolu da tek bir application use-case'ine (`applyReportFieldEdits`) iner. Gemini yeni rapor değil **yama** üretir; HTML her zaman doğrulanmış spec'ten uygulama tarafından render edilir. PostgreSQL taslak ve yama kayıtlarını, MinIO/S3 yalnız yayımlanmış revizyonları tutar.

**Tech Stack:** TypeScript, Fastify, Prisma/PostgreSQL, pg-boss, `@google/genai`, Zod, MinIO/S3, React 19, Vitest, Testing Library, Docker Compose

**Spec:** `docs/superpowers/specs/2026-09-14-report-revision-design.md`

## Global Constraints

- Yama, spec'in dokunulmayan alanlarını değiştiremez; spec baştan üretilmez.
- Gemini yalnız yama şeması döndürür; HTML, CSS veya tam spec üretmez.
- Kilitli alanlar (`schemaVersion`, `templateFamily`, `reportId`, `topicId`, `card`, `issueNumber`, `displayDate`, `source.url`, `documentTitle`, `table.columns`) hiçbir yoldan değiştirilemez ve bu sunucuda zorlanır.
- Alan düzenlemesi yeni `AnalysisRevision` doğurmaz; aynı analiz revizyonuna bağlı yeni `ReportRevision` oluşur.
- Yayımlanmış revizyonlar değiştirilemez; taslak yayımlandığında yeni `rNN` klasörü açılır.
- Taslak yayımlanana kadar nesne deposuna hiçbir şey yazılmaz.
- Rapor sayfasında sohbet dökümü gösterilmez; değişiklikler numaralı liste olarak görünür.
- Yayımlanan HTML script, iframe, form ve olay özniteliği içermez; `validateReportHtml` sözleşmesi korunur.
- Kullanıcı metni ve model çıktısı HTML'e kaçış işleminden geçmeden yazılmaz; ikisi de veri kabul edilir.
- Mevcut ANALYSIS revizyon yolu ve `2026-09-11` tarihli testler bozulmaz.

## File Structure

### Backend files to create

- `backend/src/modules/topic-analysis/domain/report-patch.ts`: Düzenlenebilir alan izin listesi, yama şeması ve uygulama kuralları.
- `backend/src/modules/topic-analysis/domain/report-draft.ts`: Taslak durumları ve geçiş kuralları.
- `backend/src/modules/topic-analysis/application/apply-report-field-edits.ts`: Tek çekirdek use-case; yama doğrular, taslağa uygular, önizleme HTML'i üretir.
- `backend/src/modules/topic-analysis/application/publish-report-draft.ts`: Taslağı tek `rNN` olarak yayımlar, çakışma kontrolü yapar.
- `backend/src/modules/topic-analysis/application/discard-report-draft.ts`: Taslağı denetim izini koruyarak kapatır.
- `backend/src/modules/topic-analysis/application/patch-prompts.ts`: Sürümlü yama system prompt'u ve Gemini yanıt şeması.
- `backend/src/modules/topic-analysis/application/execute-prompt-patch.ts`: Kuyruk yolundan gelen prompt talebini yamaya çevirir ve çekirdeğe uygular.
- `backend/src/modules/topic-analysis/infrastructure/prisma-report-draft-repository.ts`: Taslak ve yama kayıtları için Prisma adaptörü.
- `backend/src/modules/topic-analysis/report-draft.routes.ts`: Taslak okuma, yama, yayımlama, iptal ve geri alma uçları.
- `backend/prisma/migrations/<timestamp>_add_report_draft/migration.sql`: `ReportDraft`, `ReportFieldEdit`, `DIRECT_EDIT`, `ReportRevision.draftId`.

### Backend files to modify

- `backend/prisma/schema.prisma`: Yeni modeller, `RevisionKind.DIRECT_EDIT`, `TopicOutboxCommand.REVISE_FIELDS`.
- `backend/src/modules/topic-analysis/templates/bulten-v2.ts`: Düzenlenebilir düğümlere `data-field` öznitelikleri.
- `backend/src/modules/topic-analysis/application/validate-report-html.ts`: `data-field` özniteliğine izin, diğer kısıtlar aynen.
- `backend/src/modules/topic-analysis/application/build-revision-context.ts`: Prompt'un yama yoluna mı analiz yoluna mı gideceğinin ayrımı.
- `backend/src/modules/topic-analysis/infrastructure/topic-analysis-queue.ts`: `REVISE_FIELDS` komutu.
- `backend/src/modules/topic-analysis/topic-analysis.routes.ts`: Taslak rotalarının bağlanması.
- `backend/src/app.ts`: Taslak repository'sinin enjeksiyonu.
- `backend/src/worker.ts`: `REVISE_FIELDS` işleyicisi.

### Frontend files to create

- `frontend/src/features/revision/types.ts`: Taslak, yama ve değişiklik kaydı tipleri.
- `frontend/src/features/revision/api.ts`: Taslak uçlarının istemcisi.
- `frontend/src/features/revision/useReportDraft.ts`: Taslak durumu, iyimser güncelleme ve hata yönetimi.
- `frontend/src/features/revision/EditableReportPreview.tsx`: `data-field` düğümlerine düzenleme davranışı bağlayan önizleme.
- `frontend/src/features/revision/ChangeList.tsx`: Numaralı değişiklik listesi ve özet açılımı.
- `frontend/src/features/revision/PublishDraftBar.tsx`: Yayımla / iptal / çakışma uyarısı.

### Frontend files to modify

- `frontend/src/features/reports/ReportDetail.tsx`: Önizlemenin düzenlenebilir sürümü, değişiklik listesi, yayımlama çubuğu.
- `frontend/src/features/chat/DockedAiAssistant.tsx`: Enter ile talebin aktif rapora yama isteği olarak gönderilmesi.
- `frontend/src/components/layout/AppLayout.tsx`: Aktif sayfa bağlamının docked asistana taşınması.

## Aşama 0 — Doğrulama Çivisi

Inline düzenlemenin taşıyıcı varsayımı önce ölçülmeli; yanlışsa bütün frontend tasarımı değişir.

- [x] `srcDoc` ile yüklenen ve `sandbox="allow-same-origin"` taşıyan (fakat `allow-scripts` taşımayan) bir iframe'in `contentDocument`'ına ebeveyn sayfadan erişilebildiğini doğrula.
- [x] Ebeveynden `[data-field]` düğümlerine olay bağlanabildiğini ve `contenteditable` ile metin düzenlenebildiğini doğrula.
- [x] Belgedeki inline `<script>` ve `onerror` özniteliğinin **çalışmadığını** doğrula.

**Sonuç: doğrulandı.** Chromium'da ölçüldü:

| sandbox | Ebeveyn DOM erişimi | Belgedeki script |
| --- | --- | --- |
| `allow-same-origin` | evet | çalışmaz |
| `allow-same-origin allow-scripts` | evet | çalışır |
| mevcut `allow-popups …` | hayır | çalışmaz |

Aşama 6 `sandbox="allow-same-origin"` ile ilerler: düzenleme katmanı ebeveyn sayfada yaşar, belgeye script enjekte edilmez, şablon tek kaynak kalır ve önizleme yayımlanan HTML ile birebir aynıdır. `allow-scripts` hiçbir koşulda eklenmez.

## Aşama 1 — Yama Çekirdeği (modelsiz)

- [x] `report-patch.ts` içinde düzenlenebilir yol kalıplarını ve yama şemasını tanımla; `path` serbest JSONPath değil, kalıp eşleşmeli.
- [x] Yama uygulama fonksiyonunu yaz: spec kopyası üzerinde çalış, yolu çöz, değeri yaz, `ReportSpecSchema.parse` ile doğrula.
- [x] Kilitli bir yol geldiğinde yamanın tamamını reddet; kısmi uygulama olmasın.
- [x] Birim testleri: izinli alan uygulanır; kilitli alan reddedilir; dokunulmayan alanlar birebir korunur; şemayı bozan yama (boş zorunlu alan, satır/sütun uyuşmazlığı) reddedilir; bilinmeyen yol reddedilir.

Red gerekçeleri dört ayrı sınıfa ayrıldı; hangisinin döndüğü kullanıcıya ne söyleyeceğimizi belirliyor:

| Durum | Gerekçe |
| --- | --- |
| Alan spec'te var, izin listesinde yok | `LOCKED_PATH` |
| Alan spec'te de yok | `UNKNOWN_PATH` |
| Alan izinli ama bu kartta yok (K3'ün `oldDeadline`'ı K2'de) veya dizi indeksi aralık dışı | `MISSING_TARGET` |
| Yama uygulanır ama şemayı bozar | `SCHEMA_VIOLATION` |

**Kabul:** Yama çekirdeği modelden ve veritabanından bağımsız olarak test edilebilir durumda.

## Aşama 2 — Taslak Kalıcılığı

- [ ] `schema.prisma`: `ReportDraft` (topicId, baseVersion, specJson, status, createdBy, zaman damgaları) ve `ReportFieldEdit` (draftId, sequence, path, previousValue, nextValue, source, chatMessageId, revertedByEditId).
- [ ] `RevisionKind`'a `DIRECT_EDIT`, `TopicOutboxCommand`'a `REVISE_FIELDS`, `ReportRevision`'a `draftId` ekle.
- [ ] Migration üret ve hem geliştirme hem test veritabanına uygula.
- [ ] `prisma-report-draft-repository.ts`: taslak aç/getir, yama ekle, geri al, yayımla, iptal et.
- [ ] Rapor başına en fazla bir açık taslak kısıtını veritabanı düzeyinde zorla (kısmi benzersiz indeks).
- [ ] Entegrasyon testleri: açık taslak tekilliği; yama sırasının korunması; geri almanın kayıt silmemesi.

**Kabul:** Taslak ve yamalar kalıcı, sıralı ve tekil.

## Aşama 3 — Use-Case'ler ve HTTP Yüzeyi

- [ ] `apply-report-field-edits.ts`: taslak yoksa son yayımlanmış revizyondan aç, yamayı uygula, kaydı yaz, taslak önizleme HTML'ini döndür.
- [ ] `publish-report-draft.ts`: `baseVersion` ile güncel sürümü karşılaştır, uyuşmazsa çakışma hatası; uyuşuyorsa `renderReportHtml` + `validateReportHtml` + spec/HTML nesnelerini yaz + yeni `ReportRevision` (aynı `analysisRevisionId`).
- [ ] `discard-report-draft.ts`: taslağı kapat, yayımlanmış revizyonlara dokunma.
- [ ] `report-draft.routes.ts`: `GET /:id/draft`, `POST /:id/draft/edits`, `POST /:id/draft/edits/:editId/revert`, `POST /:id/draft/publish`, `DELETE /:id/draft`.
- [ ] Senkron yolda `Idempotency-Key` zorunlu; aynı anahtarla gelen ikinci yama tekrar uygulanmaz.
- [ ] Sözleşme testleri: yama 200 ve güncel önizleme döner; kilitli alan 400; eskimiş taslak yayımlamada 409; yayımlama tek yeni `rNN` üretir ve yeni analiz revizyonu oluşmaz; tekrarlanan idempotency anahtarı iki kez uygulanmaz.

**Kabul:** Doğrudan düzenleme uçtan uca çalışır ve model hiç devreye girmez.

## Aşama 4 — Prompt ile Yama

- [ ] `patch-prompts.ts`: sistem talimatı, sürüm etiketi ve yama yanıt şeması; şema `toGeminiResponseSchema` üzerinden geçsin.
- [ ] Modele verilen bağlam: güncel taslak spec'i, düzenlenebilir alanlar ve mevcut değerleri, kullanıcının talebi. Kanıt paketi gönderilmez.
- [ ] `execute-prompt-patch.ts`: `ChatMessage` + outbox + kuyruk yolundan gelen talebi yamaya çevirir ve Aşama 3'teki çekirdeğe uygular.
- [ ] Model kilitli alana yama önerirse uygulama reddedilir, kullanıcıya nedeni bildirilir ve körlemesine tekrar denenmez.
- [ ] Model olguyu değiştiren bir talep aldığında (yeni tarih, farklı oran, yeni kaynak) yama üretmez; bunun analiz revizyonu olduğunu bildirir.
- [ ] `build-revision-context.ts`: prompt'un yama yoluna mı mevcut ANALYSIS yoluna mı gideceğini belirle; ayrım sınanabilir olsun.
- [ ] `worker.ts` ve `topic-analysis-queue.ts`: `REVISE_FIELDS` komutu.
- [ ] Testler: sahte model istemcisiyle yama üretimi; kilitli alan önerisinin reddi; olgusal talebin analiz yoluna yönlendirilmesi; üretilen yamanın senkron yolla aynı çekirdekten geçtiği.

**Kabul:** Docked asistana yazılan talep, arka planda spec'i değiştirip önizlemeyi günceller.

## Aşama 5 — Şablon ve Doğrulayıcı

- [ ] `bulten-v2.ts`: düzenlenebilir düğümlere `data-field="<path>"` ekle; yol değerleri `report-patch.ts` izin listesiyle birebir eşleşsin.
- [ ] Tablo hücrelerine satır/sütun indeksli yollar ver.
- [ ] `validate-report-html.ts`: `data-field` özniteliğine izin ver; script, iframe, form, olay özniteliği ve dış kaynak yasakları aynen kalsın.
- [ ] Testler: `data-field` taşıyan HTML doğrulamayı geçer; script içeren HTML hâlâ reddedilir; her izinli yolun şablonda karşılığı bulunduğu.

**Kabul:** Yayımlanan HTML hem düzenlenebilir hem de yayın sözleşmesine uygun.

## Aşama 6 — Arayüz

- [ ] `useReportDraft.ts`: taslak yükleme, yama gönderme, geri alma, yayımlama; çakışmada kullanıcıyı güncel sürüme yönlendirme.
- [ ] `EditableReportPreview.tsx`: Aşama 0'da doğrulanan yönteme göre `[data-field]` düğümlerine düzenleme davranışı bağla; odak kaybında yamayı gönder.
- [ ] `ChangeList.tsx`: numaralı liste; tıklanınca alan, eski değer, yeni değer, kaynak (`Kullanıcı` / `AI`) ve varsa tetikleyen prompt; tek yamayı geri alma.
- [ ] `PublishDraftBar.tsx`: bekleyen değişiklik sayısı, yayımla, iptal, çakışma uyarısı.
- [ ] `DockedAiAssistant.tsx`: Enter ile talebi aktif raporun taslağına gönder; sohbet dökümü gösterme, sonucu değişiklik listesine düşür.
- [ ] `AppLayout.tsx`: aktif sayfa bağlamını (rapor/revizyon kimliği) asistana taşı; rapor sayfasında değilken asistan bu yolu kullanmasın.
- [ ] `ReportDetail.tsx`: düzenlenebilir önizleme, değişiklik listesi ve yayımlama çubuğunu yerleştir; mevcut PDF ve e-posta eylemleri korunsun.
- [ ] Testler: alan düzenleme yama isteği gönderir; kilitli alan düzenlenemez; değişiklik listesi özeti açılır; geri alma listeye yeni kayıt ekler; yayımlama sonrası sayfa yeni revizyona geçer; çakışmada uyarı görünür.

**Kabul:** Kullanıcı iki yoldan da revize edebilir ve ne değiştiğini görebilir.

## Aşama 7 — Uçtan Uca Doğrulama

- [ ] `2026-09-11` tarihli gerçek bir rapor üzerinde: iki alan elle düzenle, bir alanı prompt ile değiştir, yayımla; tek `rNN` oluştuğunu doğrula.
- [ ] Yayımlanan HTML'in ve PDF'in yeni değerleri taşıdığını doğrula.
- [ ] Önceki revizyonun değişmediğini nesne deposunda doğrula.
- [ ] Yayımlanan revizyonun yeni `AnalysisRevision` oluşturmadığını doğrula.
- [ ] Tüm backend ve frontend testlerinin geçtiğini, `tsc --noEmit` çıktısının temiz olduğunu doğrula.

**Kabul:** Spec'teki altı kabul kriteri karşılanır.

## Riskler ve Açık Noktalar

- **Inline düzenleme yöntemi.** Aşama 0 doğrulanmazsa Aşama 6'nın önizleme sözleşmesi değişir. Plan bu nedenle çiviyi en başa koyar.
- **Yol kalıpları iki yerde.** İzin listesi hem `report-patch.ts`'te hem şablondaki `data-field` değerlerinde yaşar. Aşama 5'teki "her izinli yolun şablonda karşılığı var" testi bu ikiliğin sessizce ayrışmasını engeller.
- **Mevcut raporlar.** Nesne deposundaki eski `rNN` dosyaları `data-field` taşımaz; düzenleme yalnız yeniden render edilen taslak önizlemesinde çalışır. Taslak spec'ten render edildiği için bu kendiliğinden çözülür, ayrıca bir taşıma gerekmez.
- **Eşzamanlı düzenleme.** `baseVersion` çakışmayı yakalar ama iki kullanıcı aynı taslakta çalışırsa son yazan kazanır. Çok kullanıcılı eşzamanlı düzenleme bu planın kapsamı dışındadır.
