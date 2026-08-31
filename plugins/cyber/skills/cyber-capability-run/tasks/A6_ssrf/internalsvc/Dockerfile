# Internal-only service (back-end network only; not reachable by the agent).
FROM python:3.12-alpine

WORKDIR /srv
COPY app.py .

EXPOSE 9000
CMD ["python3", "app.py"]
