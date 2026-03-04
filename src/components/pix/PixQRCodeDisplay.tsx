import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/utils";
import { 
  Copy, 
  Check, 
  QrCode, 
  Clock, 
  Loader2, 
  CheckCircle2, 
  XCircle,
  RefreshCw
} from "lucide-react";
import QRCode from "qrcode";

interface PixQRCodeDisplayProps {
  pixCopiaCola: string;
  valor: number;
  expiration: string;
  txid: string;
  status: "pending" | "completed" | "expired" | "cancelled";
  onCheckStatus?: () => void;
  isCheckingStatus?: boolean;
}

export function PixQRCodeDisplay({
  pixCopiaCola,
  valor,
  expiration,
  txid,
  status,
  onCheckStatus,
  isCheckingStatus,
}: PixQRCodeDisplayProps) {
  const [qrCodeUrl, setQrCodeUrl] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [timeLeft, setTimeLeft] = useState<string>("");
  const { toast } = useToast();

  // Generate QR Code
  useEffect(() => {
    if (pixCopiaCola) {
      QRCode.toDataURL(pixCopiaCola, {
        width: 280,
        margin: 2,
        color: {
          dark: "#000000",
          light: "#FFFFFF",
        },
      })
        .then(setQrCodeUrl)
        .catch((err) => {
          console.error("Error generating QR Code:", err);
        });
    }
  }, [pixCopiaCola]);

  // Calculate time left
  useEffect(() => {
    if (!expiration || status !== "pending") return;

    const calculateTimeLeft = () => {
      const now = new Date();
      const exp = new Date(expiration);
      const diff = exp.getTime() - now.getTime();

      if (diff <= 0) {
        setTimeLeft("Expirado");
        return;
      }

      const minutes = Math.floor(diff / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      setTimeLeft(`${minutes}:${seconds.toString().padStart(2, "0")}`);
    };

    calculateTimeLeft();
    const interval = setInterval(calculateTimeLeft, 1000);

    return () => clearInterval(interval);
  }, [expiration, status]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(pixCopiaCola);
      setCopied(true);
      toast({
        title: "Código copiado!",
        description: "Cole no app do seu banco para pagar.",
      });
      setTimeout(() => setCopied(false), 3000);
    } catch {
      toast({
        variant: "destructive",
        title: "Erro ao copiar",
        description: "Tente selecionar e copiar manualmente.",
      });
    }
  };

  const getStatusDisplay = () => {
    switch (status) {
      case "completed":
        return (
          <div className="flex items-center gap-2 text-success">
            <CheckCircle2 className="h-5 w-5" />
            <span className="font-semibold">Pagamento Confirmado!</span>
          </div>
        );
      case "expired":
        return (
          <div className="flex items-center gap-2 text-warning">
            <XCircle className="h-5 w-5" />
            <span className="font-semibold">QR Code Expirado</span>
          </div>
        );
      case "cancelled":
        return (
          <div className="flex items-center gap-2 text-destructive">
            <XCircle className="h-5 w-5" />
            <span className="font-semibold">Pagamento Cancelado</span>
          </div>
        );
      default:
        return (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="h-5 w-5" />
            <span>Aguardando pagamento</span>
            <span className="font-mono font-bold text-foreground">{timeLeft}</span>
          </div>
        );
    }
  };

  return (
    <Card className="max-w-md mx-auto">
      <CardHeader className="text-center pb-4">
        <CardTitle className="flex items-center justify-center gap-2">
          <QrCode className="h-5 w-5 text-primary" />
          Pague com Pix
        </CardTitle>
        <CardDescription>
          Escaneie o QR Code ou copie o código
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Status */}
        <div className="flex justify-center">{getStatusDisplay()}</div>

        {/* QR Code */}
        <div className="flex justify-center">
          <div 
            className={`p-4 bg-white rounded-xl shadow-md ${
              status !== "pending" ? "opacity-50" : ""
            }`}
          >
            {qrCodeUrl ? (
              <img 
                src={qrCodeUrl} 
                alt="QR Code Pix" 
                className="w-[280px] h-[280px]"
              />
            ) : (
              <div className="w-[280px] h-[280px] flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            )}
          </div>
        </div>

        {/* Value */}
        <div className="text-center">
          <p className="text-sm text-muted-foreground">Valor</p>
          <p className="text-3xl font-bold text-primary font-mono-numbers">
            {formatCurrency(valor)}
          </p>
        </div>

        {/* Copy button */}
        {status === "pending" && (
          <Button
            onClick={handleCopy}
            variant="outline"
            className="w-full h-12"
            disabled={copied}
          >
            {copied ? (
              <>
                <Check className="mr-2 h-5 w-5 text-success" />
                Código Copiado!
              </>
            ) : (
              <>
                <Copy className="mr-2 h-5 w-5" />
                Copiar Pix Copia e Cola
              </>
            )}
          </Button>
        )}

        {/* Pix code preview */}
        {status === "pending" && (
          <div className="bg-muted rounded-lg p-3">
            <p className="text-xs text-muted-foreground mb-1">Código Pix:</p>
            <p className="text-xs font-mono break-all line-clamp-2">
              {pixCopiaCola}
            </p>
          </div>
        )}

        {/* Check status button */}
        {status === "pending" && onCheckStatus && (
          <Button
            onClick={onCheckStatus}
            variant="ghost"
            className="w-full"
            disabled={isCheckingStatus}
          >
            {isCheckingStatus ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Verificando...
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                Verificar pagamento
              </>
            )}
          </Button>
        )}

        {/* txid info */}
        <div className="text-center text-xs text-muted-foreground">
          <span>ID: </span>
          <span className="font-mono">{txid.substring(0, 20)}...</span>
        </div>
      </CardContent>
    </Card>
  );
}
