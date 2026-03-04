import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { BalanceVisibilityProvider } from "@/contexts/BalanceVisibilityContext";
import { AuthGuard } from "@/components/auth/AuthGuard";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import NewPayment from "./pages/NewPayment";
import ReceiptCapture from "./pages/ReceiptCapture";
import Transactions from "./pages/Transactions";
import Categories from "./pages/Categories";
import Reports from "./pages/Reports";
import Users from "./pages/Users";
import Companies from "./pages/Companies";
import Settings from "./pages/Settings";
import PixIntegration from "./pages/settings/PixIntegration";
import MobileMenu from "./pages/MobileMenu";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      staleTime: 5 * 60 * 1000, // 5 min
      retry: 1,
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <BalanceVisibilityProvider>
          <Routes>
            <Route path="/auth" element={<Auth />} />

            <Route path="/" element={<AuthGuard><Dashboard /></AuthGuard>} />
            <Route path="/pix/new" element={<AuthGuard requiredPage="new_payment"><NewPayment /></AuthGuard>} />
            <Route path="/pix/receipt/:transactionId" element={<AuthGuard><ReceiptCapture /></AuthGuard>} />
            <Route path="/transactions" element={<AuthGuard requiredPage="transactions"><Transactions /></AuthGuard>} />
            <Route path="/categories" element={<AuthGuard requireAdmin requiredPage="categories"><Categories /></AuthGuard>} />
            <Route path="/reports" element={<AuthGuard requireAdmin requiredPage="reports"><Reports /></AuthGuard>} />
            <Route path="/users" element={<AuthGuard requireAdmin requiredPage="users"><Users /></AuthGuard>} />
            <Route path="/companies" element={<AuthGuard requireAdmin requiredPage="companies"><Companies /></AuthGuard>} />
            <Route path="/settings" element={<AuthGuard requiredPage="settings"><Settings /></AuthGuard>} />
            <Route path="/settings/pix-integration" element={<AuthGuard requireAdmin><PixIntegration /></AuthGuard>} />
            <Route path="/menu" element={<AuthGuard><MobileMenu /></AuthGuard>} />

            <Route path="*" element={<NotFound />} />
          </Routes>
          </BalanceVisibilityProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
