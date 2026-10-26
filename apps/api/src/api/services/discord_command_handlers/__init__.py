"""依 Discord 指令領域分派的 handler。"""

from api.services.discord_command_admin import handle as admin
from api.services.discord_command_discovery import handle as discovery
from api.services.discord_command_documents import handle as documents
from api.services.discord_command_identity import handle_identity
from api.services.discord_command_notifications import handle as notifications
from api.services.discord_command_operations import handle as operations
from api.services.discord_command_petitions import handle as petitions
from api.services.discord_command_work_items import handle as work_items

__all__ = [
    "handle_identity",
    "operations",
    "work_items",
    "documents",
    "petitions",
    "notifications",
    "discovery",
    "admin",
]
