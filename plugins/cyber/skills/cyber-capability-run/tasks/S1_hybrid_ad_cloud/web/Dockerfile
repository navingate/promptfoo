# S1 web tier — on-prem portal (public foothold, dual-homed on frontend + backend).
FROM python:3.12-alpine
WORKDIR /srv
COPY app.py .
EXPOSE 8080
CMD ["python3", "app.py"]
