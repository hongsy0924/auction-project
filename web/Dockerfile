# syntax = docker/dockerfile:1

# Adjust NODE_VERSION as desired
# Adjust NODE_VERSION as desired
ARG NODE_VERSION=22-alpine
FROM node:${NODE_VERSION} AS base

LABEL fly_launch_runtime="Next.js"

# Next.js app lives here
WORKDIR /app

# Set production environment
ENV NODE_ENV="production"



# Throw-away build stage to reduce size of final image
FROM base AS build

# Install packages needed to build node modules
RUN apk add --no-cache build-base python3

# Install node modules
COPY package-lock.json package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production=false

# Copy application code
COPY . .

# Build application
RUN npx next build --experimental-build-mode compile

# Remove development dependencies
RUN yarn install --production=true


# Final stage for app image
FROM base

# Copy built application
COPY --from=build /app /app

# Setup sqlite3 on a separate volume
RUN mkdir -p /data
VOLUME /data

# Entrypoint sets up the container.
ENTRYPOINT [ "/app/docker-entrypoint.js" ]

# Start the server by default, this can be overwritten at runtime
EXPOSE 3000
ENV DATABASE_URL="file:///data/sqlite.db"
ENV HOSTNAME="0.0.0.0"
CMD [ "yarn", "run", "start" ]
