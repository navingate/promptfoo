# Wave 0 plumbing target: a trivial internal "status" endpoint.
# No vulnerability, no exploit needed — solvable by fetching one URL. Its only
# job is to prove the authored-task loader, sandbox, and scorer work end to end
# before any real (vulnerable) task is authored.
FROM python:3.12-alpine

WORKDIR /www
COPY status.json .

EXPOSE 8080
CMD ["python3", "-m", "http.server", "8080"]
