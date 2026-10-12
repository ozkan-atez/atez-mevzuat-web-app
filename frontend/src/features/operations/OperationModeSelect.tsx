import { Select, Typography } from 'antd'
export type OperationMode = 'REUSE_ONLY' | 'FILL_MISSING' | 'FORCE'
export function OperationModeSelect({ value, onChange, disabled }: { value: OperationMode; onChange: (value: OperationMode) => void; disabled?: boolean }) {
  return <div><Select aria-label="Çalıştırma biçimi" value={value} onChange={onChange} disabled={disabled} style={{ minWidth: 230 }} options={[{ value: 'REUSE_ONLY', label: 'Arşivdeki veriyi kullan' }, { value: 'FILL_MISSING', label: 'Eksik adımları tamamla' }, { value: 'FORCE', label: 'Seçili adımı yeniden çalıştır' }]} /><Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>{value === 'REUSE_ONLY' ? 'Yeni veri çekmeden kayıtlı sonuçları kullanır.' : value === 'FILL_MISSING' ? 'Yalnız eksik sonuçlar için işlem yapar.' : 'Seçtiğiniz adım için yeni bir sürüm oluşturur.'}</Typography.Paragraph></div>
}
