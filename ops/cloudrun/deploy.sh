#!/usr/bin/env bash
set -Eeuo pipefail

: "${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
: "${GCP_REGION:?Set GCP_REGION}"
: "${GCP_ARTIFACT_REPOSITORY:?Set GCP_ARTIFACT_REPOSITORY}"
: "${GCP_RUNTIME_SERVICE_ACCOUNT:?Set GCP_RUNTIME_SERVICE_ACCOUNT}"
: "${GCP_SCHEDULER_SERVICE_ACCOUNT:?Set GCP_SCHEDULER_SERVICE_ACCOUNT}"
: "${FRONTEND_URL:?Set FRONTEND_URL to the exact Vercel origin}"
: "${FIREBASE_PROJECT_ID:?Set FIREBASE_PROJECT_ID}"
: "${DEPLOY_IMAGE_TAG:?Set DEPLOY_IMAGE_TAG to the commit SHA}"
: "${GROQ_MODEL:=qwen/qwen3.8-27b}"
: "${EMAIL_PROVIDER:=none}"

registry="${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${GCP_ARTIFACT_REPOSITORY}"
image_tag="${DEPLOY_IMAGE_TAG}"

USE_CLOUD_BUILD="${USE_CLOUD_BUILD:-0}"

build_push() {
  local name="$1" dockerfile="$2" context="$3"
  local image="${registry}/fresherai-${name}:${image_tag}"
  local rel="${dockerfile#"${context}"/}"
  if [[ "$USE_CLOUD_BUILD" == "1" ]]; then
    echo "Cloud Build: ${image} (Dockerfile ${rel})"
    gcloud builds submit "$context" --project "$GCP_PROJECT_ID" --timeout=1200s --quiet --config=/dev/stdin <<EOF
steps:
- name: gcr.io/cloud-builders/docker
  args: ["build", "-f", "${rel}", "-t", "${image}", "."]
images:
- ${image}
options:
  logging: CLOUD_LOGGING_ONLY
EOF
    return
  fi
  docker build -f "$dockerfile" "$context" -t "$image"
  docker push "$image"
}

deploy_private() {
  local name="$1" memory="$2" secrets="$3" env_vars="${4:-}"
  local image="${registry}/fresherai-${name}:${image_tag}"
  local args=(run deploy "fresherai-${name}" --image "$image" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --platform managed --no-allow-unauthenticated --min 0 --max 2 --cpu 1 --memory "$memory" --timeout 300 --concurrency 20 --service-account "$GCP_RUNTIME_SERVICE_ACCOUNT" --set-secrets "$secrets" --set-env-vars "NODE_ENV=production${env_vars:+,${env_vars}}" --quiet)
  gcloud "${args[@]}"
}

for service in gateway auth resume interview roadmap progress billing practice career; do
  case "$service" in
    gateway) build_push "$service" backend/gateway/Dockerfile backend ;;
    *) build_push "$service" "backend/services/${service}/Dockerfile" backend ;;
  esac
done

common_secrets="MONGODB_URL=MONGODB_URL:latest,REDIS_URL=REDIS_URL:latest"
llm_secrets="${common_secrets},GROQ_API_KEY=GROQ_API_KEY:latest"

deploy_private auth 512Mi "${common_secrets},FIREBASE_CLIENT_EMAIL=FIREBASE_CLIENT_EMAIL:latest,FIREBASE_PRIVATE_KEY=FIREBASE_PRIVATE_KEY:latest" "FRONTEND_URL=${FRONTEND_URL},FIREBASE_PROJECT_ID=${FIREBASE_PROJECT_ID}"
deploy_private resume 1Gi "$llm_secrets" "GROQ_MODEL=${GROQ_MODEL}"
deploy_private interview 1Gi "$llm_secrets" "GROQ_MODEL=${GROQ_MODEL}"
deploy_private roadmap 512Mi "$llm_secrets" "GROQ_MODEL=${GROQ_MODEL}"
deploy_private progress 512Mi "$common_secrets"
deploy_private billing 512Mi "${common_secrets},RAZORPAY_KEY_ID=RAZORPAY_KEY_ID:latest,RAZORPAY_KEY_SECRET=RAZORPAY_KEY_SECRET:latest,RAZORPAY_WEBHOOK_SECRET=RAZORPAY_WEBHOOK_SECRET:latest"
deploy_private practice 512Mi "$common_secrets"

career_secrets="$llm_secrets"
if [[ "$EMAIL_PROVIDER" == "resend" ]]; then
  career_secrets="${career_secrets},RESEND_API_KEY=RESEND_API_KEY:latest"
fi
deploy_private career 1Gi "$career_secrets" "GROQ_MODEL=${GROQ_MODEL},EMAIL_PROVIDER=${EMAIL_PROVIDER}${EMAIL_FROM:+,EMAIL_FROM=${EMAIL_FROM}}"

service_url() {
  gcloud run services describe "fresherai-$1" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format='value(status.url)'
}

progress_url="$(service_url progress)"
roadmap_url="$(service_url roadmap)"
career_url="$(service_url career)"

# The gateway and Cloud Scheduler use this runtime identity to invoke private services.
for service in auth resume interview roadmap progress billing practice career; do
  gcloud run services add-iam-policy-binding "fresherai-${service}" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --member="serviceAccount:${GCP_RUNTIME_SERVICE_ACCOUNT}" --role=roles/run.invoker --quiet
done

upsert_scheduler_job() {
  local name="$1" schedule="$2" uri="$3"
  local audience="${uri%%/internal/*}"
  local args=(--project "$GCP_PROJECT_ID" --location "$GCP_REGION" --schedule "$schedule" --time-zone UTC --uri "$uri" --http-method POST --oidc-service-account-email "$GCP_SCHEDULER_SERVICE_ACCOUNT" --oidc-token-audience "$audience" --attempt-deadline 180s --max-retry-attempts 3 --max-backoff 3600s --quiet)
  if gcloud scheduler jobs describe "$name" --project "$GCP_PROJECT_ID" --location "$GCP_REGION" >/dev/null 2>&1; then
    gcloud scheduler jobs update http "$name" "${args[@]}"
  else
    gcloud scheduler jobs create http "$name" "${args[@]}"
  fi
}

for service in progress roadmap career; do
  gcloud run services add-iam-policy-binding "fresherai-${service}" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --member="serviceAccount:${GCP_SCHEDULER_SERVICE_ACCOUNT}" --role=roles/run.invoker --quiet
done
upsert_scheduler_job fresherai-progress-drain "*/5 * * * *" "${progress_url}/internal/events/drain"
upsert_scheduler_job fresherai-roadmap-drain "*/5 * * * *" "${roadmap_url}/internal/events/drain"
upsert_scheduler_job fresherai-career-reminders "0 * * * *" "${career_url}/internal/reminders/run"

gateway_env="FRONTEND_URL=${FRONTEND_URL},AUTH_SERVICE_URL=$(service_url auth),RESUME_SERVICE_URL=$(service_url resume),INTERVIEW_SERVICE_URL=$(service_url interview),ROADMAP_SERVICE_URL=$(service_url roadmap),PROGRESS_SERVICE_URL=${progress_url},PRACTICE_SERVICE_URL=$(service_url practice),CAREER_SERVICE_URL=${career_url},BILLING_SERVICE_URL=$(service_url billing)"
gateway_image="${registry}/fresherai-gateway:${image_tag}"
gcloud run deploy fresherai-gateway --image "$gateway_image" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --platform managed --allow-unauthenticated --min 0 --max 2 --cpu 1 --memory 512Mi --timeout 300 --concurrency 40 --service-account "$GCP_RUNTIME_SERVICE_ACCOUNT" --set-secrets "$common_secrets" --set-env-vars "NODE_ENV=production,${gateway_env}" --quiet

gateway_url="$(service_url gateway)"
echo "Cloud Run gateway deployed at ${gateway_url}"
echo "Set VITE_BACKEND_URL=${gateway_url} in the Vercel project and redeploy the frontend."
