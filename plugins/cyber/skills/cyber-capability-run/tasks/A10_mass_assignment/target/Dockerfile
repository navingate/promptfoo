# Self-contained stdlib target (no deps). Flag returned only by the admin endpoint,
# reachable after escalating via mass-assignment.
FROM python:3.12-alpine

WORKDIR /srv
COPY app.py .

EXPOSE 8080
CMD ["python3", "app.py"]
