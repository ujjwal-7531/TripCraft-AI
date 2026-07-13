# --- Stage 1: Build the React Application ---
FROM node:20-alpine AS builder
WORKDIR /app

# Copy package descriptors
COPY package*.json ./

# Install dependencies (ignoring peer-deps conflicts due to React 19)
RUN npm install --legacy-peer-deps

# Copy application source
COPY . .

# Compile the React application (generates /dist folder)
RUN npm run build

# --- Stage 2: Production Runtime ---
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV NODE_OPTIONS=--dns-result-order=ipv6first

# Copy package descriptors
COPY package*.json ./

# Install only production dependencies (Express, Gemini SDK, dotenv, cors)
RUN npm install --omit=dev --legacy-peer-deps

# Copy backend server file and the built frontend folder
COPY server.js ./
COPY --from=builder /app/dist ./dist

# Expose server port
EXPOSE 8080

# Start server (uses NODE_OPTIONS from package.json start script)
CMD ["npm", "start"]
