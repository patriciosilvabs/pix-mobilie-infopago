import { useEffect, useRef, useState, useCallback } from "react";
import { DecodeHintType, BarcodeFormat, MultiFormatReader, BinaryBitmap, HybridBinarizer, HTMLCanvasElementLuminanceSource } from "@zxing/library";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertCircle, Camera, X, Keyboard, ArrowLeft } from "lucide-react";

interface BarcodeScannerProps {
  mode: "qrcode" | "barcode";
  isOpen: boolean;
  onScan: (result: string) => void;
  onClose: () => void;
  onManualInput?: () => void;
  preAcquiredStream?: MediaStream | null;
}

export function BarcodeScanner({ mode, isOpen, onScan, onClose, onManualInput, preAcquiredStream }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const hasScannedRef = useRef(false);
  const mountedRef = useRef(true);
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopScanner = useCallback(() => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }


    const stream = streamRef.current;
    if (stream) {
      streamRef.current = null;
      stream.getTracks().forEach(t => t.stop());
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Unified scanner for both modes using ZXing + preAcquiredStream
  useEffect(() => {
    if (!isOpen) {
      hasScannedRef.current = false;
      stopScanner();
      return;
    }

    let cancelled = false;

    const startScanner = async () => {
      setError(null);
      setIsStarting(true);
      hasScannedRef.current = false;

      // Wait for video element to be in DOM using rAF instead of setTimeout
      await new Promise<void>((resolve) => {
        const check = () => {
          if (videoRef.current) {
            resolve();
          } else {
            requestAnimationFrame(check);
          }
        };
        requestAnimationFrame(check);
      });

      if (cancelled || !mountedRef.current) return;

      const videoEl = videoRef.current;
      if (!videoEl) {
        setError("Elemento de vídeo não encontrado. Tente novamente.");
        setIsStarting(false);
        return;
      }

      // Ensure playsinline attributes for iOS
      videoEl.setAttribute("playsinline", "true");
      videoEl.setAttribute("webkit-playsinline", "true");

      try {
        let stream: MediaStream;

        if (preAcquiredStream && preAcquiredStream.active) {
          // Use the pre-acquired stream from the click handler (iOS gesture chain preserved)
          stream = preAcquiredStream;
          console.log("[BarcodeScanner] Using pre-acquired stream");
        } else {
          // Fallback: request camera directly (works on Android, may fail on iOS)
          console.log("[BarcodeScanner] Fallback: requesting camera directly");
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: "environment" },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
          });
        }

        if (cancelled || !mountedRef.current) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        streamRef.current = stream;
        videoEl.srcObject = stream;
        await videoEl.play();

        // Configure ZXing hints based on mode
        const hints = new Map();
        if (mode === "qrcode") {
          hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);
        } else {
          hints.set(DecodeHintType.POSSIBLE_FORMATS, [
            BarcodeFormat.ITF,
            BarcodeFormat.CODE_128,
            BarcodeFormat.CODE_39,
            BarcodeFormat.EAN_13,
            BarcodeFormat.EAN_8,
            BarcodeFormat.UPC_A,
            BarcodeFormat.UPC_E,
            BarcodeFormat.CODABAR,
          ]);
        }
        hints.set(DecodeHintType.TRY_HARDER, true);

        const mfReader = new MultiFormatReader();
        mfReader.setHints(hints);



        // Track partial reads for barcode confirmation
        const partialReads: string[] = [];
        let lastReadTime = 0;

        const handleResult = (text: string) => {
          if (hasScannedRef.current || cancelled) return;
          const now = Date.now();

          if (mode === "qrcode") {
            // QR codes: accept immediately
            hasScannedRef.current = true;
            console.log("[BarcodeScanner] QR scanned:", text);
            onScan(text);
            setTimeout(() => stopScanner(), 100);
            return;
          }

          // Barcode mode: boleto validation
          const isCompleteBoleto = /^\d{44}$/.test(text) || /^\d{47,48}$/.test(text);
          if (isCompleteBoleto) {
            hasScannedRef.current = true;
            console.log("[BarcodeScanner] Complete boleto:", text);
            onScan(text);
            setTimeout(() => stopScanner(), 100);
            return;
          }

          // Shorter barcodes: require 2x confirmation
          if (text.length >= 8 && text.length < 44) {
            if (now - lastReadTime < 2000) {
              partialReads.push(text);
            } else {
              partialReads.length = 0;
              partialReads.push(text);
            }
            lastReadTime = now;

            if (partialReads.filter(r => r === text).length >= 2) {
              hasScannedRef.current = true;
              console.log("[BarcodeScanner] Confirmed barcode:", text);
              onScan(text);
              setTimeout(() => stopScanner(), 100);
            }
          }
        };

        // Canvas-based scanning loop (works for both modes)
        const scanInterval = mode === "qrcode" ? 250 : 500;
        scanIntervalRef.current = setInterval(() => {
          if (cancelled || hasScannedRef.current || !videoEl.videoWidth) return;

          try {
            const vw = videoEl.videoWidth;
            const vh = videoEl.videoHeight;

            let canvasW = vw;
            let canvasH = vh;
            let sx = 0;
            let sy = 0;

            if (mode === "barcode") {
              // Crop horizontal center strip for barcodes
              canvasH = Math.round(vh * 0.3);
              sy = Math.round((vh - canvasH) / 2);
            } else {
              // For QR, crop center square
              const size = Math.min(vw, vh);
              canvasW = size;
              canvasH = size;
              sx = Math.round((vw - size) / 2);
              sy = Math.round((vh - size) / 2);
            }

            const canvas = document.createElement("canvas");
            canvas.width = canvasW;
            canvas.height = canvasH;
            const ctx = canvas.getContext("2d");
            if (!ctx) return;
            ctx.drawImage(videoEl, sx, sy, canvasW, canvasH, 0, 0, canvasW, canvasH);

            const luminance = new HTMLCanvasElementLuminanceSource(canvas);
            const bitmap = new BinaryBitmap(new HybridBinarizer(luminance));
            const result = mfReader.decode(bitmap);
            if (result) {
              // For barcodes (boleto), strip all whitespace since codes are purely numeric
              // For QR codes (EMV Pix), preserve spaces - they are part of the merchant name
              // and stripping them corrupts the EMV structure (length fields) and CRC16 checksum
              const rawText = result.getText();
              const text = mode === "barcode" ? rawText.replace(/\s/g, "") : rawText.trim();
              handleResult(text);
            }
          } catch {
            // No code found - normal
          }
        }, scanInterval);

        console.log(`[BarcodeScanner] ${mode} scanner started successfully`);
        if (mountedRef.current) setIsStarting(false);
      } catch (err: any) {
        console.error("[BarcodeScanner] Error:", err);
        if (!mountedRef.current) return;
        if (err?.toString?.().includes("NotAllowedError")) {
          setError("Permissão da câmera negada. Habilite nas configurações do navegador.");
        } else if (err?.toString?.().includes("NotFoundError")) {
          setError("Nenhuma câmera encontrada no dispositivo.");
        } else {
          setError(`Erro ao acessar a câmera: ${err?.message || err}`);
        }
        setIsStarting(false);
      }
    };

    startScanner();

    return () => {
      cancelled = true;
      stopScanner();
    };
  }, [isOpen, mode, preAcquiredStream]);

  const handleClose = () => {
    stopScanner();
    onClose();
  };

  const handleManualInput = () => {
    stopScanner();
    onClose();
    onManualInput?.();
  };

  // Fullscreen barcode mode
  if (mode === "barcode") {
    if (!isOpen) return null;

    return (
      <div className="fixed inset-0 z-[100] bg-black flex flex-col">
        <div className="relative flex-1 overflow-hidden">
          {error ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 px-6">
              <AlertCircle className="h-16 w-16 text-destructive" />
              <p className="text-center text-white text-lg">{error}</p>
              <Button
                className="bg-accent hover:bg-accent/90 text-accent-foreground font-bold px-8 py-3 text-lg rounded-lg"
                onClick={handleClose}
              >
                VOLTAR
              </Button>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                playsInline
                muted
                autoPlay
              />

              {/* Horizontal scan guide line */}
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-10">
                <div className="w-[80vw] h-[2px] bg-accent shadow-[0_0_8px_rgba(34,197,94,0.8)]" />
              </div>

              {/* Guide text */}
              <div className="absolute top-8 left-0 right-0 pointer-events-none z-10">
                <p className="text-white/90 text-sm font-medium text-center tracking-wider">
                  Posicione o código de barras na linha verde
                </p>
              </div>

              {/* Action buttons */}
              <div className="absolute bottom-8 left-0 right-0 flex justify-center gap-4 z-10 px-4">
                <Button
                  className="bg-accent hover:bg-accent/90 text-accent-foreground font-bold px-6 py-4 text-base rounded-lg shadow-lg"
                  onClick={handleClose}
                >
                  <ArrowLeft className="mr-2 h-5 w-5" />
                  VOLTAR
                </Button>
                <Button
                  className="bg-accent hover:bg-accent/90 text-accent-foreground font-bold px-6 py-4 text-base rounded-lg shadow-lg"
                  onClick={handleManualInput}
                >
                  <Keyboard className="mr-2 h-5 w-5" />
                  DIGITAR CÓDIGO
                </Button>
              </div>

              {isStarting && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-20">
                  <p className="text-white text-lg font-medium">Iniciando câmera...</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  // QR Code mode - dialog with video + ZXing canvas scanning
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-4 pb-2">
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            Escanear QR Code
          </DialogTitle>
        </DialogHeader>

        <div className="px-4 pb-4">
          {error ? (
            <div className="flex flex-col items-center gap-4 py-8">
              <AlertCircle className="h-12 w-12 text-destructive" />
              <p className="text-center text-sm text-muted-foreground">{error}</p>
              <Button variant="outline" onClick={handleClose}>
                Fechar
              </Button>
            </div>
          ) : (
            <>
              <div className="w-full rounded-lg overflow-hidden bg-black relative" style={{ minHeight: "300px" }}>
                <video
                  ref={videoRef}
                  className="w-full h-full object-cover"
                  playsInline
                  muted
                  autoPlay
                  style={{ minHeight: "300px" }}
                />
                {/* QR scan area guide */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-[250px] h-[250px] border-2 border-white/50 rounded-lg" />
                </div>
              </div>
              {isStarting && (
                <p className="text-center text-sm text-muted-foreground mt-3">
                  Iniciando câmera...
                </p>
              )}
              <p className="text-center text-xs text-muted-foreground mt-3">
                Aponte a câmera para o QR Code Pix
              </p>
            </>
          )}

          <Button variant="outline" className="w-full mt-4" onClick={handleClose}>
            <X className="mr-2 h-4 w-4" />
            Cancelar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
