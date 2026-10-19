# Keycloak girişini çalıştırma ve şirket ortamına geçiş

Uygulama Fastify BFF oturumu kullanır. Kullanıcı Keycloak ekranında giriş yapar; sağlayıcı tokenları şifreli olarak PostgreSQL'de kalır. Tarayıcı yalnız HttpOnly oturum cookie'sini kullanır. Kullanıcı kimliği issuer ve subject ile bağlanır; e-posta veya Keycloak rolü otomatik uygulama üyeliği oluşturmaz.

## Yerel kullanım

Uygulama adresi `http://localhost:5173`, bu projeye ait Keycloak adresi `http://localhost:45881` ve realm `atez-web-local` şeklindedir. Eski 8888 ve 127.0.0.1 frontend adresleri canonical localhost:5173 adresine yönlenir. Diğer radar projesinin 45880 kurulumuna dokunulmaz.

İlk kurulum:

```sh
node backend/scripts/setup-local-auth.cjs
docker compose --env-file .local/auth/auth.env -f infra/auth/compose.yml up -d
node backend/scripts/local-auth-command.cjs migrate
node backend/scripts/local-auth-command.cjs provision
```

`migrate` yalnız bu makinenin 127.0.0.1:5432/atez_db hedefine çalışabilir. Mevcut veritabanında önce yedek alınmalıdır. Setup tekrar çalıştırıldığında secret ve kullanıcı parolaları korunur; provisioning mevcut rol veya kapatılmış üyeliği yeniden etkinleştirmez.

Yerel hesaplar `admin`, `editor`, `viewer` ve uygulama üyeliği olmayan `outsider` hesabıdır. Parolalar yalnız `.local/auth/accounts.json` içinde saklanır. `.local/auth/auth.env` bağlantı ve şifreleme değerlerini içerir. Bu dosyalar Git'e alınmaz; kullanıcıya ait yerel erişimle okunur. Kurulum sırları terminale yazdırmaz.

Keycloak realm import ilk oluşturma içindir. Var olan realm başlangıçta yeniden içeri alınmaz; realm ayarları değiştirilecekse ayrı yönetim işlemi gerekir. `start-dev` profili yalnız yerel kullanım içindir. [Keycloak container rehberi](https://www.keycloak.org/server/containers), [realm import davranışı](https://www.keycloak.org/server/importExport)

Yerel servisler `deploy/run-local.mjs` ile çalışır. Yerel profil `.local/auth/auth.env` değerlerini okur. `.env` veya process env içinde açık `AUTH_PROFILE=company` seçilirse yerel auth değerleri kullanılmaz. Frontend değişikliği için `frontend` dizininde `npm run build` çalıştırılır. API, worker ve web servisleri yeni ayarları almak için yeniden başlatılır.

## Roller ve özel içerik

VIEWER yayımlanmış, erişebildiği raporları ve ortak arşivi okuyabilir. EDITOR kendi sohbet ve belgelerini yönetir; analiz, tarama ve rapor düzenleme/kaydetme yapabilir. ADMIN ayrıca kaynak hesabı, otomasyon, şablon, kullanıcı ve rol yönetir. E-posta gönderimi ayrı delivery.send iznine bağlıdır.

Kişisel belge, sohbet, analiz ve bunlardan türeyen rapor kullanıcıya özeldir. Admin rolü başka kullanıcının özel içeriğine otomatik erişim vermez. Mevcut ortak topic raporuna özel arşiv belgesi doğrudan eklenemez; belge arşivindeki özel analiz/rapor akışı kullanılmalıdır. Bir kaydın yayımlanmış olması kendiliğinden bütün çalışma alanıyla paylaşılması anlamına gelmez.

Eski sahipsiz kayıtlar migration sırasında LEGACY durumunda kalır. Açık sahip atama önce dry-run ile incelenir:

```sh
node backend/scripts/local-auth-command.cjs assign --workspace-id WORKSPACE_UUID --owner-user-id ADMIN_USER_UUID
```

`--apply` atamayı yapar. Bu komut aktif ve kimliği açıkça bağlanmış bir yönetici ister. Resmî Gazete kaynağı doğrulanan belgeler ortak arşive, sohbet ve diğer belgeler seçilen kişiye bağlanır. Eski raporlar varsayılan olarak bu kişiye özel kalır; ortaklaşması incelenen her rapor için ayrıca `--shared-report-id REPORT_UUID` belirtilir. Metadata ataması tarihleri korur ve eşzamanlı kullanıcı değişikliğinin üzerine yazmaz.

12 Ekim 2026 geçişinde 81 tarama, 16 sohbet, 38 sohbet mesajı, 181 belge, 184 belge sürümü, 58 rapor, 60 rapor revizyonu ve 2 taslak korunmuştur. 160 doğrulanmış Resmî Gazete belgesi ortak arşive ayrılmıştır. Yedek özel izinlerle yerel Codex yedek dizininde saklanır. Eski sohbetler açıkça yerel admin hesabına bağlanmış; orijinal etkinlik zamanları korunmuştur.

## Şirket bağlantısı

Bu sürüm şirket Keycloak'ına bağlanmaz. Şirket geçişi için aynı OIDC adapterına şu ayarlar verilir:

```dotenv
AUTH_PROFILE=company
APP_PUBLIC_ORIGIN=https://UYGULAMA_HOST
OIDC_ISSUER_URL=https://KEYCLOAK_HOST/realms/REALM
OIDC_CLIENT_ID=UYGULAMA_CLIENT
OIDC_CLIENT_SECRET=SECRET_MANAGER_VALUE
OIDC_REDIRECT_URI=https://UYGULAMA_HOST/api/auth/callback
OIDC_POST_LOGOUT_REDIRECT_URI=https://UYGULAMA_HOST/login
SESSION_ENCRYPTION_KEY=32_BYTE_KEY_AS_64_HEX
SESSION_ENCRYPTION_KEY_ID=v1
SESSION_IDLE_TTL_SECONDS=1800
SESSION_ABSOLUTE_TTL_SECONDS=28800
AUTH_WORKSPACE_KEY=atez
AUTH_API_ALLOWED_HOSTS=UYGULAMA_HOST
OIDC_CA_FILE=/var/run/secrets/oidc/ca.pem
WORKER_ACTOR_USER_ID=EXPLICIT_SERVICE_USER_UUID
```

Değerler örnektir; gerçek secretlar `.env.example`, Git veya frontend bundle içine konulmaz. Özel CA gerekmiyorsa OIDC_CA_FILE boş bırakılır. Callback, logout ve backchannel adresleri şirket client kaydına eklenir. Code akışı, PKCE S256 ve confidential client doğrulanır. Direct grant ile uygulamaya kullanıcı parolası gönderilmez. İlgili protokol uçları discovery metadata üzerinden doğrulanır. [Keycloak OIDC rehberi](https://www.keycloak.org/securing-apps/oidc-layers)

Provider metadata uçları issuer origininden farklıysa mevcut adapter reddeder; şirket topolojisi için kontrollü allowlist tasarımı gerekir. TLS doğrulamasını kapatarak çözüm üretilmez. Docker şirket yapılandırması auth değişkenlerini API ve worker'a iletir; reverse proxy Host bilgisini doğru taşımalı veya yalnız gerçek upstream hostları AUTH_API_ALLOWED_HOSTS içinde açıkça tanımlanmalıdır. Yerel geliştirme native servisleri kullanır; Docker API içinde localhost issuer kullanmak containerın kendisini hedefleyeceğinden farklı ağ düzeni ayrı doğrulanmalıdır.

Şirket kullanıcısı açık issuer+subject bağlantısıyla provision edilir. `backend/scripts/provision-auth-identity.ts` env içindeki issuer'ı kullanır; aşağıdaki alanlar ve `--apply` olmadan yalnız dry-run yapar:

```sh
backend/node_modules/.bin/tsx backend/scripts/provision-auth-identity.ts --user-id USER_UUID --email USER_EMAIL --name DISPLAY_NAME --subject KEYCLOAK_SUB --role EDITOR
```

Workspace önceden kurulmalıdır. Aynı email otomatik kimlik bağlantısı oluşturmaz. Başka kullanıcıya bağlı subject otomatik taşınmaz. Rol/provisioning değişikliği önceki oturumları iptal eder. Servis aktörünün ayrı User kaydı açıkça oluşturulup WORKER_ACTOR_USER_ID olarak seçilir; cron aktörüne Keycloak kimliği veya browser parolası verilmez.

## Oturum iptali ve iş sürekliliği

Logout uygulama oturumunu önce kalıcı iptal eder. Keycloak geçici olarak erişilemese de yerel oturum yeniden canlanmaz. Refresh işlemi owner/version/lease kontrolüyle tek sahip tarafından yapılır. Yerel Docker kurulumunda backchannel servisi provider imzasını doğrulayıp çıkış bildirimini kalıcı, özel mailbox volume içinde saklar. Native web servisi 127.0.0.1:45882 üzerinden ayrı gizli taşıma anahtarıyla bildirimleri alır ve localhost API'ye iletir; API genel ağa açılmaz. Kuyruk okuma anonim erişime kapalıdır. Bu köprü yalnız local profilde çalışır; şirket profilinde normal HTTPS backchannel adresi kullanılır.

Backchannel `/api/auth/backchannel-logout` imzalı logout tokenı tekrar doğrular; cookie/CSRF istisnası bu server callbackine özeldir. Tekrar kullanılan bildirim reddedilir; eski sid bildirimi yeni giriş oturumuna uygulanmaz.

Sohbet ve tarama canlı akışları oturum ve izin değişimini tekrar kontrol eder. Arka plan işleri token taşımadan kayıtlı başlatan kullanıcıyla çalışır; güncel üyelik yoksa işlem yürütülmez. Logout kabul edilmiş işi silmez. Cron açık servis aktörüyle yürür. Role veya aktiflik değişimi API kullanıcı yönetiminden yapılınca ilgili oturumlar iptal edilir.

Şifreleme anahtarı değişirse eski oturum yeniden giriş ister; keyId zarfı yanlış anahtar kullanımıyla çözülemez. Sağlayıcı yönetiminden uygulama session iptalinin ulaşması için şirket backchannel URL'sinin ağdan erişilebilir olması gerekir.

## Doğrulama ve geri dönüş

Backend testleri yalnız açık TEST_DATABASE_URL ve `_test` biten ayrı veritabanıyla yürütülür; aynı veritabanındaki fixture dosyaları sırayla çalışır. İki ayrı yerel OIDC fixture issuer'ı imza, audience, nonce, PKCE ve logout sözleşmesini doğrular. Bu testler şirket bağlantısı kabulü değildir. Gerçek yerel Keycloak'ta yönetici/okuyucu giriş ve logout, üye olmayan hesabın reddi ve başka kullanıcının sohbetinin gizliliği tarayıcıda doğrulanmıştır. Keycloak yönetiminden test kullanıcısının oturumu kapatılarak gerçek imzalı backchannel bildiriminin uygulama oturumunu iptal ettiği de doğrulanmıştır. Gemini testleri sahte sağlayıcı kullanır.

Bir dağıtım sorunu olduğunda auth guard kaldırılıp mock erişime dönülmez. Bakım veya read-only durumunda kalınır; sahiplik ve session tabloları korunur. Önce ayrı test ortamında login, rol, özel içerik, refresh ve logout doğrulanır. Şirket issuer/client değişiminde eski yerel oturumlar geçersiz olur; yerel test hesapları şirket realm'ine aktarılmaz.
