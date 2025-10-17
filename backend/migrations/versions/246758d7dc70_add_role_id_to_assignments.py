from alembic import op
import sqlalchemy as sa
from typing import Union

revision: str = '246758d7dc70'
down_revision: Union[str, None] = 'b95e9161cc73'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("assignments", sa.Column("role_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_assignments_role_id_roles",
        "assignments", "roles",
        ["role_id"], ["id"],
        ondelete=None,
    )

def downgrade():
    op.drop_constraint("fk_assignments_role_id_roles", "assignments", type_="foreignkey")
    op.drop_column("assignments", "role_id")
