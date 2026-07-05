import { Navigate, Outlet, Route, Routes } from "react-router-dom";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { AccessVaultPage } from "@/pages/DashboardPage";
import { AciInventoryPage } from "@/pages/AciInventoryPage";
import { AciEndpointsPage } from "@/pages/AciEndpointsPage";
import { AciFreePortsPage } from "@/pages/AciFreePortsPage";
import { AciVlansPage } from "@/pages/AciVlansPage";
import { IpMplsDevicesPage } from "@/pages/IpMplsDevicesPage";
import { IpMplsDeviceDetailPage } from "@/pages/IpMplsDeviceDetailPage";
import { IpMplsDevicesAdminPage } from "@/pages/IpMplsDevicesAdminPage";
import { IpMplsTopologyPage } from "@/pages/IpMplsTopologyPage";
import { AciFabricSummaryPage } from "@/pages/AciFabricSummaryPage";
import { AciNodeDetailPage } from "@/pages/AciNodeDetailPage";
import { LoginPage } from "@/pages/LoginPage";
import { InventoryPage } from "@/pages/InventoryPage";
import { InventoryAdminPage } from "@/pages/InventoryAdminPage";
import { TelcoOnboardingPage } from "@/pages/TelcoOnboardingPage";
import { VirtualMachinesPage } from "@/pages/VirtualMachinesPage";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <ProtectedRoute>
            <Outlet />
          </ProtectedRoute>
        }
      >
    <Route index element={<Navigate to="/inventory" replace />} />
    <Route path="/inventory" element={<InventoryPage />} />
    <Route path="/inventory/aci" element={<Navigate to="/telco/aci" replace />} />
    <Route path="/inventory/admin" element={<InventoryAdminPage />} />
    <Route path="/inventory/virtual-machines" element={<VirtualMachinesPage />} />
    <Route path="/telco/aci" element={<AciInventoryPage />} />
    <Route path="/telco/aci/endpoints" element={<AciEndpointsPage />} />
    <Route path="/telco/aci/free-ports" element={<AciFreePortsPage />} />
    <Route path="/telco/aci/vlans" element={<AciVlansPage />} />
    <Route path="/telco/aci/summary" element={<AciFabricSummaryPage />} />
    <Route path="/telco/aci/nodes/:nodeId" element={<AciNodeDetailPage />} />
    <Route path="/ipmpls/devices" element={<IpMplsDevicesPage />} />
    <Route path="/ipmpls/devices/:deviceId" element={<IpMplsDeviceDetailPage />} />
    <Route path="/ipmpls/topology" element={<IpMplsTopologyPage />} />
    <Route path="/ipmpls/admin" element={<IpMplsDevicesAdminPage />} />
    <Route path="/telco/onboarding" element={<TelcoOnboardingPage />} />
    <Route path="/accessvault" element={<AccessVaultPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
