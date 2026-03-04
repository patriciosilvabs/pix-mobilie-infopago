import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Banknote } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { invalidateDashboardCache } from "@/hooks/useDashboardData";

interface CashPaymentDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CashPaymentDrawer({ open, onOpenChange }: CashPaymentDrawerProps) {
  const [amount, setAmount] = useState("");
  const [beneficiary, setBeneficiary] = useState("");
  const [description, setDescription] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { currentCompany, user } = useAuth();

  const handleSubmit = async () => {
    const parsedAmount = parseFloat(amount.replace(",", "."));
    if (!parsedAmount || parsedAmount <= 0) {
      toast({ variant: "destructive", title: "Erro", description: "Informe um valor válido." });
      return;
    }
    if (!beneficiary.trim()) {
      toast({ variant: "destructive", title: "Erro", description: "Informe o nome do favorecido." });
      return;
    }
    if (!currentCompany?.id || !user?.id) {
      toast({ variant: "destructive", title: "Erro", description: "Empresa ou usuário não identificado." });
      return;
    }

    setIsLoading(true);
    try {
      const { data, error } = await supabase.from("transactions").insert({
        company_id: currentCompany.id,
        created_by: user.id,
        amount: parsedAmount,
        beneficiary_name: beneficiary.trim(),
        description: description.trim() || "Pagamento em dinheiro",
        pix_type: "cash" as any,
        status: "completed",
        paid_at: new Date().toISOString(),
      }).select("id").single();

      if (error) throw error;

      invalidateDashboardCache();
      toast({ title: "Pagamento registrado!", description: "Agora anexe o comprovante." });
      onOpenChange(false);
      setAmount("");
      setBeneficiary("");
      setDescription("");
      navigate(`/pix/receipt/${data.id}`);
    } catch (error: any) {
      console.error("[CashPaymentDrawer] Error:", error);
      toast({ variant: "destructive", title: "Erro", description: error.message || "Falha ao registrar pagamento." });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="px-4 pb-8">
        <DrawerHeader className="text-left px-0">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Banknote className="h-5 w-5 text-primary" />
            </div>
            <DrawerTitle>Registrar Pagamento em Dinheiro</DrawerTitle>
          </div>
        </DrawerHeader>

        <div className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label htmlFor="cash-amount">Valor (R$) *</Label>
            <Input
              id="cash-amount"
              placeholder="0,00"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="text-lg font-mono-numbers"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cash-beneficiary">Favorecido *</Label>
            <Input
              id="cash-beneficiary"
              placeholder="Nome de quem recebeu o dinheiro"
              value={beneficiary}
              onChange={(e) => setBeneficiary(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cash-description">Descrição (opcional)</Label>
            <Textarea
              id="cash-description"
              placeholder="Observações do pagamento..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-[80px]"
            />
          </div>

          <Button
            onClick={handleSubmit}
            disabled={isLoading}
            className="w-full h-12 text-base font-bold uppercase tracking-wider"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Registrando...
              </>
            ) : (
              "Registrar Pagamento"
            )}
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
