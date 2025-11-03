"""fix vacations sequence

Revision ID: fix_vac_seq_2025
Revises: a1b2c3d4e5f6
Create Date: 2025-11-03 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'fix_vac_seq_2025'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Fix the vacations.id sequence by setting it to the max(id) + 1
    # This handles cases where data was inserted manually or the sequence got out of sync
    op.execute("""
        SELECT setval(
            pg_get_serial_sequence('vacations', 'id'),
            COALESCE((SELECT MAX(id) FROM vacations), 0) + 1,
            false
        );
    """)


def downgrade() -> None:
    # No-op: sequence adjustment doesn't need a rollback
    pass

