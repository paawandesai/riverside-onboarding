"""session version for revocable sessions

Revision ID: b7d2c41e9a10
Revises: 893b4847876e
Create Date: 2026-10-17 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b7d2c41e9a10"
down_revision: str | Sequence[str] | None = "893b4847876e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("users", sa.Column("session_version", sa.Integer(), server_default="0", nullable=False))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("users", "session_version")
