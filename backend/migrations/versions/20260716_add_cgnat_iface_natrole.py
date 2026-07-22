"""add nat_role + addresses to cgnat_interfaces (CGNAT dashboard Phase 2)

Revision ID: 20260716_add_cgnat_iface_natrole
Revises: 20260715_add_host_portgroups
Create Date: 2026-07-17
"""
from alembic import op
import sqlalchemy as sa

revision = "20260716_add_cgnat_iface_natrole"
down_revision = "20260715_add_host_portgroups"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("cgnat_interfaces", sa.Column("addresses", sa.JSON(), nullable=False, server_default="[]"))
    op.add_column("cgnat_interfaces", sa.Column("nat_role", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("cgnat_interfaces", "nat_role")
    op.drop_column("cgnat_interfaces", "addresses")
