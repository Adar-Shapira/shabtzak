from alembic import op
import sqlalchemy as sa
from typing import Union


# revision identifiers, used by Alembic.
revision: str = 'add_soldier_friendships'
down_revision: Union[str, None] = 'fix_vac_seq_2025'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "soldier_friendships",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("soldier_id", sa.Integer(), sa.ForeignKey("soldiers.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("friend_id", sa.Integer(), sa.ForeignKey("soldiers.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("status", sa.String(20), nullable=False),
    )
    op.create_unique_constraint(
        "uq_soldier_friendship",
        "soldier_friendships",
        ["soldier_id", "friend_id"],
    )
    op.create_check_constraint(
        "chk_no_self_friendship",
        "soldier_friendships",
        "soldier_id != friend_id",
    )
    op.create_check_constraint(
        "chk_valid_friendship_status",
        "soldier_friendships",
        "status IN ('friend', 'not_friend')",
    )


def downgrade():
    op.drop_constraint("chk_valid_friendship_status", "soldier_friendships", type_="check")
    op.drop_constraint("chk_no_self_friendship", "soldier_friendships", type_="check")
    op.drop_constraint("uq_soldier_friendship", "soldier_friendships", type_="unique")
    op.drop_table("soldier_friendships")

