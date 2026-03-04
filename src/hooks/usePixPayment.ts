import { useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface PayDictParams {
  pix_key: string;
  valor: number;
  descricao?: string;
  creditor_document?: string;
  priority?: 'HIGH' | 'NORM';
  payment_flow?: 'INSTANT' | 'APPROVAL_REQUIRED';
}

interface PayQrcParams {
  qr_code: string;
  valor?: number;
  descricao?: string;
  creditor_document?: string;
  priority?: 'HIGH' | 'NORM';
  payment_flow?: 'INSTANT' | 'APPROVAL_REQUIRED';
}

interface QRCInfoParams {
  qr_code: string;
}

interface PaymentResult {
  success: boolean;
  transaction_id: string;
  end_to_end_id: string;
  provider_id: number;
  status: string;
  event_date?: string;
  idempotency_key?: string;
  amount?: number;
}

interface QRCInfoResult {
  success: boolean;
  type: string;
  merchant_name?: string;
  merchant_city?: string;
  amount?: number;
  pix_key?: string;
  txid?: string;
  end_to_end_id?: string;
}

interface DictLookupResult {
  success: boolean;
  name: string;
  cpf_cnpj: string;
  key_type: string;
  key: string;
  bank_name: string;
  agency: string;
  account: string;
  account_type: string;
  end2end_id: string;
  ispb: string;
  error?: string;
}

interface PaymentStatus {
  success: boolean;
  end_to_end_id: string;
  provider_id: number;
  status: string;
  internal_status: string;
  is_liquidated: boolean;
  is_completed: boolean;
  error_code?: string;
  amount?: number;
  creditor?: any;
  debtor?: any;
}

interface ReceiptResult {
  success: boolean;
  end_to_end_id: string;
  pdf_base64?: string;
  content_type: string;
}

export function usePixPayment() {
  const { currentCompany, session } = useAuth();
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [paymentData, setPaymentData] = useState<PaymentResult | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Lookup Pix key in DICT
  const lookupKey = useCallback(async (pix_key: string): Promise<DictLookupResult | null> => {
    if (!currentCompany || !session) {
      toast({
        variant: "destructive",
        title: "Erro",
        description: "Você precisa estar logado e ter uma empresa selecionada.",
      });
      return null;
    }

    setIsLookingUp(true);

    try {
      const { data, error } = await supabase.functions.invoke('pix-dict-lookup', {
        body: { company_id: currentCompany.id, pix_key },
      });

      if (error) {
        console.error('[usePixPayment] DICT lookup error:', error);
        toast({
          variant: "destructive",
          title: "Erro na consulta DICT",
          description: error.message || "Não foi possível consultar a chave.",
        });
        return null;
      }

      if (!data.success) {
        toast({
          variant: "destructive",
          title: "Chave não encontrada",
          description: data.error || "A chave Pix informada não foi encontrada no DICT.",
        });
        return null;
      }

      return data as DictLookupResult;

    } catch (error: any) {
      console.error('[usePixPayment] DICT lookup exception:', error);
      toast({
        variant: "destructive",
        title: "Erro",
        description: "Falha na comunicação com o servidor.",
      });
      return null;
    } finally {
      setIsLookingUp(false);
    }
  }, [currentCompany, session, toast]);

  // Pay via Pix key (DICT)
  const payByKey = useCallback(async (params: PayDictParams): Promise<PaymentResult | null> => {
    if (!currentCompany || !session) {
      toast({
        variant: "destructive",
        title: "Erro",
        description: "Você precisa estar logado e ter uma empresa selecionada.",
      });
      return null;
    }

    setIsProcessing(true);
    const idempotencyKey = crypto.randomUUID();

    try {
      const { data, error } = await supabase.functions.invoke('pix-pay-dict', {
        body: {
          company_id: currentCompany.id,
          idempotency_key: idempotencyKey,
          ...params,
        },
      });

      if (error) {
        console.error('[usePixPayment] Pay by key error:', error);
        
        // Check if it's a network error (connection lost)
        const isNetworkError = !error.context || error.message?.includes('Failed to send') || error.message?.includes('fetch');
        
        if (isNetworkError) {
          toast({
            variant: "destructive",
            title: "Conexão perdida",
            description: "A conexão caiu durante o processamento. Verifique o extrato antes de tentar novamente.",
            duration: 10000,
          });
          return null;
        }

        let errorMessage = "Tente novamente mais tarde.";
        try {
          if (error.context && typeof error.context === 'object') {
            const res = error.context as Response;
            if (res?.json) {
              const body = await res.json();
              let providerMessage = "";
              if (typeof body?.provider_error === 'string') {
                try { providerMessage = JSON.parse(body.provider_error)?.message || ""; } catch { providerMessage = body.provider_error; }
              } else if (body?.provider_error?.message) {
                providerMessage = body.provider_error.message;
              }
              errorMessage = body?.error || providerMessage || body?.hint || errorMessage;
            }
          }
        } catch { /* ignore */ }

        toast({
          variant: "destructive",
          title: "Erro ao iniciar pagamento Pix",
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
      
      // Auto-generate receipt in background (fallback for webhook)
      if (data.transaction_id && currentCompany?.id) {
        supabase.functions.invoke('generate-pix-receipt', {
          body: { transaction_id: data.transaction_id, company_id: currentCompany.id },
        }).catch(e => console.error('[usePixPayment] Auto-receipt generation failed:', e));
      }

      toast({
        title: "Pagamento iniciado!",
        description: "O pagamento foi enviado para processamento.",
      });
      
      return data;

    } catch (error: any) {
      console.error('[usePixPayment] Pay by key exception:', error);
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

  // Pay via QR Code
  const payByQRCode = useCallback(async (params: PayQrcParams): Promise<PaymentResult | null> => {
    if (!currentCompany || !session) {
      toast({
        variant: "destructive",
        title: "Erro",
        description: "Você precisa estar logado e ter uma empresa selecionada.",
      });
      return null;
    }

    setIsProcessing(true);
    const idempotencyKey = crypto.randomUUID();

    try {
      const { data, error } = await supabase.functions.invoke('pix-pay-qrc', {
        body: {
          company_id: currentCompany.id,
          idempotency_key: idempotencyKey,
          ...params,
        },
      });

      if (error) {
        console.error('[usePixPayment] Pay by QRC error:', error);
        
        const isNetworkError = !error.context || error.message?.includes('Failed to send') || error.message?.includes('fetch');
        
        toast({
          variant: "destructive",
          title: isNetworkError ? "Conexão perdida" : "Erro ao iniciar pagamento Pix",
          description: isNetworkError 
            ? "A conexão caiu durante o processamento. Verifique o extrato antes de tentar novamente."
            : (error.message || "Tente novamente mais tarde."),
          duration: isNetworkError ? 10000 : 5000,
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
        title: "Pagamento iniciado!",
        description: "O pagamento via QR Code foi enviado para processamento.",
      });
      
      return data;

    } catch (error: any) {
      console.error('[usePixPayment] Pay by QRC exception:', error);
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

  // Get QR Code info before paying
  const getQRCodeInfo = useCallback(async (params: QRCInfoParams): Promise<QRCInfoResult | null> => {
    if (!currentCompany || !session) {
      return null;
    }

    try {
      const { data, error } = await supabase.functions.invoke('pix-qrc-info', {
        body: {
          company_id: currentCompany.id,
          ...params,
        },
      });

      if (error || !data.success) {
        console.error('[usePixPayment] QRC info error:', error || data.error);
        return null;
      }

      return data;

    } catch (error: any) {
      console.error('[usePixPayment] QRC info exception:', error);
      return null;
    }
  }, [currentCompany, session]);

  // Check payment status
  const checkStatus = useCallback(async (
    endToEndIdOrTransactionId: string, 
    isTransactionId = false
  ): Promise<PaymentStatus | null> => {
    if (!currentCompany || !session) return null;

    setIsChecking(true);

    try {
      const body: any = { company_id: currentCompany.id };
      
      if (isTransactionId) {
        body.transaction_id = endToEndIdOrTransactionId;
      } else {
        body.end_to_end_id = endToEndIdOrTransactionId;
      }

      const { data, error } = await supabase.functions.invoke('pix-check-status', {
        body,
      });

      if (error || !data.success) {
        console.error('[usePixPayment] Check status error:', error || data.error);
        return null;
      }

      setPaymentStatus(data);
      return data;

    } catch (error: any) {
      console.error('[usePixPayment] Check status exception:', error);
      return null;
    } finally {
      setIsChecking(false);
    }
  }, [currentCompany, session]);

  // Start polling for payment status
  const startPolling = useCallback((endToEndId: string, intervalMs = 5000, maxAttempts = 60) => {
    let attempts = 0;

    const poll = async () => {
      attempts++;
      console.log(`[usePixPayment] Polling attempt ${attempts}/${maxAttempts}`);

      const status = await checkStatus(endToEndId);

      if (status?.is_completed || status?.is_liquidated || status?.internal_status === 'completed') {
        console.log('[usePixPayment] Payment confirmed!');
        stopPolling();
        toast({
          title: "Pagamento confirmado!",
          description: "O Pix foi liquidado com sucesso.",
        });
        return;
      }

      if (status?.status === 'CANCELED') {
        console.log('[usePixPayment] Payment cancelled');
        stopPolling();
        toast({
          variant: "destructive",
          title: "Pagamento cancelado",
          description: status.error_code || "O pagamento foi cancelado.",
        });
        return;
      }

      if (attempts >= maxAttempts) {
        console.log('[usePixPayment] Max polling attempts reached');
        stopPolling();
        return;
      }
    };

    // Initial check
    poll();

    // Start interval
    pollingRef.current = setInterval(poll, intervalMs);
  }, [checkStatus, toast]);

  // Stop polling
  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  // Get receipt PDF
  const getReceipt = useCallback(async (
    endToEndIdOrTransactionId: string,
    isTransactionId = false
  ): Promise<ReceiptResult | null> => {
    if (!currentCompany || !session) {
      toast({
        variant: "destructive",
        title: "Erro",
        description: "Você precisa estar logado.",
      });
      return null;
    }

    try {
      const body: any = { company_id: currentCompany.id };
      
      if (isTransactionId) {
        body.transaction_id = endToEndIdOrTransactionId;
      } else {
        body.end_to_end_id = endToEndIdOrTransactionId;
      }

      const { data, error } = await supabase.functions.invoke('pix-receipt', {
        body,
      });

      if (error || !data.success) {
        console.error('[usePixPayment] Get receipt error:', error || data.error);
        toast({
          variant: "destructive",
          title: "Erro ao obter comprovante",
          description: "Não foi possível baixar o comprovante.",
        });
        return null;
      }

      return data;

    } catch (error: any) {
      console.error('[usePixPayment] Get receipt exception:', error);
      toast({
        variant: "destructive",
        title: "Erro",
        description: "Falha na comunicação com o servidor.",
      });
      return null;
    }
  }, [currentCompany, session, toast]);

  // Download receipt as PDF file
  const downloadReceipt = useCallback(async (
    endToEndIdOrTransactionId: string,
    isTransactionId = false
  ) => {
    const receipt = await getReceipt(endToEndIdOrTransactionId, isTransactionId);
    
    if (receipt?.pdf_base64) {
      // Convert base64 to blob and download
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
      link.download = `comprovante_pix_${receipt.end_to_end_id}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      toast({
        title: "Comprovante baixado!",
        description: "O PDF foi salvo na pasta de downloads.",
      });
    }
  }, [getReceipt, toast]);

  // Request refund
  const requestRefund = useCallback(async (transactionId: string, valor?: number, motivo?: string) => {
    if (!session) {
      toast({
        variant: "destructive",
        title: "Erro",
        description: "Você precisa estar logado.",
      });
      return null;
    }

    try {
      const { data, error } = await supabase.functions.invoke('pix-refund', {
        body: {
          transaction_id: transactionId,
          valor,
          motivo,
        },
      });

      if (error) {
        console.error('[usePixPayment] Refund error:', error);
        toast({
          variant: "destructive",
          title: "Erro ao solicitar devolução",
          description: error.message || "Tente novamente mais tarde.",
        });
        return null;
      }

      if (data.success) {
        toast({
          title: "Devolução solicitada",
          description: `Status: ${data.status}`,
        });
      }

      return data;

    } catch (error: any) {
      console.error('[usePixPayment] Refund exception:', error);
      toast({
        variant: "destructive",
        title: "Erro",
        description: "Falha na comunicação com o servidor.",
      });
      return null;
    }
  }, [session, toast]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  return {
    // State
    isProcessing,
    isChecking,
    isLookingUp,
    paymentData,
    paymentStatus,
    // DICT lookup
    lookupKey,
    // Payment actions
    payByKey,
    payByQRCode,
    getQRCodeInfo,
    // Status actions
    checkStatus,
    startPolling,
    stopPolling,
    // Receipt actions
    getReceipt,
    downloadReceipt,
    // Refund
    requestRefund,
  };
}
