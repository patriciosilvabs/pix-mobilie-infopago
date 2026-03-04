import { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { invalidateDashboardCache } from "@/hooks/useDashboardData";
import {
  Camera,
  Upload,
  FileText,
  DollarSign,
  TrendingUp,
  Loader2,
  Check,
  AlertCircle,
  X,
  Sparkles,
  Search,
} from "lucide-react";

type ClassificationType = "cost" | "expense";

interface ReceiptData {
  file: File | null;
  previewUrl: string | null;
  classification: ClassificationType | null;
  subcategory: string | null;
  ocrData: {
    cnpj?: string;
    date?: string;
    value?: string;
    accessKey?: string;
    suggestedCategory?: string;
  } | null;
  isProcessing: boolean;
}

interface CategoryRecord {
  id: string;
  name: string;
  classification: "cost" | "expense";
}

export default function ReceiptCapture() {
  const { transactionId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { currentCompany } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [categorySearch, setCategorySearch] = useState("");
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [categoryUsageCounts, setCategoryUsageCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!currentCompany) return;

    // Load categories and usage counts in parallel
    Promise.all([
      supabase
        .from("categories")
        .select("id, name, classification")
        .eq("company_id", currentCompany.id)
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("transactions")
        .select("category_id")
        .eq("company_id", currentCompany.id)
        .not("category_id", "is", null),
    ]).then(([catRes, txRes]) => {
      if (catRes.data) setCategories(catRes.data as CategoryRecord[]);
      if (txRes.data) {
        const counts: Record<string, number> = {};
        for (const row of txRes.data) {
          const cid = row.category_id as string;
          counts[cid] = (counts[cid] || 0) + 1;
        }
        setCategoryUsageCounts(counts);
      }
    });
  }, [currentCompany]);

  const [receiptData, setReceiptData] = useState<ReceiptData>({
    file: null,
    previewUrl: null,
    classification: null,
    subcategory: null,
    ocrData: null,
    isProcessing: false,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const normalizeImageOrientation = useCallback(async (file: File): Promise<{ blob: Blob; previewUrl: string }> => {
    // Only process image files
    if (!file.type.startsWith("image/")) {
      const previewUrl = URL.createObjectURL(file);
      return { blob: file, previewUrl };
    }

    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();

    const blob = await new Promise<Blob>((resolve) => {
      canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.9);
    });

    const previewUrl = URL.createObjectURL(blob);
    return { blob, previewUrl };
  }, []);

  const handleFileSelect = useCallback(async (file: File) => {
    setReceiptData((prev) => ({ ...prev, isProcessing: true }));

    // Normalize orientation via Canvas (fixes mobile EXIF rotation)
    const { blob, previewUrl } = await normalizeImageOrientation(file);

    // Build a corrected File object preserving the original name
    const fileName = file.name.replace(/\.[^.]+$/, ".jpg");
    const correctedFile = new File([blob], fileName, { type: "image/jpeg" });

    setReceiptData((prev) => ({
      ...prev,
      file: correctedFile,
      previewUrl,
      isProcessing: true,
    }));

    // Convert image to base64 and call OCR
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string;
          // Remove data:image/...;base64, prefix
          resolve(result.split(",")[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(correctedFile);
      });

      const { data: ocrResponse, error: ocrError } = await supabase.functions.invoke("process-ocr", {
        body: { imageBase64: base64 },
      });

      if (ocrError) throw ocrError;

      if (ocrResponse?.success && ocrResponse.data) {
        const d = ocrResponse.data;
        const extractedOcr = {
          cnpj: d.cnpj || undefined,
          date: d.data_emissao || undefined,
          value: d.valor_total != null ? `R$ ${Number(d.valor_total).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : undefined,
          accessKey: d.chave_acesso || undefined,
          suggestedCategory: d.categoria_sugerida || undefined,
        };

        const aiClassification: ClassificationType | null =
          d.classificacao_sugerida === "cost" || d.classificacao_sugerida === "expense"
            ? d.classificacao_sugerida
            : null;

        setReceiptData((prev) => ({
          ...prev,
          ocrData: extractedOcr,
          classification: aiClassification,
          isProcessing: false,
        }));

        // Auto-select suggested category if it matches
        if (extractedOcr.suggestedCategory && aiClassification) {
          const match = categories.find(
            (c) =>
              c.name.toLowerCase() === extractedOcr.suggestedCategory!.toLowerCase() &&
              c.classification === aiClassification
          );
          if (match) {
            setReceiptData((prev) => ({ ...prev, subcategory: match.name }));
          }
        }

        toast({
          title: "Comprovante processado!",
          description: "Os dados foram extraídos automaticamente pela IA.",
        });
      } else {
        throw new Error(ocrResponse?.error || "Falha na extração");
      }
    } catch (err: any) {
      console.error("OCR error:", err);
      setReceiptData((prev) => ({ ...prev, isProcessing: false }));
      toast({
        variant: "destructive",
        title: "Erro no OCR",
        description: err?.message?.includes("429")
          ? "Limite de requisições excedido. Tente novamente em alguns segundos."
          : err?.message?.includes("402")
          ? "Créditos de IA esgotados."
          : "Não foi possível extrair dados do comprovante.",
      });
    }
  }, [toast, normalizeImageOrientation, categories]);

  const handleCameraCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleSubmit = async () => {
    if (!receiptData.file || !receiptData.classification) {
      toast({
        variant: "destructive",
        title: "Erro",
        description: "Anexe um comprovante e selecione a classificação.",
      });
      return;
    }

    if (!transactionId || !currentCompany) {
      toast({ variant: "destructive", title: "Erro", description: "Transação ou empresa não encontrada." });
      return;
    }

    setIsSubmitting(true);

    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");

      // Upload file to storage
      const timestamp = Date.now();
      const filePath = `${currentCompany.id}/${transactionId}/${timestamp}_${receiptData.file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("receipts")
        .upload(filePath, receiptData.file);

      if (uploadError) throw uploadError;

      // Save relative path (bucket is private, signed URLs generated on demand)
      // Insert receipt record
      const { error: receiptError } = await supabase
        .from("receipts")
        .insert({
          transaction_id: transactionId,
          file_url: filePath,
          file_name: receiptData.file.name,
          file_type: receiptData.file.type,
          uploaded_by: user.id,
          ocr_status: "pending" as const,
        });

      if (receiptError) throw receiptError;

      // Update transaction status to completed
      await supabase
        .from("transactions")
        .update({ status: "completed" as const, paid_at: new Date().toISOString() })
        .eq("id", transactionId);

      // Update category on transaction if selected
      if (receiptData.subcategory) {
        const selectedCategory = categories.find(
          (c) => c.name === receiptData.subcategory && c.classification === receiptData.classification
        );
        if (selectedCategory) {
          await supabase
            .from("transactions")
            .update({
              category_id: selectedCategory.id,
              classified_by: user.id,
              classified_at: new Date().toISOString(),
            })
            .eq("id", transactionId);
        }
      }

      invalidateDashboardCache();

      toast({
        title: "Comprovante salvo!",
        description: "A transação foi classificada com sucesso.",
      });

      navigate("/transactions");
    } catch (error: any) {
      console.error("Erro ao salvar comprovante:", error);
      toast({
        variant: "destructive",
        title: "Erro ao salvar",
        description: error.message || "Tente novamente.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemoveFile = () => {
    if (receiptData.previewUrl) {
      URL.revokeObjectURL(receiptData.previewUrl);
    }
    setReceiptData({
      file: null,
      previewUrl: null,
      classification: null,
      subcategory: null,
      ocrData: null,
      isProcessing: false,
    });
  };

  const canSubmit = receiptData.file && receiptData.classification && !receiptData.isProcessing;

  return (
    <MainLayout>
      <div className="p-6 lg:p-8 max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Anexar Comprovante</h1>
          <p className="text-muted-foreground">
            Capture ou anexe o comprovante fiscal e classifique o pagamento
          </p>
        </div>

        {/* Alert */}
        <Card className="border-warning/50 bg-warning/5 mb-6">
          <CardContent className="flex items-center gap-4 p-4">
            <div className="h-10 w-10 rounded-full bg-warning/20 flex items-center justify-center flex-shrink-0">
              <AlertCircle className="h-5 w-5 text-warning" />
            </div>
            <div>
              <p className="font-medium">Comprovante Obrigatório</p>
              <p className="text-sm text-muted-foreground">
                Você não pode sair desta tela sem anexar o comprovante.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Capture options or Preview */}
        {!receiptData.file ? (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Capturar Comprovante</CardTitle>
              <CardDescription>
                Tire uma foto do cupom/nota ou anexe um arquivo
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                {/* Camera button */}
                <Button
                  variant="outline"
                  size="lg"
                  className="h-32 flex-col gap-3"
                  onClick={() => cameraInputRef.current?.click()}
                >
                  <Camera className="h-10 w-10 text-primary" />
                  <span>Tirar Foto</span>
                </Button>
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={handleCameraCapture}
                />

                {/* Upload button */}
                <Button
                  variant="outline"
                  size="lg"
                  className="h-32 flex-col gap-3"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-10 w-10 text-primary" />
                  <span>Anexar Arquivo</span>
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,.pdf"
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Preview */}
            <Card className="mb-6 overflow-hidden">
              <div className="relative">
                {receiptData.previewUrl && (
                  <img
                    src={receiptData.previewUrl}
                    alt="Comprovante"
                    className="w-full h-64 object-cover"
                  />
                )}
                <Button
                  variant="destructive"
                  size="icon"
                  className="absolute top-4 right-4"
                  onClick={handleRemoveFile}
                  disabled={isSubmitting}
                >
                  <X className="h-4 w-4" />
                </Button>

                {/* Processing overlay */}
                {receiptData.isProcessing && (
                  <div className="absolute inset-0 bg-background/80 flex items-center justify-center">
                    <div className="text-center">
                      <Loader2 className="h-10 w-10 animate-spin mx-auto text-primary mb-4" />
                      <p className="font-medium">Processando comprovante...</p>
                      <p className="text-sm text-muted-foreground">
                        Extraindo dados com IA
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* OCR Data */}
              {receiptData.ocrData && !receiptData.isProcessing && (
                <CardContent className="p-4 space-y-3 bg-muted/30">
                  <div className="flex items-center gap-2 text-sm text-primary">
                    <Sparkles className="h-4 w-4" />
                    <span className="font-medium">Dados extraídos por IA</span>
                  </div>

                  <div className="grid gap-2 text-sm">
                    {receiptData.ocrData.cnpj && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">CNPJ</span>
                        <span className="font-mono">{receiptData.ocrData.cnpj}</span>
                      </div>
                    )}
                    {receiptData.ocrData.value && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Valor</span>
                        <span className="font-bold">{receiptData.ocrData.value}</span>
                      </div>
                    )}
                    {receiptData.ocrData.date && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Data</span>
                        <span>{receiptData.ocrData.date}</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              )}
            </Card>

            {/* Classification */}
            {!receiptData.isProcessing && (
              <Card className="mb-6">
                <CardHeader>
                  <CardTitle>Classificar Pagamento</CardTitle>
                  <CardDescription>
                    Selecione se é um Custo ou Despesa
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Main classification */}
                  <div className="grid grid-cols-2 gap-4">
                    <Button
                      variant={
                        receiptData.classification === "cost"
                          ? "default"
                          : "outline"
                      }
                      size="lg"
                      className={cn(
                        "h-20 flex-col gap-2",
                        receiptData.classification === "cost" &&
                          "bg-gradient-primary shadow-primary"
                      )}
                      onClick={() => {
                        setReceiptData((prev) => ({
                          ...prev,
                          classification: "cost",
                          subcategory: null,
                        }));
                        setCategorySearch("");
                        setShowAllCategories(false);
                      }}
                    >
                      <DollarSign className="h-6 w-6" />
                      <span className="font-bold">CUSTO</span>
                    </Button>

                    <Button
                      variant={
                        receiptData.classification === "expense"
                          ? "default"
                          : "outline"
                      }
                      size="lg"
                      className={cn(
                        "h-20 flex-col gap-2",
                        receiptData.classification === "expense" &&
                          "bg-destructive hover:bg-destructive/90"
                      )}
                      onClick={() => {
                        setReceiptData((prev) => ({
                          ...prev,
                          classification: "expense",
                          subcategory: null,
                        }));
                        setCategorySearch("");
                        setShowAllCategories(false);
                      }}
                    >
                      <TrendingUp className="h-6 w-6" />
                      <span className="font-bold">DESPESA</span>
                    </Button>
                  </div>

                  {/* Subcategories */}
                  {receiptData.classification && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Categoria</label>
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Buscar categoria..."
                          value={categorySearch}
                          onChange={(e) => setCategorySearch(e.target.value)}
                          className="pl-9"
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {(() => {
                          const filtered = categories
                            .filter((c) => c.classification === receiptData.classification)
                            .filter((c) => c.name.toLowerCase().includes(categorySearch.toLowerCase()))
                            .sort((a, b) => {
                              const countA = categoryUsageCounts[a.id] || 0;
                              const countB = categoryUsageCounts[b.id] || 0;
                              if (countB !== countA) return countB - countA;
                              return a.name.localeCompare(b.name);
                            });

                          const isSearching = categorySearch.trim().length > 0;
                          const visible = isSearching || showAllCategories ? filtered : filtered.slice(0, 8);
                          const hasMore = filtered.length > 8;

                          return (
                            <>
                              {visible.map((cat) => (
                                <Button
                                  key={cat.id}
                                  variant={receiptData.subcategory === cat.name ? "default" : "outline"}
                                  size="sm"
                                  onClick={() =>
                                    setReceiptData((prev) => ({ ...prev, subcategory: cat.name }))
                                  }
                                >
                                  {cat.name}
                                </Button>
                              ))}
                              {visible.length === 0 && (
                                <p className="text-sm text-muted-foreground py-2">Nenhuma categoria encontrada</p>
                              )}
                              {hasMore && !isSearching && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-primary"
                                  onClick={() => setShowAllCategories((v) => !v)}
                                >
                                  {showAllCategories ? "Ver menos" : `Ver todas (${filtered.length})`}
                                </Button>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* Submit button */}
        <Button
          className="w-full bg-gradient-accent hover:opacity-90 shadow-accent text-lg h-14"
          disabled={!canSubmit || isSubmitting}
          onClick={handleSubmit}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Salvando...
            </>
          ) : (
            <>
              <Check className="mr-2 h-5 w-5" />
              Salvar Comprovante
            </>
          )}
        </Button>
      </div>
    </MainLayout>
  );
}
