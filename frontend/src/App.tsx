import { Navigate, Outlet, Route, Routes } from "react-router-dom";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { AccessVaultPage } from "@/pages/DashboardPage";
import { LoginPage } from "@/pages/LoginPage";
import { InventoryPage } from "@/pages/InventoryPage";
import { InventoryAdminPage } from "@/pages/InventoryAdminPage";
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
  <Route path="/inventory/admin" element={<InventoryAdminPage />} />
  <Route path="/inventory/virtual-machines" element={<VirtualMachinesPage />} />
  <Route path="/accessvault" element={<AccessVaultPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
