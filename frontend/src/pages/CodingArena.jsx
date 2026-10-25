import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FiArrowLeft, FiCheck, FiCode, FiHelpCircle, FiPlay, FiSend, FiTerminal } from 'react-icons/fi'
import CodeEditor from '../components/interview/CodeEditor'
import api from '../utils/axios'

const LANGUAGES = ['javascript', 'python']
const TIME_LIMIT_MS = { javascript: 2500, python: 12000 }

const executeInWorker = (language, payload) => new Promise((resolve) => {
  const worker = language === 'javascript'
    ? new Worker(new URL('../workers/javascriptRunner.worker.js', import.meta.url), { type: 'module' })
    : new Worker(new URL('../workers/pythonRunner.worker.js', import.meta.url), { type: 'module' })
  const startedAt = performance.now()
  let timeoutId = window.setTimeout(() => {
    worker.terminate()
    resolve({ error: language === 'python' ? 'Python runtime did not finish loading in 60 seconds.' : `Time limit exceeded (${TIME_LIMIT_MS[language] / 1000}s). The worker was stopped.`, runtimeMs: TIME_LIMIT_MS[language] })
  }, language === 'python' ? 60_000 : TIME_LIMIT_MS[language])
  worker.onmessage = ({ data }) => {
    if (data.ready) {
      window.clearTimeout(timeoutId)
      timeoutId = window.setTimeout(() => {
        worker.terminate()
        resolve({ error: `Time limit exceeded (${TIME_LIMIT_MS.python / 1000}s). The worker was stopped.`, runtimeMs: TIME_LIMIT_MS.python })
      }, TIME_LIMIT_MS.python)
      return
    }
    window.clearTimeout(timeoutId)
    worker.terminate()
    resolve({ ...data, runtimeMs: data.runtimeMs ?? Math.max(0, Math.round(performance.now() - startedAt)) })
  }
  worker.onerror = (event) => {
    window.clearTimeout(timeoutId)
    worker.terminate()
    resolve({ error: event.message || 'The code worker failed.', runtimeMs: Math.max(0, Math.round(performance.now() - startedAt)) })
  }
  const pyodideBaseUrl = new URL(`${import.meta.env.BASE_URL}assets/pyodide/`, window.location.origin).href
  worker.postMessage({ ...payload, ...(language === 'python' ? { pyodideBaseUrl } : {}) })
})

function CodingArena() {
  const navigate = useNavigate()
  const [problems, setProblems] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [language, setLanguage] = useState('javascript')
  const [code, setCode] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [review, setReview] = useState(null)
  const [reviewError, setReviewError] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const [coinsRemaining, setCoinsRemaining] = useState(null)

  useEffect(() => {
    let cancelled = false
    api.get('/api/practice/coding/problems')
      .then(({ data }) => {
        if (cancelled) return
        const available = data.problems || []
        setProblems(available)
        setSelectedId(available[0]?._id || '')
      })
      .catch((requestError) => { if (!cancelled) setError(requestError.response?.data?.message || 'Could not load coding problems.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const selected = useMemo(() => problems.find((problem) => problem._id === selectedId), [problems, selectedId])
  const selectProblem = (id) => {
    const next = problems.find((problem) => problem._id === id)
    setSelectedId(id)
    setLanguage('javascript')
    setCode(next?.starterCode?.javascript || '')
    setResult(null)
    setReview(null)
    setError('')
    setReviewError('')
  }

  useEffect(() => {
    if (selected && !code) setCode(selected.starterCode?.javascript || '')
  }, [selected, code])

  const runTests = async (tests) => {
    if (!selected || busy || !code.trim()) return null
    setBusy(true)
    setError('')
    setResult(null)
    setReview(null)
    setReviewError('')
    const executed = await executeInWorker(language, { code, functionName: selected.functionName, tests })
    setBusy(false)
    return executed
  }

  const runVisible = async () => {
    const outcome = await runTests(selected.visibleTests || [])
    if (outcome) {
      setResult({ ...outcome, visibleOnly: true })
      if (outcome.error) setError(outcome.error)
    }
  }

  const submitSolution = async () => {
    if (!selected || busy || !code.trim()) return
    setBusy(true)
    setError('')
    setResult(null)
    setReview(null)
    setReviewError('')
    try {
      const { data: testData } = await api.post(`/api/practice/coding/problems/${selected._id}/submit`, { language })
      const startedAt = performance.now()
      const executed = await executeInWorker(language, { code, functionName: testData.functionName, tests: [...selected.visibleTests, ...testData.hiddenTests] })
      const runtimeMs = executed.runtimeMs ?? Math.round(performance.now() - startedAt)
      const passedCount = executed.error ? 0 : executed.passedCount
      const totalCount = selected.visibleTests.length + testData.hiddenTests.length
      const { data: saved } = await api.post(`/api/practice/coding/problems/${selected._id}/attempt`, { language, passedCount, totalCount, runtimeMs })
      setResult({ ...executed, passedCount, totalCount, runtimeMs: saved.runtimeMs, score: saved.score, visibleOnly: false })
      if (executed.error) setError(executed.error)
    } catch (requestError) {
      setError(requestError.response?.data?.message || requestError.message || 'Could not submit this solution.')
    } finally {
      setBusy(false)
    }
  }

  const askForReview = async () => {
    if (!selected || reviewing || !result || result.error) return
    setReviewing(true)
    setReviewError('')
    setReview(null)
    try {
      const { data } = await api.post('/api/interview/code-review', {
        code, language, problemTitle: selected.title, statement: selected.statement, idempotencyKey: crypto.randomUUID(),
      })
      setReview(data.review)
      setCoinsRemaining(data.coinsRemaining)
    } catch (requestError) {
      setReviewError(requestError.response?.status === 402 ? 'You need 5 interview coins for an AI review.' : requestError.response?.data?.message || 'Could not generate the review.')
    } finally {
      setReviewing(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#f7f7f5] px-4 py-7 text-[#111] sm:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><button onClick={() => navigate('/practice')} className="inline-flex items-center gap-2 text-sm text-black/55 hover:text-black"><FiArrowLeft /> Practice studio</button><span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800"><FiTerminal /> JavaScript and Python run in isolated browser workers</span></div>
        <header className="mb-6"><p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-black/45">Coding arena</p><h1 className="text-3xl font-bold tracking-tight">Solve. Run. Improve.</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-black/55">Practice with visible examples, then submit against hidden cases. Code runs locally in a worker with a time limit. AI complexity review is optional and costs 5 interview coins.</p></header>
        {loading ? <div className="rounded-xl bg-white p-6 text-sm text-black/50">Loading original problems…</div> : <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="h-fit rounded-2xl border border-black/8 bg-white p-4"><h2 className="mb-3 px-2 text-xs font-semibold uppercase tracking-widest text-black/40">Problem set</h2><nav className="max-h-[70vh] space-y-1 overflow-y-auto">{problems.map((problem) => <button key={problem._id} onClick={() => selectProblem(problem._id)} className={`w-full rounded-lg px-3 py-2.5 text-left ${selectedId === problem._id ? 'bg-black text-white' : 'text-black/70 hover:bg-black/5'}`}><span className="block truncate text-sm font-medium">{problem.title}</span><span className={`mt-0.5 block text-xs capitalize ${selectedId === problem._id ? 'text-white/55' : 'text-black/40'}`}>{problem.difficulty} · {problem.topicTags.join(', ')}</span></button>)}</nav></aside>
          {selected && <section className="min-w-0 space-y-4">
            <article className="rounded-2xl border border-black/8 bg-white p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-black/40">{selected.topicTags.join(' · ')} · {selected.difficulty}</p><h2 className="mt-1 text-xl font-bold">{selected.title}</h2></div><span className="rounded-md bg-black/5 px-2 py-1 text-xs text-black/55">{problems.length} problems</span></div><p className="mt-4 whitespace-pre-line text-sm leading-6 text-black/65">{selected.statement}</p><ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-black/55">{selected.constraints.map((constraint) => <li key={constraint}>{constraint}</li>)}</ul><details className="mt-4 rounded-xl bg-[#f7f7f5] p-3"><summary className="cursor-pointer text-sm font-medium"><FiHelpCircle className="mr-2 inline" />Visible examples</summary><pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs leading-5 text-black/65">{JSON.stringify(selected.visibleTests, null, 2)}</pre></details></article>
            <section className="overflow-hidden rounded-2xl border border-black/10 bg-[#111315] text-white"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3"><span className="inline-flex items-center gap-2 text-xs font-medium text-white/65"><FiCode /> Solution editor</span><div className="flex items-center gap-3"><label className="text-xs text-white/50">Language <select value={language} onChange={(event) => { const nextLanguage = event.target.value; setLanguage(nextLanguage); setCode(selected.starterCode?.[nextLanguage] || '') }} className="ml-2 rounded-md border border-white/15 bg-[#1a1d20] px-2 py-1 text-white">{LANGUAGES.map((option) => <option key={option} value={option}>{option}</option>)}</select></label><button onClick={() => setEditorOpen(true)} className="rounded-md border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:bg-white/5">Open full editor</button></div></div><textarea aria-label="Solution code editor" spellCheck="false" value={code} onChange={(event) => setCode(event.target.value)} placeholder={selected.starterCode[language]} className="min-h-72 w-full resize-y bg-transparent p-4 font-mono text-sm leading-6 text-emerald-100 outline-none placeholder:text-white/25"/><div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-4 py-3"><span className="text-xs text-white/40">No coin cost · Hidden tests stay off the initial problem list</span><div className="flex gap-2"><button onClick={runVisible} disabled={busy || !code.trim()} className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-xs text-white/75 disabled:opacity-40"><FiPlay /> Run examples</button><button onClick={submitSolution} disabled={busy || !code.trim()} className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-xs font-semibold text-black disabled:opacity-45"><FiSend /> {busy ? 'Running…' : 'Submit solution'}</button></div></div></section>
            {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
            {result && <section className={`rounded-2xl border bg-white p-5 ${result.error ? 'border-red-200' : result.passedCount === result.totalCount ? 'border-emerald-200' : 'border-amber-200'}`}><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="flex items-center gap-2 font-semibold">{result.error ? 'Execution stopped' : result.visibleOnly ? 'Example results' : result.passedCount === result.totalCount ? 'All tests passed' : 'Some tests failed'}{!result.error && result.passedCount === result.totalCount && <FiCheck className="text-emerald-600" />}</h3><p className="mt-1 text-sm text-black/55">{result.error ? result.error : `${result.passedCount}/${result.totalCount} passed · ${result.runtimeMs} ms${result.visibleOnly ? ' · visible cases only' : ` · score ${result.score}%`}`}</p></div>{!result.visibleOnly && !result.error && <button onClick={askForReview} disabled={reviewing} className="rounded-lg bg-black px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{reviewing ? 'Reviewing…' : 'AI review · 5 coins'}</button>}</div>{reviewError && <p role="alert" className="mt-3 text-sm text-red-700">{reviewError}</p>}{review && <article className="mt-4 rounded-xl bg-[#f7f7f5] p-4"><p className="text-sm font-semibold">Complexity: {review.timeComplexity} time · {review.spaceComplexity} space</p><p className="mt-2 text-sm leading-6 text-black/65">{review.feedback}</p>{review.improvements.length > 0 && <ul className="mt-3 list-disc pl-5 text-sm text-black/65">{review.improvements.map((item) => <li key={item}>{item}</li>)}</ul>}{review.styleSuggestions.length > 0 && <p className="mt-3 text-xs text-black/50">Style: {review.styleSuggestions.join(' · ')}</p>}{coinsRemaining != null && <p className="mt-3 text-xs text-black/45">Balance after review: {coinsRemaining} coins</p>}</article>}</section>}
          </section>}
        </div>}
        {!loading && problems.length === 0 && !error && <p className="rounded-xl bg-white p-5 text-sm text-black/55">No approved coding problems are available yet.</p>}
      </div>
      {editorOpen && selected && <CodeEditor onClose={() => setEditorOpen(false)} languageOptions={LANGUAGES} initialLanguage={language} initialCode={code} starterCodeByLanguage={selected.starterCode} submitLabel="Use this code" onSubmitCode={(nextCode, nextLanguage) => { setCode(nextCode); setLanguage(nextLanguage); setEditorOpen(false) }} />}
    </main>
  )
}

export default CodingArena
