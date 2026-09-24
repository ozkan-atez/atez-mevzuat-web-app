# Rapor Revizyonu: Doğrudan Alan Düzenleme, Prompt ile Revizyon ve Taslak Tasarımı

**Tarih:** 14 Eylül 2026

**Durum:** Tasarım kararları kullanıcı ile netleştirildi; uygulama planı öncesi tasarım kaydı

**İlgili tasarım:** [Topic Bazlı Analiz, Revizyon Sohbeti ve HTML Rapor Tasarımı](2026-09-14-topic-analysis-report-design.md)

## 1. Amaç

Yayımlanmış bir ATEZ bülteninde kullanıcının belirttiği alanları kesin biçimde değiştirebilmesini sağlamak. Kullanıcı aynı raporu iki yoldan revize edebilir: bülten önizlemesinde alana tıklayıp yerinde düzenleyerek, ya da alt taraftaki AI asistanına yazdığı bir talepten. İki yol da aynı çekirdekten geçer, aynı denetim izini bırakır ve mevcut değişmez `rNN` revizyon düzenini bozmaz.

## 2. Bugünkü davranış ve neden yetersiz

Kullanıcı mesajı `classifyRevisionKind` ile ANALYSIS veya PUBLICATION olarak sınıflanır; her iki yol da Gemini'ye gider ve model **spec'in tamamını yeniden üretir**.

Üç sonucu var:

1. Kullanıcı birebir metni verdiğinde bile bir model turu ödenir; gecikme ve maliyet gereksizdir.
2. Model bütün spec'i yeniden ürettiği için kullanıcının dokunmadığı alanlar da değişebilir. "Başlığı düzelt" talebi özeti de başkalaştırabilir — sessiz kayma.
3. Kesinlik yoktur. Kullanıcı belirli bir değer istiyorsa modelin ona yaklaşması yeterli değildir.

## 3. Kesin Kararlar

1. Doğrudan düzenleme bir **yama** (patch) uygular; spec baştan üretilmez. Yamanın dokunmadığı alan değişmez.
2. Prompt ile revizyon da **yama üretir**. Gemini'den istenen çıktı, yeni bir rapor değil, uygulanacak alan değişiklikleri listesidir.
3. Model hiçbir koşulda HTML üretmez. HTML her zaman doğrulanmış spec'ten uygulama tarafından render edilir.
4. Değişiklikler bir **taslakta** birikir. Yeni `rNN` yalnızca kullanıcı yayınladığında oluşur.
5. Kanıta ve belge kimliğine bağlı alanlar düzenlenemez.
6. Alan düzenlemesi yeni bir `AnalysisRevision` doğurmaz; aynı analiz revizyonuna bağlı yeni bir `ReportRevision` oluşur.
7. Rapor sayfasında sohbet dökümü gösterilmez. Değişiklikler numaralı bir liste olarak görünür; bir numaraya tıklandığında o değişikliğin özeti açılır.
8. Her yama kaydı denetlenebilirdir: hangi alan, eski değer, yeni değer, kaynağı (insan mı model mi), varsa tetikleyen prompt.

## 4. Kapsam

Bu tasarım şunları kapsar:

- Doğrudan alan düzenleme (`DIRECT_EDIT`) çekirdeği
- Prompt tabanlı yama üretimi
- Taslak yaşam döngüsü ve yayımlama
- Düzenlenebilir alan izin listesi
- Değişiklik listesi ve özet görünümü
- Çakışma ve idempotency davranışı
- Veri modeli ve denetim izi

Şunlar bu tasarımın dışındadır:

- Genel amaçlı sohbet ajanı, araç katalogu ve internet araması (ayrı tasarım)
- Analiz revizyonu (olguların değişmesi) — mevcut ANALYSIS yolu korunur
- E-posta dağıtımı ve PDF üretimi

## 5. Uçtan Uca Akış

```text
                    Yayımlanmış rapor (rNN)
                              |
              +---------------+---------------+
              |                               |
   Önizlemede alan düzenleme          Docked asistana prompt
              |                               |
        insan yaması                    Gemini yama önerir
              |                               |
              +---------------+---------------+
                              |
                    İzin listesi doğrulaması
                              |
                       Taslağa uygula
                              |
                    ReportSpecSchema.parse
                              |
                  renderReportHtml (taslak)
                              |
                  Önizleme güncellenir + değişiklik listesine kayıt
                              |
                     [kullanıcı yayınlar]
                              |
                  validateReportHtml + yeni rNN
```

Taslak yayımlanana kadar nesne deposunda revizyon oluşmaz. Önizleme taslak spec'inden anlık render edilir; `renderReportHtml` saf bir fonksiyon olduğu için bu ucuzdur.

## 6. Yama Sözleşmesi

Bir yama, izin listesine göre doğrulanan alan yollarının listesidir:

```json
{
  "expectedVersion": 3,
  "edits": [
    { "path": "title", "value": "..." },
    { "path": "affectedParties.1", "value": "..." },
    { "path": "table.rows.3.2", "value": "50" },
    { "path": "note", "value": null }
  ]
}
```

`path` serbest JSONPath değildir; izin listesindeki kalıplarla eşleşmek zorundadır. Eşleşmeyen yol reddedilir, yamanın tamamı uygulanmaz.

### 6.1 Düzenlenebilir alanlar

| Düzenlenebilir | Kilitli |
| --- | --- |
| `title`, `typeLabel`, `summary`, `documentNumber` | `schemaVersion`, `templateFamily`, `reportId`, `topicId` |
| `affectedParties[]`, `dates[]`, `note` | `card` |
| `blocks` seçimi | `issueNumber`, `displayDate` |
| `table.title`, `table.note`, `table.rows[][]` | `source.url`, `documentTitle` |
| K3: `oldDeadline`, `newDeadline`, `timeline[]` | |
| K4: `removedRule`, `replacementRule`, `alert` | |
| K5: `supportingSource.label` | |

Sağ sütun belgenin kimliğini ve kaynağını taşır. Bunlar değişirse rapor başka bir belgeyi anlatmaya başlar; düzeltilmesi gerekiyorsa doğru yol analiz revizyonudur.

`card` kilitlidir çünkü kart seçimi analizin kanıtladığı veriye bağlı bir kuraldır. `table.columns` ve satır/sütun sayısı da yama ile değiştirilemez; tablo yapısı değişecekse bu bir analiz revizyonudur.

### 6.2 Prompt ile yama üretimi

Modelden istenen çıktı şeması, yukarıdaki yama sözleşmesinin kendisidir. Modele verilen bağlam:

1. Sabit sistem prompt'u ve prompt sürümü
2. Güncel taslak spec'i
3. Düzenlenebilir alan listesi ve her birinin mevcut değeri
4. Kullanıcının talebi

Model kilitli bir alana yama önerirse çıktı doğrulamada reddedilir ve kullanıcıya bunun neden yapılamadığı bildirilir; körlemesine tekrar denenmez. Model kanıtı değiştirecek bir talep aldığında (`yeni bir tarih ekle`, `oranı düzelt`) yama üretmek yerine bunun bir analiz revizyonu olduğunu bildirir.

Kullanıcı girdisi ve mevcut spec içeriği **veridir**, talimat değildir; içlerindeki yönergeler çalıştırılmaz.

## 7. Taslak Yaşam Döngüsü

```text
YOK -> AÇIK -> (yayımlandı) -> KAPALI
          \-> (iptal edildi) -> KAPALI
```

- Rapor başına en fazla bir açık taslak bulunur.
- Taslak, üzerine kurulduğu revizyonun numarasını saklar (`baseVersion`).
- Yayımlama, biriken bütün yamaları tek bir `rNN` olarak yazar.
- İptal, taslağı ve yamalarını denetim izinde bırakarak kapatır; yayımlanmış revizyonlara dokunmaz.

Yayımlama sırasında `baseVersion` ile raporun güncel sürümü karşılaştırılır. Arada başka bir revizyon oluştuysa yayımlama reddedilir (409) ve kullanıcı güncel hâlin üstüne çalışır. Bu olmadan iki kullanıcı birbirinin değişikliğini sessizce ezer.

## 8. Değişiklik Listesi

Rapor sayfasında sohbet dökümü yoktur. Bunun yerine taslaktaki her yama sıra numarasıyla görünür:

```text
1  Başlık düzeltildi
2  Etkilenen taraflar güncellendi (2 madde)
3  Tablo: "Doğum Tarihi" satırı düzeltildi
```

Bir numaraya tıklandığında o yamanın özeti açılır: hangi alan, eski değer, yeni değer, kaynağı (`Kullanıcı` / `AI`), AI ise tetikleyen prompt. Kullanıcı tek bir yamayı geri alabilir; geri alma taslakta yeni bir kayıt oluşturur, kayıt silinmez.

## 9. Veri Modeli

Mevcut `TopicProcess`, `AnalysisThread`, `ChatMessage`, `AnalysisRevision` ve `ReportRevision` korunur. Eklenenler:

- `ReportDraft`: raporun açık taslağı; `topicId`, `baseVersion`, `specJson`, durum, oluşturan, zaman damgaları
- `ReportFieldEdit`: taslağa bağlı tek yama kaydı; sıra numarası, `path`, `previousValue`, `nextValue`, kaynak (`USER` / `AI`), varsa `chatMessageId`, `revertedByEditId`

`RevisionKind` enum'ına `DIRECT_EDIT` eklenir. Yayımlanan revizyon, hangi taslaktan geldiğini `ReportRevision.draftId` ile taşır.

İlişki özeti:

```text
TopicProcess 1---0..1 ReportDraft (açık olan)
ReportDraft  1---N    ReportFieldEdit
ReportDraft  1---0..1 ReportRevision (yayımlandığında)
ReportFieldEdit 0..1---1 ChatMessage (AI kaynaklı yamalarda)
```

## 10. Yürütme Yolu

Doğrudan düzenleme modelden geçmediği için **senkron** çalışır: HTTP isteği yamayı uygular, taslağı günceller ve yeni önizleme HTML'ini döner. Kuyruk ve outbox bu yol için kullanılmaz; modelsiz bir işi asenkron yapmak kullanıcıyı gereksiz bekletir.

Prompt ile revizyon bir model çağrısı içerdiği için mevcut desene uyar: `ChatMessage` + `TopicOutbox` + kuyruk. Kuyruk işçisi yamayı üretir, aynı senkron çekirdeğe uygular ve sonucu değişiklik listesine yazar.

Her iki yol da tek bir application use-case'ini çağırır: `applyReportFieldEdits(draftId, patch, source)`. Yama doğrulama, şema kontrolü, render ve kayıt burada tek yerde olur.

İdempotency mevcut desenle korunur: senkron yol `Idempotency-Key` başlığı, kuyruk yolu `ChatMessage.requestKey` ile.

## 11. Katmanlar

- **domain** — `ReportPatch`, `EditablePath` izin listesi, taslak durum kuralları
- **application** — `applyReportFieldEdits`, `publishReportDraft`, `discardReportDraft`, `buildPatchPrompt`
- **infrastructure** — `PrismaReportDraftRepository`, Gemini yama istemcisi
- **interface** — `/api/v1/topics/:id/draft` uçları

Mevcut `renderReportHtml` ve `validateReportHtml` değişmeden kullanılır.

## 12. Güvenlik ve Denetlenebilirlik

- Yayımlanmış hiçbir revizyon değiştirilmez; her yayımlama yeni `rNN` açar.
- Kilitli alanlar sunucuda zorlanır; istemciden gelen yol listesine güvenilmez.
- Model çıktısı yama şemasından geçmeden uygulanmaz.
- Her yama kaydı kaynağı ve tetikleyicisiyle saklanır.
- Kullanıcı metni ve model çıktısı HTML'e kaçış işleminden geçmeden yazılmaz.

## 13. Test Stratejisi

### 13.1 Birim testleri

- İzin listesi: kilitli alana yama reddedilir, izinli alan uygulanır
- Yamanın dokunmadığı alanların değişmediği
- Şemayı bozan yamanın (boş zorunlu alan, satır/sütun uyuşmazlığı) tamamen reddedildiği
- Model çıktısının yama şemasına uymadığında uygulanmadığı
- Geri almanın kaydı silmeyip yeni kayıt oluşturduğu

### 13.2 Entegrasyon testleri

- Taslakta biriken üç yamanın tek `rNN` ürettiği
- `baseVersion` eskiyken yayımlamanın 409 döndüğü
- Yayımlamanın yeni `AnalysisRevision` oluşturmadığı, aynı analize bağlandığı
- Aynı `Idempotency-Key` ile tekrarlanan yamanın iki kez uygulanmadığı
- Prompt yolunun ürettiği yamanın aynı çekirdekten geçtiği

## 14. Kabul Kriterleri

1. Kullanıcı önizlemede bir alanı düzenlediğinde yalnız o alan değişir ve önizleme anında güncellenir.
2. Kullanıcı docked asistana yazdığında arka planda yama üretilir, spec ve önizleme güncellenir, sohbet dökümü gösterilmez.
3. Biriken değişiklikler numaralı listede görünür; bir numaraya tıklandığında ne değiştiği özetlenir.
4. Yayımlama tek bir yeni `rNN` üretir ve önceki revizyonlar değişmez.
5. Kilitli bir alan hiçbir yoldan değiştirilemez.
6. Eskimiş bir taslak yayımlanamaz; kullanıcı güncel revizyonun üstüne çalışmaya yönlendirilir.
