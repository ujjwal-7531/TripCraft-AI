# TripCraft — AI Travel Planner

TripCraft is a premium full-stack AI travel planner for Indian routes. Enter a source and destination, and the app generates a travel overview (streamed live), an interactive Leaflet route map, live train options, local food highlights, and souvenir recommendations.

**Stack:** React (Vite) + Node.js (Express) + Google Gemini + RailRadar API

---

## For Team Members — Quick Start

Follow these steps after cloning the repo. **Each person uses their own API keys** — never share or commit them.

### 1. Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- npm (comes with Node.js)
- Git
- Docker (optional, only if you want to run via container)

### 2. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/TripCraft.git
cd TripCraft
```

### 3. Install dependencies

```bash
npm install --legacy-peer-deps
```

### 4. Set up your environment variables

Copy the example file and create your own local `.env`:

```bash
cp .env.example .env
```

Open `.env` in a text editor and add **your own** keys:

```env
PORT=8080

# Required — get from https://aistudio.google.com/apikey
GEMINI_API_KEY=your_actual_gemini_key_here

# Recommended stable model to avoid 503 high demand errors
GEMINI_MODEL=gemini-3.1-flash-lite

# Required for live Indian Railways train schedules
RAILRADAR_API_KEY=your_actual_railradar_key_here
```

> **Never commit `.env` to GitHub.** It is already listed in `.gitignore`. Only `.env.example` (with placeholders) is tracked in the repo.

### 5. Build and run

**Production mode (recommended — single port, same as Docker):**

```bash
npm run build
npm start
```

Open **http://localhost:8080** in your browser.

**Developer mode (hot reload for frontend changes):**

Terminal 1 — backend:
```bash
npm start
```

Terminal 2 — frontend dev server:
```bash
npm run dev
```

Open **http://localhost:5173** (API requests are proxied to port 8080).

### 6. Verify everything is working

Check the health endpoint:

```bash
curl http://localhost:8080/health
```

Expected response:
```json
{
  "status": "healthy",
  "geminiConfigured": true,
  "liveTrainsConfigured": true,
  "geminiModel": "gemini-3.1-flash-lite"
}
```

In the app, open **Settings** (top right) to confirm Gemini and RailRadar connection status.

---

## Getting API Keys

### Gemini API (required)

1. Go to [Google AI Studio](https://aistudio.google.com/apikey)
2. Sign in with a Google account
3. Click **Create API key**
4. Paste the key into `GEMINI_API_KEY` in your `.env`

Without this key, trip planning, overviews, and metadata will not work.

### RailRadar API (required for trains)

1. Get your API key from [RailRadar](https://railradar.in/)
2. Paste the key into `RAILRADAR_API_KEY` in your `.env`

Without this key, train schedules and fare fetching will return an error or show "No trains found".

---

## What the App Does

| Feature | Description |
|---|---|
| **Trip metadata** | Geocodes cities, finds station codes, suggests places, food, and souvenirs |
| **Overview** | Streams a randomized, creative travel summary in real time |
| **Map** | Leaflet map focusing on the source and destination route with a clear legend |
| **Trains** | Real-time intercity trains fetched directly from the RailRadar API |
| **Fares** | Live ticket fare lookups for different booking classes |
| **Souvenirs** | Local souvenir recommendations to help users find authentic gifts |

---

## Troubleshooting

| Problem | What to do |
|---|---|
| `geminiConfigured: false` in `/health` | Check `GEMINI_API_KEY` in `.env` — no placeholders, no extra spaces |
| `Gemini API quota exceeded` | Wait a few minutes or check usage at [ai.google.dev](https://ai.google.dev) |
| `Network error: cannot reach Google Gemini API` | Check internet connection; restart with `npm start` |
| `RailRadar API authentication failed` | Verify `RAILRADAR_API_KEY` and that your subscription is active |
| Port 8080 already in use | Stop the other process: `fuser -k 8080/tcp` then `npm start` |
| `npm install` peer dependency errors | Use `npm install --legacy-peer-deps` |

Error messages in the app are specific — they tell you whether **RailRadar** or **Gemini** failed and why.

---

## Running with Docker

```bash
# Build and run with docker-compose
docker-compose up --build
```

Or manually:

```bash
docker build -t tripcraft .
docker run -p 8080:8080 --env-file .env tripcraft
```

Open **http://localhost:8080**.

---

## Deploying to AWS

### AWS App Runner (recommended)

1. Push this repo to GitHub
2. In AWS App Runner → **Create service** → connect your GitHub repo
3. Set **Runtime** to Docker, **Port** to `8080`
4. Add environment variables: `GEMINI_API_KEY`, `RAILRADAR_API_KEY`, `GEMINI_MODEL`
5. Deploy — AWS provides a public HTTPS URL

### AWS Elastic Beanstalk

```bash
eb init -p docker tripcraft
eb create tripcraft-env
```

Add `GEMINI_API_KEY` and `RAILRADAR_API_KEY` under **Configuration → Environment properties**, then:

```bash
eb deploy
```

---

## Project Structure

```
TripCraft/
├── src/                  # React frontend
│   ├── App.jsx           # Main UI
│   └── components/       # Map and other components
├── server.js             # Express backend + API routes
├── .env.example          # Environment template (safe to commit)
├── .env                  # Your secrets (NEVER commit)
├── Dockerfile            # Container build
├── docker-compose.yml    # Local Docker setup
├── package.json          # Dependencies and scripts
└── README.md             # Documentation
```

---

## API Routes (for reference)

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/health` | Server and API key status |
| `POST` | `/api/trip-meta` | Structured trip metadata (JSON) |
| `POST` | `/api/stream-itinerary` | Streaming travel overview (markdown) |
| `GET` | `/api/trains` | Live trains list from RailRadar |
| `GET` | `/api/fare` | Ticket fare for a train class |

---

## Security Reminders for the Team

- **Do not** put API keys in frontend code
- **Do not** commit `.env` — use `.env.example` as the template only
- **Do not** share keys in chat, screenshots, or pull requests
- If a key is accidentally pushed to GitHub, **revoke it immediately** and generate a new one

---

## License

This project is for educational / team use. Add a license file if needed before public distribution.
