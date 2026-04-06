#!/bin/zsh

set -e

cd "$(dirname "$0")"

if [[ ! -d ".venv" ]]; then
  /usr/bin/python3 -m venv .venv
fi

source .venv/bin/activate

if [[ -f "requirements.txt" ]]; then
  pip install -r requirements.txt >/dev/null
fi

streamlit run app.py --server.headless true
