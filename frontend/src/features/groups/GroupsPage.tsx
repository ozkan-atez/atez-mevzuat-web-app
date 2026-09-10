import { useState, useEffect } from 'react';
import { Users, Plus, Trash2, Edit2, Check, X, RefreshCw, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

interface CustomerGroup {
  id: string;
  name: string;
  description: string | null;
  emails: string;
  isActive: boolean;
}

const DUMMY_GROUPS: CustomerGroup[] = [
  {
    id: "group-1",
    name: "Yönetim Kurulu & Direktörler",
    description: "Tüm kritik mevzuat bültenleri anlık olarak iletilir.",
    emails: "genel-mudur@atez.com, yonetim@atez.com",
    isActive: true,
  },
  {
    id: "group-2",
    name: "Gümrük Operasyon Ekibi",
    description: "Tarife ve GTİP değişiklikleri, damping kararları.",
    emails: "gumruk-operasyon@atez.com, mevzuat-takip@atez.com",
    isActive: true,
  },
];

export function GroupsPage() {
  const [groups, setGroups] = useState<CustomerGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: '', description: '', emails: '' });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchGroups();
  }, []);

  const fetchGroups = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/customer-groups');
      if (res.ok) {
        setGroups(await res.json());
      } else {
        setGroups(DUMMY_GROUPS);
      }
    } catch {
      setGroups(DUMMY_GROUPS);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.emails) {
      alert('İsim ve e-posta alanları zorunludur.');
      return;
    }

    setIsSaving(true);
    try {
      const url = isEditing === 'new' ? '/api/customer-groups' : `/api/customer-groups/${isEditing}`;
      const method = isEditing === 'new' ? 'POST' : 'PUT';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, isActive: true }),
      });

      if (res.ok) {
        setIsEditing(null);
        setFormData({ name: '', description: '', emails: '' });
        fetchGroups();
      } else {
        // Local state fallback for mock
        if (isEditing === 'new') {
          setGroups(prev => [
            ...prev,
            { id: `group-${Date.now()}`, ...formData, description: formData.description || null, isActive: true }
          ]);
        } else {
          setGroups(prev => prev.map(g => g.id === isEditing ? { ...g, ...formData } : g));
        }
        setIsEditing(null);
        setFormData({ name: '', description: '', emails: '' });
      }
    } catch {
      if (isEditing === 'new') {
        setGroups(prev => [
          ...prev,
          { id: `group-${Date.now()}`, ...formData, description: formData.description || null, isActive: true }
        ]);
      }
      setIsEditing(null);
      setFormData({ name: '', description: '', emails: '' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Bu grubu silmek istediğinize emin misiniz?')) return;
    try {
      await fetch(`/api/customer-groups/${id}`, { method: 'DELETE' });
    } catch {}
    setGroups(prev => prev.filter(g => g.id !== id));
  };

  return (
    <div className="space-y-6 w-full pb-10">
      {/* Üst Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white px-6 py-4 rounded-2xl border border-slate-200/80 shadow-2xs">
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="p-2 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-xl border border-slate-200 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
              <Users className="w-5 h-5 text-blue-600" />
              <span>E-Posta Dağıtım Grupları</span>
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Mevzuat bültenlerinin otomatik veya tek tıkla iletileceği alıcı listeleri
            </p>
          </div>
        </div>

        <button
          onClick={() => {
            setIsEditing('new');
            setFormData({ name: '', description: '', emails: '' });
          }}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Yeni Grup Ekle</span>
        </button>
      </div>

      {/* Form (Yeni / Düzenle) */}
      {isEditing && (
        <form onSubmit={handleSave} className="bg-white p-6 rounded-2xl border border-blue-200 shadow-sm space-y-4 animate-in fade-in">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-sm font-bold text-slate-900">
              {isEditing === 'new' ? 'Yeni Müşteri/Departman Grubu' : 'Grubu Düzenle'}
            </h3>
            <button
              type="button"
              onClick={() => setIsEditing(null)}
              className="text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Grup Adı</label>
              <input
                type="text"
                placeholder="Örn: Finans & Muhasebe"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                required
              />
            </div>
            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Açıklama (Opsiyonel)</label>
              <input
                type="text"
                placeholder="Örn: Vergi ve mevzuat takibi yapan departman"
                value={formData.description}
                onChange={e => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </div>

          <div className="space-y-1 text-xs">
            <label className="font-semibold text-slate-700">E-Posta Adresleri (Virgülle ayırın)</label>
            <textarea
              rows={3}
              placeholder="ahmet@sirket.com, mehmet@sirket.com"
              value={formData.emails}
              onChange={e => setFormData({ ...formData, emails: e.target.value })}
              className="w-full p-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 font-mono text-xs"
              required
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setIsEditing(null)}
              className="px-4 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800"
            >
              İptal
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold cursor-pointer"
            >
              {isSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              <span>Kaydet</span>
            </button>
          </div>
        </form>
      )}

      {/* Gruplar Listesi */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center p-12 gap-2 text-slate-400">
          <RefreshCw className="w-6 h-6 animate-spin text-blue-600" />
          <span className="text-xs">Gruplar yükleniyor...</span>
        </div>
      ) : groups.length === 0 ? (
        <div className="bg-white p-8 rounded-2xl border border-slate-200 text-center text-slate-400 text-xs">
          Henüz kayıtlı grup bulunmuyor. Yeni bir grup oluşturabilirsiniz.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {groups.map(group => (
            <div key={group.id} className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-bold text-sm text-slate-900">{group.name}</h3>
                  {group.description && <p className="text-xs text-slate-500 mt-0.5">{group.description}</p>}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      setIsEditing(group.id);
                      setFormData({
                        name: group.name,
                        description: group.description || '',
                        emails: group.emails,
                      });
                    }}
                    className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                    title="Düzenle"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(group.id)}
                    className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                    title="Sil"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 text-xs font-mono text-slate-600 break-all leading-relaxed">
                {group.emails}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
