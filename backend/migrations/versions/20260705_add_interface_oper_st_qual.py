"""Add oper_st_qual to aci_fabric_node_interfaces (for free-port reporting)

Revision ID: 20260705_add_interface_oper_st_qual
Revises: 20260705_add_aci_fabric_endpoints
Create Date: 2026-07-05 01:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260705_add_interface_oper_st_qual"
down_revision = "20260705_add_aci_fabric_endpoints"
branch_labels: tuple[str, ...] | None = None
depends_on: tuple[str, ...] | None = None


TABLE_NAME = "aci_fabric_node_interfaces"


def upgrade() -> None:
    with op.batch_alter_table(TABLE_NAME, schema=None) as batch_op:
        batch_op.add_column(sa.Column("oper_st_qual", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table(TABLE_NAME, schema=None) as batch_op:
        batch_op.drop_column("oper_st_qual")
