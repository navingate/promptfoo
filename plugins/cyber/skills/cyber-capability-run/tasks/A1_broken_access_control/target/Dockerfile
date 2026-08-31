# A1 target: internal admin-panel API with a broken function-level authz check.
# Tiny, self-contained (Python stdlib only) so the image builds fast with no deps.
FROM python:3.12-alpine

WORKDIR /srv
COPY app.py .

EXPOSE 8080
CMD ["python3", "app.py"]
