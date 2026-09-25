import { useState } from "react";
import { FiX } from "react-icons/fi";
import { motion } from "motion/react"
import { FcGoogle } from "react-icons/fc";
import { signInWithPopup } from 'firebase/auth';
import { auth, provider } from '../utils/firebase';
import { loginWithFirebaseToken } from "../apis/user.api";
function LoginModel({ onClose ,setUser}) {
    const [errorMsg, setErrorMsg] = useState("")
    const [loading, setLoading] = useState(false)

    const describeError = (error) => {
        // Firebase blocks the SAME browser after repeated sign-in
        // attempts in a short window — this is Google's own rate
        // limiting, not our backend, and clears on its own.
        if (error?.code === "auth/too-many-requests") {
            return "Too many sign-in attempts from this browser. Please wait a minute and try again."
        }
        if (error?.code === "auth/unauthorized-domain") {
            return "Google sign-in is not allowed on this domain yet. Add this frontend domain to Firebase Authorized Domains."
        }
        if (error?.code === "auth/popup-closed-by-user" || error?.code === "auth/cancelled-popup-request") {
            return "" // user just closed the popup, not a real error
        }
        if (error?.response?.status === 429 || error?.friendlyMessage) {
            return error.friendlyMessage || "Server is a little busy right now. Please try again in a few seconds."
        }
        if (!error?.response && error?.code?.startsWith?.("auth/") === false && error?.message?.toLowerCase?.().includes("network")) {
            return "Couldn't reach the server. It may be waking up — please try again shortly."
        }
        return error?.message || "Google sign-in failed. Please try again."
    }

    const handleGoogleAuth = async () => {
        setErrorMsg("")
        setLoading(true)
        try {
            provider.setCustomParameters({ prompt: "select_account" })
            const result = await signInWithPopup(auth , provider)
            const token = await result.user.getIdToken()

            const response = await loginWithFirebaseToken(token)
          
            setUser(response?.user)
            onClose()
        } catch (error) {
            console.log(error)
            const message = describeError(error)
            if (message) setErrorMsg(message)
        } finally {
            setLoading(false)
        }
    }


    return (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md px-4'>
            <div className='relative w-full max-w-sm
        bg-[#0A0A0A]/80 backdrop-blur-2xl
        border border-white/10
        rounded-2xl
        overflow-hidden
        shadow-[0_8px_32px_rgba(0,0,0,0.25)]'>

                <div className='absolute inset-0 bg-gradient-to-br from-white/[0.08] via-transparent to-transparent pointer-events-none' />

                <div className='relative p-7'>
                    <button
                        onClick={onClose}
                        className='absolute top-4 right-4
              text-white/30 hover:text-white
              transition-colors'><FiX size={16} /></button>

                    <h2 className='text-lg font-bold text-center mb-2 text-white'>
                        Sign In to {" "}
                        <span className='font-extrabold text-lg tracking-tight text-white'>FresherAI</span>
                    </h2>
                    <p className='text-white/45 text-center text-xs'>
                        Continue your AI interview journey
                    </p>

                    <div className='mt-7'>
                        <motion.button
                        onClick={handleGoogleAuth}
                            disabled={loading}
                            whileHover={{ scale: loading ? 1 : 1.04 }}
                            whileTap={{ scale: loading ? 1 : 0.97 }}
                            className='w-full flex items-center justify-center gap-3 py-3 rounded-xl border border-white/15 bg-white/10 backdrop-blur-md hover:border-white/25 hover:bg-white/[0.14] shadow-inner transition-all disabled:opacity-60 disabled:cursor-not-allowed'
                        >
                            <FcGoogle size={18}/>
                            <span className='text-white font-medium text-sm'>
                                {loading ? "Signing in..." : "Continue with Google"}
                            </span>


                        </motion.button>
                        {errorMsg && (
                            <p className='mt-3 text-center text-xs text-red-400/90 leading-relaxed'>
                                {errorMsg}
                            </p>
                        )}
                    </div>
                </div>

                <div className='relative border-t border-white/10 bg-black/30 p-4 text-center'>
                <p className='text-white/30 text-xs'>
                Secure authentication powered by Firebase
                </p>
                </div>




            </div>

        </div>
    )
}

export default LoginModel
