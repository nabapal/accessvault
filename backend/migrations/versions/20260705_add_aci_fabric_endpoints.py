"""Add aci_fabric_endpoints table for fabric-wide endpoint inventory

Revision ID: 20260705_add_aci_fabric_endpoints
Revises: 20251106_add_host_serial_location
Create Date: 2026-07-05 00:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

from app.core.types import GUID


revision = "20260705_add_aci_fabric_endpoints"
down_revision = "20251106_add_host_serial_location"
branch_labels: tuple[str, ...] | None = None
depends_on: tuple[str, ...] | None = None


TABLE_NAME = "aci_fabric_endpoints"


def upgrade() -> None:
    op.create_table(
        TABLE_NAME,
        sa.Column("id", GUID(), nullable=False),
        sa.Column(
            "fabric_job_id",
            GUID(),
            sa.ForeignKey("telco_fabric_onboarding_jobs.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("distinguished_name", sa.String(), nullable=False),
        sa.Column("mac", sa.String(), nullable=True),
        sa.Column("ip_addresses", sa.JSON(), nullable=False),
        sa.Column("tenant", sa.String(), nullable=True),
        sa.Column("app_profile", sa.String(), nullable=True),
        sa.Column("epg", sa.String(), nullable=True),
        sa.Column("encap", sa.String(), nullable=True),
        sa.Column("bridge_domain", sa.String(), nullable=True),
        sa.Column("vrf", sa.String(), nullable=True),
        sa.Column("pod", sa.String(), nullable=True),
        sa.Column("nodes", sa.JSON(), nullable=False),
        sa.Column("interface", sa.String(), nullable=True),
        sa.Column("path_dn", sa.String(), nullable=True),
        sa.Column("learning_source", sa.String(), nullable=True),
        sa.Column("last_modified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("raw_attributes", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("fabric_job_id", "distinguished_name", name="uq_aci_fabric_endpoint"),
    )
    op.create_index(op.f("ix_aci_fabric_endpoints_fabric_job_id"), TABLE_NAME, ["fabric_job_id"], unique=False)
    op.create_index(op.f("ix_aci_fabric_endpoints_mac"), TABLE_NAME, ["mac"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_aci_fabric_endpoints_mac"), table_name=TABLE_NAME)
    op.drop_index(op.f("ix_aci_fabric_endpoints_fabric_job_id"), table_name=TABLE_NAME)
    op.drop_table(TABLE_NAME)
