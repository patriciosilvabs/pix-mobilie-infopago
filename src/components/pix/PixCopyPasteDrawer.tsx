import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Loader2, ClipboardPaste, DollarSign, CheckCircle2, Clipboard } from "lucide-react";
import { toast } from "sonner";
import { usePixPayment } from "@/hooks/usePixPayment";
import { parseLocalizedNumber, isValidPaymentAmount } from "@/lib/utils";
import { PaymentStatusScreen } from "./PaymentStatusScreen";

interface PixCopyPasteDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PixCopyPasteDrawer({ open, onOpenChange }: PixCopyPasteDrawerProps) {
  const navigate = useNavigate();
  const { getQRCodeInfo, payByQRCode, isProcessing } = usePixPayment();
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [emvCode, setEmvCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [amount, setAmount] = useState("");
  const [merchantName, setMerchantName] = useState("");
  const [merchantCity, setMerchantCity] = useState("");
  const [pixKey, setPixKey] = useState("");
  const [hasFixedAmount, setHasFixedAmount] = useState(false);
  const [transactionId, setTransactionId] = useState("");

  const reset = () => {
    setStep(1);
    setEmvCode("");
    setIsLoading(false);
    setAmount("");
    setMerchantName("");
    setMerchantCity("");
    setPixKey("");
    setHasFixedAmount(false);
    setTransactionId("");
  };

  const handleClose = () => {
    onOpenChange(false);
    setTimeout(reset, 300);
  };

  const handleBack = () => {
    if (step === 1) {
      handleClose();
    } else if (step === 2) {
      // Loading step — go back to input
      setStep(1);
    } else if (step === 3) {
      setStep(1);
    } else if (step === 4) {
      setStep(hasFixedAmount ? 1 : 3);
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setEmvCode(text.trim());
      } else {
        toast.error("Área de transferência vazia");
      }
    } catch {
      toast.error("Não foi possível acessar a área de transferência. Cole manualmente.");
    }
  };

  const handleContinue = async () => {
    const code = emvCode.trim();
    if (!code) {
      toast.error("Cole ou digite o código Pix");
      return;
    }

    setStep(2);
    setIsLoading(true);

    const info = await getQRCodeInfo({ qr_code: code });
    setIsLoading(false);

    if (info) {
      setMerchantName(info.merchant_name || "");
      setMerchantCity(info.merchant_city || "");
      setPixKey(info.pix_key || "");
      if (info.amount && info.amount > 0) {
        setAmount(info.amount.toFixed(2).replace(".", ","));
        setHasFixedAmount(true);
        setStep(4); // skip amount step
      } else {
        setStep(3);
      }
    } else {
      toast.error("Não foi possível ler os dados do código Pix");
      setStep(3);
    }
  };

  const handleAmountContinue = () => {
    const value = parseLocalizedNumber(amount);
    const validation = isValidPaymentAmount(value);
    if (!validation.valid) {
      toast.error(validation.message);
      return;
    }
    setStep(4);
  };

  const handleConfirm = async () => {
    const value = parseLocalizedNumber(amount);
    const result = await payByQRCode({
      qr_code: emvCode.trim(),
      valor: value,
    });

    if (result?.transaction_id) {
      setTransactionId(result.transaction_id);
      setStep(5);
    }
  };

  const handleCloseAndNavigate = () => {
    handleClose();
    navigate("/transactions");
  };

  const formattedAmount = () => {
    const value = parseLocalizedNumber(amount);
    if (isNaN(value)) return "R$ 0,00";
    return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  };

  const totalSteps = 4;
  const stepIcon = step === 1 ? ClipboardPaste : step === 2 ? ClipboardPaste : step === 3 ? DollarSign : CheckCircle2;
  const stepTitle = step === 1 ? "Copia e Cola" : step === 2 ? "Consultando..." : step === 3 ? "Valor do Pagamento" : "Confirmar Pagamento";
  const StepIcon = stepIcon;

  return (
    <Drawer open={open} onOpenChange={step === 5 ? undefined : handleClose}>
      <DrawerContent>
        <div className="px-5 pb-8">
          {step !== 5 && (
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
                {[1, 2, 3, 4].map((s) => (
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

          {/* Step 1: Paste EMV code */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Código Pix (EMV)
                </Label>
                <Textarea
                  placeholder="Cole aqui o código Pix Copia e Cola..."
                  value={emvCode}
                  onChange={(e) => setEmvCode(e.target.value)}
                  className="min-h-[100px] text-sm"
                  autoFocus
                />
              </div>

              <Button
                variant="outline"
                onClick={handlePaste}
                className="w-full h-10 gap-2 text-sm font-semibold"
              >
                <Clipboard className="h-4 w-4" />
                Colar
              </Button>

              <Button
                onClick={handleContinue}
                disabled={!emvCode.trim()}
                className="w-full h-12 text-base font-bold uppercase tracking-wider"
              >
                Continuar
              </Button>
            </div>
          )}

          {/* Step 2: Loading */}
          {step === 2 && isLoading && (
            <div className="space-y-4 py-6">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Consultando dados do código Pix...</p>
              </div>
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          )}

          {/* Step 3: Amount */}
          {step === 3 && (
            <div className="space-y-5">
              {merchantName && (
                <div className="rounded-xl bg-secondary p-3">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Recebedor</p>
                  <p className="text-sm font-medium">{merchantName}</p>
                  {merchantCity && <p className="text-xs text-muted-foreground">{merchantCity}</p>}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="cp-amount" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Valor (R$)
                </Label>
                <Input
                  id="cp-amount"
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
                onClick={handleAmountContinue}
                disabled={!amount || parseLocalizedNumber(amount) <= 0}
                className="w-full h-12 text-base font-bold uppercase tracking-wider"
              >
                Continuar
              </Button>
            </div>
          )}

          {/* Step 4: Confirmation */}
          {step === 4 && (
            <div className="space-y-5">
              <div className="rounded-xl bg-secondary p-4 space-y-3">
                {merchantName && (
                  <>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Recebedor</p>
                      <p className="text-sm font-medium break-words mt-1">{merchantName}</p>
                    </div>
                    <div className="h-px bg-border" />
                  </>
                )}
                {pixKey && (
                  <>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Chave Pix</p>
                      <p className="text-sm font-medium break-all mt-1">{pixKey}</p>
                    </div>
                    <div className="h-px bg-border" />
                  </>
                )}
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

          {/* Step 5: Status verification */}
          {step === 5 && transactionId && (
            <PaymentStatusScreen
              transactionId={transactionId}
              amount={parseLocalizedNumber(amount)}
              beneficiaryName={merchantName || pixKey}
              onClose={handleCloseAndNavigate}
              redirectToReceiptCapture
            />
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
