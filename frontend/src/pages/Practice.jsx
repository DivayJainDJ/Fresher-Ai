import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FiArrowLeft, FiArrowRight, FiCheckCircle, FiClock, FiCode, FiDatabase, FiRotateCcw } from 'react-icons/fi'
import api from '../utils/axios'

const topics = [
  ['quantitative', 'Quantitative'], ['logical', 'Logical reasoning'], ['verbal', 'Verbal ability'],
  ['os', 'Operating systems'], ['dbms', 'DBMS'], ['networks', 'Computer networks'], ['oop', 'OOP'],
]
const formatTime = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

function Practice() {
  const navigate = useNavigate()
  const [topic, setTopic] = useState('quantitative')
  const [difficulty, setDifficulty] = useState('mixed')
  const [count, setCount] = useState(10)
  const [quiz, setQuiz] = useState(null)
  const [answers, setAnswers] = useState({})
  const [active, setActive] = useState(0)
  const [remaining, setRemaining] = useState(0)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const autoSubmitted = useRef(false)

  const submitQuiz = useCallback(async (activeQuiz = quiz, activeAnswers = answers) => {
    if (!activeQuiz || loading || result) return
    setLoading(true)
    setError('')
    try {
      const response = await api.post('/api/practice/quiz/submit', {
        quizId: activeQuiz.quizId,
        idempotencyKey: window.crypto.randomUUID(),
        answers: activeQuiz.questions.map((question) => ({ questionId: question.questionId, selectedIndex: activeAnswers[question.questionId] ?? null })),
      })
      setResult(response.data)
    } catch (err) {
      setError(err.response?.data?.message || 'Could not submit this quiz. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [answers, loading, quiz, result])

  useEffect(() => {
    if (!quiz || result || loading) return undefined
    if (remaining <= 0) {
      if (!autoSubmitted.current) {
        autoSubmitted.current = true
        submitQuiz(quiz, answers)
      }
      return undefined
    }
    const timer = window.setTimeout(() => setRemaining((value) => value - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [answers, loading, quiz, remaining, result, submitQuiz])

  const beginQuiz = async () => {
    setLoading(true)
    setError('')
    try {
      const response = await api.get('/api/practice/quiz', { params: { topic, difficulty, count } })
      setQuiz(response.data)
      setAnswers({})
      setActive(0)
      setResult(null)
      autoSubmitted.current = false
      setRemaining(response.data.questions.length * 30)
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load a quiz right now.')
    } finally {
      setLoading(false)
    }
  }

  const restart = () => {
    setQuiz(null)
    setResult(null)
    setAnswers({})
    setError('')
  }
  const current = quiz?.questions[active]
  const answeredCount = useMemo(() => Object.keys(answers).length, [answers])

  return (
    <main className="min-h-screen bg-[#f7f7f5] px-4 py-8 text-[#111] sm:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3"><button onClick={() => navigate('/dashboard')} className="inline-flex items-center gap-2 text-sm text-black/55 hover:text-black"><FiArrowLeft /> Dashboard</button><div className="flex gap-2"><button onClick={() => navigate('/practice/sql')} className="inline-flex items-center gap-2 rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-medium hover:border-black/35"><FiDatabase /> SQL Playground</button><button onClick={() => navigate('/practice/coding')} className="inline-flex items-center gap-2 rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-medium hover:border-black/35"><FiCode /> Coding Arena</button></div></div>
        <header className="mb-8">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-black/45">Practice studio</p>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Sharpen your fundamentals.</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-black/55">Timed, focused quizzes with explanations after you submit. Questions are served from the local bank, so quiz sessions work without AI providers.</p>
        </header>

        {!quiz && !result && <section className="rounded-2xl border border-black/8 bg-white p-5 shadow-sm sm:p-7">
          <h2 className="mb-5 text-lg font-semibold">Set up a quiz</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="text-sm font-medium">Topic<select value={topic} onChange={(e) => setTopic(e.target.value)} className="mt-2 block w-full rounded-lg border border-black/15 bg-white px-3 py-3 outline-none focus:border-black">{topics.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="text-sm font-medium">Difficulty<select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} className="mt-2 block w-full rounded-lg border border-black/15 bg-white px-3 py-3 outline-none focus:border-black">{[['mixed', 'Mixed'], ['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="text-sm font-medium">Questions<select value={count} onChange={(e) => setCount(Number(e.target.value))} className="mt-2 block w-full rounded-lg border border-black/15 bg-white px-3 py-3 outline-none focus:border-black">{[5, 10, 15, 20].map((n) => <option key={n} value={n}>{n} questions</option>)}</select></label>
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-xl bg-[#f7f7f5] p-4 text-sm text-black/55"><span className="inline-flex items-center gap-2"><FiClock /> 30 seconds per question</span><span>No coins used · no AI calls</span></div>
          <button onClick={beginQuiz} disabled={loading} className="mt-6 rounded-lg bg-black px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{loading ? 'Loading questions…' : 'Start quiz'}</button>
        </section>}

        {quiz && !result && current && <section className="rounded-2xl border border-black/8 bg-white p-5 shadow-sm sm:p-7">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div><p className="text-xs font-semibold uppercase tracking-wider text-black/40">{topics.find(([value]) => value === quiz.topic)?.[1]} · {current.difficulty}</p><p className="mt-1 text-sm text-black/55">Question {active + 1} of {quiz.questions.length} · {answeredCount} answered</p></div>
            <div className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 font-mono text-sm font-semibold ${remaining < 60 ? 'bg-red-50 text-red-700' : 'bg-black/5'}`}><FiClock /> {formatTime(remaining)}</div>
          </div>
          <div className="mb-6 h-1.5 overflow-hidden rounded-full bg-black/8"><div className="h-full rounded-full bg-black transition-all" style={{ width: `${((active + 1) / quiz.questions.length) * 100}%` }} /></div>
          <h2 className="mb-6 text-xl font-semibold leading-8 sm:text-2xl">{current.question}</h2>
          <div className="space-y-3">{current.options.map((option, index) => {
            const selected = answers[current.questionId] === index
            return <button key={`${current.questionId}-${index}`} onClick={() => setAnswers((prev) => ({ ...prev, [current.questionId]: index }))} className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left text-sm transition ${selected ? 'border-black bg-black text-white' : 'border-black/10 hover:border-black/35'}`}><span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${selected ? 'border-white/50' : 'border-black/20'}`}>{String.fromCharCode(65 + index)}</span><span className="pt-0.5">{option}</span></button>
          })}</div>
          <div className="mt-7 flex flex-wrap items-center justify-between gap-4">
            <div className="flex gap-2"><button onClick={() => setActive((index) => Math.max(0, index - 1))} disabled={active === 0} className="rounded-lg border border-black/15 px-4 py-2.5 text-sm disabled:opacity-35"><FiArrowLeft /></button><button onClick={() => setActive((index) => Math.min(quiz.questions.length - 1, index + 1))} disabled={active === quiz.questions.length - 1} className="rounded-lg border border-black/15 px-4 py-2.5 text-sm disabled:opacity-35"><FiArrowRight /></button></div>
            <div className="flex flex-wrap gap-1.5">{quiz.questions.map((question, index) => <button key={question.questionId} aria-label={`Go to question ${index + 1}`} onClick={() => setActive(index)} className={`h-8 w-8 rounded-md text-xs font-medium ${index === active ? 'bg-black text-white' : answers[question.questionId] !== undefined ? 'bg-emerald-100 text-emerald-800' : 'bg-black/5 text-black/55'}`}>{index + 1}</button>)}</div>
            <button onClick={() => submitQuiz()} disabled={loading} className="rounded-lg bg-black px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{loading ? 'Submitting…' : 'Finish quiz'}</button>
          </div>
        </section>}

        {result && <section className="space-y-5">
          <div className="rounded-2xl bg-black p-6 text-white sm:p-8"><p className="text-xs font-semibold uppercase tracking-widest text-white/55">Quiz complete</p><div className="mt-3 flex flex-wrap items-end justify-between gap-5"><div><p className="text-4xl font-bold">{result.score}<span className="text-2xl text-white/50"> / {result.total}</span></p><p className="mt-2 text-sm text-white/65">{result.accuracy}% accuracy</p></div><button onClick={restart} className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-3 text-sm font-semibold text-black"><FiRotateCcw /> New quiz</button></div></div>
          {Object.keys(result.perTopicAccuracy || {}).length > 1 && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(result.perTopicAccuracy).map(([name, stats]) => <div key={name} className="rounded-xl border border-black/8 bg-white p-4"><p className="text-sm font-medium">{topics.find(([value]) => value === name)?.[1] || name}</p><p className="mt-2 text-xl font-bold">{stats.accuracy}% <span className="text-sm font-normal text-black/45">· {stats.correct}/{stats.total}</span></p></div>)}</div>}
          <div className="rounded-2xl border border-black/8 bg-white p-5 sm:p-7"><h2 className="mb-4 text-lg font-semibold">Review answers</h2><div className="space-y-4">{result.results.map((item, index) => <article key={item.questionId} className="rounded-xl border border-black/8 p-4"><div className="flex gap-3"><span className={`mt-0.5 ${item.correct ? 'text-emerald-600' : 'text-red-600'}`}><FiCheckCircle /></span><div><p className="text-xs font-semibold uppercase tracking-wider text-black/40">Question {index + 1} · {topics.find(([value]) => value === item.topic)?.[1]}</p><h3 className="mt-1 font-semibold leading-6">{item.question}</h3><p className="mt-3 text-sm text-black/60">Your answer: {item.selectedIndex == null ? 'Not answered' : item.options[item.selectedIndex]}</p><p className="mt-1 text-sm font-medium text-emerald-800">Correct answer: {item.options[item.correctIndex]}</p><p className="mt-2 text-sm leading-6 text-black/60">{item.explanation}</p></div></div></article>)}</div></div>
        </section>}
        {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      </div>
    </main>
  )
}

export default Practice
