import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Loader2, Key, DollarSign, CheckCircle2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { usePixPayment } from "@/hooks/usePixPayment";
import { useAuth } from "@/contexts/AuthContext";
import { parseLocalizedNumber, isValidPaymentAmount } from "@/lib/utils";
import { PaymentStatusScreen } from "./PaymentStatusScreen";

interface PixKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PixKeyDialog({ open, onOpenChange }: PixKeyDialogProps) {
  const navigate = useNavigate();
  const { payByKey, isProcessing } = usePixPayment();
  const { hasPageAccess } = useAuth();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [pixKey, setPixKey] = useState("");
  const [amount, setAmount] = useState("");
  const [saveFavorite, setSaveFavorite] = useState(false);
  const [transactionId, setTransactionId] = useState("");

  const handleClose = () => {
    setPixKey("");
    setAmount("");
    setSaveFavorite(false);
    setStep(1);
    setTransactionId("");
    onOpenChange(false);
  };

  const handleCloseAndNavigate = () => {
    handleClose();
    const nextRoute = hasPageAccess("transactions") ? "/transactions" : "/";
    navigate(nextRoute);
  };

  const handleBack = () => {
    if (step === 1 || step === 4) {
      handleClose();
    } else {
      setStep((s) => (s - 1) as 1 | 2 | 3 | 4);
    }
  };

  const handleStep1 = () => {
    const trimmed = pixKey.trim();
    if (!trimmed) {
      toast.error("Informe a chave Pix");
      return;
    }
    setStep(2);
  };

  const handleStep2 = () => {
    const value = parseLocalizedNumber(amount);
    const validation = isValidPaymentAmount(value);
    if (!validation.valid) {
      toast.error(validation.message);
      return;
    }
    setStep(3);
  };

  const handleConfirm = async () => {
    const value = parseLocalizedNumber(amount);
    const result = await payByKey({
      pix_key: pixKey.trim(),
      valor: value,
    });

    if (result?.transaction_id) {
      setTransactionId(result.transaction_id);
      setStep(4);
    }
  };

  const formattedAmount = () => {
    const value = parseLocalizedNumber(amount);
    if (isNaN(value)) return "R$ 0,00";
    return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  };

  const stepIcons = [Key, DollarSign, CheckCircle2, ShieldCheck];
  const stepTitles = ["Pix com Chave", "Valor do Pagamento", "Confirmar Pagamento", "Verificando"];
  const totalSteps = 4;
  const StepIcon = stepIcons[step - 1];
  const stepTitle = stepTitles[step - 1];

  return (
    <Drawer open={open} onOpenChange={step === 4 ? undefined : handleClose}>
      <DrawerContent>
        <div className="px-5 pb-8">
          {step !== 4 && (
            <>
              <DrawerHeader className="flex-row items-center gap-3 p-0 pb-5">
                <button onClick={handleBack} className="p-1 -ml-1">
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center">
                    <StepIcon className="h-4 w-4 text-primary-foreground" />
                  </div>
                  <DrawerTitle className="text-base font-bold uppercase tracking-wide">
                    {stepTitle}
                  </DrawerTitle>
                </div>
              </DrawerHeader>
              <DrawerDescription className="sr-only">
                {stepTitle}
              </DrawerDescription>

              {/* Step indicators */}
              <div className="flex gap-1.5 mb-5">
                {Array.from({ length: totalSteps }, (_, i) => i + 1).map((s) => (
                  <div
                    key={s}
                    className={`h-1 flex-1 rounded-full transition-colors ${
                      s <= step ? "bg-primary" : "bg-muted"
                    }`}
                  />
                ))}
              </div>
            </>
          )}

          {/* Step 1: Pix Key */}
          {step === 1 && (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="pix-key" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Chave Pix
                </Label>
                <Input
                  id="pix-key"
                  placeholder="CPF, CNPJ, e-mail, telefone ou chave aleatória"
                  value={pixKey}
                  onChange={(e) => setPixKey(e.target.value)}
                  className="h-12 text-base"
                  autoFocus
                />
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="save-favorite"
                  checked={saveFavorite}
                  onCheckedChange={(checked) => setSaveFavorite(checked === true)}
                />
                <Label htmlFor="save-favorite" className="text-sm font-medium cursor-pointer">
                  Salvar como Favorecido
                </Label>
              </div>

              <Button
                onClick={handleStep1}
                disabled={!pixKey.trim()}
                className="w-full h-12 text-base font-bold uppercase tracking-wider"
              >
                Continuar
              </Button>
            </div>
          )}

          {/* Step 2: Amount */}
          {step === 2 && (
            <div className="space-y-5">
              <div className="rounded-lg bg-secondary/50 p-3 flex items-center gap-3">
                <Key className="h-4 w-4 text-primary shrink-0" />
                <p className="text-sm font-medium truncate">{pixKey}</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="pix-amount" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Valor (R$)
                </Label>
                <Input
                  id="pix-amount"
                  type="text"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="h-14 text-2xl font-bold text-center"
                  autoFocus
                />
              </div>

              <Button
                onClick={handleStep2}
                disabled={!amount || parseLocalizedNumber(amount) <= 0}
                className="w-full h-12 text-base font-bold uppercase tracking-wider"
              >
                Continuar
              </Button>
            </div>
          )}

          {/* Step 3: Confirmation */}
          {step === 3 && (
            <div className="space-y-5">
              <div className="rounded-xl bg-secondary p-4 space-y-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Chave Pix</p>
                  <p className="text-sm font-medium break-all mt-1">{pixKey}</p>
                </div>
                <div className="h-px bg-border" />
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Valor</p>
                  <p className="text-lg font-bold text-primary mt-1">{formattedAmount()}</p>
                </div>
              </div>

              <Button
                onClick={handleConfirm}
                disabled={isProcessing}
                className="w-full h-12 text-base font-bold uppercase tracking-wider"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                    Processando...
                  </>
                ) : (
                  "Confirmar Pagamento"
                )}
              </Button>
            </div>
          )}

          {/* Step 4: Status verification */}
          {step === 4 && transactionId && (
            <PaymentStatusScreen
              transactionId={transactionId}
              amount={parseLocalizedNumber(amount)}
              beneficiaryName={pixKey}
              onClose={handleCloseAndNavigate}
            />
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
