import type { ReactNode } from 'react'
import { Drawer } from 'antd'
import '../chat/chat-workspace.css'

export function ReportCorrectionDrawer({open,onClose,extra,children}:{open:boolean;onClose:()=>void;extra?:ReactNode;children:ReactNode}) {
  return <Drawer className="atez-report-correction-drawer" title="Rapor düzelt" placement="right" size={960} styles={{wrapper:{maxWidth:'100vw'}}} open={open} onClose={onClose} extra={extra}>{children}</Drawer>
}
