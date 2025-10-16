"""add total_needed and mission_requirements

Revision ID: b95e9161cc73
Revises: 5f4f4f8bb42b
Create Date: 2025-10-16 14:13:33.634350

"""
from typing import Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'b95e9161cc73'
down_revision: Union[str, None] = '5f4f4f8bb42b'
branch_labels = None
depends_on = None


def upgrade():
    # 1) missions.total_needed (nullable int)
    with op.batch_alter_table("missions") as batch_op:
        batch_op.add_column(sa.Column("total_needed", sa.Integer(), nullable=True))

    # 2) mission_requirements table (if it doesn't exist yet)
    #    Columns: id (PK), mission_id (FK to missions, ondelete=CASCADE)
    #             role_id (FK to roles, ondelete=RESTRICT), count (int NOT NULL default 1)
    #    Unique: (mission_id, role_id)
    op.create_table(
        "mission_requirements",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column(
            "mission_id",
            sa.Integer(),
            sa.ForeignKey("missions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "role_id",
            sa.Integer(),
            sa.ForeignKey("roles.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("count", sa.Integer(), nullable=False, server_default="1"),
        sa.UniqueConstraint("mission_id", "role_id", name="uq_mission_role_once"),
    )

    # Clean up server_default so future inserts must provide a value (the ORM gives default=1 anyway)
    with op.batch_alter_table("mission_requirements") as batch_op:
        batch_op.alter_column("count", server_default=None)


def downgrade():
    # Drop mission_requirements table
    op.drop_table("mission_requirements")

    # Remove missions.total_needed
    with op.batch_alter_table("missions") as batch_op:
        batch_op.drop_column("total_needed")
