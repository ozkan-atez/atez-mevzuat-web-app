import { useCan } from '../auth/AuthProvider'
import { Can } from '../auth/Can'
import { useState } from 'react'
import { Alert, Button, Card, Col, Empty, Modal, Progress, Radio, Row, Space, Statistic, Tag, Typography } from 'antd'
import { ArrowRightOutlined, StarOutlined } from '@ant-design/icons'
import { listAcademyAttempts, workspaceRequest } from './api'
import { useResource } from './useResource'
import { LoadError } from './CatalogPages'
import './workspace.css'
const { Title, Paragraph, Text } = Typography
const bank = [
  { prompt: 'Düzenlemelerin resmî yayımı hangi kaynakta yer alır?', options: ['Ticaret Bakanlığı', 'T.C. Resmî Gazete', 'Türkiye İstatistik Kurumu'] },
  { prompt: 'GTİP kısaltması hangi kavramı ifade eder?', options: ['Gümrük Tarife İstatistik Pozisyonu', 'Genel Ticaret İhracat Planı', 'Günlük Tarife İndirim Protokolü'] },
  { prompt: 'Bir tebliğin yürürlük tarihi öncelikle nereden kontrol edilmelidir?', options: ['Yayın tarihinden varsayılır', 'Tebliğin yürürlük maddesinden', 'E-posta özetinden'] },
  { prompt: 'Mükerrer sayı için doğru yaklaşım hangisidir?', options: ['Günlük sayıdan ayrı incelemek', 'Aynı içeriği varsaymak', 'Kaynağı yok saymak'] },
  { prompt: 'İthalat rejimi değişikliği raporunda hangi bilgi operasyonel etkiyi görmeye yardımcı olur?', options: ['Yalnızca başlık', 'İlgili GTİP ve yürürlük tarihi', 'Belge yazı tipi'] },
]
export function AcademyPage() {
  const canWrite=useCan('academy.write')
  const resource = useResource(listAcademyAttempts, { attempts: [] })
  const [type, setType] = useState<'daily' | 'weekly' | null>(null)
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<number[]>([])
  const [finished, setFinished] = useState<{ correct: number; total: number; points: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const questions = type === 'weekly' ? bank : bank.slice(0, 3)
  const current = questions[index]
  const attempts = resource.data.attempts
  const earned = attempts.reduce((sum, attempt) => sum + attempt.points, 0)
  const level = Math.floor(earned / 100) + 1
  const total = attempts.reduce((sum, attempt) => sum + attempt.total, 0)
  const correct = attempts.reduce((sum, attempt) => sum + attempt.correct, 0)
  const start = (kind: 'daily' | 'weekly') => { if(!canWrite)return; setType(kind); setIndex(0); setAnswers([]); setFinished(null); setError(null) }
  const next = async () => {
    if (!canWrite || answers[index] === undefined) return
    if (index < questions.length - 1) { setIndex(index + 1); return }
    setSaving(true); setError(null)
    try {
      const result = await workspaceRequest<{ correct: number; total: number; points: number }>('academy/attempts', { method: 'POST', body: JSON.stringify({ lessonId: type, answers }) })
      setFinished(result); await resource.refresh()
    } catch (caught) { setError((caught as Error).message) } finally { setSaving(false) }
  }
  return <div className="atez-demo-page atez-academy"><LoadError error={resource.error} retry={() => void resource.refresh()} /><div className="atez-academy-hero"><div><Text className="atez-kicker">MEVZUAT RADAR · GELİŞİM AKADEMİSİ</Text><Title>Mevzuat bilginizi<br /><span>her gün güçlendirin.</span></Title><Paragraph>Kısa günlük pratikler ve haftalık değerlendirmeler. Tamamlanan çalışmalarınız kaydedilir.</Paragraph><Tag color="purple">{earned.toLocaleString('tr-TR')} TOPLAM PUAN</Tag></div><div className="atez-academy-orbit">{level}<small>Seviye</small></div></div>
    <Row gutter={[18, 18]}>{(['daily', 'weekly'] as const).map(kind => <Col xs={24} lg={12} key={kind}><Card className={`atez-challenge ${kind}`}><Text className="atez-kicker">{kind === 'daily' ? 'BUGÜNÜN HIZLI TURU' : 'HAFTALIK DEĞERLENDİRME'}</Text><Title level={2}>{kind === 'daily' ? 'Günlük Quiz' : 'Haftanın Rotası'}</Title><Paragraph>Gümrük ve dış ticaret yetkinliğinizi ölçün. Dönemin en iyi skoru saklanır.</Paragraph><Space><Tag>{kind === 'daily' ? 3 : 5} soru</Tag><Tag>{kind === 'daily' ? 30 : 50} puan</Tag></Space><div className="atez-challenge-action"><Can permission="academy.write"><Button type="primary" onClick={() => start(kind)}>{kind === 'daily' ? 'Günlük quiz’i başlat' : 'Haftalık quiz’i başlat'} <ArrowRightOutlined /></Button></Can>{!canWrite&&<Text type="secondary">Bu hesapla kayıtlı çalışmalarınızı görüntüleyebilirsiniz.</Text>}</div></Card></Col>)}</Row>
    <Row gutter={[18, 18]} className="atez-demo-spaced"><Col xs={24} lg={14}><Card title="Kaydedilen çalışmalar" className="atez-demo-card">{!attempts.length && <Empty description="İlk çalışmanızı tamamlayın." />}{attempts.slice().reverse().map(attempt => <div className="atez-history" key={attempt.id || `${attempt.type}:${attempt.date}`}><StarOutlined /><span>{attempt.type === 'daily' ? 'Günlük Quiz' : 'Haftanın Rotası'} · {attempt.date} · {attempt.correct}/{attempt.total} doğru</span><strong>+{attempt.points}</strong></div>)}</Card></Col><Col xs={24} lg={10}><Card title="Gelişim özeti" className="atez-demo-card"><div className="atez-academy-progress"><Progress type="circle" percent={earned % 100} format={() => `${earned} puan`} /></div><Row gutter={12}><Col span={12}><Statistic title="Doğruluk" value={total ? Math.round(correct / total * 100) : 0} suffix="%" /></Col><Col span={12}><Statistic title="Tamamlanan çalışma" value={attempts.length} /></Col></Row></Card></Col></Row>
    <Modal title={type === 'daily' ? 'GÜNLÜK HIZLI TUR' : 'HAFTANIN ROTASI'} open={Boolean(type)&&canWrite} onCancel={() => setType(null)} footer={null} width={680}>{finished ? <div className="atez-quiz-result"><Title level={2}>{finished.correct === finished.total ? 'Kusursuz tur!' : 'Çalışma tamamlandı.'}</Title><Paragraph>{finished.correct}/{finished.total} doğru · {finished.points} puan</Paragraph><Button type="primary" onClick={() => setType(null)}>Akademiye dön</Button></div> : <div className="atez-quiz"><Progress percent={Math.round(index / questions.length * 100)} showInfo={false} /><Text type="secondary">{index + 1} / {questions.length}</Text><Title level={3}>{current?.prompt}</Title><Radio.Group value={answers[index]} onChange={event => setAnswers(old => { const nextAnswers = [...old]; nextAnswers[index] = event.target.value; return nextAnswers })} className="atez-quiz-options">{current?.options.map((option, at) => <Radio.Button key={at} value={at}>{String.fromCharCode(65 + at)} · {option}</Radio.Button>)}</Radio.Group>{error && <Alert type="error" title={error} style={{ margin: '12px 0' }} />}<Button disabled={!canWrite || answers[index] === undefined} loading={saving} type="primary" onClick={() => void next()} style={{ marginTop: 16 }}>{index === questions.length - 1 ? 'Sonucu kaydet' : 'Sonraki soru'} <ArrowRightOutlined /></Button></div>}</Modal>
  </div>
}
