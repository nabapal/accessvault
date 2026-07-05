"""Add IP-MPLS VRF and neighbor tables (Phase 2)

Revision ID: 20260705_add_ipmpls_vrf_neighbor
Revises: 20260705_add_ip_mpls_inventory
Create Date: 2026-07-05 04:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

from app.core.types import GUID


revision = "20260705_add_ipmpls_vrf_neighbor"
down_revision = "20260705_add_ip_mpls_inventory"
branch_labels: tuple[str, ...] | None = None
depends_on: tuple[str, ...] | None = None


def upgrade() -> None:
    op.create_table(
        "ip_mpls_vrfs",
        sa.Column("id", GUID(), nullable=False),
        sa.Column("device_id", GUID(), sa.ForeignKey("ip_mpls_devices.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("rd", sa.String(), nullable=True),
        sa.Column("rt_import", sa.JSON(), nullable=False),
        sa.Column("rt_export", sa.JSON(), nullable=False),
        sa.Column("interfaces", sa.JSON(), nullable=False),
        sa.Column("protocols", sa.String(), nullable=True),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("device_id", "name", name="uq_ipmpls_vrf"),
    )
    op.create_index(op.f("ix_ip_mpls_vrfs_device_id"), "ip_mpls_vrfs", ["device_id"], unique=False)

    op.create_table(
        "ip_mpls_neighbors",
        sa.Column("id", GUID(), nullable=False),
        sa.Column("device_id", GUID(), sa.ForeignKey("ip_mpls_devices.id", ondelete="CASCADE"), nullable=False),
        sa.Column("protocol", sa.String(), nullable=False),
        sa.Column("neighbor_id", sa.String(), nullable=True),
        sa.Column("address", sa.String(), nullable=True),
        sa.Column("interface", sa.String(), nullable=True),
        sa.Column("state", sa.String(), nullable=True),
        sa.Column("uptime", sa.String(), nullable=True),
        sa.Column("vrf", sa.String(), nullable=True),
        sa.Column("attributes", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_ip_mpls_neighbors_device_id"), "ip_mpls_neighbors", ["device_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_ip_mpls_neighbors_device_id"), table_name="ip_mpls_neighbors")
    op.drop_table("ip_mpls_neighbors")
    op.drop_index(op.f("ix_ip_mpls_vrfs_device_id"), table_name="ip_mpls_vrfs")
    op.drop_table("ip_mpls_vrfs")
