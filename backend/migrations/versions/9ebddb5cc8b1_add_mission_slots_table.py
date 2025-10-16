from alembic import op
import sqlalchemy as sa
from typing import Union

# revision identifiers, used by Alembic.
revision: str = '9ebddb5cc8b1'
down_revision: Union[str, None] = '5bde3ca585c8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mission_slots",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("mission_id", sa.Integer(), sa.ForeignKey("missions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("start_time", sa.Time(), nullable=False),
        sa.Column("end_time", sa.Time(), nullable=False),
    )
    op.create_index("ix_mission_slots_mission_start", "mission_slots", ["mission_id", "start_time"])
    op.create_unique_constraint("uq_mission_slot_range", "mission_slots", ["mission_id", "start_time", "end_time"])


def downgrade() -> None:
    op.drop_constraint("uq_mission_slot_range", "mission_slots", type_="unique")
    op.drop_index("ix_mission_slots_mission_start", table_name="mission_slots")
    op.drop_table("mission_slots")
