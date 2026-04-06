#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT_DIR/gemini_arch_pack"

FILES=(
  "GEMINI_ARCHITECTURE_BRIEF.md"
  "GEMINI_REVIEW_PROMPT.txt"
  "README.md"
  "requirements.txt"
  "pyproject.toml"
  "webapp/main.py"
  "src/adaptlearn/config.py"
  "src/adaptlearn/models.py"
  "src/adaptlearn/pipeline.py"
  "src/adaptlearn/knowledge_graph.py"
  "src/adaptlearn/gemini_client.py"
  "src/adaptlearn/pdf_parser.py"
  "src/adaptlearn/domain_templates.py"
  "src/adaptlearn/quiz_engine.py"
  "src/adaptlearn/review_scheduler.py"
  "src/adaptlearn/database.py"
  "src/adaptlearn/vector_store.py"
  "webapp/frontend/src/App.jsx"
  "webapp/frontend/src/hooks/useApi.ts"
  "webapp/frontend/vite.config.js"
  "webapp/frontend/package.json"
  "tests/test_api_integration.py"
  "tests/test_unit.py"
  "tests/test_service_workflow.py"
)

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

for rel in "${FILES[@]}"; do
  src="$ROOT_DIR/$rel"
  if [[ ! -f "$src" ]]; then
    echo "Missing required file: $rel" >&2
    exit 1
  fi
  mkdir -p "$OUT_DIR/$(dirname "$rel")"
  cp "$src" "$OUT_DIR/$rel"
done

# Helpful context files for Gemini
{
  echo "Project root: $ROOT_DIR"
  echo "Generated at: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo
  echo "Included files:"
  for rel in "${FILES[@]}"; do
    echo "- $rel"
  done
} > "$OUT_DIR/PACK_INFO.txt"

# Lightweight tree excluding heavy and sensitive folders
find "$ROOT_DIR" \
  -type d \( -name ".git" -o -name ".venv" -o -name "node_modules" -o -name "data" -o -name "__pycache__" \) -prune \
  -o -type f \
  ! -name ".env" \
  ! -name ".env.*" \
  ! -name "*.db" \
  ! -name "*.db-wal" \
  ! -name "*.db-shm" \
  ! -name ".DS_Store" \
  -print \
  | sed "s|$ROOT_DIR/||" \
  | sort \
  > "$OUT_DIR/PROJECT_FILE_LIST.txt"

# API route inventory from FastAPI app
if command -v rg >/dev/null 2>&1; then
  rg "@app\\.(get|post|put|patch|delete)\\(\"" "$ROOT_DIR/webapp/main.py" -n > "$OUT_DIR/API_ROUTES.txt"
else
  grep -nE "@app\\.(get|post|put|patch|delete)\\(\"" "$ROOT_DIR/webapp/main.py" > "$OUT_DIR/API_ROUTES.txt"
fi

# Remove macOS metadata artifacts from the export pack.
find "$OUT_DIR" -name ".DS_Store" -delete

echo "Gemini architecture pack generated: $OUT_DIR"
