import { useState } from 'react'
import Sidebar from '../components/Sidebar'
import { useNavigate } from 'react-router-dom'
import { motion } from "motion/react"
import { FiSidebar } from 'react-icons/fi'
import { useEffect } from 'react'
import { getAllInterviews } from '../apis/interview.api'
import { logoutUser } from '../apis/user.api'
import Statbox from '../components/Statbox'
import InterviewGraph from '../components/InterviewGraph'
import api from '../utils/axios'
import { FiArrowUpRight, FiBookOpen, FiCode, FiDatabase, FiFileText, FiMap, FiTarget } from 'react-icons/fi'

const MODULES = {
  interview: ['Interviews', '/interview', FiTarget],
  resume: ['Resume score', '/scorer', FiFileText],
  quiz: ['Practice quizzes', '/practice', FiBookOpen],
  sql: ['SQL', '/practice/sql', FiDatabase],
  coding: ['Coding', '/practice/coding', FiCode],
  roadmap: ['Roadmap', '/roadmap', FiMap],
}
function Dashboard({ user, setUser }) {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [moblieOpen, setMoblieOpen] = useState(false)
  const [stats, setStats] = useState({

    totalInterviews: 0,

    totalQuestions: 0,

    completed: 0,

    averageScore: 0,

  });

  const [technicalData, setTechnicalData] = useState([]);

  const [hrData, setHrData] = useState([]);

  const [technicalCount, setTechnicalCount] = useState(0);

  const [hrCount, setHrCount] = useState(0);
  const [readiness, setReadiness] = useState(null)
  const [readinessLoading, setReadinessLoading] = useState(true)
  const [readinessError, setReadinessError] = useState('')

  const navigate = useNavigate()

  useEffect(() => {

    const fetchInterviews = async () => {
      const response = await getAllInterviews()
      if (!response) {
        setStats({
          totalInterviews: 0,
          totalQuestions: 0,
          completed: 0,
          averageScore: 0,
        })
        setTechnicalData([])
        setHrData([])
        setTechnicalCount(0)
        setHrCount(0)
        return
      }
      setStats(response.stats)
      setTechnicalData(response.technicalData)
      setHrData(response.hrData)
      setTechnicalCount(response.technicalCount)
      setHrCount(response.hrCount)
    }

    fetchInterviews()

  }, [])

  const fetchReadiness = async () => {
    setReadinessLoading(true)
    setReadinessError('')
    try {
      const response = await api.get('/api/progress/dashboard')
      setReadiness(response.data.dashboard)
    } catch (error) {
      setReadinessError(error.response?.data?.message || 'Readiness data could not be loaded.')
    } finally {
      setReadinessLoading(false)
    }
  }

  useEffect(() => { fetchReadiness() }, [])

  useEffect(() => {
    const onFocus = () => fetchReadiness()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const handleLogout = async () => {
    try {
      await logoutUser()
      setUser(null)
      navigate("/")
    } catch (error) {
      console.log(error)
    }
  }



  return (
    <div className='bg-white min-h-screen text-[#0A0A0A] font-sans flex'>
      <Sidebar
        user={user}
        onNewInterview={() => navigate("/interview")}
        onLogout={handleLogout}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        moblieOpen={moblieOpen}
        setMoblieOpen={setMoblieOpen}
      />

      <motion.main className={`flex-1 min-h-screen px-3 sm:px-4 md:px-6 py-4 md:py-6 transition-all duration-300 ${sidebarOpen ? "md:ml-[260px]" : "md:ml-[72px]"
        }`}>

        {/* top Area */}
        <div className='flex items-center justify-between mb-5 md:mb-6'>
          <div className='flex items-center gap-2.5'>

            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setMoblieOpen(true)}
              className='md:hidden text-black/40 hover:text-[#0A0A0A] transition-colors'>
              <FiSidebar size={17} />

            </motion.button>


            <motion.div
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
            >
              <p className='text-black/40 text-[11px] md:text-xs font-medium mb-0.5'>Overview</p>

              <h2 className='text-lg md:text-xl font-bold text-[#0A0A0A]'>Hello, {user?.name?.split(" ")[0]} 👋 </h2>



            </motion.div>



          </div>
        </div>

        <div className='h-px bg-black/8 mb-5 md:mb-6' />
        <div className="mb-5 flex flex-wrap gap-2"><button onClick={() => navigate('/applications')} className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm font-medium">Job tracker</button><button onClick={() => navigate('/retention')} className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm font-medium">Daily practice & revision</button><button onClick={() => navigate('/company-packs')} className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm font-medium">Company packs</button></div>

        <section className="mb-7 rounded-2xl border border-black/8 bg-[#f8f8f6] p-4 sm:p-6">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-black/40">Readiness</p><h3 className="mt-1 text-lg font-bold">Your preparation at a glance</h3></div>
            <div className="flex gap-2 rounded-xl bg-white px-3 py-2 text-sm"><span className="text-black/45">Streak</span><strong>{readiness?.streak?.current || 0} days</strong></div>
          </div>
          {readinessLoading ? <p className="py-8 text-center text-sm text-black/45">Loading readiness…</p> : readinessError ? <div className="rounded-xl bg-white p-5 text-center"><p className="text-sm text-black/60">{readinessError}</p><button onClick={fetchReadiness} className="mt-3 text-sm font-semibold underline">Try again</button></div> : readiness?.empty || !readiness?.hasData ? <div className="rounded-xl bg-white p-5 sm:p-7"><p className="font-semibold">Start building your readiness score</p><p className="mt-1 text-sm text-black/50">Complete an interview, score your resume, or finish a practice activity. Your score appears as soon as we have a result.</p><button onClick={() => navigate('/practice')} className="mt-4 rounded-lg bg-black px-4 py-2.5 text-sm font-semibold text-white">Start a quiz <FiArrowUpRight className="ml-1 inline" /></button></div> : <>
            <div className="grid gap-4 lg:grid-cols-[210px_1fr]">
              <div className="flex flex-col items-center justify-center gap-1 rounded-xl bg-black p-4 text-center text-white">
                <div className="relative flex h-28 w-28 items-center justify-center rounded-full" style={{ background: `conic-gradient(#a3e635 ${readiness.readinessScore * 3.6}deg, #ffffff22 0deg)` }}><div className="flex h-20 w-20 flex-col items-center justify-center rounded-full bg-black"><span className="text-3xl font-bold">{readiness.readinessScore}</span><span className="text-[10px] text-white/50">out of 100</span></div></div>
                <p className="text-sm font-semibold">Readiness score</p><p className="text-xs text-white/50">Based on {readiness.modules.length} active modules</p>
              </div>
              <div className="rounded-xl bg-white p-4 sm:p-5"><div className="mb-3 flex items-center justify-between"><h4 className="font-semibold">Module breakdown</h4><button onClick={fetchReadiness} className="text-xs text-black/45 underline">Refresh</button></div><div className="space-y-3">{readiness.modules.map((item) => { const [label, href, Icon] = MODULES[item.module] || [item.module, '/practice', FiTarget]; return <button key={item.module} onClick={() => navigate(href)} className="group flex w-full items-center gap-3 text-left"><Icon className="shrink-0 text-black/45"/><span className="w-28 shrink-0 text-xs font-medium text-black/65">{label}</span><span className="h-2 flex-1 overflow-hidden rounded-full bg-black/7"><span className="block h-full rounded-full bg-black transition-all" style={{ width: `${item.score}%` }} /></span><span className="w-9 text-right text-xs font-semibold">{Math.round(item.score)}%</span></button> })}</div></div>
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl bg-white p-4 sm:p-5"><h4 className="font-semibold">Topics to strengthen</h4>{readiness.weakTopics.length ? <div className="mt-3 flex flex-wrap gap-2">{readiness.weakTopics.map((topic) => <span key={topic} className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900">{topic}</span>)}</div> : <p className="mt-2 text-sm text-black/45">No weak topics yet. Keep practicing to build a useful picture.</p>}</div>
              <div className="rounded-xl bg-white p-4 sm:p-5"><div className="mb-3 flex items-center justify-between"><h4 className="font-semibold">Today’s plan</h4><span className="text-xs text-black/40">3 tasks</span></div><div className="space-y-2">{readiness.dailyPlan.map((item, index) => <button key={item.id} onClick={() => navigate(item.href)} className="flex w-full items-center gap-3 rounded-lg border border-black/6 p-3 text-left hover:bg-black/[0.025]"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black text-xs font-semibold text-white">{index + 1}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{item.title}</span><span className="block truncate text-xs text-black/45">{item.description}</span></span><FiArrowUpRight className="shrink-0 text-black/40"/></button>)}</div></div>
            </div>
          </>}
        </section>

        <div className='grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5 md:gap-3'>

          <Statbox
            label="Total Interviews"

            value={stats?.totalInterviews}

            subHighlight="All Time"

            sub="Interviews Created"

            index={0}
          />

          <Statbox

            label="Questions Solved"

            value={stats?.totalQuestions}

            subHighlight="Answered"

            sub="Across All Interviews"

            index={1}

          />



          <Statbox

            label="Completed"

            value={stats?.completed}

            subHighlight={`${stats?.totalInterviews || 0} Total`}

            sub="Interviews Finished"

            index={2}

          />



          <Statbox

            label="Average Score"

            value={`${Math.round(stats?.averageScore || 0)}/100`}

            subHighlight="Completed Only"

            sub="Average Performance"

            index={3}

          />


        </div>

        <motion.div  
        initial={{ opacity: 0 }}

          animate={{ opacity: 1 }}

          transition={{ duration: 0.4, delay: 0.3 }}

          className="mb-3 md:mb-4">

            <p className='text-black/40 text-[10px] font-semibold uppercase tracking-widest mt-2.5 mb-1'>
            Performance</p>

            <h3 className='text-[#0A0A0A] font-bold text-sm md:text-base mb-3 md:mb-4'>Interview History</h3>

        </motion.div>

        

          <InterviewGraph
          technicalData={technicalData}
          technicalCount={technicalCount}
          hrData={hrData}
          hrCount={hrCount}
          />
        

      </motion.main>



    </div>
  )
}

export default Dashboard
