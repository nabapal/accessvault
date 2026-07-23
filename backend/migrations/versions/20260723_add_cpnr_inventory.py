"""add CPNR inventory (vms + objects + change events)

Revision ID: 20260723_add_cpnr_inventory
Revises: 20260719_add_cgnat_license
Create Date: 2026-07-23
"""
from alembic import op
import sqlalchemy as sa

from app.core.types import GUID

revision = "20260723_add_cpnr_inventory"
down_revision = "20260719_add_cgnat_license"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "cpnr_vms",
        sa.Column("id", GUID(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("site", sa.String(), nullable=True),
        sa.Column("service", sa.String(), nullable=True),
        sa.Column("role", sa.String(), nullable=False, server_default="local"),
        sa.Column("pair_id", sa.String(), nullable=True),
        sa.Column("mgmt_ip", sa.String(), nullable=False),
        sa.Column("port", sa.Integer(), nullable=False, server_default="8443"),
        sa.Column("verify_ssl", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("username", sa.String(), nullable=True),
        sa.Column("password_secret", sa.LargeBinary(), nullable=True),
        sa.Column("version", sa.String(), nullable=True),
        sa.Column("cluster_role", sa.String(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("poll_interval_seconds", sa.Integer(), nullable=False, server_default="900"),
        sa.Column("status", sa.String(), nullable=False, server_default="pending"),
        sa.Column("last_polled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("scope_count", sa.Integer(), nullable=True),
        sa.Column("prefix_count", sa.Integer(), nullable=True),
        sa.Column("reservation4_count", sa.Integer(), nullable=True),
        sa.Column("reservation6_count", sa.Integer(), nullable=True),
        sa.Column("client_count", sa.Integer(), nullable=True),
        sa.Column("client_class_count", sa.Integer(), nullable=True),
        sa.Column("pair_status", sa.String(), nullable=False, server_default="single"),
        sa.Column("inconsistency_count", sa.Integer(), nullable=True),
        sa.Column("last_compared_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("mgmt_ip", name="uq_cpnr_vm_mgmt_ip"),
    )
    op.create_index("ix_cpnr_vms_pair_id", "cpnr_vms", ["pair_id"])

    op.create_table(
        "cpnr_objects",
        sa.Column("id", GUID(), primary_key=True),
        sa.Column("vm_id", GUID(), sa.ForeignKey("cpnr_vms.id", ondelete="CASCADE"), nullable=False),
        sa.Column("object_type", sa.String(), nullable=False),
        sa.Column("object_key", sa.String(), nullable=False),
        sa.Column("content_hash", sa.String(), nullable=False),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("vm_id", "object_type", "object_key", name="uq_cpnr_object"),
    )
    op.create_index("ix_cpnr_objects_vm_id", "cpnr_objects", ["vm_id"])
    op.create_index("ix_cpnr_objects_object_type", "cpnr_objects", ["object_type"])

    op.create_table(
        "cpnr_change_events",
        sa.Column("id", GUID(), primary_key=True),
        sa.Column("vm_id", GUID(), sa.ForeignKey("cpnr_vms.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ts", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("object_type", sa.String(), nullable=False),
        sa.Column("object_key", sa.String(), nullable=False),
        sa.Column("action", sa.String(), nullable=False),
        sa.Column("changes", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_cpnr_change_events_vm_id", "cpnr_change_events", ["vm_id"])
    op.create_index("ix_cpnr_change_events_ts", "cpnr_change_events", ["ts"])


def downgrade() -> None:
    op.drop_table("cpnr_change_events")
    op.drop_table("cpnr_objects")
    op.drop_index("ix_cpnr_vms_pair_id", table_name="cpnr_vms")
    op.drop_table("cpnr_vms")
