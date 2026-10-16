# Resmî Gazete collection experiment

Isolated prototype on `codex/source-engine-redesign`. It does not replace production chat, scheduled scans, credentials, database records or report publishing.

From `backend`:

```sh
node --import tsx scripts/rg-prototype.ts --date 2026-10-13 --expected-links 8
```

`--expected-links` is an optional acceptance assertion for the supplied screenshot, not a hardcoded daily count. `--model` and `--output` are optional. A new output directory is required for each attempt. `--reuse-analysis-from <attempt-directory>` reuses prior raw content-analysis responses only when the model and ordered source hashes/representations match, and reapplies the current validations; title analysis always runs afresh. Root `.env` overrides backend `.env`; explicit environment variables override both. Keys never appear in artifacts.

## Responsibilities

- `contracts.ts`: explicit date request, source records, analyst/collector ports and validated response schemas. No natural-language dates enter the collector.
- `parsing.ts`: official-domain URL policy, issue identity, link inventory, announcement subjects and attachment discovery.
- `playwright-collector.ts`: Playwright renders every index and HTML page; original HTML and downloaded binaries are saved with hashes. HTML, PDFs, linked/embedded images and nested HTML attachments are associated with their parent. No AI-driven clicking is needed for this stable layout.
- `gemini-analyst.ts`: HTML is sent as complete rendered text. Original PDFs and JPEG/PNG/WebP images are sent as multimodal parts in the same request with source IDs. PDF text layers are supplied as additional context, never as a replacement for the PDF. Static GIF/BMP images are rendered to PNG; unsupported or animated assets remain errors. Model responses are schema-validated and material-ID sets are checked. HTML quotations must match extracted text; one bounded repair is allowed. All PDF/image bundles are conservatively marked `VISUAL_REVIEW_REQUIRED`: hybrid PDFs may have a text header but an image body. Claim-to-evidence coverage still requires independent audit.
- `run.ts`: checks issue identity, follows discovered same-day supplement indices, reads every top-level link, analyzes every regulation, then sends announcement titles to Gemini. Institution-only titles are always escalated regardless of the model's first decision. IN and REVIEW announcements receive full-content analysis; definite OUT titles are preserved with the title-only reason. Standalone top-level pages such as exchange-rate images are always read in full. No implicit six-document cap.
- `incremental.ts`: durable per-day source and analysis checkpoints. Every invocation checks the live daily index. Global “Son Mükerrer” buttons are ignored; only the target day's supplement links are used. Completed supplement indices, source bundles, title decisions and successful content decisions are reused; unseen editions and unfinished work continue. Model/policy versions invalidate analysis without redownloading intact sources. Artifacts are copied into a persistent, hashed cache independent of attempt directories.
- `scripts/rg-prototype.ts`: local CLI composition, fresh attempt directory, checkpoints and model selection. No database required.

## Artifacts

`summary.json` is the compact output. `result.json` holds the issue inventory, all eight top-level pages for the example date, regulation summaries/decisions, individual announcement decisions, errors and counts. `activity.json` records the current check time, downloaded/reused bundle counts, new/reused analysis counts, processed editions and `NO_NEW_DOCUMENTS`, `PROCESSED_NEW_OR_PENDING` or `CHECK_FAILED`. `*.bundle.json` contains original-source relationships and readability preparation. `*.input.json` records representations and files supplied to Gemini, including full HTML text. `*.model.json` preserves fresh model output, model identity and usage. Cached responses live in the persistent state, keyed by model/policy, entry and content hashes. `sources/` retains fresh rendered HTML and binaries; converted images also retain original bytes.

## Incremental checks

The default persistent state is `.local/rg-prototype/cache/YYYY-MM-DD` (override with `--cache`). To import an already completed pre-cache experiment, use `--seed-from ../.local/rg-prototype/2026-10-13-final` once. The importer checks date/model and file hashes; it never downloads documents. Subsequent invocations require no seed parameter.

| Invocation | Daily page | Source/analysis work |
| --- | --- | --- |
| 05:00, first run | Check | Main issue |
| 09:00, unchanged | Check | None |
| 15:00, M1 appears | Check | M1 only |
| 18:00, unchanged | Check | None |
| Later, M2 appears | Check | M2 only |

These times are test scenarios, not installed schedules. Results aggregate the main issue and every discovered supplement. A successful download with failed analysis is reused for the retry; failed/REVIEW decisions are not treated as finished. Missing or hash-invalid cache files are downloaded again. A failed current index check remains UNKNOWN/BLOCKED, never “no new supplement”.

The local adapter writes state atomically and holds a per-day exclusive lock for the full run. A crashed process may leave `run.lock`; remove that lock only after verifying its recorded process is no longer running. This is a single-host prototype, not a distributed database/worker lock. Completed publication URLs are assumed immutable, as requested; the daily index is always refreshed, but unchanged document bytes are not periodically re-fetched. Moving into production requires using the same ports with durable shared storage and database locking. Analysis completion does not clear pending visual/evidence audits.

IN/OUT means relevance to customs/foreign trade and demonstrable international logistics effects; REVIEW means insufficient evidence. Daily exchange rates are operational data, not a legislative amendment. A missing attachment or unreadable document must never become OUT.

## Scope and limits

This is an auditable experiment, not an approved legal bulletin. COMPLETED means the configured collection/analysis steps finished without unresolved REVIEW results, not independent legal or coverage certification. Supplement discovery is time-stamped and limited to links exposed by the visited issue pages; later publications are not covered. The title stage covers individual notices, not just the broad headings “Various notices” or “Tenders”.

Documents are never silently shortened to fit Gemini: payloads exceeding the prototype's 18 MB budget become REVIEW. Recursive attachment traversal is bounded at 80 URLs and depth 4; exceeding it is an explicit error. Word/Excel/ZIP archives remain unsupported and are retained for review. Embedded data images, srcset, SVG and canvas are explicitly flagged for conversion rather than silently omitted. A full-page OCR pipeline, visual quote audit, general-purpose API workflow discovery, durable background jobs and production UI integration are outside this first experiment.

## Validation

`npm test -- test/unit/gazette-prototype.test.ts test/unit/gazette-incremental.test.ts` exercises date identity, daily-vs-global supplement separation, nested assets, external-host rejection, tender headings, full item accounting, uncertain-notice escalation, 05/09/15/18/M2 progression, failed checks, partial retries, policy invalidation and locking. `npm run build` checks TypeScript compatibility. Live evidence is written under ignored `.local/rg-prototype/` and must be inspected separately from unit tests.

## Ayrıntılı IN belgesi: v0.2 deneysel veri sözleşmesi

`rg-dossier.ts --input <tamamlanmış-tarama-klasörü>` mevcut IN belgelerinin kaydedilmiş materyallerini okur. Yeni indirme yapmaz; HTML'nin görünür tam metni ve görsel/PDF ekleri aynı Gemini isteğinde gider. Çıktılar `dossiers/analysis.json`, belge kimliğiyle JSON ve ham model yanıtıdır. `extraction.schema.json` yalnız model çıkarım sözleşmesidir; final kayıt bundan türetilen tarih, flag, geçmiş veri işi ve readiness alanlarını da içerir. Bunlar üretim rapor hattına henüz bağlanmadı.

- `amendedInstruments`: değiştirilen temel mevzuatın numarası, kabul/yayım tarihleri, RG sayısı, madde ve ek kimlikleri. Temel metin, son geçerli önceki sürüm demek değildir.
- `effectiveRules`: kaynak hükmü + takvim kuralı. Kod, yayımı izleyen N gün ve açık tarih kurallarını çözer. Diğer ifadeler REVIEW kalır; AI'ın hesapladığı tarihe sessizce güvenilmez. Bir belgenin birden fazla yürürlük tarihi olabilir.
- `changes`: madde bazında olgular ve kaynakta varsa eski metin. Olmayan eski metin `null` kalır.
- `tables`: bütün satır/sütunlar, birleşik hücre yayılımı, dipnot, menşe, koşullar ve sayfa/ek konumu. `cells` kaynak yazımını korur; `values` ondalık string ve ölçü türünü taşır. Gözetim kıymeti vergi değildir. GTİP stringtir; baştaki sıfırlar ve kısa pozisyon kapsamı korunur, hayalî 12 haneli kod oluşturulmaz.
- `historyRequests`: tablodaki GTİP, ölçü, menşe, yasal kimlik ve **yürürlükten bir önceki gün** ile Tariff işi. `legalHistoryRequests`: kaynakta eski metni olmayan değişikliklerin önceki hüküm araştırması. İkisi de bu deneyde yalnız hazırlanır; Tariff sorgusu yapılmış sayılmaz.
- `sourceManifest`: orijinallerin adresi, SHA-256 özeti ve dosya yolu. Rapor üreticisi bu kaydı kullanabilir; denetim için asıllar saklanır.
- `readiness`: çıkarım, karşılaştırma ve bağımsız denetim ayrıdır. Modelin `complete=true` beyanı satır tamlığı denetimi değildir. `reportReady` bu deneyde daima false; otomatik yayın yapılmaz.

Mevcut Tariff istemcisi `date`, `previousDate`, `origin` kabul ediyor. Üretim bağlantısında `date=resolvedDate`, `previousDate=previousSnapshotDate` kullanılmalı; mevcut `enrichWithTariff` yalnız raporun `targetDate` değerini geçiriyor. Ülke grupları, ölçü türü, miktar birimi ve GTİP sürümü eşleşmeden artış/azalış hesaplanmamalı. 4/6/8 haneli pozisyonlar alt kod araştırması gerektirir; mevcut istemcinin sıfır doldurma davranışına doğrudan verilmemeli.

Mevzuat türü tek başına genel OUT filtresi değildir. Kanun, Cumhurbaşkanı kararı, tebliğ, yönetmelik ve yargı kararı ilgili hükümler içerebilir. Tür + dar konu/başlık kuralıyla dışlama ancak ayrı politika, gerekçe ve kapsama testleriyle eklenmeli. Bu Temmuz deneyi tür nedeniyle belge atlamaz.

`rg-assemble.ts --input <tarama-klasörü>` tüm IN/OUT/REVIEW kayıtlarını `filter-report.json` içinde birleştirir; güncel türetilmiş IN kayıtlarını `dossiers-final/` içine yazar. İsteğe bağlı `dossier-audit.json` kapsam bulguları kesin OUT kararını REVIEW'a çekebilir. Modelin ilk kararı ayrıca saklanır. `valueGroups` aynı değerleri taşıyan satırları, GTİPlerini, kaynak ürün tanımlarını ve dipnotlarını birlikte sunar; anlamsal ürün ailesi tahmini yapmaz.

Temmuz deneyinde keşfedilen sınırlar: tek büyük model çağrısı uzun PDF'de zaman aşımına uğrayabilir; torba kanunda JSON şemasına uyan yanıt madde atlayabilir. İlk başarısız deneme saklanır. Yeniden çıkarım `--id ... --output <ayrı-deneme> --repair-note 'denetim bulgusu'` ile yapılır. `--concurrency 3` bağımsız belgeleri eşzamanlı işleyebilir. Üretimden önce sayfa/madde envanteri, bölümlenmiş çıkarım ve bağımsız kapsam eşitliği denetimi gerekir; bu prototip genel hukuki doğruluk garantisi vermez.

## v0.3: katalogdan araştırma planı

`tariff-catalog.ts` 21 mantıksal veri grubunu ve sınırlı `researchNeeds` sözleşmesini tanımlar. `tariff-provider-fields.json`, 2026-10-13 tarihinde yedi GTİP üzerinde alınmış 17 yanıtta gözlenen 225 alan yolunu/tipini ve 12 önlem türünü içerir. Bu dosya tüm Tariff servislerinin tam şeması değildir; null/boş alanlar veya tüm geçmiş sürümler için doluluk sözü vermez. Katalog gelecekte yeni yanıtlarla genişletilebilir.

Hem ilk filtreleme promptu hem ayrıntılı IN çıkarımı aynı kataloğu kullanır. Model alan kimliklerini, GTİPleri, önlem türünü, menşei ve yürürlük kuralına bağlantıyı seçer; eski değer icat etmez. Ayrıntılı yeni model yanıtlarında `researchNeeds` zorunludur. Eski kayıtlar `LEGACY_EXTRACTION_NEEDS_REPLAN` olarak kalır; eski araştırma alanları `legacyPlanning` altında açıkça yürütülemez olarak korunur. Prompt/önbellek sürümü yükseltilmiştir.

`research-plan.ts` yürürlükten bir gün önce Tariff sorgusunu hazırlar. Geçerli GTİP veya tarih eksikse sorgu planı yürütülemez; kısa GTİPler sıfırla doldurulmaz. Önceki tam hüküm metni doğrudan RG araştırmasına yönlendirilir. Tariff için eşleşmeme, eksik alan, belirsiz kapsam, hata veya resmî kaynakla çelişki RG alternatifini tetikleyecek nedenlerdir. RG planı başlık/numara/madde arama sözcüklerini, mükerrer kapsamını, ilk arama bitişini ve yürürlük öncesine kadar genişletme sınırını ayrı saklar. Geçerli önceki kaynak birden fazla değişiklik belgesi gerektirebilir.

`tariff-snapshot.ts` ham yanıtı, istek tarihini, kaynak rolünü, hash'i ve gözlenen alanları kayıpsız paketler; veri seçimi veya dönüştürme öncesi kullanılmalıdır. Kaynak rolleri raporda ayrı kalır: güncel RG bağlayıcı güncel hüküm; önceki RG bağlayıcı tarihsel hüküm; Tariff destekleyici tarihsel veri. Her rapor iddiasının kullandığı kaynaklar `provenance.reportClaims` içine araştırma yürütücüsü tarafından eklenecektir.

Bu adım katalog/prompt/plan sözleşmesini uygular. Otomatik Tariff sorgusu → RG arama → Gemini aday seçimi yürütücüsü ve üretim rapor hattı bağlantısı henüz uygulanmamıştır; `PLANNED` başarılı veri toplama anlamına gelmez. Önceki canlı karşılaştırma deneyi ayrıca saklıdır.

### Alan bazlı araştırmayı çalıştırma

`backend` dizininde:

```sh
node --import tsx scripts/rg-research.ts --input /absolute/path/dossier.json --output /absolute/path/research
```

İsteğe bağlı `--id need-1` tek araştırma ihtiyacını yürütür. Ayrıntılı çıkarım komutuna `--research` eklenirse çıkarımdan sonra aynı yürütücü otomatik çağrılır. Girdi, `rg-dossier.ts` tarafından üretilmiş `researchNeeds`, yürürlük kuralları ve tablo bağlamını içermelidir. Plan her seferinde bu verilerden yeniden kurulur; eski planın tarihine güvenilmez. Bu komut yeni kaynak prototipinin yürütücüsüdür; mevcut üretim rapor/otomasyon hattını değiştirmez.

- `tariff-retrieval.ts`: 21 katalog grubunu gerçek JSON konumlarıyla getirir; ham cevabı hash ve istek tarihiyle saklar. Aynı çalışma içinde GTİP+tarih sorgusu paylaşılır. Tam kod, beyan edilebilir ürün, yürürlük, ithalat, önlem türü, ülke/grup ve verilmişse birim/para/brüt ağırlık bağlamı kontrol edilir. Birden fazla kayıt, bilinmeyen grup üyeliği veya sağlayıcı önlem kodu otomatik seçilmez. Katalog yeteneği, her GTİPte dolu alan garantisi değildir.
- `official-research.ts`: Resmî Gazete'nin halka açık `/Home/Filter` aramasını tarayıcı oturumuyla kullanır. ISO tarih, tüm mükerrerler ve sayfalama korunur. İlk mevzuatın RG sayısı zorunlu filtre yapılmaz. `2018/5` ile `2018/5552` ayrılır. Arama kapsamı yürürlük öncesi güne kadar uzanır; güncel değişiklik belgesi seçim dışıdır. Model her adayı değerlendirir; seçilen fihristteki tekil başlık gerçek belgeye çözülür, ekleriyle toplanır.
- `execute-research.ts`: yalnız aynı eksik alan kümesine sahip GTİPleri birlikte RG araştırmasına aktarır. Tariff'te başarıyla alınmış alanları korur. `FOUND`, `NOT_FOUND`, `REVIEW` ve sağlayıcı düzeyinde `PARTIAL/AMBIGUOUS/ERROR` ayrımı yapılır. Ağ hatası veya kapsam sınırı “bulunamadı” sayılmaz.
- `research.json`: alan bazlı değerler, ham JSON konumları, Tariff kaynakları, resmî belgeler, model kanıtları ve eksikler. `evidenceResolved` yayın onayı değildir. PDF/görsel alıntıları bağımsız denetim beklediği için `REVIEW` kalır; hiçbir rapor yayımlanmaz.

Sınırlar sessiz kesme yapmaz: arama başına 200 sonuç, model için 100 aday, 20 seçili belge ve 18 MB materyal. Fazlası `REVIEW` döner. Önlem kodu haritası yalnız gözlenen kodları içerir; desteklenmeyen kontenjan/diğer türler RG araştırmasına düşer. Menşe ülkesinin sağlayıcı gruplarına üyeliğini çözen ayrı bir katalog henüz yoktur; bu durumda kesin eşleşme üretilmez.
