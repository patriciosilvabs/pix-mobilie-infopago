import React, { useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { Link } from "react-router-dom";
import { useIsMobile } from "@/hooks/use-mobile";
import { MobileDashboard } from "@/components/dashboard/MobileDashboard";
import { usePixBalance } from "@/hooks/usePixBalance";
import { useDashboardData } from "@/hooks/useDashboardData";
import { Skeleton } from "@/components/ui/skeleton";
import { BarcodeScanner } from "@/components/payment/BarcodeScanner";
import { BoletoPaymentDrawer } from "@/components/payment/BoletoPaymentDrawer";
import { useBalanceVisibility } from "@/contexts/BalanceVisibilityContext";
import {
  DollarSign,
  TrendingDown,
  TrendingUp,
  Wallet,
  Send,
  AlertCircle,
  ArrowRight,
  FileWarning,
  PieChart,
  Inbox,
} from "lucide-react";
import { PieChart as RechartsPie, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

export function AdminDashboard() {
  const { profile, currentCompany, canViewBalance } = useAuth();
  const isMobile = useIsMobile();
  const { balanceVisible, toggleBalance } = useBalanceVisibility();
  const { balance, isLoading: balanceLoading, isAvailable: balanceAvailable, provider } = usePixBalance();
  const { summary, categoryData, recentTransactions, missingReceipts, isLoading: dataLoading } = useDashboardData();

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
      console.error("[AdminDashboard] getUserMedia failed:", err);
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
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold">
            Olá, {profile?.full_name?.split(" ")[0]}! 👋
          </h1>
          <p className="text-muted-foreground">
            {currentCompany?.name} • Visão administrativa
          </p>
        </div>
        <Button asChild className="bg-gradient-primary hover:opacity-90 shadow-primary">
          <Link to="/pix/new">
            <Send className="mr-2 h-4 w-4" />
            Novo Pagamento Pix
          </Link>
        </Button>
      </div>

      {/* Alert for pending receipts */}
      {summary.pendingReceipts > 0 && (
        <Card className="border-warning/50 bg-warning/5">
          <CardContent className="flex items-center gap-4 p-4">
            <div className="h-10 w-10 rounded-full bg-warning/20 flex items-center justify-center">
              <FileWarning className="h-5 w-5 text-warning" />
            </div>
            <div className="flex-1">
              <p className="font-medium">
                {summary.pendingReceipts} comprovante{summary.pendingReceipts > 1 ? "s" : ""} pendente{summary.pendingReceipts > 1 ? "s" : ""} de classificação
              </p>
              <p className="text-sm text-muted-foreground">
                Classifique os comprovantes para manter a contabilidade em dia
              </p>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link to="/transactions?status=pending">
                Ver pendências
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Summary cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Balance card */}
        {canViewBalance && (
          <Card className="balance-card text-white overflow-hidden">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="h-10 w-10 rounded-lg bg-white/20 flex items-center justify-center">
                  <Wallet className="h-5 w-5" />
                </div>
                <span className="text-xs bg-white/20 px-2 py-1 rounded-full">
                  Saldo atual
                </span>
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

        {/* Total outputs today */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="h-10 w-10 rounded-lg bg-accent-light flex items-center justify-center">
                <TrendingDown className="h-5 w-5 text-accent" />
              </div>
              <span className="text-xs bg-muted px-2 py-1 rounded-full text-muted-foreground">
                Hoje
              </span>
            </div>
            {dataLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <p className="text-2xl font-bold font-mono-numbers">
                {formatCurrency(summary.totalToday)}
              </p>
            )}
            <p className="text-muted-foreground text-sm mt-1">
              {summary.transactionsToday} transações
            </p>
          </CardContent>
        </Card>

        {/* Costs */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="h-10 w-10 rounded-lg bg-primary-light flex items-center justify-center">
                <DollarSign className="h-5 w-5 text-primary" />
              </div>
              <span className="text-2xs font-medium text-primary bg-primary-light px-2 py-1 rounded-full">
                CUSTOS
              </span>
            </div>
            {dataLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <p className="text-2xl font-bold font-mono-numbers">
                {formatCurrency(summary.totalCosts)}
              </p>
            )}
            <p className="text-muted-foreground text-sm mt-1">
              Este mês
            </p>
          </CardContent>
        </Card>

        {/* Expenses */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="h-10 w-10 rounded-lg bg-destructive/10 flex items-center justify-center">
                <TrendingUp className="h-5 w-5 text-destructive" />
              </div>
              <span className="text-2xs font-medium text-destructive bg-destructive/10 px-2 py-1 rounded-full">
                DESPESAS
              </span>
            </div>
            {dataLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <p className="text-2xl font-bold font-mono-numbers">
                {formatCurrency(summary.totalExpenses)}
              </p>
            )}
            <p className="text-muted-foreground text-sm mt-1">
              Este mês
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts and transactions */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Category distribution */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PieChart className="h-5 w-5 text-primary" />
              Distribuição por Categoria
            </CardTitle>
            <CardDescription>Gastos do mês atual</CardDescription>
          </CardHeader>
          <CardContent>
            {dataLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-[200px] w-full rounded-lg" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ) : categoryData.length === 0 ? (
              <div className="h-[200px] flex flex-col items-center justify-center text-muted-foreground">
                <Inbox className="h-10 w-10 mb-2" />
                <p className="text-sm">Nenhuma transação este mês</p>
              </div>
            ) : (
              <>
                <div className="h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <RechartsPie>
                      <Pie
                        data={categoryData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        {categoryData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: number) => formatCurrency(value)}
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                        }}
                      />
                    </RechartsPie>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-2 mt-4">
                  {categoryData.map((item, index) => (
                    <div key={index} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <div
                          className="h-3 w-3 rounded-full"
                          style={{ backgroundColor: item.color }}
                        />
                        <span className="text-muted-foreground">{item.name}</span>
                      </div>
                      <span className="font-medium font-mono-numbers">
                        {formatCurrency(item.value)}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Recent transactions */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Transações Recentes</CardTitle>
              <CardDescription>Últimos pagamentos realizados</CardDescription>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link to="/transactions">
                Ver todas
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {dataLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-4">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                    </div>
                    <Skeleton className="h-5 w-20" />
                  </div>
                ))}
              </div>
            ) : recentTransactions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <Inbox className="h-10 w-10 mb-2" />
                <p className="text-sm">Nenhuma transação este mês</p>
              </div>
            ) : (
              <div className="space-y-4">
                {recentTransactions.map((transaction) => (
                  <div
                    key={transaction.id}
                    className="flex items-center justify-between p-4 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                        <DollarSign className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium">{transaction.beneficiary}</p>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs ${
                              transaction.classification === "cost"
                                ? "bg-primary/10 text-primary"
                                : "bg-destructive/10 text-destructive"
                            }`}
                          >
                            {transaction.category}
                          </span>
                          <span>•</span>
                          <span>{transaction.time}</span>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold font-mono-numbers text-destructive">
                        - {formatCurrency(transaction.amount)}
                      </p>
                      {transaction.status === "pending" && (
                        <span className="text-xs text-warning flex items-center gap-1 justify-end">
                          <AlertCircle className="h-3 w-3" />
                          Pendente
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
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
