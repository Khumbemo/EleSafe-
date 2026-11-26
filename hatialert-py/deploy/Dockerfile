# HatiAlert server image: Python standard library only, no pip installs.
#
# Build from the hatialert-py folder (compose.yaml does this for you):
#   docker build -f deploy/Dockerfile -t hatialert .
#
# The base image is pinned by version AND digest so a rebuild gives the same
# Python. To update: look up the newest python:3.14.x-slim-trixie on Docker Hub,
# replace both the tag and the digest, rebuild, run the tests.
FROM python:3.14.10-slim-trixie@sha256:9aaa474097d094040649f2162a627c0049b408f52138d980916788d80f04802f

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Unprivileged user with a fixed id (10001), so a bind-mounted data folder can be
# chowned to it on the host: chown -R 10001:10001 /srv/hatialert-data
RUN groupadd --system --gid 10001 hatialert \
 && useradd --system --uid 10001 --gid hatialert --no-create-home \
            --home-dir /nonexistent --shell /usr/sbin/nologin hatialert \
 && mkdir -p /data/backups \
 && chown -R hatialert:hatialert /data \
 && chmod 0700 /data /data/backups

WORKDIR /app
# Only the server package (code + built web app); not tests, tools or web-ts.
COPY hatialert/ /app/hatialert/
COPY --chmod=0755 deploy/entrypoint.sh /usr/local/bin/hatialert-entrypoint
# Compile once as root so the app never needs to write into /app.
RUN python -m compileall -q /app/hatialert

USER hatialert:hatialert
# SQLite database (with photos and voice notes) and automatic backups.
VOLUME ["/data"]
EXPOSE 8000
# Python turns SIGINT into a clean shutdown even as PID 1; SIGTERM would be ignored.
STOPSIGNAL SIGINT
# /api/meta needs no sign-in and reads the database, so it proves the app and DB work.
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --start-interval=2s --retries=3 \
  CMD ["python", "-c", "import urllib.request as u; u.urlopen('http://127.0.0.1:8000/api/meta', timeout=4)"]

ENTRYPOINT ["hatialert-entrypoint"]
CMD ["serve"]
