# Roller ve Yetkiler — Teknik Referans

Kontrol tarihi: 19 Ekim 2026

Bu belge yerel projedeki rol tanımları, sunucu erişim politikası ve arayüz sayfa korumaları temel alınarak hazırlanmıştır. `/admin` adresi önceki kontrolde giriş ekranına yönlendirdiğinden, canlı kullanıcı üyelikleri ve kişiye özel ek yetkiler doğrulanmamıştır.

> Güncellik notu: Önceki sohbet açıklamasında bulunan `academy.write`, dosya hazırlanırken güncel koddan kaldırılmış durumdadır. Bu belge güncel tanımları esas alır. Ayrıca `/api/v2/*` için `config.manage` kontrolü eklenmiştir.

## 1. Rol tanımları

| Kod | Türkçe adı | Temel görev |
|---|---|---|
| `ADMIN` | Yönetici | Kullanıcıları, yapılandırmayı ve içerik süreçlerini yönetir. |
| `EDITOR` | Editör | Belge yükler, tarama ve analiz başlatır, rapor düzenler ve yayımlar. |
| `VIEWER` | Görüntüleyici | Erişimine açık içerikleri ve işlem sonuçlarını okur. |

Permission adları `resource.action` biçimindedir. Sistemde genel bir `write` permission'ı yoktur; yazma işlemleri `write`, `upload`, `run`, `edit`, `publish`, `manage` ve `send` olarak ayrılır.

## 2. Rol–permission matrisi

Tablo varsayılan yetkileri gösterir. Permission sahibi olmak, kaynak sahipliği ve paylaşım kontrollerini ortadan kaldırmaz.

| Permission | İşlev | `ADMIN` | `EDITOR` | `VIEWER` |
|---|---|:---:|:---:|:---:|
| `workspace.read` | Çalışma alanı, tarama, otomasyon, kullanım ve katalog bilgilerini okuma | ✓ | ✓ | ✓ |
| `report.read` | Raporları, sürümleri, geçmişi ve rapor çıktılarını okuma | ✓ | ✓ | ✓ |
| `document.read` | Belgeleri, sürüm içeriğini ve orijinal dosyaları okuma | ✓ | ✓ | ✓ |
| `chat.read` | Sohbet listesini, mesajları ve sohbet bağlamını okuma | ✓ | ✓ | ✓ |
| `chat.write` | Sohbet oluşturma, mesaj gönderme, durdurma, silme ve sohbete belge ekleme | ✓ | ✓ | — |
| `document.upload` | Belge yükleme, içeri aktarma ve belge test işlemi | ✓ | ✓ | — |
| `scan.run` | Tarama başlatma ve mevcut otomasyonu elle çalıştırma | ✓ | ✓ | — |
| `analysis.run` | Analiz başlatma, işlem planlama ve işlem oluşturma | ✓ | ✓ | — |
| `report.edit` | Taslak açma/düzenleme, kaynak değiştirme, değişiklik geri alma ve taslak silme | ✓ | ✓ | — |
| `report.publish` | Rapor taslağını veya işlem çıktısını yayımlama | ✓ | ✓ | — |
| `operation.manage` | İşlem iptali, yeniden deneme ve otomasyon işlem adımlarını çalıştırma | ✓ | ✓ | — |
| `config.manage` | Kaynak, bağlantı, şablon, otomasyon, dağıtım grubu ve v2 erişimini yönetme | ✓ | — | — |
| `admin.manage` | Kullanıcı yönetimi ve arka plan iş kayıtlarına erişim | ✓ | — | — |
| `delivery.send` | Rapor gönderimi oluşturma | ✓ | Ek yetkiyle | — |

## 3. Kodda tanımlanan varsayılan yetki paketleri

Aşağıdaki kod, mevcut tanımların okunabilir biçimde düzenlenmiş halidir.

```ts
type ApplicationRole = 'VIEWER' | 'EDITOR' | 'ADMIN'

const rolePermissions: Record<ApplicationRole, string[]> = {
  VIEWER: [
    'workspace.read',
    'report.read',
    'document.read',
    'chat.read',
  ],
  EDITOR: [
    'workspace.read',
    'report.read',
    'document.read',
    'chat.read',
    'chat.write',
    'document.upload',
    'scan.run',
    'analysis.run',
    'report.edit',
    'report.publish',
    'operation.manage',
  ],
  ADMIN: [
    'workspace.read',
    'report.read',
    'document.read',
    'chat.read',
    'chat.write',
    'document.upload',
    'scan.run',
    'analysis.run',
    'report.edit',
    'report.publish',
    'operation.manage',
    'config.manage',
    'admin.manage',
    'delivery.send',
  ],
}
```

Varsayılan permission sayıları: `VIEWER`: 4, `EDITOR`: 11, `ADMIN`: 14. `ADMIN` ayrıca aşağıda açıklanan genel permission geçişine sahiptir.

## 4. HTTP metodu ve endpoint bazında örnekler

Sunucu gerekli permission'ı HTTP metodu ve kayıtlı route üzerinden seçer. Aşağıdaki tablo örnek eşleşmelerdir; tam politika kaynak dosyadadır.

| HTTP | Endpoint / route | Gerekli permission |
|---|---|---|
| `GET` | `/api/v1/documents` | `document.read` |
| `GET` | `/api/v1/document-versions/:id/original` | `document.read` |
| `POST` | `/api/v1/documents/uploads` | `document.upload` |
| `POST` | `/api/v1/documents/imports` | `document.upload` |
| `GET` | `/api/v1/chat/sessions/:id/messages` | `chat.read` |
| `POST` | `/api/v1/chat/sessions/:id/messages` | `chat.write` |
| `DELETE` | `/api/v1/chat/sessions/:id` | `chat.write` |
| `POST` | `/api/v1/scan-runs` | `scan.run` |
| `POST` | `/api/v1/operations/plan` | `analysis.run` |
| `POST` | `/api/v1/operations` | `analysis.run` |
| `POST` | `/api/v1/operations/:id/cancel` | `operation.manage` |
| `POST` | `/api/v1/operation-tasks/:id/retry` | `operation.manage` |
| `GET` | `/api/v1/topics/:id/draft` | `report.edit` |
| `POST` | `/api/v1/topics/:id/draft/edits` | `report.edit` |
| `DELETE` | `/api/v1/topics/:id/draft` | `report.edit` |
| `POST` | `/api/v1/topics/:id/draft/publish` | `report.publish` |
| `POST` | `/api/v1/topics/:id/dispatches` | `delivery.send` |
| `GET` | `/api/v1/automations` | `workspace.read` |
| `POST` | `/api/v1/automations/:id/run` | `scan.run` |
| `PATCH` | `/api/v1/automations/:id` | `config.manage` |
| `POST` | `/api/v1/templates/preview` | `workspace.read` |
| `GET` | `/api/v1/source-profiles/:id` | `config.manage` |
| `GET` | `/api/v1/users` | `admin.manage` |
| `PATCH` | `/api/v1/users/:id` | `admin.manage` |
| `GET` | `/api/v1/background-jobs` | `admin.manage` |
| Route'a gelen metotlar | `/api/v2/*` | `config.manage` |

### Read/write ayrımının önemli sonuçları

- Her `GET` isteği `.read` permission'ıyla açılmaz. Taslak okuma `report.edit`, kullanıcı listesi `admin.manage`, kaynak profili okuma `config.manage` ister.
- Her `POST` isteği içerik değiştirme yetkisi istemez. Şablon önizleme `workspace.read` ile açılır.
- `report.publish` ve `delivery.send` ayrıdır. Editör rapor yayımlayabilir; varsayılan olarak e-posta gönderimi oluşturamaz.
- Otomasyonu çalıştırmak `scan.run`, otomasyonun tanımını değiştirmek `config.manage` ister.
- `GET` ve `HEAD` istekleri politika seçiminde aynı okuma eşlemesini kullanır.
- Politika tablosunda bir eşleşme bulunması, ilgili endpoint'in uygulamada mutlaka kayıtlı olduğunu göstermez; endpoint kaydı ayrıca gereklidir.

## 5. Permission kontrolü

```ts
export function hasPermission(
  actor: ActorContext | undefined,
  permission: string,
): boolean {
  return !!actor && (
    actor.role === 'ADMIN' ||
    actor.permissions.includes(permission)
  )
}
```

- `ADMIN`, istenen permission listesinde bulunmasa da bu kontrolü geçer.
- `EDITOR` ve `VIEWER` için permission'ın etkin listede bulunması gerekir.
- Aktör yoksa bu fonksiyon `false` döndürür.
- Bu kontrol kaynak sahipliği, çalışma alanı, aktif oturum ve CSRF kontrollerinden ayrıdır.

## 6. Özel permission'lar ve rol sınırları

```ts
export function permissionsForRole(
  role: ApplicationRole,
  custom: string[] = [],
): string[] {
  const ceiling = new Set(
    role === 'VIEWER'
      ? rolePermissions.VIEWER
      : role === 'EDITOR'
        ? [...rolePermissions.EDITOR, 'delivery.send']
        : rolePermissions.ADMIN
  )

  return [...new Set([
    ...rolePermissions[role],
    ...custom.filter(permission => ceiling.has(permission)),
  ])]
}
```

| Rol | Özel permission davranışı |
|---|---|
| `VIEWER` | Yalnızca kendi dört okuma permission'ı kabul edilir; yazma yetkisi kazanamaz. |
| `EDITOR` | Varsayılan permission'larına ek olarak yalnızca `delivery.send` ile kapsamı genişleyebilir. |
| `ADMIN` | Özel liste tanımlı yönetici permission'larıyla filtrelenir; genel permission kontrolünü zaten rolü nedeniyle geçer. |

Özel permission'lar eklemelidir; rolün varsayılan yetkilerini çıkarmak için kullanılmaz. Tekrarlanan permission'lar `Set` ile tekilleştirilir. Örneğin `EDITOR` üyeliğine `admin.manage` yazılması, bu permission'ın etkin listeye girmesini sağlamaz.

## 7. Sunucunun ret davranışı

| Durum | HTTP | Hata kategorisi |
|---|---|---|
| Endpoint için politika tanımsız ve aktör `ADMIN` değil | `403` | `ROUTE_FORBIDDEN` |
| Gerekli permission aktörde yok | `403` | `PERMISSION_DENIED` |

`ADMIN`, tanımsız route politikası kontrolündeki istisnadır. Bu, mevcut olmayan endpoint'leri oluşturmaz veya diğer erişim kontrollerini kaldırmaz. Sunucu ayrıca oturum ve değiştirme isteklerinde kaynak/CSRF doğrulaması yapar.

## 8. Arayüz sayfa korumaları

| Sayfa | Gerekli permission |
|---|---|
| `/admin` | `admin.manage` |
| `/groups` | `config.manage` |
| `/templates` | `config.manage` |
| `/templates/components` | `config.manage` |

Arayüzde sayfa ve buton erişimi sınırlandırılır; sunucu istekleri ayrıca denetler. Bir okuma API'sine erişebilmek, ilgili yönetim sayfasına da erişilebildiği anlamına gelmez. Örneğin şablon listesinin API yetkisi `workspace.read`, şablon yönetim sayfasının yetkisi `config.manage` olarak tanımlıdır.

## 9. Kaynak sahipliği ve yönetim davranışı

- Özel sohbet erişimi çalışma alanı ve kullanıcı sahipliğiyle sınırlandırılır.
- Belge ve raporlarda özel içerik ile çalışma alanına paylaşılan içerik ayrımı vardır.
- `ADMIN` rolü, bu kaynak filtrelerini kendiliğinden kaldırmaz.
- Mevcut kullanıcı yönetim formunda hazır rol seçimi ve aktiflik alanı vardır; permission'ları tek tek düzenleme veya yeni rol tanımlama alanı yoktur.
- Rol güncellendiğinde üyeliğin özel permission listesi temizlenir ve ilgili çalışma alanındaki kullanıcı oturumları iptal edilir.
- Kullanıcıyı pasifleştirmek de ilgili oturumların iptalini tetikler.
- Kullanıcı kaydı oluşturma ile kurumsal kimlik bağlantısı kurma ayrı işlemlerdir.

## 10. Kaynak dosyalar

Bağlantılar bu Markdown dosyasının konumuna göre görecelidir ve depo taşındığında kullanılabilir.

- [Rol tanımları, özel permission sınırları ve sahiplik filtreleri](../../backend/src/platform/actor-context.ts)
- [HTTP metodu ve route bazında erişim politikası](../../backend/src/modules/auth/route-policy.ts)
- [Sunucu oturum ve permission denetimi](../../backend/src/modules/auth/guard.ts)
- [Kullanıcı ve üyelik güncelleme davranışı](../../backend/src/modules/workspace/workspace.routes.ts)
- [Arayüz sayfa korumaları](../../frontend/src/App.tsx)
- [Yönetim formu](../../frontend/src/features/workspace/CatalogPages.tsx)
- [Arayüz permission kontrolü](../../frontend/src/features/auth/AuthProvider.tsx)
