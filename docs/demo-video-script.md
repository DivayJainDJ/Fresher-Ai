# FresherAI demo video script (2–3 minutes)

Record only scenes for features that work in the selected demo environment. Remove any measured claim unless its linked result report exists. The first 30 seconds should show the working product, before narration about architecture.

| Time | Scene | Show | Narration |
|---|---|---|---|
| 0:00 | Hook | Landing page and sign-in | “FresherAI helps graduates prepare for technical interviews with AI.” |
| 0:15 | Resume feedback | Upload a synthetic/sample PDF and show completed score | “Resume analysis runs as a background job, so the page stays responsive.” |
| 0:40 | Mock interview | Start a session and show feedback; show token streaming only if verified in the browser | “Practice interviews and get feedback on each answer.” |
| 1:05 | Practice and progress | Quiz, SQL practice, and readiness dashboard if populated | “Practice activity contributes to your progress view.” |
| 1:30 | Architecture | Show `docs/architecture.svg` | “The gateway routes requests to independent services, with Redis and MongoDB supporting shared state.” |
| 1:50 | Evidence | Show an actual generated load-test report or green CI run | State only recorded measurements; otherwise omit this scene. |
| 2:10 | Recovery | Show a real worker retry/recovery run if captured | “Queued work can retry after a worker interruption.” Only say this after recording evidence. |
| 2:25 | Close | Repository and configured live demo, if available | “The source code and demo are linked here.” |

## Recording checklist

- Use a clean browser profile at 110–125% zoom, disable notifications, and seed a demo account with synthetic data.
- Capture short scenes at 1080p/30 fps with OBS Studio or Loom; record voice in a quiet room with a headset.
- Edit pauses and add captions; keep the final cut below three minutes.
- Capture a 10–15 second GIF under 10 MB using Kap on macOS or ScreenToGif on Windows. Put the final files in `docs/` and link the unlisted video in the README.
- Never include API keys, private resume data, or a real user's account details in the recording.
