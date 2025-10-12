from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "5bde3ca585c8"
down_revision = "2fdb79d1dafb"  # keep whatever your file had here
branch_labels = None
depends_on = None

def upgrade():
    bind = op.get_bind()
    insp = sa.inspect(bind)

    # We DO NOT create any constraint on soldier_roles here.
    # soldier_roles was already created in an earlier migration.

    # Drop soldiers.role_id if it still exists
    cols = [c["name"] for c in insp.get_columns("soldiers")]
    if "role_id" in cols:
        # try to drop the FK if it exists, then drop the column
        try:
            op.drop_constraint("soldiers_role_id_fkey", "soldiers", type_="foreignkey")
        except Exception:
            # FK name may differ; ignore if not found
            pass
        with op.batch_alter_table("soldiers") as batch:
            batch.drop_column("role_id")

def downgrade():
    # Recreate role_id (nullable) and FK; no data backfill here
    with op.batch_alter_table("soldiers") as batch:
        batch.add_column(sa.Column("role_id", sa.Integer(), nullable=True))
    try:
        op.create_foreign_key("soldiers_role_id_fkey", "soldiers", "roles", ["role_id"], ["id"])
    except Exception:
        pass
