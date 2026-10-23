# syntax=docker/dockerfile:1
# BetterMyAdmin: one Node process serving the API and the built web app.
#
#   docker build -t bettermyadmin .
#   docker run -p 8080:80 -e PMA_HOST=mysql bettermyadmin
#
# The official phpMyAdmin image's variables work unchanged (PMA_HOST, PMA_PORT, PMA_ARBITRARY,
# PMA_USER / PMA_PASSWORD, PMA_PMADB, PMA_ABSOLUTE_URI, UPLOAD_LIMIT, … and their *_FILE secrets),
# see packages/config/src/docker-env.ts; BMA__<Directive> variables and a mounted
# /etc/bettermyadmin/bettermyadmin.config.{ts,js,mjs,json,yaml,yml} take precedence over them.
#
# Behind a TLS-intercepting proxy, pass its CA for the package downloads (optional):
#   docker build --secret id=ca,src=/path/to/ca.pem -t bettermyadmin .
ARG NODE_IMAGE=node:22.23.4-bookworm-slim

FROM ${NODE_IMAGE} AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN --mount=type=secret,id=ca,required=false NODE_EXTRA_CA_CERTS=/run/secrets/ca pnpm install --frozen-lockfile
RUN pnpm --filter @bettermyadmin/web build

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
RUN corepack enable
# manifests first: the production dependencies of the server and the workspace packages it uses
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/apps/server ./apps/server
COPY --from=build /app/apps/web/package.json ./apps/web/package.json
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/packages ./packages
COPY --from=build /app/tools ./tools
RUN --mount=type=secret,id=ca,required=false NODE_EXTRA_CA_CERTS=/run/secrets/ca \
    pnpm install --frozen-lockfile --prod --filter "@bettermyadmin/server..." \
 && rm -rf /root/.cache /root/.local/share/pnpm \
 # the image's configuration directory: an empty config file closes /setup like the
 # phpMyAdmin image's config.inc.php; mount your own over it (or next to it, .ts/.js/.mjs win)
 && mkdir -p /etc/bettermyadmin /var/lib/bettermyadmin /etc/phpmyadmin/ssl \
 && echo '{}' > /etc/bettermyadmin/bettermyadmin.config.json \
 # PMA_SSL_*_BASE64 are decoded into PMA_SSL_DIR (default /etc/phpmyadmin/ssl) by the server's user
 && chown node:node /var/lib/bettermyadmin /etc/phpmyadmin/ssl \
 && chmod 700 /etc/phpmyadmin/ssl
ENV NODE_ENV=production \
    BMA_DOCKER=1
WORKDIR /etc/bettermyadmin
USER node
# sessions, the generated blowfish_secret and the local metadata store
VOLUME /var/lib/bettermyadmin
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.APACHE_PORT||80)+'/api/meta/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "/app/apps/server/bin/bettermyadmin.mjs"]
