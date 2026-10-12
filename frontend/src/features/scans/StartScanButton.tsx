import { Can } from '../auth/Can'
import { Button } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import './start-scan-button.css'

export function StartScanButton({ onClick }: { onClick: () => void }) {
  return <Can permission="chat.write"><Can permission="scan.run"><Button type="primary" className="atez-start-scan-button" icon={<PlusOutlined />} onClick={onClick}>Yeni tarama başlat</Button></Can></Can>
}
