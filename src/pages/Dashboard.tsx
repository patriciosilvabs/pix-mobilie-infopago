import { useAuth } from "@/contexts/AuthContext";
import { MainLayout } from "@/components/layout/MainLayout";
import { AdminDashboard } from "@/components/dashboard/AdminDashboard";
import { OperatorDashboard } from "@/components/dashboard/OperatorDashboard";

export default function Dashboard() {
  const { isAdmin } = useAuth();

  return (
    <MainLayout>
      {isAdmin ? <AdminDashboard /> : <OperatorDashboard />}
    </MainLayout>
  );
}
