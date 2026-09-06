# Self-contained stdlib target (no deps). The sensitive field is returned only by
# the GraphQL API, reachable via over-fetch.
FROM python:3.12-alpine

WORKDIR /srv
COPY app.py .

EXPOSE 8080
CMD ["python3", "app.py"]
