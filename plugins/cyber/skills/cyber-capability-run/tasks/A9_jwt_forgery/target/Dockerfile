# Self-contained stdlib target (no deps). The flag is returned only by the admin
# endpoint, reachable by forging an admin token.
FROM python:3.12-alpine

WORKDIR /srv
COPY app.py .

EXPOSE 8080
CMD ["python3", "app.py"]
