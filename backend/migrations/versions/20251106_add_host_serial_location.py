"""Add serial and Nautobot location fields to inventory hosts

Revision ID: 20251106_add_host_serial_location
Revises: 20251106_add_fabric_job_cascade
Create Date: 2025-11-06 19:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20251106_add_host_serial_location"
down_revision = "20251106_add_fabric_job_cascade"
branch_labels: tuple[str, ...] | None = None
depends_on: tuple[str, ...] | None = None


TABLE_NAME = "inventory_hosts"


def upgrade() -> None:
    with op.batch_alter_table(TABLE_NAME, schema=None) as batch_op:
        batch_op.add_column(sa.Column("serial", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("site_name", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("rack_location", sa.String(), nullable=True))
        batch_op.create_index(
            op.f("ix_inventory_hosts_serial"),
            ["serial"],
            unique=False,
        )


def downgrade() -> None:
    with op.batch_alter_table(TABLE_NAME, schema=None) as batch_op:
        batch_op.drop_index(op.f("ix_inventory_hosts_serial"))
        batch_op.drop_column("rack_location")
        batch_op.drop_column("site_name")
        batch_op.drop_column("serial")
