# Gate-0B demonstrator target — a generic image whose flag is injected per run.
# The SAME image serves a different flag on every run: the broker sets PFCYBER_NONCE_<STAGE>
# in this container's env, and app.py reads it (env-or-default) at request time.
FROM python:3.12-alpine

WORKDIR /srv
COPY app.py .

EXPOSE 8080
CMD ["python3", "app.py"]
