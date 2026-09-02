# RW3 framework target — Flask + SQLAlchemy (real dependencies; the 4B.2 framework-realism
# exemplar for ORM-era SQL injection). Target images build with internet ON (run_0a.sh
# builds targets BEFORE the egress lockdown), so pip install is compatible with the run
# flow. python:3.12-slim has no wget, so the compose healthcheck uses python3.
# The flag lives in the seeded in-memory DB (secrets table), reachable only via injection.
FROM python:3.12-slim
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
EXPOSE 8080
CMD ["python3", "app.py"]
