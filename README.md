```markdown
# BLACKGIFT AI

BLACKGIFT AI is a Shona-speaking chatbot that uses OpenAI to generate replies. This repository is configured for production-ready deployment:
- Redis-backed sessions (connect-redis + ioredis)
- Firebase Authentication (Google Sign-In) with server-side verification (Firebase Admin)
- Persistent per-user conversation history in Firestore
- Token usage accounting and history trimming (gpt-3-encoder)
- Dockerfile, Render service config (render.yaml), and GitHub Actions CI example

This README focuses on deployment steps so you can deploy BLACKGIFT AI quickly.

Important security reminder
- NEVER commit secret keys (OpenAI key, Firebase service account JSON, Redis passwords) to the repo.
- If you exposed secrets earlier, rotate/revoke them now.

1) Prepare secrets & prerequisites
- OpenAI API key: create one in the OpenAI dashboard and keep it secret.
- Firebase:
  - Use the given client config in `public/firebase-config.js` (public info).
  - For server-side ID token verification, create a Firebase service account JSON from Firebase Console -> Project Settings -> Service accounts -> Generate new private key.
  - Save this JSON securely and set the environment variable GOOGLE_APPLICATION_CREDENTIALS to point to it on your server (or load it via your platform's secret file mechanism).
- Redis:
  - Provision a managed Redis instance (recommended) and get the REDIS_URL (e.g., redis://:password@host:6379).
- Docker registry (optional): For CI pushing images, configure DOCKERHUB_USERNAME and DOCKERHUB_TOKEN as GitHub repository secrets or use your preferred registry.

2) Environment variables (required for any deploy)
Set these in your hosting platform or container runtime:
- OPENAI_API_KEY (required)
- SESSION_SECRET (required)
- REDIS_URL (required for production)
- GOOGLE_APPLICATION_CREDENTIALS (or set admin credentials via your platform)
Optional:
- HISTORY_MAX_TOKENS (default 3000)
- DOCKERHUB_USERNAME / DOCKERHUB_TOKEN (for CI)

3) Quick local test (not production)
- Install dependencies:
  npm install
- Create a `.env` from `.env.example` and set keys (for local dev you can run Redis locally).
- Start:
  npm start
- Visit: http://localhost:3000

4) Deploy to Render (recommended quick path)
- Create a Render account and connect your GitHub repo.
- Create a new Web Service:
  - Environment: Node
  - Build Command: npm install
  - Start Command: npm start
- In the Render dashboard for your service, add environment variables:
  - OPENAI_API_KEY
  - SESSION_SECRET
  - REDIS_URL
  - GOOGLE_APPLICATION_CREDENTIALS (see notes below)
- Redis: add a managed Redis service on Render (or use an external Redis provider) and use the provided REDIS_URL.
- Firebase service account: Render supports "Files" or you can set the JSON contents in a secret and write a small start script to write it to a file and set GOOGLE_APPLICATION_CREDENTIALS accordingly. Alternatively, if you're using Google Cloud, you can set appropriate IAM roles and metadata.
- Deploy: Render will auto-deploy on push. Ensure you set the env vars before starting.

5) Deploy to Railway
- Create a Railway project and connect the repo.
- Add the Environment Variables (OPENAI_API_KEY, SESSION_SECRET, REDIS_URL, etc).
- Add Redis plugin on Railway and set REDIS_URL.
- Deploy via Railway dashboard (or `railway up` locally if you have CLI configured).

6) Docker + self-host or other platforms
- Build:
  docker build -t blackgift-ai:latest .
- Run (example):
  docker run -e OPENAI_API_KEY="sk-..." -e SESSION_SECRET="..." -e REDIS_URL="redis://..." -p 3000:3000 blackgift-ai:latest

7) GitHub Actions CI (example included)
- The workflow in `.github/workflows/ci-cd.yml` builds and pushes a Docker image to Docker Hub.
- Add repository secrets:
  - DOCKERHUB_USERNAME
  - DOCKERHUB_TOKEN
- After image is pushed you can configure Render to automatically deploy from the Docker registry image, or use Render's GitHub integration to deploy from the repo.

8) Post-deploy checks
- Verify Redis connectivity in server logs.
- Verify Firebase Admin initialization (server logs show "Firebase Admin initialized.").
- Make a signed-in Google login in the web UI to ensure authenticated histories are stored in Firestore.
- Use /api/usage to see token usage per user (authenticated).

9) Notes & recommended production improvements
- Use Redis with TLS and credentials.
- Use a secure session secret and restrict cookie options for your domain.
- Implement rate-limiting and per-user quotas to avoid cost surprises.
- Consider using tiktoken for more accurate token accounting.
- Store service account files in a secure secrets manager or platform-provided file store.

10) Where to change the app name & branding
- App name is set to BLACKGIFT AI in server logs and system prompt. Change SYSTEM_PROMPT inside server.js if you want to alter phrasing.

If you'd like, I will:
- Add an automated Render deployment step in GitHub Actions (requires Render service key from you).
- Convert token accounting to tiktoken for higher accuracy.
- Add server-side rate limiting and per-user monthly caps integrated with Firestore billing.

You can now follow the Render or Railway steps above to deploy BLACKGIFT AI. Good luck!
```