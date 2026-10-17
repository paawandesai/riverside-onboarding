"""flag for made-up demo patients

Revision ID: d4a9e2f7c1b3
Revises: b7d2c41e9a10
Create Date: 2026-10-17 21:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d4a9e2f7c1b3"
down_revision: str | Sequence[str] | None = "b7d2c41e9a10"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("users", sa.Column("synthetic", sa.Boolean(), server_default="false", nullable=False))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("users", "synthetic")
