from datetime import datetime, timezone

def utcnow():
    """Store naive UTC consistently with existing SQL DateTime columns."""
    return datetime.now(timezone.utc).replace(tzinfo=None)
