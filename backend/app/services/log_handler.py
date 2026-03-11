import logging
import threading
from collections import deque
from datetime import datetime, timezone


class BufferedLogHandler(logging.Handler):
    """A logging handler that stores log records in a fixed-size ring buffer."""

    def __init__(self, capacity: int = 500):
        super().__init__()
        self._buffer: deque[dict] = deque(maxlen=capacity)
        self._lock = threading.Lock()

    def emit(self, record: logging.LogRecord) -> None:
        entry = {
            'timestamp': datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            'level': record.levelname,
            'logger': record.name,
            'message': self.format(record),
        }
        with self._lock:
            self._buffer.append(entry)

    def get_entries(self, level: str | None = None) -> list[dict]:
        """Return log entries, optionally filtered by minimum level."""
        with self._lock:
            entries = list(self._buffer)
        if level:
            min_level = getattr(logging, level.upper(), logging.DEBUG)
            entries = [e for e in entries if getattr(logging, e['level'], 0) >= min_level]
        return entries

    def clear(self) -> None:
        with self._lock:
            self._buffer.clear()


# Singleton instance
log_handler = BufferedLogHandler()
