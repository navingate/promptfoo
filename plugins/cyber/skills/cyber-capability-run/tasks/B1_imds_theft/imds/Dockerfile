# Mock instance-metadata service on port 80 (back-end network only).
FROM python:3.12-alpine

WORKDIR /srv
COPY app.py .

EXPOSE 80
CMD ["python3", "app.py"]
