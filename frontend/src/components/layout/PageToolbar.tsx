import type { ReactNode } from 'react'
import { Button, type ButtonProps } from 'antd'
import { ArrowLeftOutlined, EditOutlined } from '@ant-design/icons'
import { useLinkClickHandler } from 'react-router-dom'
import './page-toolbar.css'

/** A single anchor with Ant's theme and router navigation, including modifier clicks. */
export function ActionLink({ to, children, icon, type = 'default', label }: { to: string; children?: ReactNode; icon?: ReactNode; type?: ButtonProps['type']; label?: string }) {
  const onClick = useLinkClickHandler<HTMLAnchorElement>(to)
  return <Button href={to} onClick={onClick} icon={icon} type={type} aria-label={label} className="atez-page-action">{children}</Button>
}

export function BackLink({ to, children = 'Geri dön', compact = false }: { to: string; children?: string; compact?: boolean }) {
  return <ActionLink to={to} icon={<ArrowLeftOutlined />} label={children}>{compact ? undefined : children}</ActionLink>
}

export function ReviseButton(props: Omit<ButtonProps, 'children' | 'icon'>) {
  return <Button {...props} type={props.type ?? 'primary'} icon={<EditOutlined aria-hidden />} className={`atez-page-action ${props.className ?? ''}`}>Revize et</Button>
}

export function PageToolbar({ backTo, backLabel, children }: { backTo: string; backLabel: string; children?: ReactNode }) {
  return <nav className="atez-page-toolbar" aria-label="Sayfa işlemleri">
    <BackLink to={backTo}>{backLabel}</BackLink>
    {children && <div className="atez-page-toolbar-actions">{children}</div>}
  </nav>
}
