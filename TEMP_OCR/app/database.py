import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import Iterator

from app.config import DATABASE_PATH, ensure_directories


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


def connect() -> sqlite3.Connection:
    ensure_directories()
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


@contextmanager
def db_session() -> Iterator[sqlite3.Connection]:
    connection = connect()
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def init_database() -> None:
    schema = """
    CREATE TABLE IF NOT EXISTS manga (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        author TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        thumbnail TEXT,
        tags TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chapters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        manga_id INTEGER NOT NULL,
        chapter_number TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (manga_id, chapter_number),
        FOREIGN KEY (manga_id) REFERENCES manga(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS import_batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chapter_id INTEGER NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        source_kind TEXT NOT NULL DEFAULT 'folder',
        file_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'completed',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS pages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chapter_id INTEGER NOT NULL,
        page_number INTEGER NOT NULL,
        original_image_path TEXT NOT NULL,
        clean_image_path TEXT,
        mask_preview_path TEXT,
        bubble_preview_path TEXT,
        bubble_analysis_path TEXT,
        import_batch_id INTEGER,
        original_filename TEXT NOT NULL DEFAULT '',
        content_hash TEXT NOT NULL DEFAULT '',
        review_status TEXT NOT NULL DEFAULT 'pending',
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'uploaded'
            CHECK (status IN ('uploaded', 'processing', 'ready', 'failed')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (chapter_id, page_number),
        FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS text_blocks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        page_id INTEGER NOT NULL,
        x REAL NOT NULL,
        y REAL NOT NULL,
        width REAL NOT NULL,
        height REAL NOT NULL,
        source_x REAL,
        source_y REAL,
        source_width REAL,
        source_height REAL,
        original_text TEXT NOT NULL DEFAULT '',
        ai_translation TEXT NOT NULL DEFAULT '',
        final_translation TEXT NOT NULL DEFAULT '',
        font_family TEXT NOT NULL DEFAULT 'Arial',
        font_size REAL NOT NULL DEFAULT 28,
        color TEXT NOT NULL DEFAULT '#000000',
        text_align TEXT NOT NULL DEFAULT 'center',
        text_offset_y REAL NOT NULL DEFAULT 0,
        placement_anchor_x REAL,
        placement_anchor_y REAL,
        rotation REAL NOT NULL DEFAULT 0,
        ocr_confidence REAL,
        ocr_provider TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS processing_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chapter_id INTEGER,
        page_id INTEGER,
        stage TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
        progress REAL NOT NULL DEFAULT 0,
        current_step TEXT,
        error_message TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        result_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
        FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS batch_job_pages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id INTEGER NOT NULL,
        page_id INTEGER NOT NULL,
        position INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'processing', 'completed', 'warning', 'failed', 'skipped')),
        child_job_id INTEGER,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(job_id, page_id),
        FOREIGN KEY (job_id) REFERENCES processing_jobs(id) ON DELETE CASCADE,
        FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS activity_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        manga_id INTEGER,
        chapter_id INTEGER,
        page_id INTEGER,
        action TEXT NOT NULL,
        summary TEXT NOT NULL,
        details_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY (manga_id) REFERENCES manga(id) ON DELETE SET NULL,
        FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE SET NULL,
        FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS study_publications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        manga_id INTEGER NOT NULL,
        chapter_id INTEGER NOT NULL UNIQUE,
        revision INTEGER NOT NULL DEFAULT 1,
        snapshot_json TEXT NOT NULL,
        published_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (manga_id) REFERENCES manga(id) ON DELETE CASCADE,
        FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS study_analysis_cache (
        text_hash TEXT PRIMARY KEY,
        source_text TEXT NOT NULL,
        analysis_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vocabulary (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lemma TEXT NOT NULL,
        reading TEXT NOT NULL DEFAULT '',
        surface TEXT NOT NULL DEFAULT '',
        meaning_vi TEXT NOT NULL DEFAULT '',
        source_sentence TEXT NOT NULL DEFAULT '',
        translation TEXT NOT NULL DEFAULT '',
        manga_title TEXT NOT NULL DEFAULT '',
        chapter_number TEXT NOT NULL DEFAULT '',
        page_number INTEGER,
        created_at TEXT NOT NULL,
        UNIQUE(lemma, reading)
    );
    """
    with db_session() as connection:
        connection.executescript(schema)
        _ensure_column(connection, "text_blocks", "ocr_confidence", "REAL")
        _ensure_column(connection, "text_blocks", "ocr_provider", "TEXT")
        _ensure_column(connection, "text_blocks", "source_x", "REAL")
        _ensure_column(connection, "text_blocks", "source_y", "REAL")
        _ensure_column(connection, "text_blocks", "source_width", "REAL")
        _ensure_column(connection, "text_blocks", "source_height", "REAL")
        _ensure_column(connection, "text_blocks", "text_offset_y", "REAL NOT NULL DEFAULT 0")
        _ensure_column(connection, "text_blocks", "placement_anchor_x", "REAL")
        _ensure_column(connection, "text_blocks", "placement_anchor_y", "REAL")
        _ensure_column(connection, "pages", "mask_preview_path", "TEXT")
        _ensure_column(connection, "pages", "bubble_preview_path", "TEXT")
        _ensure_column(connection, "pages", "bubble_analysis_path", "TEXT")
        _ensure_column(connection, "pages", "import_batch_id", "INTEGER")
        _ensure_column(connection, "pages", "original_filename", "TEXT NOT NULL DEFAULT ''")
        _ensure_column(connection, "pages", "content_hash", "TEXT NOT NULL DEFAULT ''")
        _ensure_column(connection, "pages", "review_status", "TEXT NOT NULL DEFAULT 'pending'")
        _ensure_column(connection, "processing_jobs", "result_count", "INTEGER NOT NULL DEFAULT 0")
        _ensure_column(connection, "processing_jobs", "current_step", "TEXT")
        _ensure_column(connection, "pages", "qa_status", "TEXT NOT NULL DEFAULT 'unknown'")
        _ensure_column(connection, "pages", "qa_issues_json", "TEXT NOT NULL DEFAULT '[]'")
        _ensure_column(connection, "pages", "last_processed_at", "TEXT")
        _ensure_column(connection, "pages", "qa_overridden", "INTEGER NOT NULL DEFAULT 0")
        _ensure_column(connection, "chapters", "publication_status", "TEXT NOT NULL DEFAULT 'draft'")
        _ensure_column(connection, "chapters", "published_at", "TEXT")
        _ensure_column(connection, "manga", "source_provider", "TEXT")
        _ensure_column(connection, "manga", "source_series_id", "TEXT")
        _ensure_column(connection, "manga", "source_url", "TEXT")
        _ensure_column(connection, "chapters", "source_provider", "TEXT")
        _ensure_column(connection, "chapters", "source_episode_id", "TEXT")
        _ensure_column(connection, "chapters", "source_url", "TEXT")
        _ensure_column(connection, "chapters", "source_published_at", "TEXT")
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_pages_chapter_hash ON pages(chapter_id, content_hash)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_history_created_at ON activity_history(created_at DESC)"
        )
        connection.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_manga_source ON manga(source_provider, source_series_id) "
            "WHERE source_provider IS NOT NULL AND source_series_id IS NOT NULL"
        )
        connection.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_chapter_source ON chapters(source_provider, source_episode_id) "
            "WHERE source_provider IS NOT NULL AND source_episode_id IS NOT NULL"
        )


def _ensure_column(connection: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    columns = {row["name"] for row in connection.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in columns:
        connection.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def row_to_dict(row: sqlite3.Row | None) -> dict | None:
    return dict(row) if row is not None else None
