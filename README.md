# TripCraft - Premium AI Agent Travel Planner

TripCraft is a stunning, glassmorphic dark-mode web application designed to act as an AI Travel Planner. Built on a React (Vite) frontend and a Node.js Express backend, it provides seamless travel itineraries, geolocated sight maps using Leaflet.js, lodging cost meters, culinary highlights, authentic souvenirs, and train ticket searches via IRCTC (RapidAPI or AI simulation fallback).

---

## Key Features
*   **Dual Request AI Flow:** Separates fast geocoding and metadata collection (Call 1) from progressive chunk-based travel guide streaming (Call 2) for an instantly interactive and engaging UX.
*   **Interactive Dark-Theme Map:** Integrates Leaflet.js with CartoDB Dark Matter tiles, geocoding coordinates of stations and local attractions automatically.
*   **Live IRCTC Trains & Fare Checks:** Connects to RapidAPI's `TrainsBetweenStations V3` and `Get Fare` endpoints, featuring a smart hybrid fare-checker that computes estimates to save API quotas and fetches live rates on-demand.
*   **Progressive Text Streaming:** Streams Markdown text chunk-by-chunk using Chunked Transfer Encoding.
*   **Containerized & AWS Ready:** Packaged in a compact, multi-stage Docker image and ready for zero-downtime AWS deployments.

---

## Getting Started

### Prerequisites
*   Node.js (v18 or higher)
*   NPM
*   Docker (Optional, for containerized run)

### Environment Setup
Create a `.env` file in the project root (you can copy `.env.example`):
```bash
cp .env.example .env
```
Provide your API credentials:
*   `GEMINI_API_KEY`: Obtain this from Google AI Studio.
*   `RAPIDAPI_KEY`: Obtain this from your RapidAPI Dashboard after subscribing to the IRCTC API.

---

## Running Locally

### 1. Developer Mode (Hot Reloading Frontend)
For local development, we run the frontend Vite dev server and the backend Express server side-by-side.

*   **Step 1:** Start the Express backend server:
    ```bash
    npm start
    ```
    *(Starts the backend API on port `8080`)*

*   **Step 2:** Start the React Vite frontend development server:
    ```bash
    npm run dev
    ```
    *(Starts the React dev server on port `5173` with proxying to backend)*

### 2. Production Mode (Single Port Serving)
To test the production build locally as it will behave in the Docker container:

```bash
# 1. Compile the React frontend
npm run build

# 2. Run the Express production server
npm start
```
Open [http://localhost:8080](http://localhost:8080) to access the app.

---

## Running with Docker

You can run the full-stack app inside a single Docker container:

### Using Docker Compose (Recommended)
```bash
docker-compose up --build
```

### Using Raw Docker CLI
```bash
# Build the container
docker build -t tripcraft .

# Run the container (injects credentials from your local .env file)
docker run -p 8080:8080 --env-file .env tripcraft
```
Open [http://localhost:8080](http://localhost:8080) in your browser.

---

## Deploying to AWS

### Option 1: AWS App Runner (Recommended - Direct Container)
AWS App Runner is the easiest way to deploy containerized web apps directly.

1.  Push your code to a GitHub repository.
2.  Go to the **AWS App Runner Console** and click **Create service**.
3.  Set the repository type to **GitHub** and connect your repo.
4.  Configure the build:
    *   **Runtime:** `Docker`
    *   **Port:** `8080`
5.  In the configuration, add the environment variables:
    *   `GEMINI_API_KEY`: `your_actual_key`
    *   `RAPIDAPI_KEY`: `your_actual_key`
6.  Click **Deploy**. AWS will automatically build your Dockerfile and assign a public HTTPS URL.

### Option 2: AWS Elastic Beanstalk (Docker Platform)
1.  Initialize Beanstalk inside the directory:
    ```bash
    eb init -p docker tripcraft
    ```
2.  Set up environment configurations:
    ```bash
    eb create tripcraft-env
    ```
3.  Add environment variables in the AWS Elastic Beanstalk console under **Configuration > Updates and Deployments > Environment Properties**:
    *   `GEMINI_API_KEY`
    *   `RAPIDAPI_KEY`
4.  Deploy updates:
    ```bash
    eb deploy
    ```
