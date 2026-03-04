import { Link } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getInitials } from "@/lib/utils";
import {
  PlusCircle,
  FolderOpen,
  FileText,
  Users,
  Building2,
  Settings,
  Link2,
  LogOut,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

export default function MobileMenu() {
  const { profile, isAdmin, signOut, hasPageAccess } = useAuth();

  const allMenuItems = [
    { name: "Novo Pagamento", href: "/pix/new", icon: PlusCircle, pageKey: "new_payment" },
    { name: "Categorias", href: "/categories", icon: FolderOpen, pageKey: "categories" },
    { name: "Relatórios", href: "/reports", icon: FileText, pageKey: "reports" },
    { name: "Usuários", href: "/users", icon: Users, pageKey: "users" },
    { name: "Empresas", href: "/companies", icon: Building2, pageKey: "companies" },
    { name: "Integração Pix", href: "/settings/pix-integration", icon: Link2, pageKey: "pix_integration" },
    { name: "Configurações", href: "/settings", icon: Settings, pageKey: "settings" },
  ];

  const menuItems = allMenuItems.filter((item) => hasPageAccess(item.pageKey));

  return (
    <MainLayout>
      <div className="p-4 pb-24 space-y-4">
        {/* User profile card */}
        <div className="flex items-center gap-4 p-4 rounded-xl bg-card border border-border">
          <Avatar className="h-14 w-14">
            <AvatarImage src={profile?.avatar_url || undefined} />
            <AvatarFallback className="bg-primary text-primary-foreground text-lg">
              {getInitials(profile?.full_name || "U")}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-base truncate">{profile?.full_name}</p>
            <p className="text-sm text-muted-foreground">
              {isAdmin ? "Administrador" : "Operador"}
            </p>
          </div>
        </div>

        {/* Menu items */}
        <div className="rounded-xl bg-card border border-border overflow-hidden">
          {menuItems.map((item, index) => (
            <div key={item.href}>
              {index > 0 && <Separator />}
              <Link
                to={item.href}
                className="flex items-center gap-3 px-4 py-3.5 hover:bg-secondary transition-colors"
              >
                <item.icon className="h-5 w-5 text-muted-foreground" />
                <span className="flex-1 text-sm font-medium">{item.name}</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            </div>
          ))}
        </div>

        {/* Logout */}
        <Button
          variant="outline"
          className="w-full justify-start gap-3 text-destructive hover:text-destructive hover:bg-destructive/10"
          onClick={() => signOut()}
        >
          <LogOut className="h-5 w-5" />
          Sair da conta
        </Button>
      </div>
    </MainLayout>
  );
}
