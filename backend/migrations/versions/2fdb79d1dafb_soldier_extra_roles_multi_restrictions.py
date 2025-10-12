"""soldier extra roles + multi restrictions

Revision ID: 2fdb79d1dafb
Revises: 86458f984bfd
Create Date: 2025-10-10 12:58:10.085060

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2fdb79d1dafb'
down_revision: Union[str, None] = '86458f984bfd'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade():
    bind = op.get_bind()
    insp = sa.inspect(bind)

    # Create table only if it doesn't exist
    if not insp.has_table("soldier_roles"):
        op.create_table(
            "soldier_roles",
            sa.Column("soldier_id", sa.Integer(), nullable=False),
            sa.Column("role_id", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.PrimaryKeyConstraint("soldier_id", "role_id", name="pk_soldier_roles"),
        )
        op.create_foreign_key(None, "soldier_roles", "soldiers", ["soldier_id"], ["id"])
        op.create_foreign_key(None, "soldier_roles", "roles", ["role_id"], ["id"])

    # Do NOT create a separate unique constraint; the composite PK is already unique.
    # If a previous run added 'uq_soldier_role', we simply leave it as-is.

def downgrade():
    # Optional: keep table during downgrade or drop it.
    op.drop_table("soldier_roles")

