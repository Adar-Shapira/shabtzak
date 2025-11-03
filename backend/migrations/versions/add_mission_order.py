"""add mission order field

Revision ID: add_mission_order
Revises: add_soldier_friendships
Create Date: 2025-01-22 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'add_mission_order'
down_revision: Union[str, None] = 'add_soldier_friendships'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add order column to missions table
    op.add_column('missions', sa.Column('order', sa.Integer(), nullable=False, server_default='0'))
    
    # Set order based on current id for existing missions
    # Using bindparam for better compatibility
    op.execute(sa.text("UPDATE missions SET \"order\" = id"))


def downgrade() -> None:
    op.drop_column('missions', 'order')

