# Cloud Run deployment

This repository deploys the nine API containers (gateway plus auth, resume, interview, roadmap, billing, progress, practice, and career) as Cloud Run services. The gateway is public; every downstream API service is private and can be called only by the gateway's runtime identity or Cloud Scheduler. The React frontend stays on Vercel.

The workflow deploys only after the `test-and-build` job passes, only on pushes to `main`, and only when both `GCP_CLOUD_RUN_DEPLOY=true` and `GCP_BILLING_BUDGET_READY=true` are set as GitHub Actions variables. Leave those variables unset until the billing alert and the Google Cloud setup below are complete. The deployment uses GitHub OIDC Workload Identity Federation; no service-account key is stored in GitHub or the repository.

Fill production values in the gitignored [`.env.production`](.env.production) file (keys are listed in [`.env.production.example`](.env.production.example)). Paste secrets into Secret Manager and non-secrets into GitHub Actions variables / Vercel. Do not put a production `.env` on Cloud Run or commit filled values.

## Current free-tier limits to plan around

- Request-billed Cloud Run currently includes 2 million requests, 180,000 vCPU-seconds, and 360,000 GiB-seconds per month, aggregated across projects under a billing account. These are usage discounts, not a spending cap; storage, build, egress, scheduler, and other services can still cost money. Check [Cloud Run pricing](https://cloud.google.com/run/pricing) again before deployment.
- Atlas Free (M0) currently has 512 MB storage, 100 operations/second, 500 connections, and 10 GB inbound plus 10 GB outbound transfer per rolling 7 days. It does not provide private endpoints. See [Atlas Free cluster limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/).
- Redis Cloud Essentials Free currently has 30 MB, 30 concurrent connections, 5 GB monthly bandwidth, and 100 operations/second. The Redis Streams and cache workloads here are demo scale on that plan. See [Redis Cloud Essentials limits](https://redis.io/docs/latest/operate/rc/subscriptions/view-essentials-subscription/essentials-plan-details/).

Free-tier quotas can be shared with other projects or workloads. Keep the budget alert active, and expect cold starts because each service uses minimum instances 0 and maximum instances 2. On an idle service, allow a few seconds for the first request to wake it.

## Before the first deployment

1. In Google Cloud Console, choose the billing account and create a budget with email alerts at 50%, 90%, and 100% of your chosen monthly amount. Alternatively, after logging in with `gcloud auth login`, run `gcloud billing budgets create --billing-account=YOUR_BILLING_ACCOUNT_ID --display-name=FresherAI-Cloud-Run --budget-amount=YOUR_MONTHLY_BUDGET --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0`. This alert does not stop spending. Do not enable the workflow until the budget exists.
2. Create/select a Google Cloud project with billing enabled. Enable `run.googleapis.com`, `artifactregistry.googleapis.com`, `iamcredentials.googleapis.com`, `sts.googleapis.com`, `cloudscheduler.googleapis.com`, and `secretmanager.googleapis.com`.
3. Create a Docker Artifact Registry repository named for `GCP_ARTIFACT_REPOSITORY` in `GCP_REGION`.
4. Create an Atlas Free cluster and a Redis Cloud Free database. Use TLS Redis URL (`rediss://...`) in Secret Manager. Put the Mongo URI and Redis URI in Secret Manager secrets named `MONGODB_URL` and `REDIS_URL`. Add Mongo URI options `maxPoolSize=10&minPoolSize=0` to keep the aggregate connections bounded with multiple Cloud Run instances.
5. Atlas Free does not offer private endpoints, while Cloud Run outbound addresses are not fixed by default. For a demo, Atlas network access may require `0.0.0.0/0`; use a unique strong database password, a least-privilege database user, TLS, and the Secret Manager URI. A fixed egress IP/private network adds paid infrastructure and is outside this free-tier setup.
6. Add these other Secret Manager secrets: `GROQ_API_KEY`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET`. The payment secrets can be test-mode keys. If reminders should send email, add `RESEND_API_KEY` and set `EMAIL_PROVIDER=resend`; otherwise use `EMAIL_PROVIDER=none`.
7. Create two service accounts: a GitHub deployer and a Cloud Run runtime account. Grant the runtime account `roles/secretmanager.secretAccessor`. The deployer needs `roles/run.admin`, `roles/artifactregistry.writer`, and `roles/cloudscheduler.admin`, plus `roles/iam.serviceAccountUser` on the runtime account. The deploy script grants the runtime and scheduler identities `roles/run.invoker` on the private services.
8. Configure a GitHub OIDC Workload Identity Pool/Provider restricted to repository `DivayJainDJ/Fresher-Ai` and ref `refs/heads/main`. Grant its `principalSet` `roles/iam.workloadIdentityUser` on the deployer service account. The provider attribute mapping must include `google.subject=assertion.sub`, `attribute.repository=assertion.repository`, and `attribute.ref=assertion.ref`; its attribute condition should require the repository and main ref.
9. In GitHub repository **Settings → Secrets and variables → Actions → Variables**, add:

   | Variable | Value |
   | --- | --- |
   | `GCP_PROJECT_ID` | Project ID |
   | `GCP_REGION` | Cloud Run and Artifact Registry region |
   | `GCP_ARTIFACT_REPOSITORY` | Docker repository name |
   | `GCP_WORKLOAD_IDENTITY_PROVIDER` | Full provider resource name |
   | `GCP_DEPLOY_SERVICE_ACCOUNT` | Deployer service account email |
   | `GCP_RUNTIME_SERVICE_ACCOUNT` | Runtime service account email |
   | `GCP_SCHEDULER_SERVICE_ACCOUNT` | Runtime service account email |
   | `FRONTEND_URL` | Exact Vercel origin, e.g. `https://your-app.vercel.app` |
   | `FIREBASE_PROJECT_ID` | Firebase project ID |
   | `GROQ_MODEL` | Optional; defaults to the repo's current model |
   | `EMAIL_PROVIDER` | `none` or `resend` |
   | `EMAIL_FROM` | Optional sender address when using Resend |

10. Only after creating and checking the billing budget, set `GCP_BILLING_BUDGET_READY` to `true`. After all APIs, accounts, roles, secrets, and GitHub variables are correct, set `GCP_CLOUD_RUN_DEPLOY` to `true`.

Example WIF bootstrap (replace the project and service-account values, then run as a Google Cloud administrator after the budget exists):

```bash
PROJECT_ID="your-project-id"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
DEPLOYER="fresherai-github-deployer@${PROJECT_ID}.iam.gserviceaccount.com"
RUNTIME="fresherai-run@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud iam service-accounts create fresherai-github-deployer --project "$PROJECT_ID"
gcloud iam service-accounts create fresherai-run --project "$PROJECT_ID"
gcloud iam workload-identity-pools create github --project "$PROJECT_ID" --location global --display-name "GitHub Actions"
gcloud iam workload-identity-pools providers create-oidc github-main \
  --project "$PROJECT_ID" --location global --workload-identity-pool github \
  --issuer-uri https://token.actions.githubusercontent.com \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition="assertion.repository == 'DivayJainDJ/Fresher-Ai' && assertion.ref == 'refs/heads/main'"

for role in roles/run.admin roles/artifactregistry.writer roles/cloudscheduler.admin; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${DEPLOYER}" --role="$role"
done
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME" --project "$PROJECT_ID" --member="serviceAccount:${DEPLOYER}" --role=roles/iam.serviceAccountUser
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${RUNTIME}" --role=roles/secretmanager.secretAccessor
gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER" --project "$PROJECT_ID" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/attribute.repository/DivayJainDJ/Fresher-Ai" \
  --role=roles/iam.workloadIdentityUser
```

Use the provider full resource name shown by `gcloud iam workload-identity-pools providers describe github-main --project "$PROJECT_ID" --location global --workload-identity-pool github --format='value(name)'` as `GCP_WORKLOAD_IDENTITY_PROVIDER`. Use `DEPLOYER` as `GCP_DEPLOY_SERVICE_ACCOUNT`; use `RUNTIME` for both the runtime and scheduler variables.

## Deployment behavior

The deploy script builds and pushes all nine API images, deploys each with minimum 0, maximum 2, 1 vCPU, a 512 MiB or 1 GiB memory limit, and a 300 second request timeout, then updates the scheduler jobs and the gateway URLs. It also creates/updates:

- `fresherai-progress-drain` every 5 minutes to wake progress and drain pending/new Redis Stream events.
- `fresherai-roadmap-drain` every 5 minutes to wake the roadmap consumer and drain its independent consumer group.
- `fresherai-career-reminders` every hour to wake career and send reminders due in each user's local timezone. Mongo idempotency records and the email provider idempotency key prevent duplicate sends.

Cloud Run services remain IAM-private except the gateway. Gateway proxy requests obtain audience-bound ID tokens from the Cloud Run metadata server. CORS on the gateway and auth service is set to the exact `FRONTEND_URL` value; do not use `*` or a wildcard preview domain. The `FRONTEND_URL` value must not contain commas.

After the first successful workflow run, copy the printed gateway URL into the Vercel project's `VITE_BACKEND_URL` environment variable (no trailing slash) and redeploy the frontend. Keep the Vercel domain exact in `FRONTEND_URL`.

## Scale-to-zero and local fallback

Progress and roadmap expose private `POST /internal/events/drain` endpoints; career exposes `POST /internal/reminders/run`. Cloud Scheduler sends OIDC-authenticated requests to wake each service. The regular Redis Streams worker also starts with its service and claims pending entries. If there is no billing card or Cloud Run setup yet, leave the deployment variables unset and continue with `docker compose up --build`; the compose stack already contains all services and its local MongoDB replica set and Redis.
