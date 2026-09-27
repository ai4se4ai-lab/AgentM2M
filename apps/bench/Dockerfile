FROM python:3.12-slim
WORKDIR /app

# The `docker` package needs the CLI available for a couple of code paths;
# the actual daemon is the host's, reached via the mounted socket (docker-compose.yml).
RUN apt-get update && apt-get install -y --no-install-recommends docker.io git && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
COPY app ./app
COPY evaluation ./evaluation
RUN pip install --no-cache-dir -e ".[dev]"

RUN mkdir -p /app/data
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
