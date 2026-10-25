const FILLER_PATTERNS = [
  ["um", /\bum+\b/gi],
  ["uh", /\buh+\b/gi],
  ["like", /\blike\b/gi],
  ["you know", /\byou\s+know\b/gi],
  ["basically", /\bbasically\b/gi],
  ["actually", /\bactually\b/gi],
]

export const countFillerWords = (transcript = "") => FILLER_PATTERNS.flatMap(([word, pattern]) =>
  [...transcript.matchAll(pattern)].map((match) => ({ word, index: match.index })),
).sort((a, b) => a.index - b.index).map(({ word }) => word)

export const calculateDeliveryMetrics = (transcript = "", startedAt = null, endedAt = null, timestamps = []) => {
  const words = transcript.trim() ? transcript.trim().split(/\s+/).length : 0
  const elapsedMs = startedAt && endedAt ? Math.max(0, endedAt - startedAt) : 0
  const wordsPerMinute = elapsedMs > 0 ? Math.round(words * 60_000 / elapsedMs) : 0
  const orderedTimes = timestamps.filter(Number.isFinite).sort((a, b) => a - b)
  let longestPauseMs = 0
  for (let index = 1; index < orderedTimes.length; index += 1) {
    longestPauseMs = Math.max(longestPauseMs, orderedTimes[index] - orderedTimes[index - 1])
  }
  const fillers = countFillerWords(transcript)
  return {
    wordsPerMinute,
    fillerCount: fillers.length,
    fillerWords: fillers,
    longestPauseMs: Math.round(longestPauseMs),
    answerLength: words,
  }
}

export const deliveryTip = (metrics = {}) => {
  if ((metrics.fillerCount || 0) > 2) return "Pause briefly instead of using filler words to connect ideas."
  if ((metrics.wordsPerMinute || 0) > 170) return "Slow down slightly and add a short pause between key points."
  if ((metrics.wordsPerMinute || 0) > 0 && metrics.wordsPerMinute < 100) return "Use a steady, conversational pace and finish each thought clearly."
  if ((metrics.longestPauseMs || 0) > 3000) return "Use a short outline to keep your answer moving through each point."
  return "Keep practicing at this measured pace and use pauses to emphasize key points."
}
