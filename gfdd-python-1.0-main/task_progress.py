
import threading
from datetime import datetime, timedelta

# 全局进度存储字典
progress_store = {}

# 线程锁保证线程安全
progress_lock = threading.Lock()

# 过期时间配置(单位：小时)
PROGRESS_EXPIRE_HOURS = 1

def add_progress(session_id, total_files):
    """添加新进度记录"""
    with progress_lock:
        progress_store[session_id] = {
            "created_at": datetime.now(),
            "finished": 0,
            "total": total_files,
            "percent": 0,
            "filename": None
        }

def update_progress(session_id, finished, filename):
    """更新进度信息"""
    with progress_lock:
        if session_id in progress_store:
            progress = progress_store[session_id]
            progress["finished"] = finished
            progress["filename"] = filename
            progress["percent"] = int((finished / progress["total"]) * 100) if progress["total"] else 100

def get_progress(session_id):
    """获取进度信息"""
    with progress_lock:
        return progress_store.get(session_id)

def cleanup_expired_progress():
    """清理过期进度记录"""
    with progress_lock:
        now = datetime.now()
        expired_keys = [
            k for k, v in progress_store.items()
            if now - v["created_at"] > timedelta(hours=PROGRESS_EXPIRE_HOURS)
        ]
        for k in expired_keys:
            del progress_store[k]
