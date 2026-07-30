"""add PBR rich-detail columns (per-node detail + per-service EPG groups + active_pct)

Revision ID: 20260729_pbr_detail_columns
Revises: 20260729_add_pbr_monitoring
Create Date: 2026-07-29

Additive nullable JSON columns carrying the full prototype-parity detail so the topology
+ node cards + EPG subnet chips can render without a relational explosion.
"""
from alembic import op
import sqlalchemy as sa

revision = "20260729_pbr_detail_columns"
down_revision = "20260729_add_pbr_monitoring"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("pbr_services", schema=None) as batch:
        batch.add_column(sa.Column("consumer_epgs", sa.JSON(), nullable=True))
        batch.add_column(sa.Column("provider_epgs", sa.JSON(), nullable=True))
    with op.batch_alter_table("pbr_nodes", schema=None) as batch:
        batch.add_column(sa.Column("active_pct", sa.Float(), nullable=True))
        batch.add_column(sa.Column("detail", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("pbr_nodes", schema=None) as batch:
        batch.drop_column("detail")
        batch.drop_column("active_pct")
    with op.batch_alter_table("pbr_services", schema=None) as batch:
        batch.drop_column("provider_epgs")
        batch.drop_column("consumer_epgs")
