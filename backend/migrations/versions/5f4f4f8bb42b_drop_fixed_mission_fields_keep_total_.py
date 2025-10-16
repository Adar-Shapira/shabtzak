from alembic import op
import sqlalchemy as sa
from typing import Union

# revision identifiers, used by Alembic.
revision: str = '5f4f4f8bb42b'
down_revision: Union[str, None] = 'cd2b2e2b6e07'
branch_labels = None
depends_on = None

def upgrade():
    with op.batch_alter_table("missions") as batch_op:
        # Drop legacy fixed-role counts
        for col in (
            "required_soldiers",
            "required_commanders",
            "required_officers",
            "required_drivers",
        ):
            try:
                batch_op.drop_column(col)
            except Exception:
                pass  # tolerate dev DBs where column already gone

        # Drop mission-level times (slots are the source of truth)
        for col in ("start_hour", "end_hour"):
            try:
                batch_op.drop_column(col)
            except Exception:
                pass

def downgrade():
    with op.batch_alter_table("missions") as batch_op:
        # Recreate mission-level times
        batch_op.add_column(sa.Column("start_hour", sa.Time(), nullable=True))
        batch_op.add_column(sa.Column("end_hour", sa.Time(), nullable=True))

        # Recreate fixed-role counts
        batch_op.add_column(sa.Column("required_soldiers", sa.Integer(), nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("required_commanders", sa.Integer(), nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("required_officers", sa.Integer(), nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("required_drivers", sa.Integer(), nullable=False, server_default="0"))
