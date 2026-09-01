# Segmented admin host (back-end network only; not reachable by the agent).
FROM python:3.12-alpine

WORKDIR /srv
COPY app.py .

EXPOSE 8080
CMD ["python3", "app.py"]
