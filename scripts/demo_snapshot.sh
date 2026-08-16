#!/usr/bin/env bash
# Demo 資料快照／還原（待辦 K）
#
# 比賽只有 4 分鐘，課程必須事先建好；跑 pytest 又會洗掉本機 demo 資料庫（待辦 I）。
# 這支腳本讓你一鍵回到已知良好狀態。
#
#   ./scripts/demo_snapshot.sh save demo
#   ./scripts/demo_snapshot.sh restore demo
#   ./scripts/demo_snapshot.sh list
#
# 刻意不自己序列化資料表：pg_dump 已經做完這件事，而且未來新增資料表不用改這裡。

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SNAPSHOT_DIR="$PROJECT_ROOT/demo_snapshots"
CHROMA_DIR="data/chroma" # 相對於 PROJECT_ROOT，tar 也用相對路徑存

die() {
    echo "錯誤：$*" >&2
    exit 1
}

load_database_url() {
    [[ -f "$PROJECT_ROOT/.env" ]] || die "找不到 $PROJECT_ROOT/.env"
    # 只取未被註解的那一行
    DATABASE_URL="$(grep -E '^DATABASE_URL=' "$PROJECT_ROOT/.env" | tail -1 | cut -d= -f2-)"
    [[ -n "${DATABASE_URL:-}" ]] || die ".env 裡沒有可用的 DATABASE_URL"

    # 防手滑打到正式庫：只允許本機
    case "$DATABASE_URL" in
    *localhost* | *127.0.0.1*) ;;
    *) die "DATABASE_URL 不是本機資料庫，拒絕執行：$DATABASE_URL" ;;
    esac
}

require_backend_stopped() {
    # Chroma 在後端開著時被覆寫會壞掉（會報 attempt to write a readonly database）
    if lsof -nP -iTCP:8000 -sTCP:LISTEN >/dev/null 2>&1; then
        die "後端還在 port 8000 執行中。請先停掉再還原（Chroma 開著時覆寫會損毀向量庫）。"
    fi
}

cmd_save() {
    local name="${1:-demo}"
    load_database_url
    mkdir -p "$SNAPSHOT_DIR"

    local sql="$SNAPSHOT_DIR/$name.sql"
    local chroma="$SNAPSHOT_DIR/$name-chroma.tgz"

    echo "→ pg_dump ..."
    pg_dump --clean --if-exists "$DATABASE_URL" >"$sql"

    if [[ -d "$PROJECT_ROOT/$CHROMA_DIR" ]]; then
        echo "→ 打包向量庫 ..."
        tar czf "$chroma" -C "$PROJECT_ROOT" "$CHROMA_DIR"
    else
        echo "→ 沒有 $CHROMA_DIR，略過向量庫"
    fi

    echo "已儲存快照「$name」："
    ls -lh "$sql" ${chroma:+"$chroma"} 2>/dev/null | awk '{print "   " $9 "  " $5}'
}

cmd_restore() {
    local name="${1:-}"
    [[ -n "$name" ]] || die "請指定快照名稱。可用 list 查看。"
    load_database_url

    local sql="$SNAPSHOT_DIR/$name.sql"
    local chroma="$SNAPSHOT_DIR/$name-chroma.tgz"
    [[ -f "$sql" ]] || die "找不到快照：$sql"

    require_backend_stopped

    if [[ "${2:-}" != "--yes" ]]; then
        echo "即將用快照「$name」覆蓋整個資料庫："
        echo "   $DATABASE_URL"
        echo "   目前資料會全部消失，且無法復原。"
        read -r -p "確定嗎？輸入 yes 繼續：" reply
        [[ "$reply" == "yes" ]] || die "已取消。"
    fi

    echo "→ 還原資料庫 ..."
    psql --quiet --set ON_ERROR_STOP=on "$DATABASE_URL" <"$sql" >/dev/null

    if [[ -f "$chroma" ]]; then
        echo "→ 還原向量庫 ..."
        rm -rf "${PROJECT_ROOT:?}/$CHROMA_DIR" # 先清掉，避免舊檔殘留混在一起
        tar xzf "$chroma" -C "$PROJECT_ROOT"
    else
        echo "→ 這個快照沒有向量庫，略過（跨課程橋在新教材上會找不到關聯）"
    fi

    echo "已還原快照「$name」。可以啟動後端了。"
}

cmd_list() {
    [[ -d "$SNAPSHOT_DIR" ]] || {
        echo "還沒有任何快照。"
        return
    }
    local found=0
    for f in "$SNAPSHOT_DIR"/*.sql; do
        [[ -e "$f" ]] || continue
        found=1
        local name size when
        name="$(basename "$f" .sql)"
        size="$(du -h "$f" | cut -f1)"
        when="$(date -r "$f" '+%Y-%m-%d %H:%M')"
        local mark="（無向量庫）"
        [[ -f "$SNAPSHOT_DIR/$name-chroma.tgz" ]] && mark=""
        printf "  %-20s %6s  %s %s\n" "$name" "$size" "$when" "$mark"
    done
    [[ "$found" == 1 ]] || echo "還沒有任何快照。"
}

case "${1:-}" in
save) shift && cmd_save "$@" ;;
restore) shift && cmd_restore "$@" ;;
list) cmd_list ;;
*)
    cat <<'USAGE'
用法：
  ./scripts/demo_snapshot.sh save [名稱]        儲存目前資料庫與向量庫（預設名稱 demo）
  ./scripts/demo_snapshot.sh restore <名稱>      還原（會覆蓋整個資料庫，需先停後端）
  ./scripts/demo_snapshot.sh list                列出現有快照

還原時加 --yes 可略過確認：restore demo --yes
USAGE
    exit 1
    ;;
esac
