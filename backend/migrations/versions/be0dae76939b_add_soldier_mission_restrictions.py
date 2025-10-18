from alembic import op
import sqlalchemy as sa
from typing import Union


# revision identifiers, used by Alembic.
revision: str = 'be0dae76939b'
down_revision: Union[str, None] = '246758d7dc70'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "soldier_mission_restrictions",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("soldier_id", sa.Integer(), sa.ForeignKey("soldiers.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("mission_id", sa.Integer(), sa.ForeignKey("missions.id", ondelete="CASCADE"), nullable=False, index=True),
    )
    op.create_unique_constraint(
        "uq_soldier_mission_restriction",
        "soldier_mission_restrictions",
        ["soldier_id", "mission_id"],
    )


def downgrade():
    op.drop_constraint("uq_soldier_mission_restriction", "soldier_mission_restrictions", type_="unique")
    op.drop_table("soldier_mission_restrictions")
