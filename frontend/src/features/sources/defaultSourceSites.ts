/** Verified entry points. These are site records, not collected evidence pages. */
export const defaultSourceSites = [
  { name: 'T.C. Resmî Gazete', url: 'https://www.resmigazete.gov.tr/fihrist', category: 'Resmî yayın', description: 'Günlük sayı ve mevzuat arşivi' },
  { name: 'Ticaret Bakanlığı', url: 'https://ticaret.gov.tr/gumruk-islemleri/mevzuat', category: 'Resmî kurum', description: 'Gümrük mevzuatı ve duyurular' },
  { name: 'İGMD', url: 'https://www.igmd.org.tr/', category: 'Meslek kuruluşu', description: 'İstanbul Gümrük Müşavirleri Derneği' },
  { name: 'Mevzuat.Net', url: 'https://www.mevzuat.net/', category: 'Ticari kaynak', description: 'Mevzuat derlemesi ve arama' },
  { name: 'TARIFF', url: 'https://tariff.singlewindow.io/', category: 'Ticari kaynak', description: 'Tarife ve dış ticaret bilgileri' },
] as const
