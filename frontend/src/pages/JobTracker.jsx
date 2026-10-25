import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../utils/axios'

const stages = [['wishlist', 'Wishlist'], ['applied', 'Applied'], ['oa', 'Online assessment'], ['interview', 'Interview'], ['offer', 'Offer'], ['rejected', 'Rejected']]
const emptyForm = { company: '', role: '', link: '', stage: 'wishlist', notes: '', nextActionDate: '' }
function JobTracker() {
  const navigate = useNavigate()
  const [applications, setApplications] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [editing, setEditing] = useState('')
  const [reminders, setReminders] = useState(true)
  const [error, setError] = useState('')
  const load = async () => {
    try { const [{ data }, settings] = await Promise.all([api.get('/api/career/applications'), api.get('/api/progress/me')]); setApplications(data.applications || []); setReminders(settings.data.progress.settings?.reminderEmailsEnabled ?? true); const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone; if (timezone && timezone !== settings.data.progress.settings?.timezone) void api.patch('/api/progress/settings', { timezone }) }
    catch (e) { setError(e.response?.data?.message || 'Applications could not be loaded.') }
  }
  useEffect(() => { load() }, [])
  const updateField = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const save = async (event) => {
    event.preventDefault(); setError('')
    try {
      if (editing) await api.patch(`/api/career/applications/${editing}`, form)
      else await api.post('/api/career/applications', form)
      setForm(emptyForm); setEditing(''); await load()
    } catch (e) { setError(e.response?.data?.message || 'Application could not be saved.') }
  }
  const move = async (application, stage) => {
    try { const { data } = await api.patch(`/api/career/applications/${application._id}`, { stage }); setApplications((items) => items.map((item) => item._id === application._id ? data.application : item)) }
    catch (e) { setError(e.response?.data?.message || 'Stage could not be updated.') }
  }
  const edit = (application) => { setEditing(application._id); setForm({ company: application.company, role: application.role, link: application.link || '', stage: application.stage, notes: application.notes || '', nextActionDate: application.nextActionDate || '' }); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const remove = async (application) => { try { await api.delete(`/api/career/applications/${application._id}`); setApplications((items) => items.filter((item) => item._id !== application._id)) } catch (e) { setError(e.response?.data?.message || 'Application could not be deleted.') } }
  const toggleReminders = async () => { try { const { data } = await api.patch('/api/progress/settings', { reminderEmailsEnabled: !reminders }); setReminders(data.settings.reminderEmailsEnabled) } catch (e) { setError(e.response?.data?.message || 'Reminder preference could not be updated.') } }
  return <main className="min-h-screen bg-[#f7f7f5] px-4 py-8 text-[#111] sm:px-8"><div className="mx-auto max-w-7xl"><div className="flex flex-wrap items-center justify-between gap-3"><button onClick={() => navigate('/dashboard')} className="text-sm text-black/55">← Dashboard</button><button onClick={toggleReminders} className="rounded-lg border bg-white px-3 py-2 text-sm">Email reminders: {reminders ? 'On' : 'Off'}</button></div><p className="mt-6 text-xs font-semibold uppercase tracking-widest text-black/40">Career</p><h1 className="mt-2 text-3xl font-bold">Job application tracker</h1><p className="mt-2 text-sm text-black/55">Move cards between stages. Due-date reminders are sent once per application and date when email is configured.</p>
    <form onSubmit={save} className="mt-5 grid gap-3 rounded-2xl border border-black/8 bg-white p-4 md:grid-cols-6"><input required maxLength={120} value={form.company} onChange={(e) => updateField('company', e.target.value)} placeholder="Company" className="rounded-lg border p-2.5 text-sm"/><input required maxLength={160} value={form.role} onChange={(e) => updateField('role', e.target.value)} placeholder="Role" className="rounded-lg border p-2.5 text-sm"/><input value={form.link} onChange={(e) => updateField('link', e.target.value)} placeholder="Job link" className="rounded-lg border p-2.5 text-sm"/><input type="date" value={form.nextActionDate} onChange={(e) => updateField('nextActionDate', e.target.value)} className="rounded-lg border p-2.5 text-sm"/><select value={form.stage} onChange={(e) => updateField('stage', e.target.value)} className="rounded-lg border p-2.5 text-sm">{stages.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button className="rounded-lg bg-black px-3 py-2.5 text-sm font-semibold text-white">{editing ? 'Save changes' : 'Add application'}</button><textarea value={form.notes} onChange={(e) => updateField('notes', e.target.value)} placeholder="Notes" rows={2} className="rounded-lg border p-2.5 text-sm md:col-span-6"/>{editing && <button type="button" onClick={() => { setEditing(''); setForm(emptyForm) }} className="text-sm text-black/50 md:col-span-6">Cancel edit</button>}</form>
    {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <div className="mt-6 grid gap-3 md:grid-cols-3 xl:grid-cols-6">{stages.map(([stage, label]) => <section key={stage} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/application'); const app = applications.find((item) => item._id === id); if (app) move(app, stage) }} className="min-h-48 rounded-xl border border-black/8 bg-white p-3"><h2 className="mb-3 flex items-center justify-between text-sm font-semibold">{label}<span className="rounded-full bg-black/5 px-2 py-0.5 text-xs">{applications.filter((item) => item.stage === stage).length}</span></h2><div className="space-y-2">{applications.filter((item) => item.stage === stage).map((item) => <article key={item._id} draggable onDragStart={(e) => e.dataTransfer.setData('text/application', item._id)} className="cursor-grab rounded-lg border border-black/8 bg-[#fafaf8] p-3"><h3 className="text-sm font-semibold">{item.company}</h3><p className="mt-0.5 text-xs text-black/60">{item.role}</p>{item.link && <a href={item.link} target="_blank" rel="noreferrer" className="mt-2 block truncate text-xs underline">Job posting</a>}{item.nextActionDate && <p className="mt-2 text-xs text-amber-800">Next step · {item.nextActionDate}</p>}{item.notes && <p className="mt-2 line-clamp-3 text-xs text-black/55">{item.notes}</p>}<div className="mt-3 flex gap-3 text-xs"><button onClick={() => edit(item)} className="underline">Edit</button><button onClick={() => remove(item)} className="text-red-700 underline">Delete</button></div></article>)}</div></section>)}</div>
  </div></main>
}
export default JobTracker
