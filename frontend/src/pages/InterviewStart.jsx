import Step1setup from '../components/interview/Step1setup'
import { useNavigate } from 'react-router-dom'

function InterviewStart({user , setUser}) {
  const navigate = useNavigate()
  return <><div className="fixed right-4 top-4 z-20 flex gap-2"><button onClick={() => navigate('/interview/design')} className="rounded-lg bg-black px-3 py-2 text-xs font-semibold text-white">System design practice</button><button onClick={() => navigate('/company-packs')} className="rounded-lg border bg-white px-3 py-2 text-xs font-semibold">Company packs</button></div><Step1setup user={user} setUser={setUser}/></>
}
export default InterviewStart
