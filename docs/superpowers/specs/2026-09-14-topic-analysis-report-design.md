# Topic Bazlı Analiz, Revizyon Sohbeti ve HTML Rapor Tasarımı

**Tarih:** 14 Eylül 2026

**Durum:** Kullanıcı tarafından mimari yaklaşımı onaylandı; uygulama planı öncesi tasarım kaydı

**Test hedef tarihi:** 11 Eylül 2026

## 1. Amaç

Resmî Gazete taramasının iki aşamalı filtresinden `IN` olarak çıkan her topic'i birbirinden bağımsız analiz etmek, analiz sonucunu kalıcı ve revizyonlanabilir biçimde saklamak ve mevcut ATEZ komponentli şablon ailesinden doğrulanmış bir HTML rapor üretmek.

Sistem aynı zamanda her topic için kalıcı bir analiz sohbeti sağlar. İlk otomatik analiz bu sohbetin ilk sistem çalışmasıdır. Kullanıcı daha sonra aynı sohbet üzerinden analiz veya rapor revizyonu isteyebilir. Önceki sonuçların üzerine yazılmaz; her değişiklik yeni bir revizyon oluşturur.

## 2. Kesin Kararlar

1. Filtre aşaması topic sınırını belirler. Analyzer belgeyi tekrar bölmez ve yeni topic üretmez.
2. Bir topic, bir kaynak belge paketi, bir analiz süreci ve bir HTML rapor demektir.
3. Her `IN` topic için işler kuyruk üzerinden bağımsız ve sınırlı paralellikle çalışır.
4. Gemini HTML, CSS veya logo üretmez. Model yalnızca sıkı şemaya uyan kapsamlı analiz verisi üretir.
5. `analysis.json` makine tarafından kullanılan kanonik analiz kaydıdır.
6. `analysis.md`, `analysis.json` içinden uygulama tarafından deterministik olarak oluşturulan geniş kapsamlı ve okunabilir analiz hafızasıdır.
7. `report-spec.json`, HTML'de kullanılacak kart ve blokları tarif eden yayın sözleşmesidir.
8. `report.html`, sabit şablon ve doğrulanmış `report-spec.json` üzerinden uygulama tarafından oluşturulur.
9. `atez-logo.png` model bağlamına gönderilmez. Renderer dosyayı okuyup HTML içine gömülü data URI olarak yerleştirir.
10. Hiçbir raporlanabilir değişiklik yoksa Gemini analiz çağrısı yapılmadan hazır K6 şablonundan tek bir `00-degisiklik-yok.html` oluşturulur.

## 3. Kapsam

Bu tasarım şunları kapsar:

- Filtre sonrası topic işlerinin oluşturulması
- Topic başına kanıt paketinin sabitlenmesi
- Gemini ile yapılandırılmış analiz
- Analiz JSON ve Markdown çıktıları
- Topic'e bağlı kalıcı sohbet ve revizyonlar
- Polimorfik rapor spesifikasyonu
- K1-K6 kart seçimi ve B1-B10 blok üretimi
- HTML oluşturma ve yerel doğrulama
- Değişiklik-yok kısa yolu
- Veritabanı ve nesne deposu sorumlulukları
- Retry, hata görünürlüğü ve test kabul kriterleri

Şunlar bu tasarımın dışındadır:

- E-posta gönderimi
- Kullanıcı/grup dağıtım kuralları
- İGMD, Ticaret Bakanlığı ve mevzuat.net kaynaklarının toplanması
- Şablon kataloğu dışında yeni kart, blok, CSS veya renk üretimi
- Aynı topic'ten birden fazla rapor çıkarılması

## 4. Uçtan Uca Akış

```text
Resmî Gazete kaynak toplama
          |
İki aşamalı IN / OUT filtresi
          |
          +-- IN yok --------------------------+
          |                                    |
          |                              K6 report-spec
          |                                    |
          |                         00-degisiklik-yok.html
          |
          +-- Her IN topic
                  |
          EvidenceBundle sabitleme
                  |
          TopicAnalysisJob (paralel)
                  |
          Gemini structured output
                  |
          analysis/rNN/analysis.json
                  |
          deterministik analysis.md
                  |
          deterministik report-spec.json
                  |
          sabit HTML renderer + validator
                  |
          reports/rNN/report.html
```

Bir topic işi diğer topic işinden veri, sohbet, retry ve durum bakımından tamamen ayrıdır. Bir topic'in başarısız olması tamamlanmış diğer topic raporlarını bozmaz; ancak run'ın genel durumu kısmi başarısızlığı açıkça gösterir.

## 5. Kanıt Paketi

Her topic için değiştirilemeyen bir `EvidenceBundle` hazırlanır. Paket şunları referanslar:

- Güncel Resmî Gazete ana belgesi
- Belgeden bulunan PDF, PNG, JPG, GIF ve diğer izinli ekler
- Belge içindeki kaynak bağlantıları
- Bulunmuşsa önceki düzenleme kaynağı
- Her nesnenin SHA-256 özeti, MIME türü, boyutu ve nesne deposu anahtarı
- Metin çıkarımı veya OCR çıktısının konum referansları

Analyzer'a verilen bütün içerik üçüncü taraf verisi kabul edilir; belge içindeki talimatlar çalıştırılmaz. Orijinal dosyalar kanıtın tek bağlayıcı kaynağıdır ve revizyonlarda silinmez.

## 6. Kanonik Analiz Sözleşmesi

Gemini tek topic için tek bir şema döndürür. Şema topic listesi içermez ve yeni topic oluşturamaz.

```json
{
  "schemaVersion": 1,
  "topicId": "uuid",
  "status": "PASS",
  "document": {
    "title": "Resmî başlık",
    "documentNumber": "2026/8",
    "gazetteDate": "2026-09-11",
    "gazetteNumber": "12345",
    "sourceUrl": "https://..."
  },
  "change": {
    "type": "AMENDMENT",
    "detailedAnalysis": "...",
    "summary": "...",
    "previousRule": "...",
    "currentRule": "...",
    "operationalImpact": "..."
  },
  "affectedParties": [],
  "effectiveDates": [],
  "comparisons": [],
  "tables": [],
  "officialSources": [],
  "supportingSources": [],
  "evidence": [],
  "unresolvedReferences": [],
  "emailTitle": "...",
  "emailSummary": "..."
}
```

Gerçek JSON şeması ayrık union tipleri kullanır. `change.type`, tarih, karşılaştırma, tablo ve kaynak elemanları kendi sıkı alt şemalarına sahiptir. Kanıtı bulunmayan koşullu alanlar boş dizi olarak döner; boş metin, `N/A`, `-` veya uydurma dolgu kullanılmaz.

Kabul edilen analiz durumları:

- `PASS`: Kanıtlı ve rapor üretimine hazır
- `PASS_NO_RELEVANT_CONTENT`: Analiz aşamasında raporlanabilir hüküm bulunmadı
- `BLOCKED_ANALYSIS_SCHEMA`: Zorunlu veri eksik veya model çıktısı şemaya uymuyor
- `BLOCKED_REFERENCE_UNRESOLVED`: Raporun zorunlu bir hükmü çözülemeyen kaynağa bağlı
- `FAILED_PROVIDER`: Gemini çağrısı sağlayıcı hatasıyla tamamlanmadı

## 7. `analysis.md`

`analysis.md`, modelden ikinci kez istenmez. Kanonik `analysis.json` ve kanıt referansları kullanılarak uygulama içinde oluşturulur. Böylece ikinci bir model çağrısı ve aynı olgular için tekrarlanan output token maliyeti oluşmaz.

Markdown dosyası şu sabit bölümleri taşır:

1. Belge kimliği
2. Düzenlemenin kapsamı
3. Ayrıntılı analiz
4. Önceki ve yeni durum
5. Etkilenen taraflar
6. Operasyonel etkiler
7. Tarihler ve koşullar
8. Tablolar
9. Resmî ve destekleyici kaynaklar
10. Kanıt konumları
11. Çözülemeyen referanslar

Boş bölüm üretilmez. Markdown müşteri raporu değildir; süreç ve kanıt ayrıntıları burada bulunabilir.

## 8. Revizyon Sohbeti

Her topic için bir `AnalysisThread` bulunur. Topic'ler aynı sohbet oturumunda birleştirilmez.

İlk otomatik analiz, thread'in ilk AI çalışması olarak kaydedilir. Sonraki kullanıcı mesajları iki sınıfa ayrılır:

- **Analiz revizyonu:** Olgu, yorum, karşılaştırma, etkilenen taraf veya tarih değişir. Yeni `AnalysisRevision` ve buna bağlı yeni `ReportRevision` oluşur.
- **Yayın revizyonu:** Kanıtlı olgular değişmeden izin verilen rapor metni veya blok seçimi değişir. Aynı `AnalysisRevision` kullanılarak yeni `ReportRevision` oluşur.

Her revizyonda bütün sohbet ve kaynak dosyalar modele yeniden gönderilmez. Context builder şu sırayla bağlam kurar:

1. Sabit sistem prompt'u ve prompt sürümü
2. Son geçerli `analysis.md`
3. Son kanonik `analysis.json`
4. Kullanıcının son talebi
5. Yalnızca taleple ilgili kanıt parçaları
6. Gerekirse son birkaç mesaj veya eski mesajların kısa özeti

`analysis.md` token tasarrufu sağlayan bağlam kaydıdır; kanıtın yerine geçmez. Yeni olgu ekleme, mevcut olguya itiraz veya hukuki/faktüel düzeltme isteklerinde ilgili orijinal kanıt yeniden bağlama alınır.

## 9. Rapor Spesifikasyonu

`report-spec.json` tek bir dev ve nullable nesne değildir. Kart türüne göre doğrulanan ayrık bir union'dır:

- `K1`: Standart kart
- `K2`: Standart kart ve tablo
- `K3`: Süre uzatımı / takvim
- `K4`: Yürürlükten kaldırma / iptal
- `K5`: Duyuru / destekleyici kaynak
- `K6`: Değişiklik yok

Kart seçimi yayın katmanında aşağıdaki öncelikle yapılır:

1. Raporlanabilir değişiklik yoksa K6
2. Yürürlükten kaldırma, iptal veya askıya alma varsa K4
3. Konunun özü kanıtlı bir tarih değişikliği ise K3
4. Okunması gereken en az iki satırlık yapısal veri varsa K2
5. Tek dayanak destekleyici kaynaksa K5
6. Diğer durumlarda K1

Tablo her raporda zorunlu değildir. `analysis.tables` boşsa K2 seçilemez ve HTML'de tablo bloğu bulunmaz. Benzer şekilde önceki durum kanıtlı değilse karşılaştırma bloğu üretilmez. Publisher yalnızca analizin kanıtladığı blokları ekler.

`report-spec.json` içerikleri gereksiz yere kopyalamak yerine mümkün olduğunda kanonik analiz alanlarına güvenli referanslar taşır:

```json
{
  "schemaVersion": 1,
  "templateFamily": "bulten-v2",
  "topicId": "uuid",
  "card": "K2",
  "blocks": [
    { "type": "summary", "contentRef": "change.summary" },
    { "type": "affectedParties", "contentRef": "affectedParties" },
    { "type": "table", "contentRef": "tables.0" },
    { "type": "source", "contentRef": "officialSources.0" }
  ]
}
```

Referanslar izinli alan listesine göre doğrulanır; serbest JSONPath veya çalıştırılabilir ifade kabul edilmez.

## 10. HTML Renderer ve Doğrulama

Renderer sabit `bulten-v2` iskeletini ve K1-K6/B1-B10 kataloğunu kullanır. Model çıktısından HTML kabul edilmez.

- Her topic için tam olarak bir HTML ve içinde tam olarak bir kart bulunur.
- HTML dosyasının topic'i filtre aşamasındaki topic ile aynıdır.
- Şablon dışı sınıf, kart veya bölüm eklenmez.
- Kaynak metinleri HTML escape işleminden geçer.
- Dış görsel, script, iframe, form ve çalıştırılabilir olay öznitelikleri yasaktır.
- `atez-logo.png` doğrulanır ve data URI olarak HTML içine gömülür.
- Kullanılmayan bloklar boş bırakılmaz; tamamen çıkarılır.
- HTML yazılmadan önce JSON şeması, yazıldıktan sonra şablon doğrulayıcısı çalışır.

Bir doğrulama başarısızsa geçersiz HTML tamamlanmış rapor olarak kaydedilmez.

## 11. Değişiklik-Yok Kısa Yolu

Aşağıdaki koşullardan biri gerçekleştiğinde tam olarak bir K6 raporu üretilir:

- İki aşamalı filtre sonunda `IN` topic sayısı sıfırsa
- Bütün topic analizleri `PASS_NO_RELEVANT_CONTENT` ile sonuçlandıysa

Bu durumda:

- Gemini rapor çağrısı yapılmaz.
- Topic raporlarıyla K6 aynı run içinde birlikte üretilmez.
- Hazır K6 komponenti kullanılır.
- Dosya adı `00-degisiklik-yok.html` olur.
- Raporda hedef tarih, Resmî Gazete kaynağı ve incelenen belge sayısı bulunur.
- Manifest durumu `PASS_NO_RELEVANT_CONTENT` olur.

En az bir `PASS` topic varsa yalnızca ilgili topic raporları üretilir; ayrıca değişiklik-yok raporu eklenmez.

## 12. Veri Modeli

Mevcut `WorkflowRun`, `GazetteItem`, `Report`, `ReportRevision` ve `ChatSession` modelleri korunarak aşağıdaki sorumluluklar eklenir veya genişletilir:

- `TopicProcess`: Filtrelenmiş tek topic'in run içindeki iş kaydı
- `EvidenceBundle`: Topic'in değiştirilemeyen kaynak paketi ve manifest'i
- `AnalysisThread`: Topic'e bire bir bağlı sohbet
- `ChatMessage`: Rol, içerik, amaç ve bağlı revizyon
- `AnalysisRevision`: Sürüm, durum, JSON/Markdown nesne anahtarları, prompt/model sürümü
- `ReportRevision`: Bağlı analiz revizyonu, report-spec ve HTML nesne anahtarları, doğrulama durumu
- `AiExecution`: Sağlayıcı isteği, süre, token kullanımı, retry sayısı ve hata sınıfı

İlişki özeti:

```text
WorkflowRun 1---N TopicProcess
TopicProcess 1---1 EvidenceBundle
TopicProcess 1---1 AnalysisThread
AnalysisThread 1---N ChatMessage
TopicProcess 1---N AnalysisRevision
AnalysisRevision 1---N ReportRevision
AnalysisRevision 1---N AiExecution
```

## 13. Nesne Deposu Düzeni

Veritabanı durum, ilişki ve sorgulanabilir metadataları; MinIO/S3 uyumlu nesne deposu ise dosyaları tutar.

```text
resmi-gazete/
  2026/09/11/
    runs/{runId}/
      topics/{topicId}/
        evidence/manifest.json
        analysis/r01/analysis.json
        analysis/r01/analysis.md
        reports/r01/report-spec.json
        reports/r01/report.html
      reports/00-degisiklik-yok.html
      manifest.json
```

Nesne anahtarları değiştirilemez revizyonlara işaret eder. Yeni revizyon yeni `rNN` klasörü açar; mevcut dosyanın üzerine yazılmaz.

## 14. Durum ve Retry Davranışı

Topic işinin temel durumları:

```text
PENDING -> ANALYZING -> ANALYZED -> RENDERING -> VALIDATING -> COMPLETED
                     \-> RETRY_WAIT
                     \-> FAILED
```

Gemini kota, yoğunluk, geçici ağ veya 5xx hatalarında hata sınıfı ve sağlayıcı mesajı saklanır. Otomatik retry sınırlı ve gecikmeli yapılır. Retry hakkı bittiğinde UI gerçek nedeni gösterir ve kullanıcı yalnızca ilgili topic için yeniden deneme başlatabilir.

Şema veya kanıt hatası sağlayıcı retry'ı değildir. Bu durumda model isteği körlemesine tekrarlanmaz; topic `BLOCKED_ANALYSIS_SCHEMA` veya `BLOCKED_REFERENCE_UNRESOLVED` durumuna alınır.

## 15. Güvenlik ve Denetlenebilirlik

- API anahtarları veritabanına, prompt kaydına veya loglara yazılmaz.
- Her AI çalışmasında model adı, prompt sürümü, şema sürümü ve kaynak imzaları kaydedilir.
- Model cevabı şema doğrulamasından geçmeden kanonik analiz olamaz.
- Kaynak metni ve sohbet girdisi HTML'e doğrudan yazılmaz.
- Bütün revizyonlar ve kullanıcı talepleri denetim izi olarak korunur.
- Önceki bir analiz veya rapor revizyonu değiştirilemez.

## 16. Test Stratejisi

### 16.1 Birim testleri

- Analysis JSON şemasının geçerli ve geçersiz örnekleri
- `analysis.json` -> `analysis.md` dönüşümü
- K1-K6 kart seçim önceliği
- Tablosuz analizde tablo bloğu üretilmemesi
- İki veya daha fazla yapısal satırda K2 seçilmesi
- Kanıtsız karşılaştırma bloğunun çıkarılması
- Logo dosyasının data URI olarak gömülmesi
- HTML escape ve izinli alan referansı kontrolleri
- K6 report-spec ve HTML üretimi

### 16.2 Entegrasyon testleri

Bütün tarih bazlı entegrasyon ve uçtan uca testler `2026-09-11` hedef tarihiyle çalışır. `2026-07-11` test girdisi kullanılmaz.

Gerçek veri senaryosu:

1. 11 Eylül 2026 Resmî Gazete kaynakları çekilir.
2. Ana belgeler ve bütün ek varlıklar nesne deposunda doğrulanır.
3. İki aşamalı filtre çalışır.
4. Her `IN` topic için tam olarak bir `TopicProcess` oluştuğu doğrulanır.
5. Analyzer'ın topic üretmediği veya bölmediği doğrulanır.
6. Her başarılı topic için `analysis.json`, `analysis.md`, `report-spec.json` ve tek kartlı HTML doğrulanır.
7. Paralel topic'lerin sohbet ve revizyonlarının birbirine karışmadığı doğrulanır.

Değişiklik-yok senaryosu:

1. Hedef tarih yine `2026-09-11` tutulur.
2. Filtre çıktısı kontrollü fixture/stub ile sıfır `IN` döndürür.
3. Gemini analiz servisinin hiç çağrılmadığı doğrulanır.
4. Tam olarak bir `00-degisiklik-yok.html` oluştuğu doğrulanır.
5. K6 dışında kart ve topic raporu bulunmadığı doğrulanır.
6. Manifest durumunun `PASS_NO_RELEVANT_CONTENT` olduğu doğrulanır.

### 16.3 Revizyon testleri

- Metinsel revizyon aynı analiz revizyonundan yeni rapor revizyonu üretir.
- Faktüel revizyon ilgili kanıtı bağlama alıp yeni analiz ve rapor revizyonu üretir.
- Eski revizyonların değişmediği doğrulanır.
- Tam sohbet geçmişinin her model çağrısına gönderilmediği doğrulanır.
- Bir topic'teki revizyonun başka topic'in bağlamına girmediği doğrulanır.

## 17. Kabul Kriterleri

Tasarım aşağıdaki koşullar sağlandığında uygulanmış kabul edilir:

1. Filtre sonrası her `IN` topic bağımsız ve bölünmeden işlenir.
2. Her başarılı topic için kanonik JSON, okunabilir Markdown, rapor spesifikasyonu ve doğrulanmış HTML saklanır.
3. HTML formatı veri türüne göre K1-K5 arasında doğru seçilir; tablo yalnızca kanıtlı yapısal veri varsa görünür.
4. Her topic sohbeti kalıcıdır ve revizyonlar sürümlüdür.
5. Revizyonlar mümkün olduğunda `analysis.md` üzerinden düşük token maliyetiyle çalışır; gerekli olgusal durumlarda özgün kanıta geri döner.
6. Sıfır değişiklikte AI çağrısı yapılmadan tek K6 HTML raporu oluşur.
7. Uçtan uca doğrulama `2026-09-11` tarihiyle geçer.
8. Eski `2026-07-11` test tarihi yeni analiz/rapor testlerinde kullanılmaz.
