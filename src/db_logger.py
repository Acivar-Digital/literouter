import sqlite3
import json
import os
import time

DB_PATH = "logs/literouter_logs.db"

def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS request_legs (
            req_id TEXT NOT NULL,
            leg INTEGER NOT NULL,
            timestamp REAL NOT NULL,
            direction TEXT NOT NULL, -- 'INCOMING' or 'OUTGOING'
            source TEXT NOT NULL,     -- 'opencode' or 'upstream'
            destination TEXT NOT NULL,-- 'literouter' or 'opencode' or 'upstream'
            url TEXT,
            status_code INTEGER,
            body TEXT,
            PRIMARY KEY (req_id, leg)
        )
    """)
    conn.commit()
    conn.close()

def log_leg(req_id: str, leg: int, direction: str, source: str, destination: str, url: str = None, status_code: int = None, body: dict = None):
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        body_str = json.dumps(body) if body is not None else None
        cursor.execute("""
            INSERT OR REPLACE INTO request_legs (req_id, leg, timestamp, direction, source, destination, url, status_code, body)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (req_id, leg, time.time(), direction, source, destination, url, status_code, body_str))
        conn.commit()
        conn.close()
    except Exception as e:
        # Avoid crashing application if database logging fails
        import logging
        logging.getLogger(__name__).error("SQLite logging error: %s", e)
