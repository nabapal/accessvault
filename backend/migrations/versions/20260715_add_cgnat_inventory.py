"""Add CGNAT inventory tables (A10 + F5)

Revision ID: 20260715_add_cgnat_inventory
Revises: 20260706_add_nxos_inventory
Create Date: 2026-07-15 12:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

from app.core.types import GUID


revision = "20260715_add_cgnat_inventory"
down_revision = "20260706_add_nxos_inventory"
branch_labels: tuple[str, ...] | None = None
depends_on: tuple[str, ...] | None = None


def upgrade() -> None:
    op.create_table(
        "cgnat_devices",
        sa.Column("id", GUID(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("hostname", sa.String(), nullable=True),
        sa.Column("mgmt_ip", sa.String(), nullable=False),
        sa.Column("port", sa.Integer(), nullable=False, server_default="443"),
        sa.Column("vendor", sa.Enum("a10", "f5", "unknown", name="cgnatvendor"), nullable=False, server_default="unknown"),
        sa.Column("verify_ssl", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("role", sa.String(), nullable=True),
        sa.Column("model", sa.String(), nullable=True),
        sa.Column("serial", sa.String(), nullable=True),
        sa.Column("os_version", sa.String(), nullable=True),
        sa.Column("uptime_seconds", sa.Integer(), nullable=True),
        sa.Column("uptime_text", sa.String(), nullable=True),
        sa.Column("username", sa.String(), nullable=True),
        sa.Column("password_secret", sa.LargeBinary(), nullable=True),
        sa.Column("connection_params", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("site_name", sa.String(), nullable=True),
        sa.Column("rack_location", sa.String(), nullable=True),
        sa.Column("poll_interval_seconds", sa.Integer(), nullable=False, server_default="900"),
        sa.Column("status", sa.Enum("pending", "ok", "error", name="cgnatdevicestatus"), nullable=False, server_default="pending"),
        sa.Column("last_polled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("active_sessions", sa.Integer(), nullable=True),
        sa.Column("active_subscribers", sa.Integer(), nullable=True),
        sa.Column("total_translations", sa.Integer(), nullable=True),
        sa.Column("port_util_pct", sa.Float(), nullable=True),
        sa.Column("exhaustion_events", sa.Integer(), nullable=True),
        sa.Column("virtual_server_count", sa.Integer(), nullable=True),
        sa.Column("raw_facts", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("mgmt_ip", name="uq_cgnat_device_mgmt_ip"),
    )

    op.create_table(
        "cgnat_interfaces",
        sa.Column("id", GUID(), primary_key=True),
        sa.Column("device_id", GUID(), sa.ForeignKey("cgnat_devices.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("admin_state", sa.String(), nullable=True),
        sa.Column("oper_state", sa.String(), nullable=True),
        sa.Column("ip_address", sa.String(), nullable=True),
        sa.Column("vlan", sa.String(), nullable=True),
        sa.Column("mtu", sa.Integer(), nullable=True),
        sa.Column("mac", sa.String(), nullable=True),
        sa.Column("attributes", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("device_id", "name", name="uq_cgnat_interface"),
    )

    op.create_table(
        "cgnat_nat_pools",
        sa.Column("id", GUID(), primary_key=True),
        sa.Column("device_id", GUID(), sa.ForeignKey("cgnat_devices.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("pool_name", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), nullable=True),
        sa.Column("mode", sa.String(), nullable=True),
        sa.Column("partition", sa.String(), nullable=True),
        sa.Column("route_domain", sa.String(), nullable=True),
        sa.Column("start_address", sa.String(), nullable=True),
        sa.Column("end_address", sa.String(), nullable=True),
        sa.Column("prefix", sa.String(), nullable=True),
        sa.Column("port_block_size", sa.Integer(), nullable=True),
        sa.Column("log_profile", sa.String(), nullable=True),
        sa.Column("pool_group", sa.String(), nullable=True),
        sa.Column("active_translations", sa.Integer(), nullable=True),
        sa.Column("translation_requests", sa.Integer(), nullable=True),
        sa.Column("translation_failures", sa.Integer(), nullable=True),
        sa.Column("port_util_pct", sa.Float(), nullable=True),
        sa.Column("attributes", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("device_id", "pool_name", name="uq_cgnat_pool"),
    )


def downgrade() -> None:
    op.drop_table("cgnat_nat_pools")
    op.drop_table("cgnat_interfaces")
    op.drop_table("cgnat_devices")
    sa.Enum(name="cgnatdevicestatus").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="cgnatvendor").drop(op.get_bind(), checkfirst=True)
