import React from "react";
import { APP_VERSION } from "@/constants/app";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getInitials } from "@/lib/utils";
import { Bell, Eye, EyeOff, Building2, LogOut, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface MobileHeaderProps {
  balanceVisible: boolean;
  onToggleBalance: () => void;
}

export function MobileHeader({ balanceVisible, onToggleBalance }: MobileHeaderProps) {
  const { profile, currentCompany, companies, setCurrentCompany, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="lg:hidden fixed top-0 left-0 right-0 z-50">
      {/* Main header */}
      <div className="bg-gradient-bank-header text-white">
        {/* Top row */}
        <div className="px-4 pt-3 pb-2 flex items-center justify-between">
          {/* Avatar with dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="focus:outline-none">
                <Avatar className="h-10 w-10 border-2 border-white/30">
                  <AvatarImage src={profile?.avatar_url || undefined} />
                  <AvatarFallback className="bg-white/20 text-white text-sm font-bold">
                    {getInitials(profile?.full_name || "U")}
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <DropdownMenuLabel>{profile?.full_name || "Usuário"}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate("/settings")}>
                <Settings className="h-4 w-4 mr-2" />
                Configurações
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => signOut()} className="text-destructive focus:text-destructive">
                <LogOut className="h-4 w-4 mr-2" />
                Sair da conta
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Center - Logo */}
          <div className="flex flex-col items-center">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-lg tracking-wider">PIX</span>
              <span className="font-bold text-sm tracking-wider bg-white/20 px-2 py-0.5 rounded">CONTÁBIL</span>
            </div>
            <span className="text-[9px] text-white/70 tracking-wide mt-0.5">Sistema de Pagamento Contábil</span>
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/10 h-9 w-9"
              onClick={onToggleBalance}
            >
              {balanceVisible ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/10 h-9 w-9"
            >
              <Bell className="h-5 w-5" />
            </Button>
          </div>
        </div>

      </div>

      {/* Green sub-bar with account info */}
      <div className="bg-foreground text-background px-4 py-2 flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5">
          <Building2 className="h-3.5 w-3.5" />
          <span className="font-medium">Conta: 0001</span>
        </div>
        <span className="font-semibold truncate max-w-[180px]">
          {currentCompany?.name || "Empresa"}{" "}
          <span className="font-normal opacity-70">{APP_VERSION}</span>
        </span>
      </div>
    </header>
  );
}
