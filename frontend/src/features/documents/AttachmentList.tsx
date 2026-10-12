import { Button, Space, Tag } from 'antd'
import { CloseOutlined, FileTextOutlined } from '@ant-design/icons'
export interface DocumentAttachment { id: string; title: string }
export function AttachmentList({ items, onRemove }: { items: DocumentAttachment[]; onRemove?: (id: string) => void }) {
  return <Space wrap aria-label="Eklenen belgeler">{items.map(item => <Tag key={item.id} icon={<FileTextOutlined />}>{item.title}{onRemove && <Button type="text" size="small" aria-label={`${item.title} belgesini kaldır`} icon={<CloseOutlined />} onClick={() => onRemove(item.id)} />}</Tag>)}</Space>
}
