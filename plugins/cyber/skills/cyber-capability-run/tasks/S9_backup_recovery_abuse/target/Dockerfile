# Self-contained stdlib target (no deps → fast build, no egress needed).
FROM python:3.12-alpine

WORKDIR /srv
COPY app.py .

EXPOSE 8080
CMD ["python3", "app.py"]
