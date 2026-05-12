"""異常行為偵測 - 檢測異常登入、速率異常等"""

import logging
from datetime import datetime, timedelta

from api.core.security import redis_client

logger = logging.getLogger(__name__)


async def record_login(user_id: str, ip: str, user_agent: str | None = None) -> None:
    """記錄用戶登入"""
    key = f"login:{user_id}"
    value = f"{ip}|{user_agent or 'unknown'}|{datetime.utcnow().isoformat()}"
    await redis_client.set(key, value, ex=30 * 24 * 3600)  # 保留 30 天


async def check_suspicious_login(
    user_id: str, current_ip: str
) -> tuple[bool, str | None]:
    """
    檢查是否為可疑登入（不同位置短時間內登入）

    返回 (is_suspicious, reason)
    """
    key = f"login:{user_id}"
    last_login = await redis_client.get(key)

    if not last_login:
        return False, None

    try:
        last_ip, _, last_time_str = last_login.decode().split("|")
        if last_ip == current_ip:
            return False, None  # 同位置

        # 同一用戶在短時間內（< 30 分鐘）從不同地點登入 → 可疑
        last_time = datetime.fromisoformat(last_time_str)
        time_diff = datetime.utcnow() - last_time
        if time_diff < timedelta(minutes=30):
            reason = f"短時間內 IP 改變：{last_ip} → {current_ip}（{time_diff.total_seconds() / 60:.0f} 分鐘）"
            return True, reason
    except Exception as e:
        logger.warning(f"Failed to parse login data: {e}")

    return False, None


async def track_rate_anomaly(user_id: str, endpoint: str, window_seconds: int = 60) -> int:
    """
    追蹤用戶在某端點的請求率

    返回當前窗口內的請求數
    """
    key = f"rate_anomaly:{user_id}:{endpoint}"
    try:
        count = await redis_client.incr(key)
        if count == 1:
            await redis_client.expire(key, window_seconds)
        return int(count)
    except Exception as e:
        logger.error(f"Failed to track rate anomaly: {e}")
        return 0


async def check_rate_anomaly(
    user_id: str, endpoint: str, threshold: int = 100, window_seconds: int = 60
) -> tuple[bool, int]:
    """
    檢查用戶在某端點的請求率是否異常

    返回 (is_anomalous, current_count)
    """
    count = await track_rate_anomaly(user_id, endpoint, window_seconds)
    return count > threshold, count
