# Use Node 18 LTS slim
FROM node:18-slim

# Create app directory
WORKDIR /usr/src/app

# Copy package files first for cached install
COPY package*.json ./

# Install production dependencies
RUN npm ci --omit=dev

# Copy rest of source
COPY . .

# Expose Cloud Run port
ENV PORT 8080
EXPOSE 8080

# Start the server
CMD ["node", "index.js"]
