import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FiArrowLeft, FiCheck, FiCode, FiDatabase, FiHelpCircle, FiPlay, FiX } from 'react-icons/fi'
import api from '../utils/axios'
import { runInDisposableDatabase } from '../utils/sqlResult'

const topicLabels = { joins: 'Joins', group_by: 'GROUP BY', subqueries: 'Subqueries', window_functions: 'Window functions' }
const cellText = (value) => value === null ? 'NULL' : String(value)

function SqlPlayground() {
  const navigate = useNavigate()
  const [SQL, setSQL] = useState(null)
  const [problems, setProblems] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [query, setQuery] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [showHint, setShowHint] = useState(false)
  const [error, setError] = useState('')
  const startedAt = useRef(performance.now())

  useEffect(() => {
    let cancelled = false
    Promise.all([import('sql.js'), import('sql.js/dist/sql-wasm.wasm?url')])
      .then(async ([sqlModule, wasmModule]) => {
        const sql = await sqlModule.default({ locateFile: () => wasmModule.default })
        if (!cancelled) setSQL(sql)
      })
      .catch(() => { if (!cancelled) setError('Could not load the in-browser SQLite engine.') })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    api.get('/api/practice/sql/problems')
      .then(({ data }) => {
        if (cancelled) return
        const available = data.problems || []
        setProblems(available)
        setSelectedId(available[0]?._id || '')
        startedAt.current = performance.now()
      })
      .catch((requestError) => { if (!cancelled) setError(requestError.response?.data?.message || 'Could not load SQL problems.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const selected = problems.find((problem) => problem._id === selectedId)
  const groupedProblems = useMemo(() => problems.reduce((groups, problem) => {
    (groups[problem.topic] ||= []).push(problem)
    return groups
  }, {}), [problems])

  const chooseProblem = (problemId) => {
    setSelectedId(problemId)
    setQuery('')
    setResult(null)
    setError('')
    setShowHint(false)
    startedAt.current = performance.now()
  }

  const runQuery = async () => {
    if (!SQL || !selected || running) return
    setRunning(true)
    setError('')
    setResult(null)
    const attemptMs = Math.min(3_600_000, Math.max(0, Math.round(performance.now() - startedAt.current)))
    try {
      const evaluation = runInDisposableDatabase(SQL, selected, query)
      setResult(evaluation)
      const { data: saved } = await api.post(`/api/practice/sql/problems/${selected._id}/attempt`, { query, attemptMs })
      setResult((current) => ({ ...current, passed: saved.passed, message: saved.message, actual: saved.actual || current.actual }))
    } catch (runError) {
      setError(runError.response?.data?.message || runError.message || 'The query could not be run.')
    } finally {
      setRunning(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#f7f7f5] px-4 py-7 text-[#111] sm:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <button onClick={() => navigate('/practice')} className="inline-flex items-center gap-2 text-sm text-black/55 hover:text-black"><FiArrowLeft /> Practice studio</button>
          <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800"><FiDatabase /> Runs locally in your browser</span>
        </div>
        <header className="mb-6">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-black/45">SQL playground</p>
          <h1 className="text-3xl font-bold tracking-tight">Query the data. Learn by doing.</h1>
          <p className="mt-2 text-sm text-black/55">Queries run locally for instant feedback and are also checked by the server. Incorrect queries are saved to your private mistake notebook for revision.</p>
        </header>

        {loading ? <div className="rounded-xl bg-white p-6 text-sm text-black/50">Loading original SQL problems…</div> : <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="h-fit rounded-2xl border border-black/8 bg-white p-4">
            <h2 className="mb-3 px-2 text-xs font-semibold uppercase tracking-widest text-black/40">Problem set</h2>
            <nav className="max-h-[70vh] space-y-4 overflow-y-auto">{Object.entries(groupedProblems).map(([topic, items]) => <section key={topic}><h3 className="mb-1 px-2 text-xs font-semibold text-black/50">{topicLabels[topic] || topic}</h3>{items.map((problem, index) => <button key={problem._id} onClick={() => chooseProblem(problem._id)} className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm ${selectedId === problem._id ? 'bg-black text-white' : 'text-black/70 hover:bg-black/5'}`}><span className="text-xs opacity-50">{index + 1}.</span><span className="truncate">{problem.title}</span></button>)}</section>)}</nav>
          </aside>

          {selected && <section className="min-w-0 space-y-4">
            <article className="rounded-2xl border border-black/8 bg-white p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-black/40">{topicLabels[selected.topic]} · {selected.difficulty}</p><h2 className="mt-1 text-xl font-bold">{selected.title}</h2></div><span className="rounded-md bg-black/5 px-2 py-1 text-xs text-black/55">{problems.length} problems</span></div>
              <p className="mt-4 text-sm leading-6 text-black/65">{selected.description}</p>
              <details className="mt-4 rounded-xl bg-[#f7f7f5] p-3"><summary className="cursor-pointer text-sm font-medium"><FiDatabase className="mr-2 inline" />Tables and sample data</summary><pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs leading-5 text-black/65">{selected.schemaSql}{'\n\n'}{selected.seedSql}</pre></details>
            </article>

            <section className="overflow-hidden rounded-2xl border border-black/10 bg-[#111315] text-white shadow-sm">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3"><span className="inline-flex items-center gap-2 text-xs font-medium text-white/65"><FiCode /> SQL editor</span><span className="text-xs text-white/35">SQLite · in-memory</span></div>
              <textarea aria-label="SQL query editor" spellCheck="false" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="-- Write your SQL query here\nSELECT ...;" className="min-h-64 w-full resize-y bg-transparent p-4 font-mono text-sm leading-6 text-emerald-100 outline-none placeholder:text-white/25" />
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-4 py-3"><div className="flex gap-2"><button onClick={() => setShowHint((visible) => !visible)} className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-xs text-white/70 hover:bg-white/5"><FiHelpCircle /> {showHint ? 'Hide hint' : 'Show hint'}</button><button onClick={() => { setQuery(''); setResult(null) }} className="rounded-lg px-3 py-2 text-xs text-white/50 hover:bg-white/5">Clear</button></div><button onClick={runQuery} disabled={!SQL || running || !query.trim()} className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-black disabled:opacity-45"><FiPlay /> {running ? 'Checking…' : 'Run & check'}</button></div>
            </section>

            {showHint && <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><FiHelpCircle className="mr-2 inline" />{selected.hint}</p>}
            {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
            {result && <section className={`overflow-hidden rounded-2xl border bg-white ${result.passed ? 'border-emerald-200' : 'border-amber-200'}`}><div className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold ${result.passed ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`}>{result.passed ? <FiCheck /> : <FiX />}{result.passed ? 'Correct — result sets match.' : result.message || 'Not quite. Check the output and try again.'}</div>{result.actual && <div className="overflow-x-auto p-4"><table className="min-w-full border-collapse text-left text-sm"><thead><tr>{result.actual.columns.map((column) => <th key={column} className="border-b border-black/10 px-3 py-2 font-semibold">{column}</th>)}</tr></thead><tbody>{result.actual.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, colIndex) => <td key={colIndex} className="border-b border-black/5 px-3 py-2 font-mono text-xs">{cellText(cell)}</td>)}</tr>)}</tbody></table>{result.actual.rows.length === 0 && <p className="py-3 text-xs text-black/50">Query returned no rows.</p>}</div>}</section>}
          </section>}
        </div>}
        {!loading && problems.length === 0 && !error && <p className="rounded-xl bg-white p-5 text-sm text-black/55">No approved SQL problems are available yet.</p>}
      </div>
    </main>
  )
}

export default SqlPlayground
