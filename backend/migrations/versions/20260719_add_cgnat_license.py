"""add license fields to cgnat_devices (dashboard Phase 5)

Revision ID: 20260719_add_cgnat_license
Revises: 20260718_add_cgnat_route_egress
Create Date: 2026-07-17
"""
from alembic import op
import sqlalchemy as sa

revision = "20260719_add_cgnat_license"
down_revision = "20260718_add_cgnat_route_egress"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("cgnat_devices", sa.Column("license", sa.JSON(), nullable=True))
    op.add_column("cgnat_devices", sa.Column("license_product", sa.String(), nullable=True))
    op.add_column("cgnat_devices", sa.Column("license_expiry", sa.String(), nullable=True))
    op.add_column("cgnat_devices", sa.Column("license_bandwidth_mbps", sa.Integer(), nullable=True))
    op.add_column("cgnat_devices", sa.Column("license_notes", sa.String(), nullable=True))
    op.add_column("cgnat_devices", sa.Column("license_modules", sa.JSON(), nullable=True))


def downgrade() -> None:
    for col in ("license_modules", "license_notes", "license_bandwidth_mbps", "license_expiry", "license_product", "license"):
        op.drop_column("cgnat_devices", col)
