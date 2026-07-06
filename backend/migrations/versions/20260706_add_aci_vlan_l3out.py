"""Add binding_type + l3out to aci_fabric_vlans (L3Out VLANs)

Revision ID: 20260706_add_aci_vlan_l3out
Revises: 20260705_add_ipmpls_vrf_neighbor
Create Date: 2026-07-06 12:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260706_add_aci_vlan_l3out"
down_revision = "20260705_add_ipmpls_vrf_neighbor"
branch_labels: tuple[str, ...] | None = None
depends_on: tuple[str, ...] | None = None


TABLE_NAME = "aci_fabric_vlans"


def upgrade() -> None:
    with op.batch_alter_table(TABLE_NAME, schema=None) as batch_op:
        batch_op.add_column(sa.Column("binding_type", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("l3out", sa.String(), nullable=True))
    # Existing rows are Bridge-Domain VLANs.
    op.execute("UPDATE aci_fabric_vlans SET binding_type = 'bd' WHERE binding_type IS NULL")


def downgrade() -> None:
    with op.batch_alter_table(TABLE_NAME, schema=None) as batch_op:
        batch_op.drop_column("l3out")
        batch_op.drop_column("binding_type")
