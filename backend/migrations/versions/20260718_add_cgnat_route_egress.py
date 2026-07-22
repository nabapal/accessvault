"""add egress_interface/egress_vlan to cgnat_static_routes (dashboard Phase 4)

Revision ID: 20260718_add_cgnat_route_egress
Revises: 20260717_add_cgnat_partition
Create Date: 2026-07-17
"""
from alembic import op
import sqlalchemy as sa

revision = "20260718_add_cgnat_route_egress"
down_revision = "20260717_add_cgnat_partition"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("cgnat_static_routes", sa.Column("egress_interface", sa.String(), nullable=True))
    op.add_column("cgnat_static_routes", sa.Column("egress_vlan", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("cgnat_static_routes", "egress_vlan")
    op.drop_column("cgnat_static_routes", "egress_interface")
