"""Where the browser tests find the app: $TRACKER_URL, or a local server on $TRACKER_PORT."""
import os

TRACKER_URL = os.environ.get("TRACKER_URL") or f"http://127.0.0.1:{os.environ.get('TRACKER_PORT', '8765')}/"
