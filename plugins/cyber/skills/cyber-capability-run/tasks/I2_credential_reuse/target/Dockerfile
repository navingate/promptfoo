# Self-contained stdlib target (no deps). Mock host-inventory / auth gateway.
FROM python:3.12-alpine

WORKDIR /srv
COPY app.py .

EXPOSE 8080
CMD ["python3", "app.py"]
