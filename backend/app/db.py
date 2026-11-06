"""SQLite 数据层：恢复追踪（tracks/track_records）+ 社区（posts/comments）共用。
见文档 §12。每操作短连接，WAL 模式，路径由 APP_DB 环境变量覆盖（部署用）。
"""
import os
import json
import sqlite3
import secrets
import hashlib
from datetime import datetime, timedelta, timezone
from pathlib import Path

_DB_PATH = os.environ.get(
    "APP_DB",
    str(Path(__file__).resolve().parent.parent / "data" / "app.db"),
)


def _conn() -> sqlite3.Connection:
    Path(_DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")


def _migrate_users_allow_duplicate_username() -> None:
    """用户名允许重名：老库 users.username 带 UNIQUE 约束时重建该表（SQLite 无法直接删列约束）。
    用独立连接并临时关掉外键，避免 DROP TABLE 被引用它的表挡住。"""
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='users'"
    ).fetchone()
    if row is None or "UNIQUE" not in (row[0] or ""):
        conn.close()
        return
    conn.execute("PRAGMA foreign_keys=OFF")
    conn.executescript(
        """
        BEGIN;
        CREATE TABLE users_new (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            username   TEXT NOT NULL,
            pw_salt    TEXT NOT NULL,
            pw_hash    TEXT NOT NULL,
            created_at TEXT NOT NULL,
            nickname   TEXT,
            avatar_url TEXT,
            role       TEXT NOT NULL DEFAULT 'user'
        );
        INSERT INTO users_new (id, username, pw_salt, pw_hash, created_at, nickname, avatar_url, role)
            SELECT id, username, pw_salt, pw_hash, created_at, nickname, avatar_url, role FROM users;
        DROP TABLE users;
        ALTER TABLE users_new RENAME TO users;
        COMMIT;
        """
    )
    conn.close()


def init_db() -> None:
    with _conn() as c:
        c.executescript(
            """
            CREATE TABLE IF NOT EXISTS tracks (
                id         TEXT PRIMARY KEY,
                name       TEXT NOT NULL,
                crop       TEXT,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS track_records (
                id                 INTEGER PRIMARY KEY AUTOINCREMENT,
                track_id           TEXT NOT NULL REFERENCES tracks(id),
                date               TEXT NOT NULL,
                species_label      TEXT,
                disease_label      TEXT,
                disease_name       TEXT,
                disease_confidence REAL,
                note               TEXT,
                created_at         TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS posts (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                nickname   TEXT NOT NULL,
                title      TEXT NOT NULL,
                body       TEXT NOT NULL,
                image_emoji TEXT,
                likes      INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS comments (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                post_id    INTEGER NOT NULL REFERENCES posts(id),
                nickname   TEXT NOT NULL,
                body       TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS users (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                username   TEXT NOT NULL,
                pw_salt    TEXT NOT NULL,
                pw_hash    TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token      TEXT PRIMARY KEY,
                user_id    INTEGER NOT NULL REFERENCES users(id),
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS garden_plants (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id      INTEGER NOT NULL REFERENCES users(id),
                nickname     TEXT NOT NULL,
                crop         TEXT,
                photo_emoji  TEXT,
                planted_date TEXT,
                notes        TEXT,
                track_id     TEXT,
                created_at   TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS diagnoses (
                id                 INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id            INTEGER REFERENCES users(id),
                crop               TEXT,
                species_label      TEXT,
                disease_label      TEXT,
                disease_name       TEXT,
                disease_confidence REAL,
                low_confidence     INTEGER NOT NULL DEFAULT 0,
                created_at         TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS post_likes (
                post_id   INTEGER NOT NULL REFERENCES posts(id),
                user_id   INTEGER NOT NULL REFERENCES users(id),
                created_at TEXT NOT NULL,
                PRIMARY KEY (post_id, user_id)
            );
            CREATE TABLE IF NOT EXISTS favorites (
                post_id   INTEGER NOT NULL REFERENCES posts(id),
                user_id   INTEGER NOT NULL REFERENCES users(id),
                created_at TEXT NOT NULL,
                PRIMARY KEY (post_id, user_id)
            );
            CREATE TABLE IF NOT EXISTS follows (
                follower_id INTEGER NOT NULL REFERENCES users(id),
                followee_id INTEGER NOT NULL REFERENCES users(id),
                created_at  TEXT NOT NULL,
                PRIMARY KEY (follower_id, followee_id)
            );
            CREATE TABLE IF NOT EXISTS notifications (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER NOT NULL REFERENCES users(id),   -- 收件人
                actor_id   INTEGER REFERENCES users(id),            -- 触发者（可能被删）
                type       TEXT NOT NULL,                           -- comment/like/favorite/follow/system
                post_id    INTEGER,
                content    TEXT,
                is_read    INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );
            """
        )
        _migrate_users_allow_duplicate_username()
        # 老库迁移：posts / comments 补 user_id 列（已存在则忽略）
        for tbl in ("posts", "comments"):
            try:
                c.execute(f"ALTER TABLE {tbl} ADD COLUMN user_id INTEGER")
            except sqlite3.OperationalError:
                pass
        # 小红书式发帖：图片组(JSON) / 标签(JSON) / 可见性
        for col in ("images TEXT", "tags TEXT"):
            try:
                c.execute(f"ALTER TABLE posts ADD COLUMN {col}")
            except sqlite3.OperationalError:
                pass
        try:
            c.execute("ALTER TABLE posts ADD COLUMN is_public INTEGER NOT NULL DEFAULT 1")
        except sqlite3.OperationalError:
            pass
        # 帖子下架：status(published/takedown) + 下架原因
        try:
            c.execute("ALTER TABLE posts ADD COLUMN status TEXT NOT NULL DEFAULT 'published'")
        except sqlite3.OperationalError:
            pass
        try:
            c.execute("ALTER TABLE posts ADD COLUMN takedown_reason TEXT")
        except sqlite3.OperationalError:
            pass
        # 花园植物真实照片（存后端 /files/uploads/ 下的相对路径）
        try:
            c.execute("ALTER TABLE garden_plants ADD COLUMN photo_url TEXT")
        except sqlite3.OperationalError:
            pass
        # 用户资料：自定义昵称 + 头像 + 角色
        for col in ("nickname TEXT", "avatar_url TEXT", "role TEXT NOT NULL DEFAULT 'user'"):
            try:
                c.execute(f"ALTER TABLE users ADD COLUMN {col}")
            except sqlite3.OperationalError:
                pass
        # 追踪记录留档照片（存 /files/uploads/ 相对路径，老记录为 NULL）
        try:
            c.execute("ALTER TABLE track_records ADD COLUMN image_url TEXT")
        except sqlite3.OperationalError:
            pass
        # 诊断记录完整结果回看：物种置信度 + 建议 + 相似疑似(JSON) + 照片路径
        for col in ("species_confidence REAL", "suggestion TEXT",
                    "candidates TEXT", "image_url TEXT"):
            try:
                c.execute(f"ALTER TABLE diagnoses ADD COLUMN {col}")
            except sqlite3.OperationalError:
                pass
        # 预置管理员账号（仅首次建库时创建；已存在则确保其为 admin）
        seed_admin()


# ---------- 追踪 ----------

def create_track(track_id: str, name: str, crop: str | None) -> dict:
    with _conn() as c:
        c.execute(
            "INSERT INTO tracks (id, name, crop, created_at) VALUES (?,?,?,?)",
            (track_id, name, crop, _now()),
        )
    return {"track_id": track_id, "name": name, "crop": crop}


def list_tracks() -> list:
    with _conn() as c:
        rows = c.execute(
            """
            SELECT t.id, t.name, t.crop, t.created_at,
                   COUNT(r.id) AS record_count,
                   MAX(r.date) AS last_date
            FROM tracks t LEFT JOIN track_records r ON r.track_id = t.id
            GROUP BY t.id ORDER BY t.created_at DESC
            """
        ).fetchall()
    return [dict(r) for r in rows]


def add_track_record(track_id: str, date: str, species: dict, disease: dict,
                     note: str | None, image_url: str | None = None) -> int:
    with _conn() as c:
        cur = c.execute(
            """
            INSERT INTO track_records
                (track_id, date, species_label, disease_label,
                 disease_name, disease_confidence, note, image_url, created_at)
            VALUES (?,?,?,?,?,?,?,?,?)
            """,
            (
                track_id, date,
                species.get("label"), disease.get("label"),
                disease.get("name"), disease.get("confidence"),
                note, image_url, _now(),
            ),
        )
        return cur.lastrowid


def get_track_records(track_id: str) -> list:
    with _conn() as c:
        rows = c.execute(
            """SELECT id, date, species_label, disease_label, disease_name,
                      disease_confidence, note, image_url
               FROM track_records WHERE track_id = ?
               ORDER BY date ASC, id ASC""",
            (track_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def track_exists(track_id: str) -> bool:
    with _conn() as c:
        row = c.execute("SELECT 1 FROM tracks WHERE id = ?", (track_id,)).fetchone()
    return row is not None


def trend_verdict(records: list) -> tuple:
    """按历次病害置信度单调性判定：好转 / 恶化 / 持平 / 波动。

    置信度下降 = 病害信号减弱 = 好转。返回 (verdict, explanation)。
    """
    pts = [r["disease_confidence"] for r in records if r["disease_confidence"] is not None]
    if len(pts) < 2:
        return "建立基线", "首次记录，作为后续对比的基线。"
    diffs = [b - a for a, b in zip(pts, pts[1:])]
    eps = 1e-6
    if all(d < -eps for d in diffs):
        chain = "→".join(f"{p:.2f}" for p in pts)
        return "好转", f"病害置信度持续下降（{chain}），植株趋于恢复，建议继续当前养护并观察。"
    if all(d > eps for d in diffs):
        chain = "→".join(f"{p:.2f}" for p in pts)
        return "恶化", f"病害置信度持续上升（{chain}），症状在加重，建议调整养护措施或咨询植保意见。"
    if all(abs(d) <= eps for d in diffs):
        return "持平", "病害置信度基本不变，继续观察。"
    return "波动", "病害置信度有升有降，建议加密记录频率并保持养护稳定。"


# ---------- 社区 ----------

def create_post(nickname: str, title: str, body: str, image_emoji: str | None,
                user_id: int | None = None, images: list | None = None,
                tags: list | None = None, is_public: bool = True) -> int:
    with _conn() as c:
        cur = c.execute(
            """INSERT INTO posts (nickname, title, body, image_emoji, user_id,
                                  images, tags, is_public, created_at)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (nickname, title, body, image_emoji, user_id,
             json.dumps(images or [], ensure_ascii=False),
             json.dumps(tags or [], ensure_ascii=False),
             1 if is_public else 0, _now()),
        )
        return cur.lastrowid


def _post_row_to_dict(row) -> dict:
    """posts 行转 dict，images/tags 从 JSON 字符串解析成数组。"""
    d = dict(row)
    for col in ("images", "tags"):
        raw = d.get(col)
        if raw:
            try:
                d[col] = json.loads(raw)
            except (ValueError, TypeError):
                d[col] = []
        else:
            d[col] = []
    return d


def list_posts(limit: int = 20, offset: int = 0, viewer_id: int | None = None) -> list:
    """信息流：私密帖（is_public=0）只对作者本人可见。"""
    with _conn() as c:
        if viewer_id is None:
            rows = c.execute(
                """SELECT p.id, p.nickname, p.title, p.body, p.image_emoji, p.likes,
                          p.user_id, p.images, p.tags, p.is_public, p.created_at,
                          (SELECT COUNT(*) FROM comments cm WHERE cm.post_id = p.id) AS comment_count
                   FROM posts p WHERE p.is_public = 1 AND p.status = 'published'
                   ORDER BY p.created_at DESC LIMIT ? OFFSET ?""",
                (limit, offset),
            ).fetchall()
        else:
            rows = c.execute(
                """SELECT p.id, p.nickname, p.title, p.body, p.image_emoji, p.likes,
                          p.user_id, p.images, p.tags, p.is_public, p.created_at,
                          (SELECT COUNT(*) FROM comments cm WHERE cm.post_id = p.id) AS comment_count
                   FROM posts p WHERE (p.is_public = 1 OR p.user_id = ?) AND p.status = 'published'
                   ORDER BY p.created_at DESC LIMIT ? OFFSET ?""",
                (viewer_id, limit, offset),
            ).fetchall()
    return [_post_row_to_dict(r) for r in rows]


def get_post(post_id: int, user_id: int | None = None,
             include_takedown: bool = False) -> dict | None:
    with _conn() as c:
        row = c.execute(
            """SELECT id, nickname, title, body, image_emoji, likes, user_id,
                      images, tags, is_public, status, created_at,
                      (SELECT COUNT(*) FROM favorites fv WHERE fv.post_id = p2.id) AS favorite_count
               FROM posts p2 WHERE p2.id = ?""",
            (post_id,),
        ).fetchone()
        if row is None:
            return None
        post = _post_row_to_dict(row)
        # 被下架的帖子对普通用户视为不存在（仅管理员可看，便于恢复）
        if post.get("status") == "takedown" and not include_takedown:
            return None
        # 私密帖仅作者本人可看
        if not post["is_public"] and post["user_id"] != user_id:
            return None
        post["comments"] = [
            dict(r) for r in c.execute(
                "SELECT id, nickname, body, user_id, created_at FROM comments WHERE post_id = ? ORDER BY created_at ASC",
                (post_id,),
            ).fetchall()
        ]
        if user_id is not None:
            post["liked"] = c.execute(
                "SELECT 1 FROM post_likes WHERE post_id=? AND user_id=?", (post_id, user_id)).fetchone() is not None
            post["favorited"] = c.execute(
                "SELECT 1 FROM favorites WHERE post_id=? AND user_id=?", (post_id, user_id)).fetchone() is not None
            post["following_author"] = (
                post["user_id"] is not None
                and c.execute(
                    "SELECT 1 FROM follows WHERE follower_id=? AND followee_id=?",
                    (user_id, post["user_id"])).fetchone() is not None
            )
    return post


def add_comment(post_id: int, nickname: str, body: str, user_id: int | None = None) -> int:
    with _conn() as c:
        cur = c.execute(
            "INSERT INTO comments (post_id, nickname, body, user_id, created_at) VALUES (?,?,?,?,?)",
            (post_id, nickname, body, user_id, _now()),
        )
        return cur.lastrowid


def like_post(post_id: int) -> int | None:
    """点赞 +1，返回新的点赞数；帖子不存在返回 None。"""
    with _conn() as c:
        cur = c.execute(
            "UPDATE posts SET likes = likes + 1 WHERE id = ? RETURNING likes",
            (post_id,),
        )
        row = cur.fetchone()
        return row["likes"] if row else None


# ---------- 用户 / 会话 / 我的花园 ----------

_PBKDF2_ROUNDS = 100_000


def _hash_password(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt), _PBKDF2_ROUNDS
    ).hex()


def create_user(username: str, password: str) -> int:
    """注册。用户名允许与其他账号重名；返回新用户 id。"""
    with _conn() as c:
        salt = secrets.token_hex(16)
        pw_hash = _hash_password(password, salt)
        cur = c.execute(
            "INSERT INTO users (username, pw_salt, pw_hash, created_at) VALUES (?,?,?,?)",
            (username, salt, pw_hash, _now()),
        )
        return cur.lastrowid


def verify_user(username: str, password: str) -> tuple[int, str] | None:
    """登录校验。用户名允许重名：逐个尝试同名账号，密码匹配哪个就登录哪个。
    成功返回 (user_id, "ok")；失败返回 (None, 原因)，
    原因："no_user"（用户不存在）或 "bad_password"（密码错误）。"""
    with _conn() as c:
        rows = c.execute(
            "SELECT id, pw_salt, pw_hash FROM users WHERE username = ? ORDER BY id",
            (username,),
        ).fetchall()
        if not rows:
            return None, "no_user"
        for row in rows:
            if secrets.compare_digest(
                _hash_password(password, row["pw_salt"]), row["pw_hash"]
            ):
                return row["id"], "ok"
        return None, "bad_password"


def create_session(user_id: int) -> str:
    token = secrets.token_hex(24)
    with _conn() as c:
        c.execute(
            "INSERT INTO sessions (token, user_id, created_at) VALUES (?,?,?)",
            (token, user_id, _now()),
        )
    return token


def update_username(user_id: int, new_username: str) -> None:
    """改用户名。允许与其他账号重名。"""
    with _conn() as c:
        c.execute("UPDATE users SET username = ? WHERE id = ?", (new_username, user_id))


def update_password(user_id: int, old_password: str, new_password: str) -> None:
    """改密码。旧密码不匹配抛 ValueError("bad_old")。"""
    with _conn() as c:
        row = c.execute(
            "SELECT pw_salt, pw_hash FROM users WHERE id = ?", (user_id,)
        ).fetchone()
        if row is None:
            raise ValueError("no_user")
        if not secrets.compare_digest(
            _hash_password(old_password, row["pw_salt"]), row["pw_hash"]
        ):
            raise ValueError("bad_old")
        salt = secrets.token_hex(16)
        c.execute(
            "UPDATE users SET pw_salt = ?, pw_hash = ? WHERE id = ?",
            (salt, _hash_password(new_password, salt), user_id),
        )


def get_user_by_token(token: str) -> dict | None:
    with _conn() as c:
        row = c.execute(
            """SELECT u.id, u.username, u.role, u.nickname FROM sessions s
               JOIN users u ON u.id = s.user_id WHERE s.token = ?""",
            (token,),
        ).fetchone()
    return dict(row) if row else None


def delete_session(token: str) -> None:
    with _conn() as c:
        c.execute("DELETE FROM sessions WHERE token = ?", (token,))


def add_plant(user_id: int, nickname: str, crop: str | None,
              photo_emoji: str | None, planted_date: str | None,
              notes: str | None) -> int:
    with _conn() as c:
        cur = c.execute(
            """INSERT INTO garden_plants
               (user_id, nickname, crop, photo_emoji, planted_date, notes, created_at)
               VALUES (?,?,?,?,?,?,?)""",
            (user_id, nickname, crop, photo_emoji, planted_date, notes, _now()),
        )
        return cur.lastrowid


def list_garden(user_id: int) -> list:
    with _conn() as c:
        rows = c.execute(
            """SELECT id, nickname, crop, photo_emoji, photo_url, planted_date, notes, track_id, created_at
               FROM garden_plants WHERE user_id = ? ORDER BY created_at DESC""",
            (user_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def get_plant(plant_id: int, user_id: int) -> dict | None:
    with _conn() as c:
        row = c.execute(
            """SELECT id, nickname, crop, photo_emoji, photo_url, planted_date, notes, track_id, created_at
               FROM garden_plants WHERE id = ? AND user_id = ?""",
            (plant_id, user_id),
        ).fetchone()
    return dict(row) if row else None


def set_plant_photo(plant_id: int, user_id: int, photo_url: str) -> bool:
    with _conn() as c:
        cur = c.execute(
            "UPDATE garden_plants SET photo_url = ? WHERE id = ? AND user_id = ?",
            (photo_url, plant_id, user_id),
        )
        return cur.rowcount > 0


def delete_plant(plant_id: int, user_id: int) -> bool:
    with _conn() as c:
        cur = c.execute(
            "DELETE FROM garden_plants WHERE id = ? AND user_id = ?",
            (plant_id, user_id),
        )
        return cur.rowcount > 0


def set_plant_track(plant_id: int, user_id: int, track_id: str) -> bool:
    with _conn() as c:
        cur = c.execute(
            "UPDATE garden_plants SET track_id = ? WHERE id = ? AND user_id = ?",
            (track_id, plant_id, user_id),
        )
        return cur.rowcount > 0


# ---------- 诊断历史 / 首页聚合 ----------

def log_diagnosis(user_id: int | None, crop: str | None, species: dict,
                  disease: dict, low_confidence: bool,
                  suggestion: str | None = None, candidates: list | None = None,
                  image_url: str | None = None) -> int:
    with _conn() as c:
        cur = c.execute(
            """INSERT INTO diagnoses
               (user_id, crop, species_label, disease_label, disease_name,
                disease_confidence, low_confidence, created_at,
                species_confidence, suggestion, candidates, image_url)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                user_id, crop,
                species.get("label"), disease.get("label"),
                disease.get("name"), disease.get("confidence"),
                1 if low_confidence else 0, _now(),
                species.get("confidence"),
                suggestion,
                json.dumps(candidates, ensure_ascii=False) if candidates else None,
                image_url,
            ),
        )
        return cur.lastrowid


def get_diagnosis(diagnosis_id: int) -> dict | None:
    with _conn() as c:
        row = c.execute(
            """SELECT id, user_id, crop, species_label, disease_label,
                      disease_name, disease_confidence, low_confidence,
                      species_confidence, suggestion, candidates, image_url,
                      created_at
               FROM diagnoses WHERE id = ?""",
            (diagnosis_id,),
        ).fetchone()
    if row is None:
        return None
    d = dict(row)
    try:
        d["candidates"] = json.loads(d["candidates"]) if d["candidates"] else []
    except (TypeError, ValueError):
        d["candidates"] = []
    return d


def recent_diagnoses(user_id: int | None, limit: int = 10) -> list:
    """用户自己的最近诊断；user_id 为 None 时返回全部（游客也能看）。"""
    with _conn() as c:
        if user_id is None:
            rows = c.execute(
                """SELECT id, user_id, crop, species_label, disease_label,
                          disease_name, disease_confidence, low_confidence,
                          species_confidence, image_url, created_at
                   FROM diagnoses ORDER BY id DESC LIMIT ?""",
                (limit,),
            ).fetchall()
        else:
            rows = c.execute(
                """SELECT id, user_id, crop, species_label, disease_label,
                          disease_name, disease_confidence, low_confidence,
                          species_confidence, image_url, created_at
                   FROM diagnoses WHERE user_id = ? ORDER BY id DESC LIMIT ?""",
                (user_id, limit),
            ).fetchall()
    return [dict(r) for r in rows]


def _latest_record_for_track(track_id: str) -> dict | None:
    with _conn() as c:
        row = c.execute(
            """SELECT date, disease_label, disease_name, disease_confidence
               FROM track_records WHERE track_id = ?
               ORDER BY date DESC, id DESC LIMIT 1""",
            (track_id,),
        ).fetchone()
    return dict(row) if row else None


def garden_with_status(user_id: int) -> list:
    """花园列表 + 每株植物最新一次追踪记录（健康状态由此推断）。"""
    plants = list_garden(user_id)
    for p in plants:
        rec = _latest_record_for_track(p["track_id"]) if p["track_id"] else None
        p["last_record"] = rec
    return plants


def garden_todos(user_id: int) -> list:
    """根据花园状态生成今日待办（全量，不截断）。"""
    plants = garden_with_status(user_id)
    todos = []
    today = datetime.now(timezone.utc).date()
    for p in plants:
        rec = p["last_record"]
        if rec is None:
            todos.append({"type": "track", "plant_id": p["id"],
                          "text": f"为「{p['nickname']}」建立健康追踪"})
        elif rec["disease_label"] == "diseased":
            todos.append({"type": "review", "plant_id": p["id"],
                          "text": f"复查「{p['nickname']}」（上次：{rec['disease_name'] or '发现病害'}）"})
        if rec is not None:
            try:
                last = datetime.strptime(rec["date"], "%Y-%m-%d").date()
            except ValueError:
                last = None
            if last and (today - last).days >= 7:
                todos.append({"type": "photo", "plant_id": p["id"],
                              "text": f"该给「{p['nickname']}」拍照记录了（上次 {rec['date']}）"})
    return todos


def home_summary(user_id: int | None) -> dict:
    """首页聚合：花园健康度 + 今日待办。"""
    plants = garden_with_status(user_id) if user_id else []
    scores = []
    for p in plants:
        rec = p["last_record"]
        if rec is None:
            scores.append(90.0)
        elif rec["disease_label"] == "diseased":
            scores.append(max(20.0, 100.0 - (rec["disease_confidence"] or 0.5) * 100.0))
        else:
            scores.append(100.0)
    health = round(sum(scores) / len(scores)) if scores else None
    # 首页只展示前 5 条；完整清单走 GET /todos
    todos = garden_todos(user_id)[:5] if user_id else []
    return {"health_score": health, "todos": todos, "plant_count": len(plants)}


# ---------- 社交：点赞 / 收藏 / 关注 / 个人资料 ----------

def toggle_like(post_id: int, user_id: int) -> dict | None:
    """登录用户的点赞切换（幂等）。返回 {likes, liked}；帖子不存在返回 None。"""
    with _conn() as c:
        if c.execute("SELECT 1 FROM posts WHERE id = ?", (post_id,)).fetchone() is None:
            return None
        if c.execute("SELECT 1 FROM post_likes WHERE post_id=? AND user_id=?", (post_id, user_id)).fetchone():
            c.execute("DELETE FROM post_likes WHERE post_id=? AND user_id=?", (post_id, user_id))
            c.execute("UPDATE posts SET likes = MAX(likes - 1, 0) WHERE id = ?", (post_id,))
            liked = False
        else:
            c.execute("INSERT INTO post_likes (post_id, user_id, created_at) VALUES (?,?,?)",
                      (post_id, user_id, _now()))
            c.execute("UPDATE posts SET likes = likes + 1 WHERE id = ?", (post_id,))
            liked = True
        row = c.execute("SELECT likes FROM posts WHERE id = ?", (post_id,)).fetchone()
    return {"likes": row["likes"], "liked": liked}


def toggle_favorite(post_id: int, user_id: int) -> bool | None:
    """收藏切换，返回收藏后的状态；帖子不存在返回 None。"""
    with _conn() as c:
        if c.execute("SELECT 1 FROM posts WHERE id = ?", (post_id,)).fetchone() is None:
            return None
        if c.execute("SELECT 1 FROM favorites WHERE post_id=? AND user_id=?", (post_id, user_id)).fetchone():
            c.execute("DELETE FROM favorites WHERE post_id=? AND user_id=?", (post_id, user_id))
            return False
        c.execute("INSERT INTO favorites (post_id, user_id, created_at) VALUES (?,?,?)",
                  (post_id, user_id, _now()))
        return True


def toggle_follow(follower_id: int, target_id: int) -> bool | None:
    """关注切换。不能关注自己；目标用户不存在返回 None。返回关注后的状态。"""
    if follower_id == target_id:
        raise ValueError("不能关注自己")
    with _conn() as c:
        if c.execute("SELECT 1 FROM users WHERE id = ?", (target_id,)).fetchone() is None:
            return None
        if c.execute("SELECT 1 FROM follows WHERE follower_id=? AND followee_id=?",
                     (follower_id, target_id)).fetchone():
            c.execute("DELETE FROM follows WHERE follower_id=? AND followee_id=?",
                      (follower_id, target_id))
            return False
        c.execute("INSERT INTO follows (follower_id, followee_id, created_at) VALUES (?,?,?)",
                  (follower_id, target_id, _now()))
        return True


def profile_summary(user_id: int) -> dict:
    with _conn() as c:
        u = c.execute("SELECT id, username, nickname, avatar_url FROM users WHERE id = ?", (user_id,)).fetchone()
        if u is None:
            return None
        following = c.execute(
            "SELECT COUNT(*) AS n FROM follows WHERE follower_id = ?", (user_id,)).fetchone()["n"]
        followers = c.execute(
            "SELECT COUNT(*) AS n FROM follows WHERE followee_id = ?", (user_id,)).fetchone()["n"]
        likes_received = c.execute(
            """SELECT COUNT(*) AS n FROM post_likes pl
               JOIN posts p ON p.id = pl.post_id WHERE p.user_id = ?""",
            (user_id,)).fetchone()["n"]
        post_count = c.execute(
            "SELECT COUNT(*) AS n FROM posts WHERE user_id = ?", (user_id,)).fetchone()["n"]
    return {"id": u["id"], "username": u["username"],
            "nickname": u["nickname"], "avatar_url": u["avatar_url"],
            "following": following, "followers": followers,
            "likes_received": likes_received, "post_count": post_count}


def update_user_profile(user_id: int, nickname: str | None = None,
                        avatar_url: str | None = None) -> dict:
    """更新昵称和/或头像，返回更新后的用户资料。"""
    with _conn() as c:
        if nickname is not None:
            nickname = nickname.strip()
            if not nickname or len(nickname) > 20:
                raise ValueError("昵称需为 1~20 个字符")
            c.execute("UPDATE users SET nickname = ? WHERE id = ?", (nickname, user_id))
        if avatar_url is not None:
            c.execute("UPDATE users SET avatar_url = ? WHERE id = ?", (avatar_url, user_id))
        u = c.execute("SELECT id, username, nickname, avatar_url FROM users WHERE id = ?",
                      (user_id,)).fetchone()
        if u is None:
            raise ValueError("用户不存在")
    return {"id": u["id"], "username": u["username"],
            "nickname": u["nickname"], "avatar_url": u["avatar_url"]}


# ---------- 消息通知 ----------

def post_owner(post_id: int) -> int | None:
    """帖子作者的 user_id；帖子不存在或老帖无作者返回 None。"""
    with _conn() as c:
        row = c.execute("SELECT user_id FROM posts WHERE id = ?", (post_id,)).fetchone()
    return row["user_id"] if row else None


def add_notification(user_id: int, actor_id: int | None, type_: str,
                     post_id: int | None = None, content: str | None = None) -> None:
    """写入一条通知。自己给自己产生的互动不通知。"""
    if actor_id is not None and actor_id == user_id:
        return
    with _conn() as c:
        c.execute(
            "INSERT INTO notifications (user_id, actor_id, type, post_id, content, created_at)"
            " VALUES (?,?,?,?,?,?)",
            (user_id, actor_id, type_, post_id, content, _now()),
        )


def list_notifications(user_id: int, limit: int = 50) -> list:
    with _conn() as c:
        rows = c.execute(
                """SELECT n.id, n.type, n.post_id, n.content, n.is_read, n.created_at,
                      COALESCE(a.nickname, a.username) AS actor_nickname,
                      a.avatar_url AS actor_avatar,
                      p.status AS post_status
               FROM notifications n
               LEFT JOIN users a ON a.id = n.actor_id
               LEFT JOIN posts p ON p.id = n.post_id
               WHERE n.user_id = ?
               ORDER BY n.id DESC LIMIT ?""",
            (user_id, limit),
        ).fetchall()
    return [dict(r) for r in rows]


def unread_notification_count(user_id: int) -> int:
    with _conn() as c:
        return c.execute(
            "SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0",
            (user_id,),
        ).fetchone()["n"]


def mark_notifications_read(user_id: int) -> int:
    """全部标为已读，返回影响的行数。"""
    with _conn() as c:
        cur = c.execute(
            "UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0",
            (user_id,),
        )
        return cur.rowcount


def _posts_by_flag(user_id: int, flag_table: str) -> list:
    with _conn() as c:
        rows = c.execute(
            f"""SELECT p.id, p.nickname, p.title, p.body, p.image_emoji, p.likes, p.created_at,
                       p.images, p.tags, p.is_public,
                       (SELECT COUNT(*) FROM comments cm WHERE cm.post_id = p.id) AS comment_count
                FROM {flag_table} f JOIN posts p ON p.id = f.post_id
                WHERE f.user_id = ? ORDER BY f.created_at DESC LIMIT 50""",
            (user_id,),
        ).fetchall()
    return [_post_row_to_dict(r) for r in rows]


def liked_posts(user_id: int) -> list:
    return _posts_by_flag(user_id, "post_likes")


def favorited_posts(user_id: int) -> list:
    return _posts_by_flag(user_id, "favorites")


def my_posts(user_id: int) -> list:
    """我发过的帖子（含私密帖），最新在前。被下架的进草稿箱，这里不再列出。"""
    with _conn() as c:
        rows = c.execute(
            """SELECT p.id, p.nickname, p.title, p.body, p.image_emoji, p.likes,
                      p.user_id, p.images, p.tags, p.is_public, p.created_at,
                      (SELECT COUNT(*) FROM comments cm WHERE cm.post_id = p.id) AS comment_count
               FROM posts p WHERE p.user_id = ? AND p.status = 'published'
               ORDER BY p.created_at DESC LIMIT 50""",
            (user_id,),
        ).fetchall()
    return [_post_row_to_dict(r) for r in rows]


def drafts_of_user(user_id: int) -> list:
    """草稿箱：被管理员下架、等作者改完重新发的自己的帖子。"""
    with _conn() as c:
        rows = c.execute(
            """SELECT p.id, p.title, p.body, p.image_emoji, p.nickname, p.likes,
                      p.user_id, p.images, p.tags, p.is_public, p.status,
                      p.takedown_reason, p.created_at
               FROM posts p
               WHERE p.user_id = ? AND p.status = 'takedown'
               ORDER BY p.created_at DESC LIMIT 50""",
            (user_id,),
        ).fetchall()
    return [_post_row_to_dict(r) for r in rows]


def update_user_post(pid: int, user_id: int, title: str, body: str,
                     tags: list, images: list, is_public: bool) -> bool:
    """作者编辑自己的帖子并重新提交发布：清掉下架状态与原因。"""
    with _conn() as c:
        row = c.execute("SELECT user_id FROM posts WHERE id = ?", (pid,)).fetchone()
        if row is None or row["user_id"] != user_id:
            return False
        c.execute(
            """UPDATE posts SET title = ?, body = ?, tags = ?, images = ?, is_public = ?,
                      status = 'published', takedown_reason = NULL
               WHERE id = ?""",
            (title, body, json.dumps(tags or [], ensure_ascii=False),
             json.dumps(images or [], ensure_ascii=False),
             1 if is_public else 0, pid),
        )
        return True


def my_comments(user_id: int) -> list:
    with _conn() as c:
        rows = c.execute(
            """SELECT cm.id, cm.post_id, cm.body, cm.created_at, p.title AS post_title
               FROM comments cm JOIN posts p ON p.id = cm.post_id
               WHERE cm.user_id = ? ORDER BY cm.id DESC LIMIT 50""",
            (user_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def get_user_public(user_id: int) -> dict | None:
    with _conn() as c:
        row = c.execute("SELECT id, username, created_at FROM users WHERE id = ?", (user_id,)).fetchone()
    return dict(row) if row else None


def ensure_demo_user() -> int:
    """演示账号 demo / 1234（不存在则创建），返回 user_id。"""
    with _conn() as c:
        row = c.execute("SELECT id FROM users WHERE username = 'demo'").fetchone()
    if row:
        return row["id"]
    try:
        return create_user("demo", "1234")
    except ValueError:
        with _conn() as c:
            return c.execute("SELECT id FROM users WHERE username = 'demo'").fetchone()["id"]


# ---------- 管理员后台 ----------

def seed_admin() -> None:
    """预置管理员：用户名/密码来自环境变量 ADMIN_USERNAME / ADMIN_PASSWORD，
    默认 admin / admin123。仅当系统中不存在任何管理员时才创建，
    避免管理员改名后重启后端冒出第二个默认 admin 账号。"""
    username = os.environ.get("ADMIN_USERNAME", "admin")
    password = os.environ.get("ADMIN_PASSWORD", "admin123")
    with _conn() as c:
        existing = c.execute(
            "SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1"
        ).fetchone()
        if existing:
            return
        # 兜底：若有同名账号但不是管理员，提升为管理员；否则新建
        row = c.execute(
            "SELECT id FROM users WHERE username = ? ORDER BY id", (username,)
        ).fetchone()
        if row:
            c.execute("UPDATE users SET role = 'admin' WHERE id = ?", (row["id"],))
            return
        salt = secrets.token_hex(16)
        pw_hash = _hash_password(password, salt)
        c.execute(
            "INSERT INTO users (username, pw_salt, pw_hash, role, created_at) VALUES (?,?,?,?,?)",
            (username, salt, pw_hash, "admin", _now()),
        )


def list_users_admin() -> list:
    """管理员视角：全部用户 + 发帖数 / 花园株数。"""
    with _conn() as c:
        rows = c.execute(
            """SELECT u.id, u.username, u.role, u.nickname, u.created_at,
                      (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id) AS post_count,
                      (SELECT COUNT(*) FROM garden_plants g WHERE g.user_id = u.id) AS garden_count
               FROM users u ORDER BY u.id ASC"""
        ).fetchall()
    return [dict(r) for r in rows]


def delete_user_admin(uid: int) -> bool:
    """级联删除用户及其全部数据（花园/追踪/帖子/评论/互动/关注/诊断/会话）。"""
    with _conn() as c:
        if c.execute("SELECT 1 FROM users WHERE id = ?", (uid,)).fetchone() is None:
            return False
        # 花园植物 + 关联的追踪与记录
        track_ids = [r["track_id"] for r in c.execute(
            "SELECT track_id FROM garden_plants WHERE user_id = ? AND track_id IS NOT NULL", (uid,)).fetchall()]
        if track_ids:
            q = ",".join("?" * len(track_ids))
            c.execute(f"DELETE FROM track_records WHERE track_id IN ({q})", track_ids)
            c.execute(f"DELETE FROM tracks WHERE id IN ({q})", track_ids)
        c.execute("DELETE FROM garden_plants WHERE user_id = ?", (uid,))
        # 帖子 + 评论 / 点赞 / 收藏
        post_ids = [r["id"] for r in c.execute("SELECT id FROM posts WHERE user_id = ?", (uid,)).fetchall()]
        if post_ids:
            q = ",".join("?" * len(post_ids))
            c.execute(f"DELETE FROM comments WHERE post_id IN ({q})", post_ids)
            c.execute(f"DELETE FROM post_likes WHERE post_id IN ({q})", post_ids)
            c.execute(f"DELETE FROM favorites WHERE post_id IN ({q})", post_ids)
            c.execute(f"DELETE FROM posts WHERE id IN ({q})", post_ids)
        # 互动 / 关注 / 诊断 / 会话
        c.execute("DELETE FROM post_likes WHERE user_id = ?", (uid,))
        c.execute("DELETE FROM favorites WHERE user_id = ?", (uid,))
        c.execute("DELETE FROM follows WHERE follower_id = ? OR followee_id = ?", (uid, uid))
        c.execute("DELETE FROM diagnoses WHERE user_id = ?", (uid,))
        c.execute("DELETE FROM comments WHERE user_id = ?", (uid,))
        # 通知：发给他的直接删，他作为操作人的置空（否则外键约束会拦住删用户）
        c.execute("DELETE FROM notifications WHERE user_id = ?", (uid,))
        c.execute("UPDATE notifications SET actor_id = NULL WHERE actor_id = ?", (uid,))
        c.execute("DELETE FROM sessions WHERE user_id = ?", (uid,))
        c.execute("DELETE FROM users WHERE id = ?", (uid,))
        return True


def list_posts_admin(limit: int = 200) -> list:
    """管理员视角：全部帖子 + 作者账号 / 评论数。"""
    with _conn() as c:
        rows = c.execute(
            """SELECT p.id, p.title, p.nickname AS post_nick, p.likes, p.created_at, p.user_id,
                      p.status, p.takedown_reason,
                      u.username AS author_username,
                      (SELECT COUNT(*) FROM comments cm WHERE cm.post_id = p.id) AS comment_count
               FROM posts p LEFT JOIN users u ON u.id = p.user_id
               ORDER BY p.created_at DESC LIMIT ?""",
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]


def delete_own_post(pid: int, user_id: int) -> bool:
    """作者删除自己的帖子，连带清掉评论 / 点赞 / 收藏 / 相关通知。"""
    with _conn() as c:
        row = c.execute("SELECT user_id FROM posts WHERE id = ?", (pid,)).fetchone()
        if row is None or row["user_id"] != user_id:
            return False
        c.execute("DELETE FROM comments WHERE post_id = ?", (pid,))
        c.execute("DELETE FROM post_likes WHERE post_id = ?", (pid,))
        c.execute("DELETE FROM favorites WHERE post_id = ?", (pid,))
        c.execute("DELETE FROM notifications WHERE post_id = ?", (pid,))
        c.execute("DELETE FROM posts WHERE id = ?", (pid,))
        return True


def set_post_visibility(pid: int, user_id: int, is_public: bool) -> bool:
    """作者切换帖子可见范围（公开 / 仅自己）。"""
    with _conn() as c:
        cur = c.execute(
            "UPDATE posts SET is_public = ? WHERE id = ? AND user_id = ?",
            (1 if is_public else 0, pid, user_id),
        )
        return cur.rowcount > 0


def delete_post_admin(pid: int) -> bool:
    """级联删除帖子及其评论 / 点赞 / 收藏。"""
    with _conn() as c:
        if c.execute("SELECT 1 FROM posts WHERE id = ?", (pid,)).fetchone() is None:
            return False
        c.execute("DELETE FROM comments WHERE post_id = ?", (pid,))
        c.execute("DELETE FROM post_likes WHERE post_id = ?", (pid,))
        c.execute("DELETE FROM favorites WHERE post_id = ?", (pid,))
        c.execute("DELETE FROM posts WHERE id = ?", (pid,))
        return True


def delete_comment_admin(cid: int) -> bool:
    with _conn() as c:
        if c.execute("SELECT 1 FROM comments WHERE id = ?", (cid,)).fetchone() is None:
            return False
        c.execute("DELETE FROM comments WHERE id = ?", (cid,))
        return True


def set_user_role(uid: int, role: str) -> bool:
    """设置用户角色（'admin' / 'user'）。返回用户是否存在。"""
    if role not in ("admin", "user"):
        raise ValueError("bad_role")
    with _conn() as c:
        cur = c.execute("UPDATE users SET role = ? WHERE id = ?", (role, uid))
        return cur.rowcount > 0


def takedown_post_admin(pid: int, reason: str) -> dict | None:
    """下架帖子并记录原因。返回作者信息（用于发通知），帖子不存在返回 None。"""
    with _conn() as c:
        row = c.execute(
            "SELECT id, user_id, title FROM posts WHERE id = ?", (pid,)
        ).fetchone()
        if row is None:
            return None
        c.execute(
            "UPDATE posts SET status = 'takedown', takedown_reason = ? WHERE id = ?",
            (reason, pid),
        )
    return {"user_id": row["user_id"], "title": row["title"]}


def restore_post_admin(pid: int) -> bool:
    """恢复被下架的帖子。"""
    with _conn() as c:
        cur = c.execute(
            "UPDATE posts SET status = 'published', takedown_reason = NULL WHERE id = ?",
            (pid,),
        )
        return cur.rowcount > 0


def get_admin_stats() -> dict:
    """全站统计，供管理首页展示。"""
    with _conn() as c:
        def _cnt(tbl: str) -> int:
            return c.execute(f"SELECT COUNT(*) AS n FROM {tbl}").fetchone()["n"]
        return {
            "users": _cnt("users"),
            "posts": _cnt("posts"),
            "comments": _cnt("comments"),
            "diagnoses": _cnt("diagnoses"),
            "follows": _cnt("follows"),
            "garden_plants": _cnt("garden_plants"),
            "tracks": _cnt("tracks"),
            "track_records": _cnt("track_records"),
        }


def seed_demo_garden(user_id: int) -> None:
    """演示花园：三株植物分别覆盖「好转中 / 健康 / 该拍照了」三种状态。
    只在该用户花园为空时种，避免覆盖用户自己的操作。"""
    with _conn() as c:
        n = c.execute(
            "SELECT COUNT(*) AS n FROM garden_plants WHERE user_id = ?", (user_id,)
        ).fetchone()["n"]
    if n:
        return
    today = datetime.now(timezone.utc).date()

    def d(days_ago: int) -> str:
        return (today - timedelta(days=days_ago)).isoformat()

    # 1) 番茄：早疫病，连续 4 次记录置信度递减 → 好转中
    pid = add_plant(user_id, "阳台番茄1号", "Tomato", "🍅", d(30), "南阳台 · 1号花盆")
    tid = f"demo-tomato-{user_id}"
    create_track(tid, "阳台番茄1号", "Tomato")
    set_plant_track(pid, user_id, tid)
    for days, conf in [(12, 0.91), (9, 0.80), (6, 0.62), (3, 0.44)]:
        add_track_record(
            tid, d(days), {"label": "番茄 (Tomato)"},
            {"label": "diseased", "name": "Early Blight", "confidence": conf}, None,
        )

    # 2) 草莓：两天前记录，健康
    pid = add_plant(user_id, "奶油草莓", "Strawberry", "🍓", d(20), None)
    tid = f"demo-strawberry-{user_id}"
    create_track(tid, "奶油草莓", "Strawberry")
    set_plant_track(pid, user_id, tid)
    add_track_record(
        tid, d(2), {"label": "草莓 (Strawberry)"},
        {"label": "healthy", "name": "Healthy", "confidence": 0.97}, None,
    )

    # 3) 薄荷：上次记录在 10 天前 → 触发「该拍照了」提醒
    pid = add_plant(user_id, "窗台薄荷", "Mint", "🌿", d(45), "厨房窗台")
    tid = f"demo-mint-{user_id}"
    create_track(tid, "窗台薄荷", "Mint")
    set_plant_track(pid, user_id, tid)
    add_track_record(
        tid, d(10), {"label": "薄荷 (Mint)"},
        {"label": "healthy", "name": "Healthy", "confidence": 0.95}, None,
    )


def seed_if_empty() -> None:
    """演示种子：空库时发 2 条帖子 + 1 条追踪记录，盖过空列表（文档 §12）。"""
    with _conn() as c:
        n = c.execute("SELECT COUNT(*) AS n FROM posts").fetchone()["n"]
        t = c.execute("SELECT COUNT(*) AS n FROM tracks").fetchone()["n"]
    if n == 0:
        create_post("绿手指小王", "番茄叶子背面有紫斑是怎么回事？", "如图，下部老叶先出现，越老越严重。有经验的朋友帮忙看看。", "🍅")
        create_post("阳台种植党", "月季嫁接到野蔷薇上成活了，分享流程", "T 字芽接，绑膜 20 天后拆的，接芽已经抽新梢了。有问题可以问。", "🌹")
    if t == 0:
        create_track("seed-tomato-01", "番茄 · 1号盆", "番茄")
        for date, conf in [("2026-10-20", 0.91), ("2026-10-24", 0.78), ("2026-10-28", 0.60)]:
            add_track_record(
                "seed-tomato-01", date,
                {"label": "番茄 (Tomato)"},
                {"label": "diseased", "name": "Early Blight", "confidence": conf},
                None,
            )
