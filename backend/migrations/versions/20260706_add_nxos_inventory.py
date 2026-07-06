"""Add NX-OS (Nexus) inventory tables

Revision ID: 20260706_add_nxos_inventory
Revises: 20260706_add_aci_vlan_l3out
Create Date: 2026-07-06 13:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

from app.core.types import GUID


revision = "20260706_add_nxos_inventory"
down_revision = "20260706_add_aci_vlan_l3out"
branch_labels: tuple[str, ...] | None = None
depends_on: tuple[str, ...] | None = None


def upgrade() -> None:
    op.create_table(
        "nxos_devices",
        sa.Column("id", GUID(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("hostname", sa.String(), nullable=True),
        sa.Column("mgmt_ip", sa.String(), nullable=False),
        sa.Column("port", sa.Integer(), nullable=False, server_default="22"),
        sa.Column("platform", sa.Enum("nxos", "unknown", name="nxosplatform"), nullable=False, server_default="unknown"),
        sa.Column("role", sa.String(), nullable=True),
        sa.Column("model", sa.String(), nullable=True),
        sa.Column("serial", sa.String(), nullable=True),
        sa.Column("os_version", sa.String(), nullable=True),
        sa.Column("uptime_seconds", sa.Integer(), nullable=True),
        sa.Column("uptime_text", sa.String(), nullable=True),
        sa.Column("username", sa.String(), nullable=True),
        sa.Column("password_secret", sa.LargeBinary(), nullable=True),
        sa.Column("enable_secret", sa.LargeBinary(), nullable=True),
        sa.Column("connection_params", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("site_name", sa.String(), nullable=True),
        sa.Column("rack_location", sa.String(), nullable=True),
        sa.Column("poll_interval_seconds", sa.Integer(), nullable=False, server_default="900"),
        sa.Column("status", sa.Enum("pending", "ok", "error", name="nxosdevicestatus"), nullable=False, server_default="pending"),
        sa.Column("last_polled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("raw_facts", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("mgmt_ip", name="uq_nxos_device_mgmt_ip"),
    )

    op.create_table(
        "nxos_interfaces",
        sa.Column("id", GUID(), primary_key=True),
        sa.Column("device_id", GUID(), sa.ForeignKey("nxos_devices.id", ondelete="CASCADE"), nullable=False, index=True),
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
        sa.Column("mode", sa.String(), nullable=True),
        sa.Column("access_vlan", sa.String(), nullable=True),
        sa.Column("trunk_vlans", sa.String(), nullable=True),
        sa.Column("port_channel", sa.String(), nullable=True),
        sa.Column("attributes", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("device_id", "name", name="uq_nxos_interface"),
    )

    op.create_table(
        "nxos_modules",
        sa.Column("id", GUID(), primary_key=True),
        sa.Column("device_id", GUID(), sa.ForeignKey("nxos_devices.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("name", sa.String(), nullable=True),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("pid", sa.String(), nullable=True),
        sa.Column("vid", sa.String(), nullable=True),
        sa.Column("serial", sa.String(), nullable=True),
        sa.Column("slot", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "nxos_vrfs",
        sa.Column("id", GUID(), primary_key=True),
        sa.Column("device_id", GUID(), sa.ForeignKey("nxos_devices.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("rd", sa.String(), nullable=True),
        sa.Column("state", sa.String(), nullable=True),
        sa.Column("interfaces", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("attributes", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("device_id", "name", name="uq_nxos_vrf"),
    )

    op.create_table(
        "nxos_neighbors",
        sa.Column("id", GUID(), primary_key=True),
        sa.Column("device_id", GUID(), sa.ForeignKey("nxos_devices.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("protocol", sa.String(), nullable=False),
        sa.Column("local_interface", sa.String(), nullable=True),
        sa.Column("remote_device", sa.String(), nullable=True),
        sa.Column("remote_interface", sa.String(), nullable=True),
        sa.Column("remote_platform", sa.String(), nullable=True),
        sa.Column("remote_mgmt_ip", sa.String(), nullable=True),
        sa.Column("attributes", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint(
            "device_id", "protocol", "local_interface", "remote_device", "remote_interface",
            name="uq_nxos_neighbor",
        ),
    )

    op.create_table(
        "nxos_bgp_neighbors",
        sa.Column("id", GUID(), primary_key=True),
        sa.Column("device_id", GUID(), sa.ForeignKey("nxos_devices.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("vrf", sa.String(), nullable=True),
        sa.Column("address_family", sa.String(), nullable=True),
        sa.Column("neighbor_ip", sa.String(), nullable=False),
        sa.Column("remote_as", sa.String(), nullable=True),
        sa.Column("local_as", sa.String(), nullable=True),
        sa.Column("state", sa.String(), nullable=True),
        sa.Column("prefixes_received", sa.Integer(), nullable=True),
        sa.Column("prefixes_sent", sa.Integer(), nullable=True),
        sa.Column("uptime", sa.String(), nullable=True),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("attributes", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("nxos_bgp_neighbors")
    op.drop_table("nxos_neighbors")
    op.drop_table("nxos_vrfs")
    op.drop_table("nxos_modules")
    op.drop_table("nxos_interfaces")
    op.drop_table("nxos_devices")
    sa.Enum(name="nxosdevicestatus").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="nxosplatform").drop(op.get_bind(), checkfirst=True)
