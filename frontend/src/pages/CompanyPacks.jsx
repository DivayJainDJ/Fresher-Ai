import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../utils/axios'

function CompanyPacks() {
  const navigate = useNavigate()
  const [packs, setPacks] = useState([])
  const [selected, setSelected] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    api.get('/api/practice/company-packs').then(({ data }) => setPacks(data.packs || [])).catch((e) => setError(e.response?.data?.message || 'Company packs could not be loaded.'))
  }, [])
  const openPack = async (slug) => {
    try { const { data } = await api.get(`/api/practice/company-packs/${slug}`); setSelected(data.pack) }
    catch (e) { setError(e.response?.data?.message || 'Company pack could not be loaded.') }
  }
  const practiceHref = (name) => /design|architecture/i.test(name) ? '/interview/design' : /coding|technical|assessment/i.test(name) ? '/practice/coding' : '/interview'
  return <main className="min-h-screen bg-[#f7f7f5] px-4 py-8 text-[#111] sm:px-8"><div className="mx-auto max-w-5xl">
    <button onClick={() => navigate('/practice')} className="mb-6 text-sm text-black/55">← Practice studio</button>
    <p className="text-xs font-semibold uppercase tracking-widest text-black/40">Company packs · free guides</p><h1 className="mt-2 text-3xl font-bold">Prepare for a company round</h1>
    {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{packs.map((pack) => <button key={pack.slug} onClick={() => openPack(pack.slug)} className="rounded-xl border border-black/10 bg-white p-5 text-left hover:border-black/30"><h2 className="font-semibold">{pack.company}</h2><p className="mt-1 text-sm text-black/55">{pack.role}</p><p className="mt-3 text-xs text-black/45">{pack.rounds.length} rounds · {pack.likelyTopics.slice(0, 3).join(' · ')}</p></button>)}</div>
    {selected && <section className="mt-7 rounded-2xl border border-black/10 bg-white p-5 sm:p-7"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-widest text-black/40">{selected.company}</p><h2 className="mt-1 text-2xl font-bold">{selected.role} preparation</h2></div><button onClick={() => setSelected(null)} className="text-sm text-black/50">Close</button></div>
      <h3 className="mt-6 font-semibold">Interview rounds</h3><div className="mt-3 grid gap-3 md:grid-cols-2">{selected.rounds.map((round) => <article key={round.name} className="rounded-xl bg-[#f7f7f5] p-4"><h4 className="font-semibold">{round.name}</h4><p className="mt-1 text-sm text-black/60">{round.description}</p><ul className="mt-2 list-inside list-disc text-sm text-black/55">{round.tips.map((tip) => <li key={tip}>{tip}</li>)}</ul><button onClick={() => navigate(practiceHref(round.name))} className="mt-3 text-sm font-semibold underline">Practice this round →</button></article>)}</div>
      <div className="mt-5 grid gap-5 md:grid-cols-2"><div><h3 className="font-semibold">Likely topics</h3><div className="mt-2 flex flex-wrap gap-2">{selected.likelyTopics.map((topic) => <span key={topic} className="rounded-full bg-amber-50 px-3 py-1 text-xs">{topic}</span>)}</div><h3 className="mt-5 font-semibold">Prep checklist</h3><ul className="mt-2 list-inside list-disc space-y-1 text-sm text-black/60">{selected.prepChecklist.map((item) => <li key={item}>{item}</li>)}</ul></div><div><h3 className="font-semibold">Sample questions</h3><ol className="mt-2 list-inside list-decimal space-y-2 text-sm text-black/60">{selected.sampleQuestions.map((question) => <li key={question}>{question}</li>)}</ol></div></div>
      <p className="mt-5 text-xs text-black/40">Original preparation guide; not official company interview material.</p></section>}
  </div></main>
}
export default CompanyPacks
