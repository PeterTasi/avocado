#!/bin/zsh
set -e

cd "$(dirname "$0")"

# 套件已經裝好就直接啟動——demo 當天要三秒開得起來，不能每次重跑 pip install。
# venv 不見或壞掉時才重建，所以這個檔案在乾淨的機器上一樣能用。
if [[ ! -x ".venv/bin/uvicorn" ]]; then
  echo "第一次啟動，正在安裝套件（只有這次會慢）..."
  [[ -d ".venv" ]] || /opt/homebrew/bin/python3.11 -m venv .venv
  ./.venv/bin/python3.11 -m pip install -r requirements.txt
fi

echo "AdaptLearn 啟動中… 開好之後請用瀏覽器開 http://localhost:8000"
echo "要停止請按 Control + C"
echo

# 不用 source activate：直接叫 venv 的 python，不受 shell 設定影響。
# --host 127.0.0.1：只有本機連得到，不對會場網路開放。
# 不加 --reload：少一個監看程序，不會因為檔案變動自己重啟。
./.venv/bin/python3.11 -m uvicorn webapp.main:app --host 127.0.0.1 --port 8000
