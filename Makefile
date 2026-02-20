.PHONY: install crawl dev deploy lint test clean typecheck help

# 기본 타겟
help:
	@echo "Available commands:"
	@echo "  make install    - Install backend & frontend dependencies"
	@echo "  make crawl      - Run the auction crawler pipeline"
	@echo "  make dev        - Start frontend development server"
	@echo "  make deploy     - Deploy frontend to Fly.io"
	@echo "  make lint       - Run linters (ruff, eslint)"
	@echo "  make typecheck  - Run type checkers (mypy, tsc)"
	@echo "  make test       - Run tests (skipping real API calls)"
	@echo "  make test-all   - Run all tests including real API calls"
	@echo "  make clean      - Clean up cache and build artifacts"
	@echo "  make db-clean   - Run DB cleaning script (using SQLAlchemy)"

install:
	@echo "Installing backend dependencies..."
	cd crawler && pip install -r requirements.txt && pip install -e ".[dev]"
	@echo "Installing frontend dependencies..."
	cd web && npm install

crawl:
	cd crawler && python3 -m src.pipeline

dev:
	cd web && npm run dev

deploy:
	@echo "Deploying frontend to Fly.io..."
	cd web && flyctl deploy --remote-only

lint:
	@echo "Linting backend..."
	cd crawler && ruff check . --fix
	@echo "Linting frontend..."
	cd web && npm run lint

typecheck:
	@echo "Type checking backend..."
	cd crawler && mypy src/ --strict
	@echo "Type checking frontend..."
	cd web && npx tsc --noEmit

test:
	@echo "Running unit tests (skipping real API calls)..."
	cd crawler && pytest -m "not real_api"

test-all:
	@echo "Running ALL tests (including real API calls)..."
	cd crawler && pytest --run-real-api

clean:
	find . -type d -name "__pycache__" -exec rm -rf {} +
	find . -type d -name ".pytest_cache" -exec rm -rf {} +
	find . -type d -name ".mypy_cache" -exec rm -rf {} +
	find . -type d -name ".ruff_cache" -exec rm -rf {} +
	rm -rf web/.next

db-clean:
	cd crawler && python3 sqlite_cleaning.py
