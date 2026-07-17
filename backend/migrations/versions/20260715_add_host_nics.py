"""Add inventory_host_nics + host facts columns (LLDP/CDP host detail)

Revision ID: 20260715_add_host_nics
Revises: 20260715_add_cgnat_static_routes
Create Date: 2026-07-15 16:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

from app.core.types import GUID


revision = "20260715_add_host_nics"
down_revision = "20260715_add_cgnat_static_routes"
branch_labels: tuple[str, ...] | None = None
depends_on: tuple[str, ...] | None = None


def upgrade() -> None:
    with op.batch_alter_table("inventory_hosts", schema=None) as batch_op:
        batch_op.add_column(sa.Column("vendor", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("cpu_model", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("bios_version", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("esxi_version", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("management_ip", sa.String(), nullable=True))

    op.create_table(
        "inventory_host_nics",
        sa.Column("id", GUID(), primary_key=True),
        sa.Column("host_id", GUID(), sa.ForeignKey("inventory_hosts.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("device", sa.String(), nullable=False),
        sa.Column("mac", sa.String(), nullable=True),
        sa.Column("speed_mb", sa.Integer(), nullable=True),
        sa.Column("neighbor_protocol", sa.String(), nullable=True),
        sa.Column("remote_device", sa.String(), nullable=True),
        sa.Column("remote_port", sa.String(), nullable=True),
        sa.Column("remote_platform", sa.String(), nullable=True),
        sa.Column("remote_mgmt", sa.String(), nullable=True),
        sa.Column("attributes", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("inventory_host_nics")
    with op.batch_alter_table("inventory_hosts", schema=None) as batch_op:
        batch_op.drop_column("management_ip")
        batch_op.drop_column("esxi_version")
        batch_op.drop_column("bios_version")
        batch_op.drop_column("cpu_model")
        batch_op.drop_column("vendor")
