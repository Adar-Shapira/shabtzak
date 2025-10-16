"""remove is_core from roles (inspector style)"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "cd2b2e2b6e07"
down_revision = "a16ef84bb0b9"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    insp = sa.inspect(bind)

    # Drop roles.is_core if it exists
    cols = [c["name"] for c in insp.get_columns("roles")]
    if "is_core" in cols:
        with op.batch_alter_table("roles") as batch:
            batch.drop_column("is_core")


def downgrade():
    bind = op.get_bind()
    insp = sa.inspect(bind)

    # Recreate roles.is_core if missing
    cols = [c["name"] for c in insp.get_columns("roles")]
    if "is_core" not in cols:
        with op.batch_alter_table("roles") as batch:
            batch.add_column(sa.Column("is_core", sa.Boolean(), nullable=False, server_default=sa.false()))
