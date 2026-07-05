"""Add IP-MPLS inventory tables (Cisco IOS-XE / IOS-XR devices)

Revision ID: 20260705_add_ip_mpls_inventory
Revises: 20260705_add_aci_fabric_vlans
Create Date: 2026-07-05 03:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

from app.core.types import GUID


revision = "20260705_add_ip_mpls_inventory"
down_revision = "20260705_add_aci_fabric_vlans"
branch_labels: tuple[str, ...] | None = None
depends_on: tuple[str, ...] | None = None


def upgrade() -> None:
    op.create_table(
        "ip_mpls_devices",
        sa.Column("id", GUID(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("hostname", sa.String(), nullable=True),
        sa.Column("mgmt_ip", sa.String(), nullable=False),
        sa.Column("port", sa.Integer(), nullable=False, server_default="22"),
        sa.Column("platform", sa.String(), nullable=False, server_default="unknown"),
        sa.Column("role", sa.String(), nullable=False, server_default="unknown"),
        sa.Column("model", sa.String(), nullable=True),
        sa.Column("serial", sa.String(), nullable=True),
        sa.Column("os_version", sa.String(), nullable=True),
        sa.Column("uptime_seconds", sa.Integer(), nullable=True),
        sa.Column("uptime_text", sa.String(), nullable=True),
        sa.Column("username", sa.String(), nullable=True),
        sa.Column("password_secret", sa.LargeBinary(), nullable=True),
        sa.Column("enable_secret", sa.LargeBinary(), nullable=True),
        sa.Column("connection_params", sa.JSON(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("site_name", sa.String(), nullable=True),
        sa.Column("rack_location", sa.String(), nullable=True),
        sa.Column("poll_interval_seconds", sa.Integer(), nullable=False, server_default="900"),
        sa.Column("status", sa.String(), nullable=False, server_default="pending"),
        sa.Column("last_polled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("raw_facts", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("mgmt_ip", name="uq_ipmpls_device_mgmt_ip"),
    )

    op.create_table(
        "ip_mpls_interfaces",
        sa.Column("id", GUID(), nullable=False),
        sa.Column("device_id", GUID(), sa.ForeignKey("ip_mpls_devices.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("admin_state", sa.String(), nullable=True),
        sa.Column("oper_state", sa.String(), nullable=True),
        sa.Column("ip_address", sa.String(), nullable=True),
        sa.Column("prefix_len", sa.Integer(), nullable=True),
        sa.Column("vrf", sa.String(), nullable=True),
        sa.Column("speed", sa.String(), nullable=True),
        sa.Column("mtu", sa.Integer(), nullable=True),
        sa.Column("mac", sa.String(), nullable=True),
        sa.Column("mpls_enabled", sa.Boolean(), nullable=True),
        sa.Column("attributes", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("device_id", "name", name="uq_ipmpls_interface"),
    )
    op.create_index(op.f("ix_ip_mpls_interfaces_device_id"), "ip_mpls_interfaces", ["device_id"], unique=False)

    op.create_table(
        "ip_mpls_modules",
        sa.Column("id", GUID(), nullable=False),
        sa.Column("device_id", GUID(), sa.ForeignKey("ip_mpls_devices.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(), nullable=True),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("pid", sa.String(), nullable=True),
        sa.Column("vid", sa.String(), nullable=True),
        sa.Column("serial", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_ip_mpls_modules_device_id"), "ip_mpls_modules", ["device_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_ip_mpls_modules_device_id"), table_name="ip_mpls_modules")
    op.drop_table("ip_mpls_modules")
    op.drop_index(op.f("ix_ip_mpls_interfaces_device_id"), table_name="ip_mpls_interfaces")
    op.drop_table("ip_mpls_interfaces")
    op.drop_table("ip_mpls_devices")
