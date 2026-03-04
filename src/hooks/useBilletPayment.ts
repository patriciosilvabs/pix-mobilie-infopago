import { useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

export interface BilletConsultResult {
  success: boolean;
  value?: number;
  total_updated_value?: number;
  due_date?: string;
  fine_value?: number;
  interest_value?: number;
  discount_value?: number;
  recipient_name?: string;
  recipient_document?: string;
  type?: string;
  status?: string;
  digitable_line?: string;
  barcode?: string;
  raw?: any;
}

interface PayBilletParams {
  digitable_code: string;
  description: string;
  payment_flow?: 'INSTANT' | 'APPROVAL_REQUIRED';
  amount?: number;
}

interface BilletPaymentResult {
  success: boolean;
  transaction_id: string;
  external_id: string;
  status: string;
  amount?: number;
  due_date?: string;
  creditor?: { name?: string; document?: string };
  idempotency_key?: string;
}

interface BilletStatus {
  success: boolean;
  billet_id: number;
  status: string;
  internal_status: string;
  is_completed: boolean;
  amount?: number;
  due_date?: string;
  settle_date?: string;
  bar_code?: string;
  creditor?: any;
  debtor?: any;
  error_code?: string;
}

interface BilletReceiptResult {
  success: boolean;
  billet_id: string;
  pdf_base64?: string;
  content_type: string;
}

export function useBilletPayment() {
  const { currentCompany, session } = useAuth();
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isConsulting, setIsConsulting] = useState(false);
  const [paymentData, setPaymentData] = useState<BilletPaymentResult | null>(null);
  const [billetStatus, setBilletStatus] = useState<BilletStatus | null>(null);
  const [consultData, setConsultData] = useState<BilletConsultResult | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const consultBillet = useCallback(async (codigo_barras: string): Promise<BilletConsultResult | null> => {
    if (!currentCompany || !session) return null;

    setIsConsulting(true);
    setConsultData(null);

    try {
      const { data, error } = await supabase.functions.invoke('billet-consult', {
        body: {
          company_id: currentCompany.id,
          codigo_barras,
        },
      });

      if (error || !data?.success) {
        console.error('[useBilletPayment] Consult error:', error || data?.error);
        // Non-blocking: return null, let the user proceed with manual amount
        return null;
      }

      setConsultData(data);
      return data;
    } catch (error: any) {
      console.error('[useBilletPayment] Consult exception:', error);
      return null;
    } finally {
      setIsConsulting(false);
    }
  }, [currentCompany, session]);

  const payBillet = useCallback(async (params: PayBilletParams): Promise<BilletPaymentResult | null> => {
    if (!currentCompany || !session) {
      toast({
        variant: "destructive",
        title: "Erro",
        description: "Você precisa estar logado e ter uma empresa selecionada.",
      });
      return null;
    }

    setIsProcessing(true);

    try {
      const { data, error } = await supabase.functions.invoke('billet-pay', {
        body: {
          company_id: currentCompany.id,
          codigo_barras: params.digitable_code,
          descricao: params.description,
          valor: params.amount,
        },
      });

      if (error) {
        console.error('[useBilletPayment] Pay error:', error);
        // Try to extract the actual error message from the response context
        let errorMessage = "Tente novamente mais tarde.";
        try {
          if (error.context && typeof error.context === 'object') {
            const res = error.context as Response;
            if (res.json) {
              const body = await res.json();
              errorMessage = body?.error || body?.hint || errorMessage;
            }
          }
        } catch { /* ignore parse errors */ }
        toast({
          variant: "destructive",
          title: "Pagamento de boleto indisponível",
          description: errorMessage,
        });
        return null;
      }

      if (!data.success) {
        toast({
          variant: "destructive",
          title: "Erro ao iniciar pagamento",
          description: data.error || "Erro desconhecido.",
        });
        return null;
      }

      setPaymentData(data);

      toast({
        title: "Pagamento de boleto iniciado!",
        description: "O pagamento foi enviado para processamento.",
      });

      return data;
    } catch (error: any) {
      console.error('[useBilletPayment] Pay exception:', error);
      toast({
        variant: "destructive",
        title: "Erro",
        description: "Falha na comunicação com o servidor.",
      });
      return null;
    } finally {
      setIsProcessing(false);
    }
  }, [currentCompany, session, toast]);

  const checkBilletStatus = useCallback(async (
    billetIdOrTransactionId: string,
    isTransactionId = false
  ): Promise<BilletStatus | null> => {
    if (!currentCompany || !session) return null;

    setIsChecking(true);

    try {
      const body: any = { company_id: currentCompany.id };

      if (isTransactionId) {
        body.transaction_id = billetIdOrTransactionId;
      } else {
        body.billet_id = billetIdOrTransactionId;
      }

      const { data, error } = await supabase.functions.invoke('billet-check-status', {
        body,
      });

      if (error || !data.success) {
        console.error('[useBilletPayment] Check status error:', error || data.error);
        return null;
      }

      setBilletStatus(data);
      return data;
    } catch (error: any) {
      console.error('[useBilletPayment] Check status exception:', error);
      return null;
    } finally {
      setIsChecking(false);
    }
  }, [currentCompany, session]);

  const startPolling = useCallback((billetId: string, intervalMs = 5000, maxAttempts = 60) => {
    let attempts = 0;

    const poll = async () => {
      attempts++;
      console.log(`[useBilletPayment] Polling attempt ${attempts}/${maxAttempts}`);

      const status = await checkBilletStatus(billetId);

      if (status?.is_completed) {
        console.log('[useBilletPayment] Billet payment confirmed!');
        stopPolling();
        toast({
          title: "Boleto pago!",
          description: "O pagamento do boleto foi confirmado.",
        });
        return;
      }

      if (status?.status === 'CANCELED' || status?.status === 'FAILED') {
        console.log('[useBilletPayment] Billet payment failed/cancelled');
        stopPolling();
        toast({
          variant: "destructive",
          title: "Pagamento falhou",
          description: status.error_code || "O pagamento do boleto foi cancelado.",
        });
        return;
      }

      if (attempts >= maxAttempts) {
        console.log('[useBilletPayment] Max polling attempts reached');
        stopPolling();
        return;
      }
    };

    poll();
    pollingRef.current = setInterval(poll, intervalMs);
  }, [checkBilletStatus, toast]);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const downloadBilletReceipt = useCallback(async (
    billetIdOrTransactionId: string,
    isTransactionId = false
  ) => {
    if (!currentCompany || !session) {
      toast({
        variant: "destructive",
        title: "Erro",
        description: "Você precisa estar logado.",
      });
      return;
    }

    try {
      const body: any = { company_id: currentCompany.id };

      if (isTransactionId) {
        body.transaction_id = billetIdOrTransactionId;
      } else {
        body.billet_id = billetIdOrTransactionId;
      }

      const { data, error } = await supabase.functions.invoke('billet-receipt', {
        body,
      });

      if (error || !data.success) {
        console.error('[useBilletPayment] Receipt error:', error || data.error);
        toast({
          variant: "destructive",
          title: "Erro ao obter comprovante",
          description: "Não foi possível baixar o comprovante do boleto.",
        });
        return;
      }

      const receipt: BilletReceiptResult = data;

      if (receipt.pdf_base64) {
        const byteCharacters = atob(receipt.pdf_base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'application/pdf' });

        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `comprovante_boleto_${receipt.billet_id}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);

        toast({
          title: "Comprovante baixado!",
          description: "O PDF foi salvo na pasta de downloads.",
        });
      }
    } catch (error: any) {
      console.error('[useBilletPayment] Receipt exception:', error);
      toast({
        variant: "destructive",
        title: "Erro",
        description: "Falha na comunicação com o servidor.",
      });
    }
  }, [currentCompany, session, toast]);

  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  return {
    isProcessing,
    isChecking,
    isConsulting,
    paymentData,
    billetStatus,
    consultData,
    payBillet,
    consultBillet,
    checkBilletStatus,
    startPolling,
    stopPolling,
    downloadBilletReceipt,
  };
}
