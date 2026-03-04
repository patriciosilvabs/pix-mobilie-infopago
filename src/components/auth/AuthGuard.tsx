import { useMemo } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";

interface AuthGuardProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
  requiredPage?: string;
}

export function AuthGuard({ children, requireAdmin = false, requiredPage }: AuthGuardProps) {
  const { user, isLoading, isAdmin, hasPageAccess } = useAuth();
  const location = useLocation();

  const firstAccessibleRoute = useMemo(() => "/", []);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Carregando...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  if (requireAdmin && !isAdmin) {
    return <Navigate to={firstAccessibleRoute} replace />;
  }

  if (requiredPage && !hasPageAccess(requiredPage)) {
    return <Navigate to={firstAccessibleRoute} replace />;
  }

  return <>{children}</>;
}

