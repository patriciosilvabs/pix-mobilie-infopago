import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Loader2, DollarSign, CheckCircle2, AlertTriangle } from "lucide-react";
import { invalidateDashboardCache } from "@/hooks/useDashboardData";
import { toast } from "sonner";
import { useBilletPayment, BilletConsultResult } from "@/hooks/useBilletPayment";
import { parseBoleto } from "@/utils/boletoParser";
import { parseLocalizedNumber, isValidPaymentAmount } from "@/lib/utils";

interface BoletoPaymentDrawerProps {
  open: boolean;
  barcode: string;
  onOpenChange: (open: boolean) => void;
}

export function BoletoPaymentDrawer({ open, barcode, onOpenChange }: BoletoPaymentDrawerProps) {
  const navigate = useNavigate();
  const { payBillet, isProcessing, consultBillet, isConsulting } = useBilletPayment();
  const [step, setStep] = useState<1 | 2>(1);
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [consultInfo, setConsultInfo] = useState<BilletConsultResult | null>(null);

  useEffect(() => {
    if (!open || !barcode) return;
    setDescription("");
    setConsultInfo(null);

    const info = parseBoleto(barcode);
    if (info && info.amount > 0) {
      setAmount(info.amount.toFixed(2).replace(".", ","));
      setDueDate(info.dueDate);
    } else {
      setAmount("");
      setDueDate(null);
    }
    setStep(1);

    // Auto-consult when drawer opens
    consultBillet(barcode).then((result) => {
      if (result) {
        setConsultInfo(result);
        if (result.total_updated_value && result.total_updated_value > 0) {
          setAmount(result.total_updated_value.toFixed(2).replace(".", ","));
        } else if (result.value && result.value > 0) {
          setAmount(result.value.toFixed(2).replace(".", ","));
        }
        if (result.due_date) {
          setDueDate(result.due_date);
        }
        // Auto-advance to step 2 if we have a value
        if ((result.total_updated_value && result.total_updated_value > 0) || (result.value && result.value > 0)) {
          setStep(2);
        }
      } else {
        // If consult fails, use barcode-parsed value and go to step 1 for manual entry
        if (info && info.amount > 0) {
          setStep(2);
        }
      }
    });
  }, [open, barcode]);

  const handleClose = () => onOpenChange(false);

  const handleBack = () => {
    if (step === 1) handleClose();
    else setStep(1);
  };

  const handleStep1 = () => {
    const value = parseLocalizedNumber(amount);
    const validation = isValidPaymentAmount(value);
    if (!validation.valid) {
      toast.error(validation.message);
      return;
    }
    setStep(2);
  };

  const handleConfirm = async () => {
    const value = parseLocalizedNumber(amount);
    const result = await payBillet({
      digitable_code: barcode,
      description: description || "Pagamento de boleto",
      amount: value,
    });

    if (result) {
      invalidateDashboardCache();
      handleClose();
      const txId = (result as any).transaction_id || (result as any).id;
      if (txId) {
        navigate(`/pix/receipt/${txId}`);
      } else {
        navigate("/transactions");
      }
    }
  };

  const formattedAmount = () => {
    const value = parseLocalizedNumber(amount);
    if (isNaN(value)) return "R$ 0,00";
    return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  };

  const formattedDueDate = () => {
    if (!dueDate) return null;
    const [y, m, d] = dueDate.split("-");
    return `${d}/${m}/${y}`;
  };

  const formatCurrency = (val?: number) => {
    if (!val || val === 0) return null;
    return val.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  };

  const hasInterestOrFine = consultInfo && ((consultInfo.interest_value && consultInfo.interest_value > 0) || (consultInfo.fine_value && consultInfo.fine_value > 0));
  const hasDiscount = consultInfo && consultInfo.discount_value && consultInfo.discount_value > 0;

  const stepIcon = step === 1 ? DollarSign : CheckCircle2;
  const stepTitle = step === 1 ? "Valor do Boleto" : "Confirmar Pagamento";
  const StepIcon = stepIcon;

  return (
    <Drawer open={open} onOpenChange={handleClose}>
      <DrawerContent>
        <div className="px-5 pb-8">
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
            {[1, 2].map((s) => (
              <div
                key={s}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  s <= step ? "bg-primary" : "bg-muted"
                }`}
              />
            ))}
          </div>

          {/* Loading consult */}
          {isConsulting && (
            <div className="flex items-center gap-2 mb-4 p-3 rounded-xl bg-secondary text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Consultando boleto na CIP...
            </div>
          )}

          {/* Step 1: Amount */}
          {step === 1 && (
            <div className="space-y-5">
              <div className="rounded-xl bg-secondary p-3">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Código</p>
                <p className="text-xs font-mono break-all text-foreground/80">{barcode}</p>
              </div>

              {/* Show consult info if available */}
              {consultInfo && consultInfo.recipient_name && (
                <div className="rounded-xl bg-secondary p-3">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Beneficiário</p>
                  <p className="text-sm font-medium">{consultInfo.recipient_name}</p>
                  {consultInfo.recipient_document && (
                    <p className="text-xs text-muted-foreground mt-0.5">{consultInfo.recipient_document}</p>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="boleto-amount" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Valor (R$)
                </Label>
                <Input
                  id="boleto-amount"
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
                onClick={handleStep1}
                disabled={!amount || parseLocalizedNumber(amount) <= 0 || isConsulting}
                className="w-full h-12 text-base font-bold uppercase tracking-wider"
              >
                Continuar
              </Button>
            </div>
          )}

          {/* Step 2: Confirmation */}
          {step === 2 && (
            <div className="space-y-5">
              <div className="rounded-xl bg-secondary p-4 space-y-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Tipo</p>
                  <p className="text-sm font-medium mt-1">Boleto</p>
                </div>
                <div className="h-px bg-border" />

                {/* Beneficiary from consult */}
                {consultInfo?.recipient_name && (
                  <>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Beneficiário</p>
                      <p className="text-sm font-medium mt-1">{consultInfo.recipient_name}</p>
                      {consultInfo.recipient_document && (
                        <p className="text-xs text-muted-foreground">{consultInfo.recipient_document}</p>
                      )}
                    </div>
                    <div className="h-px bg-border" />
                  </>
                )}

                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Código</p>
                  <p className="text-xs font-mono break-all mt-1">{barcode}</p>
                </div>
                <div className="h-px bg-border" />
                {formattedDueDate() && (
                  <>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Vencimento</p>
                      <p className="text-sm font-medium mt-1">{formattedDueDate()}</p>
                    </div>
                    <div className="h-px bg-border" />
                  </>
                )}

                {/* Original value + breakdown */}
                {consultInfo?.value && hasInterestOrFine && (
                  <>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Valor Original</p>
                      <p className="text-sm font-medium mt-1">{formatCurrency(consultInfo.value)}</p>
                    </div>
                    <div className="h-px bg-border" />
                  </>
                )}

                {consultInfo?.fine_value && consultInfo.fine_value > 0 && (
                  <>
                    <div className="flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                      <p className="text-xs font-bold uppercase tracking-wider text-amber-600">Multa</p>
                    </div>
                    <p className="text-sm font-medium text-amber-600 -mt-2">+ {formatCurrency(consultInfo.fine_value)}</p>
                    <div className="h-px bg-border" />
                  </>
                )}

                {consultInfo?.interest_value && consultInfo.interest_value > 0 && (
                  <>
                    <div className="flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                      <p className="text-xs font-bold uppercase tracking-wider text-amber-600">Juros</p>
                    </div>
                    <p className="text-sm font-medium text-amber-600 -mt-2">+ {formatCurrency(consultInfo.interest_value)}</p>
                    <div className="h-px bg-border" />
                  </>
                )}

                {hasDiscount && (
                  <>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-emerald-600">Desconto</p>
                      <p className="text-sm font-medium text-emerald-600 mt-1">- {formatCurrency(consultInfo!.discount_value)}</p>
                    </div>
                    <div className="h-px bg-border" />
                  </>
                )}

                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    {hasInterestOrFine ? "Valor Atualizado" : "Valor"}
                  </p>
                  <p className="text-lg font-bold text-primary mt-1">{formattedAmount()}</p>
                </div>
              </div>

              {hasInterestOrFine && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                  <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Este boleto possui juros e/ou multa por atraso. O valor atualizado já inclui esses encargos.
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="boleto-desc" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Descrição (opcional)
                </Label>
                <Input
                  id="boleto-desc"
                  type="text"
                  placeholder="Ex: Conta de luz"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
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
        </div>
      </DrawerContent>
    </Drawer>
  );
}
