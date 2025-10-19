# migrations/versions/xxxx_drop_unique_soldier_window.py
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '395f0ce9c47a'
down_revision: Union[str, None] = '8b55bc16180f'
branch_labels = None
depends_on = None

def upgrade():
    # Drop the unique constraint so overlaps are allowed
    op.drop_constraint(
        "uq_assignments_soldier_window",
        "assignments",
        type_="unique",
    )
    # Optional: keep it fast to query overlaps by adding a plain index
    op.create_index(
        "ix_assignments_soldier_window",
        "assignments",
        ["soldier_id", "start_at", "end_at"],
        unique=False,
    )

def downgrade():
    op.drop_index("ix_assignments_soldier_window", table_name="assignments")
    op.create_unique_constraint(
        "uq_assignments_soldier_window",
        "assignments",
        ["soldier_id", "start_at", "end_at"],
    )
