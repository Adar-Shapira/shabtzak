"""make soldier_id nullable and set FK to ON DELETE SET NULL

Revision ID: 8b55bc16180f
Revises: be0dae76939b
Create Date: 2025-10-19 08:37:52.758122

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8b55bc16180f'
down_revision: Union[str, None] = 'be0dae76939b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade():
    # make column nullable
    op.alter_column('assignments', 'soldier_id',
        existing_type=sa.Integer(),
        nullable=True
    )
    # fix FK to set null on delete (rename if your FK has a different name)
    op.drop_constraint('assignments_soldier_id_fkey', 'assignments', type_='foreignkey')
    op.create_foreign_key(
        'assignments_soldier_id_fkey',
        'assignments', 'soldiers',
        ['soldier_id'], ['id'],
        ondelete='SET NULL'
    )

def downgrade():
    op.drop_constraint('assignments_soldier_id_fkey', 'assignments', type_='foreignkey')
    op.create_foreign_key(
        'assignments_soldier_id_fkey',
        'assignments', 'soldiers',
        ['soldier_id'], ['id']
        # no ondelete
    )
    op.alter_column('assignments', 'soldier_id',
        existing_type=sa.Integer(),
        nullable=False
    )
