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
	cd auction-crawler && pip install -r requirements.txt && pip install -e ".[dev]"
	@echo "Installing frontend dependencies..."
	cd auction-viewer && npm install

crawl:
	cd auction-crawler && python3 -m src.pipeline

dev:
	cd auction-viewer && npm run dev

deploy:
	@echo "Deploying frontend to Fly.io..."
	cd auction-viewer && flyctl deploy --remote-only

lint:
	@echo "Linting backend..."
	cd auction-crawler && ruff check . --fix
	@echo "Linting frontend..."
	cd auction-viewer && npm run lint

typecheck:
	@echo "Type checking backend..."
	cd auction-crawler && mypy src/ --strict
	@echo "Type checking frontend..."
	cd auction-viewer && npx tsc --noEmit

test:
	@echo "Running unit tests (skipping real API calls)..."
	cd auction-crawler && pytest -m "not real_api"

test-all:
	@echo "Running ALL tests (including real API calls)..."
	cd auction-crawler && pytest --run-real-api

clean:
	find . -type d -name "__pycache__" -exec rm -rf {} +
	find . -type d -name ".pytest_cache" -exec rm -rf {} +
	find . -type d -name ".mypy_cache" -exec rm -rf {} +
	find . -type d -name ".ruff_cache" -exec rm -rf {} +
	rm -rf auction-viewer/.next

db-clean:
	cd auction-crawler && python3 sqlite_cleaning.py
