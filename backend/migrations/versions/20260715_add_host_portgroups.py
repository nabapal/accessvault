"""Add inventory_host_portgroups (VM connectivity: portgroup -> uplinks)

Revision ID: 20260715_add_host_portgroups
Revises: 20260715_add_host_nics
Create Date: 2026-07-15 18:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

from app.core.types import GUID


revision = "20260715_add_host_portgroups"
down_revision = "20260715_add_host_nics"
branch_labels: tuple[str, ...] | None = None
depends_on: tuple[str, ...] | None = None


def upgrade() -> None:
    op.create_table(
        "inventory_host_portgroups",
        sa.Column("id", GUID(), primary_key=True),
        sa.Column("host_id", GUID(), sa.ForeignKey("inventory_hosts.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("switch_name", sa.String(), nullable=True),
        sa.Column("switch_kind", sa.String(), nullable=True),
        sa.Column("uplinks", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("vlan_id", sa.String(), nullable=True),
        sa.Column("attributes", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("host_id", "name", name="uq_inventory_host_portgroup"),
    )


def downgrade() -> None:
    op.drop_table("inventory_host_portgroups")
