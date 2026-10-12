import { Can } from '../auth/Can'
import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Paperclip, RefreshCw } from 'lucide-react'
import { Button, Checkbox, Input, Modal, Tag, Typography } from 'antd'
import { MailOutlined, SendOutlined } from '@ant-design/icons'
import './delivery.css'
import { getDeliveryContext, parseEmailList, sendDispatch } from './api'
import type { DeliveryContext, DispatchResult } from './types'

interface Props {
  topicId: string
  reportVersion: number
  reportTitle: string
  onClose: () => void
  onDispatched?: () => void
}

export function EmailDispatchModal({ topicId, reportVersion, reportTitle, onClose, onDispatched }: Props) {
  const [context, setContext] = useState<DeliveryContext | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [result, setResult] = useState<(DispatchResult & { error?: string }) | null>(null)

  const [toInput, setToInput] = useState('')
  const [subject, setSubject] = useState('')
  const [bodyText, setBodyText] = useState('')
  const [attachPdf, setAttachPdf] = useState(true)

  useEffect(() => {
    let active = true
    setIsLoading(true)
    getDeliveryContext(topicId, reportVersion)
      .then((loaded) => {
        if (!active) return
        setContext(loaded)
        setSubject(loaded.draft.subject)
        setBodyText(loaded.draft.bodyText)
        const defaults = loaded.groups.filter(group => group.isActive && loaded.suggestedGroupIds?.includes(group.id)).flatMap(group => group.emails)
        setToInput([...new Set(defaults.map(email => email.trim().toLowerCase()))].join(', '))
      })
      .catch((caught) => { if (active) setLoadError(caught instanceof Error ? caught.message : 'Dağıtım bilgileri alınamadı') })
      .finally(() => { if (active) setIsLoading(false) })
    return () => { active = false }
  }, [topicId, reportVersion])

  const recipients = useMemo(() => parseEmailList(toInput), [toInput])

  const addGroup = (emails: string[]) => {
    setToInput((current) => [...new Set([...parseEmailList(current), ...emails.map((email) => email.toLowerCase())])].join(', '))
  }

  const handleSend = async () => {
    if (isSending) return
    setIsSending(true)
    try {
      // The recipient field is the single source of truth: group chips merge their
      // addresses into it, so a removed address stays removed.
      const dispatched = await sendDispatch(topicId, {
        reportVersion, groupIds: [], recipients, subject: subject.trim(), bodyText: bodyText.trim(), attachPdf,
      })
      setResult(dispatched)
      onDispatched?.()
    } catch (caught) {
      setResult({ dispatchId: '', status: 'FAILED', error: caught instanceof Error ? caught.message : 'E-posta gönderilirken bir hata oluştu.' })
    } finally {
      setIsSending(false)
    }
  }

  const canSend = recipients.length > 0 && subject.trim().length > 0 && bodyText.trim().length > 0

  return (
    <Modal open onCancel={onClose} footer={null} width={650} title={<span><MailOutlined /> E-Posta ile Bülten Gönder</span>} className="atez-delivery-modal" destroyOnHidden>
      <Typography.Text type="secondary" className="atez-delivery-subtitle">{reportTitle}</Typography.Text>

        {result ? (
          <div className="space-y-4 p-6 text-center">
            {result.status === 'FAILED' ? (
              <>
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600"><AlertCircle className="h-7 w-7 stroke-[2.5]" /></div>
                <h4 className="text-base font-bold text-[var(--atez-text)]">Gönderilemedi</h4>
                <p className="text-xs text-red-600">{result.error ?? result.message ?? 'Gönderim başarısız oldu.'}</p>
                <Button onClick={() => setResult(null)}>Tekrar Dene</Button>
              </>
            ) : (
              <>
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600"><CheckCircle2 className="h-7 w-7 stroke-[2.5]" /></div>
                <h4 className="text-base font-bold text-[var(--atez-text)]">
                  {result.status === 'SIMULATED' ? 'E-Posta Simüle Edildi & Kaydedildi' : 'E-Posta Başarıyla Gönderildi!'}
                </h4>
                <p className="mx-auto max-w-md text-xs leading-relaxed text-[var(--atez-muted)]">
                  {result.note ?? 'Bülten ve ekteki PDF dosyası başarıyla iletildi.'}
                </p>
                <div className="space-y-1 rounded-xl border border-[var(--atez-border)] bg-[var(--atez-raised)] p-3 text-left font-mono text-xs text-[var(--atez-text)]">
                  <div className="break-words"><strong>Alıcılar:</strong> {(result.recipients ?? recipients).join(', ')}</div>
                  {attachPdf && context && <div className="break-words"><strong>PDF Eki:</strong> {context.draft.attachmentName}</div>}
                </div>
                <Button type="primary" onClick={onClose}>Tamamla</Button>
              </>
            )}
          </div>
        ) : isLoading ? (
          <div className="flex flex-col items-center justify-center gap-2 p-12 text-center text-[var(--atez-muted)]">
            <RefreshCw className="h-6 w-6 animate-spin text-[var(--atez-accent)]" />
            <span className="text-xs font-medium">Bülten taslağı hazırlanıyor...</span>
          </div>
        ) : !context ? (
          <div className="space-y-4 p-6 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600"><AlertCircle className="h-7 w-7 stroke-[2.5]" /></div>
            <p className="text-xs text-red-600">{loadError}</p>
            <Button type="primary" onClick={onClose}>Kapat</Button>
          </div>
        ) : (
          <div className="space-y-3.5 p-5 text-xs">
            <div className="space-y-2">
              <label htmlFor="dispatch-to" className="font-bold text-[var(--atez-text)]">Alıcılar (Kime):</label>
              <Input id="dispatch-to" value={toInput} onChange={(event) => setToInput(event.target.value)} placeholder="ornek@atez.com, diger@gmail.com" />
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {context.groups.length === 0 && (
                  <span className="text-[10px] italic text-[var(--atez-muted)]">Henüz grup eklenmemiş. &lsquo;Müşteri Grupları&rsquo;ndan ekleyebilirsiniz.</span>
                )}
                {context.groups.filter((group) => group.isActive).map((group) => (
                  <Tag.CheckableTag key={group.id} checked={false} onChange={() => addGroup(group.emails)}>+ {group.name}</Tag.CheckableTag>
                ))}
                {toInput && (
                  <Button size="small" danger onClick={() => setToInput('')}>Temizle</Button>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <label htmlFor="dispatch-subject" className="font-bold text-[var(--atez-text)]">Konu:</label>
              <Input id="dispatch-subject" value={subject} onChange={(event) => setSubject(event.target.value)} />
            </div>

            <div className="flex items-center justify-between rounded-xl border border-blue-200/80 bg-blue-50/60 p-2.5">
              <div className="flex min-w-0 items-center gap-2 font-medium text-[var(--atez-accent)]">
                <Paperclip className="h-3.5 w-3.5 shrink-0 text-[var(--atez-accent)]" />
                <span className="truncate">{context.draft.attachmentName}</span>
              </div>
              <div className="ml-2 flex shrink-0 items-center gap-1.5 text-[11px] font-semibold">
                <Checkbox checked={attachPdf} onChange={(event) => setAttachPdf(event.target.checked)}>PDF Ekle</Checkbox>
              </div>
            </div>

            <div className="space-y-1">
              <label htmlFor="dispatch-body" className="font-bold text-[var(--atez-text)]">Bülten Mesajı (Düzenlenebilir):</label>
              <Input.TextArea id="dispatch-body" rows={6} value={bodyText} onChange={(event) => setBodyText(event.target.value)} />
              <p className="text-[10px] text-[var(--atez-muted)]">Kullanılan kaynaklar listesi e-postanın sonuna otomatik eklenir.</p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-[var(--atez-muted)]">
              {context.sender.configured
                ? (
                  <>
                    <span>Gönderen: <strong className="text-[var(--atez-text)]">{context.sender.address}</strong></span>
                    <span className="inline-flex items-center gap-1 font-medium text-emerald-600">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Kalıcı E-Posta Bağlantısı Aktif
                    </span>
                  </>
                )
                : (
                  <span className="inline-flex items-center gap-1 font-medium text-amber-600">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />{context.sender.note}
                  </span>
                )}
            </div>

            <div className="flex items-center justify-between border-t border-[var(--atez-border)] pt-2">
              <Button onClick={onClose}>Vazgeç</Button>
              <Can permission="delivery.send"><Button type="primary" icon={<SendOutlined />} onClick={() => void handleSend()} disabled={!canSend} loading={isSending}>E-Postayı Gönder</Button></Can>
            </div>
          </div>
        )}
    </Modal>
  )
}
