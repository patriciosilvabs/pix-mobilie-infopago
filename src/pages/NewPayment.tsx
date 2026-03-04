import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { usePixPayment } from "@/hooks/usePixPayment";
import { useBilletPayment } from "@/hooks/useBilletPayment";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { invalidateDashboardCache } from "@/hooks/useDashboardData";
import { cn, formatCurrency } from "@/lib/utils";
import {
  Key,
  Copy,
  QrCode,
  FileText,
  ScanBarcode,
  ArrowLeft,
  ArrowRight,
  Loader2,
  Check,
  AlertCircle,
  Banknote,
} from "lucide-react";
import { RecentPayments, type RecentPayment } from "@/components/payment/RecentPayments";
import { BarcodeScanner } from "@/components/payment/BarcodeScanner";
import { parseBoleto } from "@/utils/boletoParser";

type PaymentType = "key" | "copy_paste" | "qrcode" | "boleto" | "cash";
type PixKeyType = "cpf" | "cnpj" | "email" | "phone" | "random";

interface PaymentData {
  type: PaymentType;
  keyType?: PixKeyType;
  key?: string;
  copyPaste?: string;
  boletoCode?: string;
  beneficiaryName?: string;
  amount: string;
  description?: string;
  classification?: "cost" | "expense";
}

const pixKeyLabels: Record<PixKeyType, string> = {
  cpf: "CPF",
  cnpj: "CNPJ",
  email: "E-mail",
  phone: "Telefone",
  random: "Chave Aleatória",
};

const pixKeyPlaceholders: Record<PixKeyType, string> = {
  cpf: "000.000.000-00",
  cnpj: "00.000.000/0000-00",
  email: "exemplo@email.com",
  phone: "(11) 99999-9999",
  random: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
};

export default function NewPayment() {
  const [step, setStep] = useState(1);
  const [pixData, setPixData] = useState<PaymentData>({
    type: "key",
    keyType: "cpf",
    amount: "",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerMode, setScannerMode] = useState<"qrcode" | "barcode">("qrcode");
  const [isConsultingPaste, setIsConsultingPaste] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const tab = searchParams.get("tab");
    const autoOpenCamera = searchParams.get("openCamera") === "1";
    const validTabs: PaymentType[] = ["key", "copy_paste", "qrcode", "boleto"];

    if (tab && validTabs.includes(tab as PaymentType)) {
      setPixData((prev) => ({ ...prev, type: tab as PaymentType }));
    }

    if (tab === "boleto" && autoOpenCamera) {
      setScannerMode("barcode");
      setScannerOpen(true);
    }

    // Handle QR code from dashboard scanner
    const qrcode = searchParams.get("qrcode");
    if (qrcode) {
      setPixData((prev) => ({ ...prev, type: "copy_paste", copyPaste: qrcode }));
      (async () => {
        setIsConsultingPaste(true);
        try {
          const info = await getQRCodeInfo({ qr_code: qrcode });
          if (info && info.amount && info.amount > 0) {
            setPixData((prev) => ({
              ...prev,
              type: "copy_paste",
              copyPaste: qrcode,
              amount: info.amount!.toFixed(2).replace(".", ","),
            }));
            setStep(2);
          }
        } catch (err) {
          console.error('[NewPayment] QR code lookup error:', err);
        } finally {
          setIsConsultingPaste(false);
        }
      })();
    }
  }, [searchParams]);
  const { toast } = useToast();
  const { currentCompany, user } = useAuth();
  const { payByKey, payByQRCode, getQRCodeInfo, isProcessing: isPixProcessing } = usePixPayment();
  const { payBillet, startPolling: startBilletPolling, isProcessing: isBilletProcessing, consultBillet, isConsulting: isConsultingBillet, consultData: billetConsultData } = useBilletPayment();

  const handleNext = () => {
    // Validate current step
    if (step === 1) {
      if (pixData.type === "cash") {
        // Cash validates all fields in step 1 then submits directly
        const parsedAmount = parseFloat((pixData.amount || "").replace(",", "."));
        if (!parsedAmount || parsedAmount <= 0) {
          toast({ variant: "destructive", title: "Erro", description: "Informe um valor válido." });
          return;
        }
        if (!pixData.beneficiaryName?.trim()) {
          toast({ variant: "destructive", title: "Erro", description: "Informe o nome do favorecido." });
          return;
        }
        handleConfirmPayment();
        return;
      }
      if (pixData.type === "key" && !pixData.key) {
        toast({
          variant: "destructive",
          title: "Erro",
          description: "Informe a chave Pix",
        });
        return;
      }
      if (pixData.type === "copy_paste" && !pixData.copyPaste) {
        toast({
          variant: "destructive",
          title: "Erro",
          description: "Cole o código Pix",
        });
        return;
      }
      if (pixData.type === "boleto" && !pixData.boletoCode) {
        toast({
          variant: "destructive",
          title: "Erro",
          description: "Informe a linha digitável do boleto",
        });
        return;
      }
    }

    if (step === 2) {
      if (!pixData.amount || parseFloat(pixData.amount.replace(",", ".")) <= 0) {
        toast({
          variant: "destructive",
          title: "Erro",
          description: "Informe um valor válido",
        });
        return;
      }
    }

    if (step < 3) {
      setStep(step + 1);
    } else {
      handleConfirmPayment();
    }
  };

  const handleConfirmPayment = async () => {
    setIsLoading(true);

    try {
      const amount = parseFloat(pixData.amount?.replace(",", ".") || "0");

      if (pixData.type === 'cash') {
        if (!currentCompany?.id || !user?.id) throw new Error("Empresa ou usuário não identificado.");
        const { data, error } = await supabase.from("transactions").insert({
          company_id: currentCompany.id,
          created_by: user.id,
          amount,
          beneficiary_name: pixData.beneficiaryName?.trim() || "",
          description: pixData.description?.trim() || "Pagamento em dinheiro",
          pix_type: "cash" as any,
          status: "completed",
          paid_at: new Date().toISOString(),
        }).select("id").single();
        if (error) throw error;
        invalidateDashboardCache();
        toast({ title: "Pagamento registrado!", description: "Agora anexe o comprovante." });
        navigate(`/pix/receipt/${data.id}`);
      } else if (pixData.type === 'boleto') {
        const result = await payBillet({
          digitable_code: pixData.boletoCode || '',
          description: 'Pagamento de boleto',
          amount: amount > 0 ? amount : undefined,
        });

        if (result) {
          startBilletPolling(result.external_id?.toString() || result.transaction_id);
          navigate(`/pix/receipt/${result.transaction_id}`);
        }
      } else if (pixData.type === 'key') {
        const result = await payByKey({
          pix_key: pixData.key || '',
          valor: amount,
          descricao: 'Pagamento Pix',
        });

        if (result) {
          navigate(`/pix/receipt/${result.transaction_id}`);
        }
      } else if (pixData.type === 'copy_paste') {
        const result = await payByQRCode({
          qr_code: pixData.copyPaste || '',
          valor: amount,
          descricao: 'Pagamento Pix',
        });

        if (result) {
          navigate(`/pix/receipt/${result.transaction_id}`);
        }
      } else {
        // QR Code scan - mock for now
        toast({
          title: "Pagamento realizado!",
          description: "Agora anexe o comprovante para finalizar.",
        });
        navigate("/pix/receipt/mock-transaction-id");
      }
    } catch (error) {
      console.error('[NewPayment] Payment error:', error);
      toast({
        variant: "destructive",
        title: "Erro",
        description: "Falha ao processar o pagamento.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const amount = parseFloat(pixData.amount?.replace(",", ".") || "0");

  return (
    <MainLayout>
      <div className="p-6 lg:p-8 max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => (step > 1 ? setStep(step - 1) : navigate(-1))}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Novo Pagamento</h1>
            <p className="text-muted-foreground">Etapa {step} de 3</p>
          </div>
        </div>

        {/* Progress */}
        <div className="flex gap-2 mb-8">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-colors",
                s <= step ? "bg-primary" : "bg-muted"
              )}
            />
          ))}
        </div>

        {/* Step 1: Choose Payment Type */}
        {step === 1 && (
          <Card>
            <CardHeader>
              <CardTitle>Tipo de Pagamento</CardTitle>
              <CardDescription>
                Escolha a forma de pagamento
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <Tabs
                value={pixData.type}
                onValueChange={(v) => setPixData({ ...pixData, type: v as PaymentType })}
              >
                <TabsList className="grid grid-cols-5 w-full">
                  <TabsTrigger value="key" className="gap-2">
                    <Key className="h-4 w-4" />
                    <span className="hidden sm:inline">Chave</span>
                  </TabsTrigger>
                  <TabsTrigger value="copy_paste" className="gap-2">
                    <Copy className="h-4 w-4" />
                    <span className="hidden sm:inline">Copia e Cola</span>
                  </TabsTrigger>
                  <TabsTrigger value="qrcode" className="gap-2">
                    <QrCode className="h-4 w-4" />
                    <span className="hidden sm:inline">QR Code</span>
                  </TabsTrigger>
                  <TabsTrigger value="boleto" className="gap-2">
                    <FileText className="h-4 w-4" />
                    <span className="hidden sm:inline">Boleto</span>
                  </TabsTrigger>
                  <TabsTrigger value="cash" className="gap-2">
                    <Banknote className="h-4 w-4" />
                    <span className="hidden sm:inline">Dinheiro</span>
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="key" className="space-y-4 mt-6">
                  <div className="space-y-2">
                    <Label>Tipo de chave</Label>
                    <Select
                      value={pixData.keyType}
                      onValueChange={(v) =>
                        setPixData({ ...pixData, keyType: v as PixKeyType })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(pixKeyLabels).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Chave Pix</Label>
                    <Input
                      placeholder={
                        pixKeyPlaceholders[pixData.keyType || "cpf"]
                      }
                      value={pixData.key || ""}
                      onChange={(e) =>
                        setPixData({ ...pixData, key: e.target.value })
                      }
                    />
                  </div>
                </TabsContent>

                <TabsContent value="copy_paste" className="space-y-4 mt-6">
                  <div className="space-y-2">
                    <Label>Código Pix Copia e Cola</Label>
                    <Textarea
                      placeholder="Cole aqui o código Pix..."
                      className="min-h-[100px] font-mono text-sm"
                      value={pixData.copyPaste || ""}
                      disabled={isConsultingPaste}
                      onChange={async (e) => {
                        const code = e.target.value;
                        setPixData((prev) => ({ ...prev, copyPaste: code }));

                        // Detect EMV code and auto-extract value
                        const clean = code.trim();
                        if (clean.length >= 50 && clean.startsWith("0002")) {
                          setIsConsultingPaste(true);
                          toast({
                            title: "Consultando código Pix...",
                            description: "Extraindo informações do pagamento.",
                          });
                          try {
                            const info = await getQRCodeInfo({ qr_code: clean });
                            if (info && info.amount && info.amount > 0) {
                              setPixData((prev) => ({
                                ...prev,
                                copyPaste: clean,
                                amount: info.amount!.toFixed(2).replace(".", ","),
                              }));
                              toast({
                                title: "Pix identificado!",
                                description: `Valor: R$ ${info.amount.toFixed(2).replace(".", ",")}${info.merchant_name ? ` • ${info.merchant_name}` : ''}`,
                              });
                              setStep(2);
                            } else {
                              toast({
                                title: "Código capturado",
                                description: "Informe o valor manualmente.",
                              });
                            }
                          } catch (err) {
                            console.error('[NewPayment] Paste lookup error:', err);
                          } finally {
                            setIsConsultingPaste(false);
                          }
                        }
                      }}
                    />
                    {isConsultingPaste && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Consultando informações...
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Cole o código Pix Copia e Cola completo
                    </p>
                  </div>
                </TabsContent>

                <TabsContent value="qrcode" className="mt-6">
                  <div className="border-2 border-dashed border-border rounded-xl p-8 text-center">
                    <QrCode className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
                    <p className="text-muted-foreground">
                      Clique para abrir a câmera e escanear o QR Code
                    </p>
                    <Button
                      variant="outline"
                      className="mt-4"
                      onClick={() => {
                        setScannerMode("qrcode");
                        setScannerOpen(true);
                      }}
                    >
                      Abrir Câmera
                    </Button>
                  </div>
                </TabsContent>

                <TabsContent value="boleto" className="space-y-4 mt-6">
                  <div className="border-2 border-dashed border-border rounded-xl p-8 text-center">
                    <ScanBarcode className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
                    <p className="text-muted-foreground">
                      Escaneie o código de barras com a câmera do seu dispositivo
                    </p>
                    <Button
                      variant="outline"
                      className="mt-4"
                      onClick={() => {
                        setScannerMode("barcode");
                        setScannerOpen(true);
                      }}
                    >
                      Abrir Câmera
                    </Button>
                  </div>

                  <div className="relative flex items-center gap-4">
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-xs text-muted-foreground">ou digite manualmente</span>
                    <div className="flex-1 h-px bg-border" />
                  </div>

                  <div className="space-y-2">
                    <Label>Linha Digitável</Label>
                    <Input
                      placeholder="00000.00000 00000.000000 00000.000000 0 00000000000000"
                      className="font-mono text-sm"
                      value={pixData.boletoCode || ""}
                      onChange={async (e) => {
                        const code = e.target.value;
                        const clean = code.replace(/[\s.\-]/g, '');
                        const newData: Partial<PaymentData> = { boletoCode: code };
                        
                        // Auto-extract value from barcode first (fallback)
                        if (clean.length === 44 || clean.length === 47 || clean.length === 48) {
                          const info = parseBoleto(clean);
                          if (info && info.amount > 0) {
                            newData.amount = info.amount.toFixed(2).replace(".", ",");
                          }
                          setPixData(prev => ({ ...prev, ...newData }));

                          // Consult backend for updated value with interest/fines
                          const consultResult = await consultBillet(clean);
                          if (consultResult) {
                            const updatedAmount = Number(consultResult.total_updated_value ?? consultResult.value ?? 0);
                            if (updatedAmount > 0) {
                              setPixData(prev => ({
                                ...prev,
                                amount: updatedAmount.toFixed(2).replace(".", ","),
                                beneficiaryName: consultResult.recipient_name || prev.beneficiaryName,
                              }));
                            }
                          }
                        } else {
                          setPixData(prev => ({ ...prev, ...newData }));
                        }
                      }}
                    />
                    {isConsultingBillet && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Consultando boleto na CIP...
                      </div>
                    )}
                    {billetConsultData && (
                      <div className="rounded-lg bg-secondary p-3 space-y-2 text-sm">
                        {billetConsultData.recipient_name && (
                          <div>
                            <span className="text-xs font-bold uppercase text-muted-foreground">Beneficiário: </span>
                            <span className="font-medium">{billetConsultData.recipient_name}</span>
                          </div>
                        )}
                        {billetConsultData.fine_value && billetConsultData.fine_value > 0 && (
                          <div className="flex items-center gap-1.5 text-amber-600">
                            <AlertCircle className="h-3.5 w-3.5" />
                            <span className="text-xs font-bold uppercase">Multa:</span>
                            <span className="font-medium">
                              {billetConsultData.fine_value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                            </span>
                          </div>
                        )}
                        {billetConsultData.interest_value && billetConsultData.interest_value > 0 && (
                          <div className="flex items-center gap-1.5 text-amber-600">
                            <AlertCircle className="h-3.5 w-3.5" />
                            <span className="text-xs font-bold uppercase">Juros:</span>
                            <span className="font-medium">
                              {billetConsultData.interest_value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                            </span>
                          </div>
                        )}
                        {billetConsultData.discount_value && billetConsultData.discount_value > 0 && (
                          <div className="text-emerald-600">
                            <span className="text-xs font-bold uppercase">Desconto:</span>
                            <span className="font-medium ml-1">
                              - {billetConsultData.discount_value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                            </span>
                          </div>
                        )}
                        {billetConsultData.total_updated_value && billetConsultData.total_updated_value > 0 && (
                          <div>
                            <span className="text-xs font-bold uppercase text-muted-foreground">Valor Atualizado: </span>
                            <span className="font-bold text-primary">
                              {billetConsultData.total_updated_value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Digite ou cole a linha digitável do código de barras (47 ou 48 dígitos)
                    </p>
                  </div>
                </TabsContent>

                <TabsContent value="cash" className="space-y-4 mt-6">
                  <div className="space-y-2">
                    <Label>Valor (R$) *</Label>
                    <Input
                      placeholder="0,00"
                      inputMode="decimal"
                      className="text-lg font-mono-numbers"
                      value={pixData.amount || ""}
                      onChange={(e) => setPixData({ ...pixData, amount: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Favorecido *</Label>
                    <Input
                      placeholder="Nome de quem recebeu o dinheiro"
                      value={pixData.beneficiaryName || ""}
                      onChange={(e) => setPixData({ ...pixData, beneficiaryName: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Descrição (opcional)</Label>
                    <Textarea
                      placeholder="Observações do pagamento..."
                      value={pixData.description || ""}
                      onChange={(e) => setPixData({ ...pixData, description: e.target.value })}
                      className="min-h-[80px]"
                    />
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        )}

        {/* Recent Payments - only on step 1 */}
        {step === 1 && (
          <RecentPayments
            onSelect={(payment: RecentPayment) => {
              setPixData({
                type: payment.pix_type as PaymentType,
                keyType: (payment.pix_key_type as PixKeyType) || "cpf",
                key: payment.pix_key,
                amount: payment.amount.toString().replace(".", ","),
                description: payment.description || "",
              });
              setStep(2);
            }}
          />
        )}

        {/* Step 2: Amount and Classification */}
        {step === 2 && (
          <Card>
            <CardHeader>
              <CardTitle>Informação do pagamento</CardTitle>
              <CardDescription>
                Informe o valor do pagamento
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label>Valor (R$)</Label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-medium text-muted-foreground">
                    R$
                  </span>
                  <Input
                    type="text"
                    inputMode="decimal"
                    placeholder="0,00"
                    className="pl-12 text-2xl font-bold h-14"
                    value={pixData.amount}
                    onChange={(e) => {
                      const value = e.target.value.replace(/[^\d,]/g, "");
                      setPixData({ ...pixData, amount: value });
                    }}
                  />
                </div>
              </div>

            </CardContent>
          </Card>
        )}

        {/* Step 3: Confirmation */}
        {step === 3 && (
          <Card>
            <CardHeader>
              <CardTitle>Confirmar Pagamento</CardTitle>
              <CardDescription>
                Verifique os dados antes de confirmar
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="bg-muted/50 rounded-xl p-6 space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Tipo</span>
                  <span className="font-medium capitalize">
                    {pixData.type === "key"
                      ? `Chave ${pixKeyLabels[pixData.keyType || "cpf"]}`
                      : pixData.type === "copy_paste"
                      ? "Copia e Cola"
                      : pixData.type === "boleto"
                      ? "Boleto"
                      : "QR Code"}
                  </span>
                </div>

                {pixData.type === "key" && (
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Chave</span>
                    <span className="font-medium font-mono text-sm">
                      {pixData.key}
                    </span>
                  </div>
                )}

                {pixData.type === "boleto" && (
                  <div className="flex justify-between items-start">
                    <span className="text-muted-foreground">Linha Digitável</span>
                    <span className="font-medium font-mono text-sm text-right max-w-[60%] break-all">
                      {pixData.boletoCode}
                    </span>
                  </div>
                )}

                <div className="border-t border-border pt-4">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Valor</span>
                    <span className="text-2xl font-bold text-primary">
                      {formatCurrency(amount)}
                    </span>
                  </div>
                </div>

              </div>

              <div className="flex items-start gap-3 p-4 bg-warning/10 rounded-lg">
                <AlertCircle className="h-5 w-5 text-warning flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium">Atenção</p>
                  <p className="text-muted-foreground">
                    Após confirmar o pagamento, você deverá anexar o comprovante
                    fiscal para finalizar a transação.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Actions */}
        <div className="flex gap-4 mt-6">
          {step > 1 && (
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setStep(step - 1)}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Voltar
            </Button>
          )}
          <Button
            className={cn(
              "flex-1 bg-gradient-primary hover:opacity-90 shadow-primary",
              step === 1 && "w-full"
            )}
            onClick={handleNext}
            disabled={isLoading || isPixProcessing || isBilletProcessing || isConsultingPaste || isConsultingBillet}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processando...
              </>
            ) : pixData.type === "cash" && step === 1 ? (
              <>
                <Check className="mr-2 h-4 w-4" />
                Registrar Pagamento
              </>
            ) : step === 3 ? (
              <>
                <Check className="mr-2 h-4 w-4" />
                Confirmar Pagamento
              </>
            ) : (
              <>
                Continuar
                <ArrowRight className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </div>

      <BarcodeScanner
        mode={scannerMode}
        isOpen={scannerOpen}
        onScan={async (result) => {
          setScannerOpen(false);
          if (scannerMode === "qrcode") {
            setPixData((prev) => ({ ...prev, type: "copy_paste", copyPaste: result }));
            toast({
              title: "QR Code escaneado!",
              description: "Consultando informações do QR Code...",
            });
            // Try to get QR code info (amount, recipient, etc.)
            const info = await getQRCodeInfo({ qr_code: result });
            if (info && info.amount && info.amount > 0) {
              setPixData((prev) => ({
                ...prev,
                type: "copy_paste",
                copyPaste: result,
                amount: info.amount.toFixed(2).replace(".", ","),
              }));
              toast({
                title: "QR Code identificado!",
                description: `Valor: R$ ${info.amount.toFixed(2).replace(".", ",")}${info.merchant_name ? ` • ${info.merchant_name}` : ''}`,
              });
              setStep(2);
            } else {
              toast({
                title: "QR Code capturado!",
                description: "Informe o valor manualmente.",
              });
            }
          } else {
            // Parse boleto to extract amount (fallback)
            const boletoInfo = parseBoleto(result);
            const extractedAmount = boletoInfo && boletoInfo.amount > 0
              ? boletoInfo.amount.toFixed(2).replace(".", ",")
              : "";

            setPixData((prev) => ({
              ...prev,
              type: "boleto",
              boletoCode: result,
              amount: extractedAmount || prev.amount,
            }));

            // Consult updated billet amount (interest/fines/discount)
            const clean = result.replace(/[\s.\-]/g, '');
            const consultResult = await consultBillet(clean);
            const updatedAmount = Number(consultResult?.total_updated_value ?? consultResult?.value ?? 0);

            if (updatedAmount > 0) {
              setPixData((prev) => ({
                ...prev,
                type: "boleto",
                boletoCode: result,
                amount: updatedAmount.toFixed(2).replace(".", ","),
                beneficiaryName: consultResult?.recipient_name || prev.beneficiaryName,
              }));

              toast({
                title: "Boleto consultado!",
                description: `Valor atualizado: R$ ${updatedAmount.toFixed(2).replace(".", ",")}`,
              });
              setStep(2);
              return;
            }

            if (boletoInfo && boletoInfo.amount > 0) {
              toast({
                title: "Boleto identificado!",
                description: `Valor: R$ ${boletoInfo.amount.toFixed(2).replace(".", ",")}${boletoInfo.dueDate ? ` • Venc: ${new Date(boletoInfo.dueDate + 'T12:00:00').toLocaleDateString('pt-BR')}` : ''}`,
              });
              setStep(2);
            } else {
              toast({
                title: "Código de barras capturado!",
                description: "Informe o valor do boleto manualmente.",
              });
            }
          }
        }}
        onClose={() => setScannerOpen(false)}
        onManualInput={() => {
          setScannerOpen(false);
        }}
      />
    </MainLayout>
  );
}
