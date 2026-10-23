# Backup/restore tooling (ADR 0025). Client version must match the server: PostgreSQL 16.
FROM postgres:16-alpine
RUN apk add --no-cache openssl
COPY deploy/backup/backup.sh deploy/backup/restore.sh deploy/backup/backup-loop.sh \
     deploy/backup/healthcheck.sh deploy/backup/selftest.sh deploy/backup/rto-drill.sh /usr/local/bin/
RUN chmod 0755 /usr/local/bin/*.sh && mkdir -p /backups
VOLUME ["/backups"]
CMD ["backup-loop.sh"]
