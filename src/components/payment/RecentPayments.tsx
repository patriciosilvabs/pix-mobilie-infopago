import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Key, Clock, Loader2 } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type PixKeyType = Database["public"]["Enums"]["pix_key_type"];
type PixType = Database["public"]["Enums"]["pix_type"];

export interface RecentPayment {
  pix_key: string;
  pix_key_type: PixKeyType | null;
  pix_type: PixType;
  amount: number;
  description: string | null;
  beneficiary_name: string | null;
  created_at: string;
  created_by?: string;
}

interface RecentPaymentsProps {
  onSelect: (payment: RecentPayment) => void;
}

const pixKeyTypeLabels: Record<string, string> = {
  cpf: "CPF",
  cnpj: "CNPJ",
  email: "E-mail",
  phone: "Telefone",
  random: "Chave Aleatória",
};

function maskKey(key: string): string {
  if (key.length <= 6) return key;
  return key.slice(0, 3) + "***" + key.slice(-4);
}

export function RecentPayments({ onSelect }: RecentPaymentsProps) {
  const { currentCompany, isAdmin, user } = useAuth();
  const [payments, setPayments] = useState<RecentPayment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [profileMap, setProfileMap] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!currentCompany?.id) {
      setIsLoading(false);
      return;
    }

    const fetchRecent = async () => {
      setIsLoading(true);
      let query = supabase
        .from("transactions")
        .select("pix_key, pix_key_type, pix_type, amount, description, beneficiary_name, created_at, created_by")
        .eq("company_id", currentCompany.id)
        .eq("status", "completed")
        .not("pix_key", "is", null)
        .order("created_at", { ascending: false })
        .limit(30);

      if (!isAdmin && user) {
        query = query.eq("created_by", user.id);
      }

      const [txResult, profileRes] = await Promise.all([
        query,
        supabase.from("profiles").select("user_id, full_name"),
      ]);

      if (profileRes.data) {
        const map: Record<string, string> = {};
        profileRes.data.forEach((p: any) => { map[p.user_id] = p.full_name; });
        setProfileMap(map);
      }

      if (txResult.error) {
        console.error("[RecentPayments] Error:", txResult.error);
        setIsLoading(false);
        return;
      }

      // Group by unique pix_key, keep most recent
      const grouped = (txResult.data || []).reduce<Record<string, RecentPayment>>((acc, tx) => {
        const key = tx.pix_key!;
        if (!acc[key]) {
          acc[key] = tx as RecentPayment;
        }
        return acc;
      }, {});

      setPayments(Object.values(grouped).slice(0, 10));
      setIsLoading(false);
    };

    fetchRecent();
  }, [currentCompany?.id, isAdmin, user?.id]);

  if (isLoading) {
    return (
      <Card className="mt-6">
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (payments.length === 0) return null;

  return (
    <Card className="mt-6">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Clock className="h-5 w-5" />
          Últimos Pagamentos
        </CardTitle>
        <CardDescription>Repita um pagamento anterior</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {payments.map((payment, idx) => (
          <button
            key={`${payment.pix_key}-${idx}`}
            type="button"
            onClick={() => onSelect(payment)}
            className="w-full flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-accent/50 transition-colors text-left"
          >
            <div className="flex-shrink-0 h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center">
              <Key className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm truncate">
                  {payment.beneficiary_name || maskKey(payment.pix_key)}
                </span>
                <span className="font-semibold text-sm text-primary whitespace-nowrap">
                  {formatCurrency(payment.amount)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 mt-0.5">
                <span className="text-xs text-muted-foreground truncate">
                  {payment.pix_key_type ? pixKeyTypeLabels[payment.pix_key_type] + ": " : ""}
                  {maskKey(payment.pix_key)}
                  {payment.description ? ` · ${payment.description}` : ""}
                </span>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {payment.created_by && profileMap[payment.created_by]
                    ? `${profileMap[payment.created_by]} · `
                    : ""}
                  {formatDate(payment.created_at)}
                </span>
              </div>
            </div>
          </button>
        ))}
      </CardContent>
    </Card>
  );
}
