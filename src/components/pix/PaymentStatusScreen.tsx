import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, CheckCircle2, XCircle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePixPayment } from "@/hooks/usePixPayment";
import { invalidateDashboardCache } from "@/hooks/useDashboardData";

type StatusState = "polling" | "completed" | "failed" | "timeout";

interface PaymentStatusScreenProps {
  transactionId: string;
  amount: number;
  beneficiaryName?: string;
  onClose: () => void;
  onViewReceipt?: () => void;
  /** When true, redirects to receipt capture page on completion instead of showing "Ver Comprovante" */
  redirectToReceiptCapture?: boolean;
}

export function PaymentStatusScreen({
  transactionId,
  amount,
  beneficiaryName,
  onClose,
  onViewReceipt,
  redirectToReceiptCapture = false,
}: PaymentStatusScreenProps) {
  const navigate = useNavigate();
  const { checkStatus, downloadReceipt } = usePixPayment();
  const [status, setStatus] = useState<StatusState>("polling");
  const [providerStatus, setProviderStatus] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const attemptsRef = useRef(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);

  const MAX_ATTEMPTS = 30;
  const POLL_INTERVAL = 2000;

  const poll = useCallback(async () => {
    if (!mountedRef.current) return;
    attemptsRef.current++;

    try {
      const result = await checkStatus(transactionId, true);

      if (!mountedRef.current) return;

      if (!result) {
        if (attemptsRef.current >= MAX_ATTEMPTS) {
          setStatus("timeout");
          return;
        }
        return; // keep polling
      }

      setProviderStatus(result.internal_status || result.status);

      if (result.is_completed || result.internal_status === "completed") {
        setStatus("completed");
        invalidateDashboardCache();
        if (timerRef.current) clearInterval(timerRef.current);
        return;
      }

      if (result.internal_status === "failed") {
        setStatus("failed");
        setErrorMessage(result.error_code || "O pagamento foi recusado pelo provedor.");
        if (timerRef.current) clearInterval(timerRef.current);
        return;
      }

      if (result.internal_status === "refunded") {
        setStatus("failed");
        setErrorMessage("O pagamento foi devolvido.");
        if (timerRef.current) clearInterval(timerRef.current);
        return;
      }

      if (attemptsRef.current >= MAX_ATTEMPTS) {
        setStatus("timeout");
        if (timerRef.current) clearInterval(timerRef.current);
      }
    } catch {
      if (attemptsRef.current >= MAX_ATTEMPTS && mountedRef.current) {
        setStatus("timeout");
        if (timerRef.current) clearInterval(timerRef.current);
      }
    }
  }, [checkStatus, transactionId]);

  useEffect(() => {
    mountedRef.current = true;
    // Initial poll
    poll();
    timerRef.current = setInterval(poll, POLL_INTERVAL);

    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [poll]);

  const formattedAmount = amount.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

  const handleDownloadReceipt = async () => {
    await downloadReceipt(transactionId, true);
  };

  return (
    <div className="flex flex-col items-center gap-5 py-4">
      {/* Polling */}
      {status === "polling" && (
        <>
          <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
          <div className="text-center space-y-1">
            <p className="text-base font-bold">Aguardando confirmação</p>
            <p className="text-sm text-muted-foreground">
              Verificando status do pagamento...
            </p>
          </div>
          {beneficiaryName && (
            <p className="text-sm text-muted-foreground">{beneficiaryName}</p>
          )}
          <p className="text-2xl font-bold text-primary">{formattedAmount}</p>
        </>
      )}

      {/* Completed */}
      {status === "completed" && (
        <>
          <div className="h-16 w-16 rounded-full bg-emerald-500/10 flex items-center justify-center">
            <CheckCircle2 className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="text-center space-y-1">
            <p className="text-base font-bold">Pagamento confirmado!</p>
            <p className="text-sm text-muted-foreground">
              O provedor confirmou a liquidação.
            </p>
          </div>
          {beneficiaryName && (
            <p className="text-sm text-muted-foreground">{beneficiaryName}</p>
          )}
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{formattedAmount}</p>
          <div className="w-full space-y-2 mt-2">
            {redirectToReceiptCapture ? (
              <>
                <Button
                  onClick={() => {
                    onClose();
                    navigate(`/pix/receipt/${transactionId}`);
                  }}
                  className="w-full h-12 text-base font-bold uppercase tracking-wider"
                >
                  Anexar Comprovante
                </Button>
              </>
            ) : (
              <>
                <Button
                  onClick={handleDownloadReceipt}
                  className="w-full h-12 text-base font-bold uppercase tracking-wider"
                >
                  Ver Comprovante
                </Button>
                <Button
                  variant="outline"
                  onClick={onClose}
                  className="w-full h-12 text-base font-bold uppercase tracking-wider"
                >
                  Fechar
                </Button>
              </>
            )}
          </div>
        </>
      )}

      {/* Failed */}
      {status === "failed" && (
        <>
          <div className="h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center">
            <XCircle className="h-8 w-8 text-destructive" />
          </div>
          <div className="text-center space-y-1">
            <p className="text-base font-bold">Pagamento não concluído</p>
            <p className="text-sm text-muted-foreground">{errorMessage}</p>
          </div>
          <p className="text-2xl font-bold text-destructive">{formattedAmount}</p>
          <Button
            variant="outline"
            onClick={onClose}
            className="w-full h-12 text-base font-bold uppercase tracking-wider mt-2"
          >
            Fechar
          </Button>
        </>
      )}

      {/* Timeout */}
      {status === "timeout" && (
        <>
          <div className="h-16 w-16 rounded-full bg-amber-500/10 flex items-center justify-center">
            <Clock className="h-8 w-8 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="text-center space-y-1">
            <p className="text-base font-bold">Pagamento em processamento</p>
            <p className="text-sm text-muted-foreground">
              O pagamento ainda está sendo processado. Acompanhe pelo extrato.
            </p>
          </div>
          <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{formattedAmount}</p>
          <Button
            variant="outline"
            onClick={onClose}
            className="w-full h-12 text-base font-bold uppercase tracking-wider mt-2"
          >
            Fechar
          </Button>
        </>
      )}
    </div>
  );
}
