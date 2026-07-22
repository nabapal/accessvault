"""add partition/route_domain tenancy tagging to CGNAT (dashboard Phase 3)

Revision ID: 20260717_add_cgnat_partition
Revises: 20260716_add_cgnat_iface_natrole
Create Date: 2026-07-17
"""
from alembic import op
import sqlalchemy as sa

revision = "20260717_add_cgnat_partition"
down_revision = "20260716_add_cgnat_iface_natrole"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # interfaces: + partition, route_domain; unique now includes partition
    with op.batch_alter_table("cgnat_interfaces", recreate="always") as b:
        b.add_column(sa.Column("partition", sa.String(), nullable=True))
        b.add_column(sa.Column("route_domain", sa.String(), nullable=True))
        b.create_unique_constraint("uq_cgnat_interface", ["device_id", "name", "partition"])

    # pools: unique now includes partition
    with op.batch_alter_table("cgnat_nat_pools", recreate="always") as b:
        b.create_unique_constraint("uq_cgnat_pool", ["device_id", "pool_name", "partition"])

    # routes: + partition
    with op.batch_alter_table("cgnat_static_routes") as b:
        b.add_column(sa.Column("partition", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("cgnat_static_routes") as b:
        b.drop_column("partition")
    with op.batch_alter_table("cgnat_nat_pools", recreate="always") as b:
        b.create_unique_constraint("uq_cgnat_pool", ["device_id", "pool_name"])
    with op.batch_alter_table("cgnat_interfaces", recreate="always") as b:
        b.create_unique_constraint("uq_cgnat_interface", ["device_id", "name"])
        b.drop_column("route_domain")
        b.drop_column("partition")
