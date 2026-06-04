#!/bin/zsh

set -e

cd "$(dirname "$0")"

if [[ ! -d ".venv" ]]; then
  /usr/bin/python3 -m venv .venv
fi

source .venv/bin/activate
pip install -r requirements.txt >/dev/null

uvicorn webapp.main:app --host 0.0.0.0 --port 8000 --reload \
  --reload-dir webapp --reload-dir src
