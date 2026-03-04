import React from "react";
import { APP_VERSION } from "@/constants/app";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getInitials } from "@/lib/utils";
import {
  Home,
  Send,
  History,
  FolderOpen,
  Settings,
  Users,
  Building2,
  FileText,
  LogOut,
  ChevronDown,
  DollarSign,
  Link2,
} from "lucide-react";
import { MobileHeader } from "@/components/layout/MobileHeader";
import { BottomTabBar } from "@/components/layout/BottomTabBar";
import { useBalanceVisibility } from "@/contexts/BalanceVisibilityContext";

interface MainLayoutProps {
  children: React.ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const { profile, isAdmin, currentCompany, companies, setCurrentCompany, signOut, hasPageAccess } = useAuth();
  const location = useLocation();
  const { balanceVisible, toggleBalance } = useBalanceVisibility();

  const navigation = [
    { name: "Dashboard", href: "/", icon: Home, pageKey: "dashboard" },
    { name: "Novo Pagamento", href: "/pix/new", icon: Send, pageKey: "new_payment" },
    { name: "Histórico", href: "/transactions", icon: History, pageKey: "transactions" },
    { name: "Categorias", href: "/categories", icon: FolderOpen, adminOnly: true, pageKey: "categories" },
    { name: "Relatórios", href: "/reports", icon: FileText, adminOnly: true, pageKey: "reports" },
    { name: "Usuários", href: "/users", icon: Users, adminOnly: true, pageKey: "users" },
    { name: "Empresas", href: "/companies", icon: Building2, adminOnly: true, pageKey: "companies" },
    { name: "Integração Pix", href: "/settings/pix-integration", icon: Link2, adminOnly: true },
    { name: "Configurações", href: "/settings", icon: Settings, pageKey: "settings" },
  ];

  const filteredNavigation = navigation.filter(
    (item) => (!item.adminOnly || isAdmin) && (!item.pageKey || hasPageAccess(item.pageKey))
  );

  const isActive = (href: string) => {
    if (href === "/") return location.pathname === "/";
    return location.pathname.startsWith(href);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile header */}
      <MobileHeader
        balanceVisible={balanceVisible}
        onToggleBalance={toggleBalance}
      />

      {/* Desktop sidebar */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-64 lg:flex-col bg-sidebar border-r border-sidebar-border">
        {/* Logo */}
        <div className="h-16 flex items-center gap-3 px-6 border-b border-sidebar-border">
          <div className="h-9 w-9 rounded-xl bg-gradient-primary flex items-center justify-center shadow-primary">
            <DollarSign className="h-5 w-5 text-white" />
          </div>
          <span className="font-bold text-lg text-sidebar-foreground">Pix Contábil</span>
        </div>

        {/* Company selector */}
        {companies.length > 0 && (
          <div className="p-4 border-b border-sidebar-border">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full justify-between bg-sidebar-accent border-sidebar-border text-sidebar-foreground hover:bg-sidebar-accent/80"
                >
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    <span className="truncate">
                      {currentCompany?.name || "Selecionar"}
                    </span>
                  </div>
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56">
                <DropdownMenuLabel>Empresas</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {companies.map((company) => (
                  <DropdownMenuItem
                    key={company.id}
                    onClick={() => setCurrentCompany(company)}
                    className={cn(
                      currentCompany?.id === company.id && "bg-accent"
                    )}
                  >
                    {company.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {filteredNavigation.map((item) => (
            <Link
              key={item.href}
              to={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                isActive(item.href)
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.name}
            </Link>
          ))}
        </nav>

        {/* User section */}
        <div className="p-4 border-t border-sidebar-border">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="w-full justify-start gap-3 h-auto p-2 hover:bg-sidebar-accent"
              >
                <Avatar className="h-9 w-9">
                  <AvatarImage src={profile?.avatar_url || undefined} />
                  <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground">
                    {getInitials(profile?.full_name || "U")}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 text-left min-w-0">
                  <p className="text-sm font-medium text-sidebar-foreground truncate">
                    {profile?.full_name}
                  </p>
                  <p className="text-xs text-sidebar-foreground/60">
                    {isAdmin ? "Administrador" : "Operador"}
                  </p>
                  <p className="text-[10px] text-sidebar-foreground/40">
                    {APP_VERSION}
                  </p>
                </div>
                <ChevronDown className="h-4 w-4 text-sidebar-foreground/60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Minha Conta</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/settings">
                  <Settings className="mr-2 h-4 w-4" />
                  Configurações
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => signOut()} className="text-destructive">
                <LogOut className="mr-2 h-4 w-4" />
                Sair
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* Main content */}
      <main className="lg:pl-64 pt-[104px] lg:pt-0 pb-16 lg:pb-0 min-h-screen">
        <div className="page-transition">{children}</div>
      </main>

      {/* Bottom tab bar (mobile only) */}
      <BottomTabBar />
    </div>
  );
}
