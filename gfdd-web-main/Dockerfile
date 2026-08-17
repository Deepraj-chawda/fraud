# Stage 1: Build the React application
FROM node:22 AS build

WORKDIR /app

# Increase memory limit for Node.js to prevent out-of-memory errors during npm install
ENV NODE_OPTIONS=--max-old-space-size=4096

# Clean npm cache and configure npm
RUN npm cache clean --force && \
    npm config set registry https://registry.npmjs.org/

# Copy package.json and package-lock.json
COPY package*.json ./

# Using npm install instead of npm ci to bypass package-lock.json
RUN npm install --no-package-lock --include=dev

# Copy the rest of the application source code
COPY . .

# Build the application
RUN npm run build

# Stage 2: Serve the application using Nginx
FROM nginx:stable-alpine

# Copy the built assets from the build stage
COPY --from=build /app/dist /usr/share/nginx/html

# Copy the nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

# Start Nginx
CMD ["nginx", "-g", "daemon off;"]
