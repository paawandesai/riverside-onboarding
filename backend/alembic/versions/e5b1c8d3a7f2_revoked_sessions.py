"""per-browser sign-out: revoked session ids

Revision ID: e5b1c8d3a7f2
Revises: d4a9e2f7c1b3
Create Date: 2026-10-17 21:40:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e5b1c8d3a7f2"
down_revision: str | Sequence[str] | None = "d4a9e2f7c1b3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "revoked_sessions",
        sa.Column("sid", sa.String(length=32), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("sid"),
    )
    op.create_index(op.f("ix_revoked_sessions_revoked_at"), "revoked_sessions", ["revoked_at"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_revoked_sessions_revoked_at"), table_name="revoked_sessions")
    op.drop_table("revoked_sessions")
