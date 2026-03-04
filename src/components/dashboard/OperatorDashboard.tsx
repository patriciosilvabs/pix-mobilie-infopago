import React, { useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/utils";
import { Link } from "react-router-dom";
import { useIsMobile } from "@/hooks/use-mobile";
import { MobileDashboard } from "@/components/dashboard/MobileDashboard";
import { useDashboardData } from "@/hooks/useDashboardData";
import { usePixBalance } from "@/hooks/usePixBalance";
import { BarcodeScanner } from "@/components/payment/BarcodeScanner";
import { BoletoPaymentDrawer } from "@/components/payment/BoletoPaymentDrawer";
import { useBalanceVisibility } from "@/contexts/BalanceVisibilityContext";
import {
  Send,
  History,
  FileWarning,
  ArrowRight,
  DollarSign,
  Clock,
  CheckCircle2,
  AlertCircle,
  Inbox,
  Wallet,
} from "lucide-react";

export function OperatorDashboard() {
  const { profile, currentCompany, canViewBalance } = useAuth();
  const isMobile = useIsMobile();
  const { balanceVisible, toggleBalance } = useBalanceVisibility();
  const { summary, recentTransactions, missingReceipts, isLoading: dataLoading } = useDashboardData();
  const { balance, isLoading: balanceLoading, isAvailable: balanceAvailable, provider } = usePixBalance();

  const [barcodeScannerOpen, setBarcodeScannerOpen] = React.useState(false);
  const [scannedBarcode, setScannedBarcode] = React.useState("");
  const [boletoPaymentOpen, setBoletoPaymentOpen] = React.useState(false);
  const preAcquiredStreamRef = useRef<MediaStream | null>(null);

  const acquireStreamAndOpenBarcode = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
      });
      preAcquiredStreamRef.current = stream;
      setBarcodeScannerOpen(true);
    } catch (err: any) {
      console.error("[OperatorDashboard] getUserMedia failed:", err);
      if (err?.name === "NotAllowedError") {
        alert("Permissão da câmera negada. Habilite nas configurações do navegador.");
      } else if (err?.name === "NotFoundError") {
        alert("Nenhuma câmera encontrada no dispositivo.");
      } else {
        alert("Erro ao acessar a câmera. Tente novamente.");
      }
    }
  };

  const handleBarcodeScan = (result: string) => {
    setBarcodeScannerOpen(false);
    setScannedBarcode(result);
    setBoletoPaymentOpen(true);
  };

  const content = isMobile ? (
    <MobileDashboard
      balanceVisible={balanceVisible}
      onToggleBalance={toggleBalance}
      balance={balance}
      balanceLoading={balanceLoading}
      balanceAvailable={balanceAvailable}
      provider={provider}
      recentTransactions={recentTransactions}
      missingReceipts={missingReceipts}
      dataLoading={dataLoading}
      canViewBalance={canViewBalance}
      onOpenBarcodeScanner={acquireStreamAndOpenBarcode}
    />
  ) : (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold">
            Olá, {profile?.full_name?.split(" ")[0]}! 👋
          </h1>
          <p className="text-muted-foreground">
            {currentCompany?.name} • Operador
          </p>
        </div>

        {/* Quick actions */}
        <div className="grid grid-cols-2 gap-4">
          <Button
            asChild
            size="lg"
            className="h-auto py-6 flex-col gap-2 bg-gradient-primary hover:opacity-90 shadow-primary"
          >
            <Link to="/pix/new">
              <Send className="h-8 w-8" />
              <span className="font-semibold">Novo Pix</span>
            </Link>
          </Button>
          <Button
            asChild
            size="lg"
            variant="outline"
            className="h-auto py-6 flex-col gap-2"
          >
            <Link to="/transactions">
              <History className="h-8 w-8" />
              <span className="font-semibold">Histórico</span>
            </Link>
          </Button>
        </div>
      </div>

      {/* Balance hidden card */}
      {canViewBalance && (
        <Card className="balance-card text-white overflow-hidden">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="h-10 w-10 rounded-lg bg-white/20 flex items-center justify-center">
                <Wallet className="h-5 w-5" />
              </div>
              <span className="text-xs bg-white/20 px-2 py-1 rounded-full">Saldo atual</span>
            </div>
            {balanceLoading ? (
              <Skeleton className="h-9 w-40 bg-white/20" />
            ) : balanceAvailable ? (
              <p className="text-3xl font-bold font-mono-numbers">
                {formatCurrency(balance ?? 0)}
              </p>
            ) : (
              <p className="text-xl font-bold">Indisponível</p>
            )}
            <p className="text-white/70 text-sm mt-1">
              {provider ? `Provedor: ${provider}` : 'Atualizado em tempo real'}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Alert for pending receipts */}
      {summary.pendingReceipts > 0 && (
        <Card className="border-warning/50 bg-warning/5">
          <CardContent className="flex items-center gap-4 p-4">
            <div className="h-10 w-10 rounded-full bg-warning/20 flex items-center justify-center">
              <FileWarning className="h-5 w-5 text-warning" />
            </div>
            <div className="flex-1">
              <p className="font-medium">
                {summary.pendingReceipts} comprovantes pendentes
              </p>
              <p className="text-sm text-muted-foreground">
                Anexe os comprovantes para completar os pagamentos
              </p>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link to="/transactions?status=pending">
                Anexar
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary-light flex items-center justify-center">
                <Clock className="h-5 w-5 text-primary" />
              </div>
              <div>
                {dataLoading ? (
                  <Skeleton className="h-7 w-10" />
                ) : (
                  <p className="text-2xl font-bold">
                    {summary.transactionsToday}
                  </p>
                )}
                <p className="text-sm text-muted-foreground">Pagamentos hoje</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-warning/10 flex items-center justify-center">
                <FileWarning className="h-5 w-5 text-warning" />
              </div>
              <div>
                {dataLoading ? (
                  <Skeleton className="h-7 w-10" />
                ) : (
                  <p className="text-2xl font-bold">
                    {summary.pendingReceipts}
                  </p>
                )}
                <p className="text-sm text-muted-foreground">Pendentes</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* My recent transactions */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-4">
          <div>
            <CardTitle className="text-lg">Meus Pagamentos</CardTitle>
            <CardDescription>Transações realizadas recentemente</CardDescription>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/transactions">
              Ver todos
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {dataLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3 p-3">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                  <Skeleton className="h-4 w-20" />
                </div>
              ))}
            </div>
          ) : recentTransactions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Inbox className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Nenhum pagamento realizado</p>
            </div>
          ) : (
            recentTransactions.map((transaction) => (
              <div
                key={transaction.id}
                className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
              >
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <DollarSign className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">{transaction.beneficiary}</p>
                    <p className="text-xs text-muted-foreground">{transaction.time}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bold font-mono-numbers text-sm">
                    {formatCurrency(transaction.amount)}
                  </p>
                  <div className="flex items-center justify-end gap-1 mt-1">
                    {transaction.status === "completed" ? (
                      <span className="text-xs text-success flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        Concluído
                      </span>
                    ) : (
                      <span className="text-xs text-warning flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />
                        Pendente
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );

  return (
    <>
      {content}
      <BarcodeScanner
        mode="barcode"
        isOpen={barcodeScannerOpen}
        onScan={handleBarcodeScan}
        onClose={() => setBarcodeScannerOpen(false)}
        preAcquiredStream={preAcquiredStreamRef.current}
      />
      <BoletoPaymentDrawer
        open={boletoPaymentOpen}
        barcode={scannedBarcode}
        onOpenChange={setBoletoPaymentOpen}
      />
    </>
  );
}
