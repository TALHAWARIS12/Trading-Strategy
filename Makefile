.PHONY: help install build dev start stop test lint format clean deploy logs

# Default target
help:
	@echo "Crypto Paper Trading Bot - Makefile Commands"
	@echo ""
	@echo "Development:"
	@echo "  make install     - Install dependencies"
	@echo "  make build       - Build TypeScript"
	@echo "  make dev         - Run development server"
	@echo "  make clean       - Clean build artifacts"
	@echo ""
	@echo "Production:"
	@echo "  make start       - Start with PM2"
	@echo "  make stop        - Stop PM2 process"
	@echo "  make restart     - Restart PM2 process"
	@echo "  make logs        - View PM2 logs"
	@echo ""
	@echo "Code Quality:"
	@echo "  make test        - Run tests"
	@echo "  make lint        - Run ESLint"
	@echo "  make format      - Format code with Prettier"
	@echo "  make typecheck   - TypeScript type checking"
	@echo ""
	@echo "Docker:"
	@echo "  make docker-build   - Build Docker image"
	@echo "  make docker-run     - Run Docker container"
	@echo "  make docker-stop    - Stop Docker container"
	@echo ""
	@echo "Utilities:"
	@echo "  make reset       - Reset paper account"
	@echo "  make validate    - Validate strategy"
	@echo "  make backtest    - Run backtesting"

# Installation
install:
	npm install

# Build
build:
	npm run build

# Development
dev:
	npm run dev

# Production with PM2
start:
	pm2 start ecosystem.config.js

stop:
	pm2 stop trading-bot

restart:
	pm2 restart trading-bot

logs:
	pm2 logs trading-bot

# Code quality
test:
	npm run test

test-watch:
	npm run test:watch

lint:
	npm run lint

format:
	npm run format

typecheck:
	npm run typecheck

# Cleaning
clean:
	rm -rf dist build node_modules

# Docker commands
docker-build:
	docker build -t trading-bot:latest .

docker-run:
	docker run -d \
		--name trading-bot \
		-p 3000:3000 \
		--env-file .env \
		-v $(PWD)/data:/app/data \
		-v $(PWD)/logs:/app/logs \
		trading-bot:latest

docker-stop:
	docker stop trading-bot && docker rm trading-bot

# Utility scripts
reset:
	npm run reset-paper

validate:
	npm run validate-strategy

backtest:
	npm run backtest

# Full setup
setup: install build
	@echo "Setup complete! Configure .env and run 'make dev' or 'make start'"

# All checks before deployment
check: lint typecheck test
	@echo "All checks passed!"
