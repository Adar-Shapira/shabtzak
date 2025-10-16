from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "a1b2c3d4e5f6"     # keep your generated ID
down_revision = "9ebddb5cc8b1"  # your current head from the logs
branch_labels = None
depends_on = None

def upgrade():
    op.alter_column("missions", "start_hour", existing_type=sa.Time(), nullable=True)
    op.alter_column("missions", "end_hour", existing_type=sa.Time(), nullable=True)

def downgrade():
    op.alter_column("missions", "end_hour", existing_type=sa.Time(), nullable=False)
    op.alter_column("missions", "start_hour", existing_type=sa.Time(), nullable=False)
