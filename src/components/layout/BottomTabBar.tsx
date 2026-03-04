import { Link, useLocation } from "react-router-dom";
import { Home, LayoutGrid, ArrowLeftRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";

const allTabs = [
  { name: "Menu", href: "/menu", icon: LayoutGrid, position: "left" },
  { name: "Home", href: "/", icon: Home, position: "center", pageKey: "dashboard" },
  { name: "Transações", href: "/transactions", icon: ArrowLeftRight, position: "right", pageKey: "transactions" },
];

export function BottomTabBar() {
  const { hasPageAccess } = useAuth();
  const location = useLocation();
  const tabs = allTabs.filter(t => !t.pageKey || hasPageAccess(t.pageKey));
  const isActive = (href: string) => {
    if (href === "/") return location.pathname === "/";
    return location.pathname.startsWith(href);
  };

  return (
    <nav className="lg:hidden fixed bottom-4 left-4 right-4 z-50">
      <div className="bg-card border border-border rounded-2xl shadow-lg flex items-center justify-around h-16 px-4 relative">
        {tabs.map((tab) => {
          const active = isActive(tab.href);
          const isHome = tab.position === "center";

          if (isHome) {
            return (
              <Link
                key={tab.href}
                to={tab.href}
                className="flex flex-col items-center justify-center flex-1"
              >
                <div className={cn(
                  "w-14 h-14 -mt-8 rounded-full flex items-center justify-center shadow-lg border-4 border-card transition-colors",
                  active ? "bg-gradient-bank-header" : "bg-primary"
                )}>
                  <tab.icon className="h-6 w-6 text-white" />
                </div>
                <span className="text-[10px] font-medium mt-0.5 text-foreground">
                  {tab.name}
                </span>
              </Link>
            );
          }

          return (
            <Link
              key={tab.href}
              to={tab.href}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors",
                active ? "text-primary" : "text-muted-foreground"
              )}
            >
              <tab.icon className="h-6 w-6" />
              <span className="text-[10px] font-medium">{tab.name}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
