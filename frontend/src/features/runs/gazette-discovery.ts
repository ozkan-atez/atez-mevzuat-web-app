import type { ScanRunDetail } from '../scans/types'

export function allGazetteDocumentsSkipped(run: ScanRunDetail): boolean {
  const discovery = run.gazetteDiscovery
  return run.status === 'COMPLETED' && !!discovery && discovery.discovered > 0 && discovery.discovered === discovery.skipped
}

export const skippedReportMessage = 'Yeni belge bulunmadığı ve önceki belgeler zaten işlendiği için yeni rapor oluşturulmadı.'
