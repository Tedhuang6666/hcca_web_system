"""add_missing_fk_ondelete_policy_apikey_audit_identity

Revision ID: f87b2273c9e3
Revises: 0875b2aea8fe
Create Date: 2026-07-06 13:51:12.799395

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f87b2273c9e3'
down_revision: Union[str, Sequence[str], None] = '0875b2aea8fe'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_constraint(op.f('api_keys_owner_user_id_fkey'), 'api_keys', type_='foreignkey')
    op.create_foreign_key(
        op.f('api_keys_owner_user_id_fkey'), 'api_keys', 'users', ['owner_user_id'], ['id'], ondelete='CASCADE'
    )
    op.drop_constraint(op.f('audit_log_anchors_last_audit_log_id_fkey'), 'audit_log_anchors', type_='foreignkey')
    op.create_foreign_key(
        op.f('audit_log_anchors_last_audit_log_id_fkey'),
        'audit_log_anchors', 'audit_logs', ['last_audit_log_id'], ['id'], ondelete='SET NULL'
    )
    op.drop_constraint(op.f('policy_consents_policy_document_id_fkey'), 'policy_consents', type_='foreignkey')
    op.drop_constraint(op.f('policy_consents_user_id_fkey'), 'policy_consents', type_='foreignkey')
    op.create_foreign_key(
        op.f('policy_consents_policy_document_id_fkey'),
        'policy_consents', 'policy_documents', ['policy_document_id'], ['id'], ondelete='RESTRICT'
    )
    op.create_foreign_key(
        op.f('policy_consents_user_id_fkey'), 'policy_consents', 'users', ['user_id'], ['id'], ondelete='RESTRICT'
    )
    op.drop_constraint(op.f('policy_documents_published_by_fkey'), 'policy_documents', type_='foreignkey')
    op.create_foreign_key(
        op.f('policy_documents_published_by_fkey'),
        'policy_documents', 'users', ['published_by'], ['id'], ondelete='SET NULL'
    )
    op.drop_constraint(op.f('privacy_requests_handled_by_fkey'), 'privacy_requests', type_='foreignkey')
    op.drop_constraint(op.f('privacy_requests_user_id_fkey'), 'privacy_requests', type_='foreignkey')
    op.create_foreign_key(
        op.f('privacy_requests_handled_by_fkey'),
        'privacy_requests', 'users', ['handled_by'], ['id'], ondelete='SET NULL'
    )
    op.create_foreign_key(
        op.f('privacy_requests_user_id_fkey'), 'privacy_requests', 'users', ['user_id'], ['id'], ondelete='RESTRICT'
    )
    op.drop_constraint(op.f('user_identities_user_id_fkey'), 'user_identities', type_='foreignkey')
    op.create_foreign_key(
        op.f('user_identities_user_id_fkey'), 'user_identities', 'users', ['user_id'], ['id'], ondelete='CASCADE'
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(op.f('user_identities_user_id_fkey'), 'user_identities', type_='foreignkey')
    op.create_foreign_key(op.f('user_identities_user_id_fkey'), 'user_identities', 'users', ['user_id'], ['id'])
    op.drop_constraint(op.f('privacy_requests_user_id_fkey'), 'privacy_requests', type_='foreignkey')
    op.drop_constraint(op.f('privacy_requests_handled_by_fkey'), 'privacy_requests', type_='foreignkey')
    op.create_foreign_key(op.f('privacy_requests_user_id_fkey'), 'privacy_requests', 'users', ['user_id'], ['id'])
    op.create_foreign_key(
        op.f('privacy_requests_handled_by_fkey'), 'privacy_requests', 'users', ['handled_by'], ['id']
    )
    op.drop_constraint(op.f('policy_documents_published_by_fkey'), 'policy_documents', type_='foreignkey')
    op.create_foreign_key(
        op.f('policy_documents_published_by_fkey'), 'policy_documents', 'users', ['published_by'], ['id']
    )
    op.drop_constraint(op.f('policy_consents_user_id_fkey'), 'policy_consents', type_='foreignkey')
    op.drop_constraint(op.f('policy_consents_policy_document_id_fkey'), 'policy_consents', type_='foreignkey')
    op.create_foreign_key(op.f('policy_consents_user_id_fkey'), 'policy_consents', 'users', ['user_id'], ['id'])
    op.create_foreign_key(
        op.f('policy_consents_policy_document_id_fkey'),
        'policy_consents', 'policy_documents', ['policy_document_id'], ['id']
    )
    op.drop_constraint(op.f('audit_log_anchors_last_audit_log_id_fkey'), 'audit_log_anchors', type_='foreignkey')
    op.create_foreign_key(
        op.f('audit_log_anchors_last_audit_log_id_fkey'),
        'audit_log_anchors', 'audit_logs', ['last_audit_log_id'], ['id']
    )
    op.drop_constraint(op.f('api_keys_owner_user_id_fkey'), 'api_keys', type_='foreignkey')
    op.create_foreign_key(op.f('api_keys_owner_user_id_fkey'), 'api_keys', 'users', ['owner_user_id'], ['id'])
