"""Add cgnat_static_routes

Revision ID: 20260715_add_cgnat_static_routes
Revises: 20260715_add_cgnat_inventory
Create Date: 2026-07-15 14:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

from app.core.types import GUID


revision = "20260715_add_cgnat_static_routes"
down_revision = "20260715_add_cgnat_inventory"
branch_labels: tuple[str, ...] | None = None
depends_on: tuple[str, ...] | None = None


def upgrade() -> None:
    op.create_table(
        "cgnat_static_routes",
        sa.Column("id", GUID(), primary_key=True),
        sa.Column("device_id", GUID(), sa.ForeignKey("cgnat_devices.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("name", sa.String(), nullable=True),
        sa.Column("destination", sa.String(), nullable=True),
        sa.Column("next_hop", sa.String(), nullable=True),
        sa.Column("distance", sa.Integer(), nullable=True),
        sa.Column("route_domain", sa.String(), nullable=True),
        sa.Column("family", sa.String(), nullable=True),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("attributes", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("cgnat_static_routes")
