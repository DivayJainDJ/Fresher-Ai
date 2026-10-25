import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../utils/axios'

const stepNames = { requirements: 'Requirements', entities: 'Entities', api: 'API design', 'data-model': 'Data model', scaling: 'Scaling' }
function DesignPractice() {
  const navigate = useNavigate()
  const [prompts, setPrompts] = useState([])
  const [promptId, setPromptId] = useState('')
  const [session, setSession] = useState(null)
  const [scenario, setScenario] = useState('')
  const [answer, setAnswer] = useState('')
  const [feedback, setFeedback] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { api.get('/api/interview/design/prompts').then(({ data }) => { setPrompts(data.prompts || []); setPromptId(data.prompts?.[0]?.id || '') }).catch((e) => setError(e.response?.data?.message || 'Design prompts could not be loaded.')) }, [])
  const start = async () => {
    setBusy(true); setError('')
    try { const { data } = await api.post('/api/interview/design/start', { promptId, role: 'Software Engineer', idempotencyKey: window.crypto.randomUUID() }); setSession(data.session); setScenario(data.scenario); setAnswer(''); setFeedback(null) }
    catch (e) { setError(e.response?.data?.message || 'Could not start the design round.') }
    finally { setBusy(false) }
  }
  const submit = async (skip = false) => {
    if (!session || busy) return
    const step = session.steps[session.currentStep]?.key
    setBusy(true); setError('')
    try { const { data } = await api.post(`/api/interview/design/${session.id}/answer`, { step, answer: skip ? '' : answer }); setSession(data.session); setFeedback(data.feedback); setAnswer('') }
    catch (e) { setError(e.response?.data?.message || 'Could not score this step.') }
    finally { setBusy(false) }
  }
  const current = session?.steps?.[session.currentStep]?.key
  return <main className="min-h-screen bg-[#f7f7f5] px-4 py-8 text-[#111] sm:px-8"><div className="mx-auto max-w-4xl"><button onClick={() => navigate('/interview')} className="mb-6 text-sm text-black/55">← Interview practice</button><p className="text-xs font-semibold uppercase tracking-widest text-black/40">Design interview · 1 coin per round</p><h1 className="mt-2 text-3xl font-bold">Build a system design answer</h1>
    {!session && <section className="mt-6 rounded-2xl bg-white p-6"><label className="text-sm font-medium">Starter prompt<select value={promptId} onChange={(e) => setPromptId(e.target.value)} className="mt-2 block w-full rounded-lg border p-3">{prompts.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label><button disabled={busy || !promptId} onClick={start} className="mt-5 rounded-lg bg-black px-5 py-3 font-semibold text-white disabled:opacity-50">{busy ? 'Starting…' : 'Start round'}</button></section>}
    {session && <section className="mt-6 space-y-4 rounded-2xl bg-white p-5 sm:p-7"><div className="rounded-xl bg-[#f7f7f5] p-4"><h2 className="font-semibold">{session.promptTitle}</h2><p className="mt-1 text-sm text-black/60">{scenario}</p></div><div className="flex gap-2">{session.steps.map((step, i) => <span key={step.key} className={`h-1.5 flex-1 rounded ${i < session.currentStep ? 'bg-emerald-500' : i === session.currentStep ? 'bg-black' : 'bg-black/10'}`} />)}</div>
      {current ? <><h2 className="text-xl font-semibold">{stepNames[current]}</h2><p className="text-sm text-black/55">Answer this step in order. You may skip it, which records a zero and lists the missing criteria.</p><textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={7} maxLength={12000} className="w-full rounded-xl border border-black/15 p-4 outline-none focus:border-black" placeholder={`Your ${stepNames[current].toLowerCase()} answer…`} /><div className="flex flex-wrap gap-2"><button disabled={busy || !answer.trim()} onClick={() => submit()} className="rounded-lg bg-black px-4 py-2.5 font-semibold text-white disabled:opacity-45">{busy ? 'Scoring…' : 'Score and continue'}</button><button disabled={busy} onClick={() => submit(true)} className="rounded-lg border px-4 py-2.5 text-sm">Skip step</button></div></> : <div className="rounded-xl bg-emerald-50 p-5"><h2 className="text-xl font-bold">Round complete</h2><p className="mt-2">Overall score: {Math.round(session.steps.reduce((sum, step) => sum + (step.score || 0), 0) / 5)} / 100</p><button onClick={start} className="mt-4 rounded-lg bg-black px-4 py-2.5 text-sm font-semibold text-white">Start another design round</button></div>}
      {feedback && <article className="rounded-xl border border-black/10 p-4"><div className="flex items-center justify-between"><h3 className="font-semibold">Step score</h3><strong>{feedback.score}/100</strong></div>{feedback.strengths.length > 0 && <ul className="mt-2 list-inside list-disc text-sm text-emerald-800">{feedback.strengths.map((x) => <li key={x}>{x}</li>)}</ul>}<h4 className="mt-3 text-sm font-semibold">Gaps</h4><ul className="mt-1 list-inside list-disc text-sm text-amber-900">{feedback.gaps.map((x) => <li key={x}>{x}</li>)}</ul><h4 className="mt-3 text-sm font-semibold">Model outline</h4><p className="mt-1 whitespace-pre-wrap text-sm text-black/65">{feedback.modelOutline}</p></article>}
    </section>}
    {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
  </div></main>
}
export default DesignPractice
