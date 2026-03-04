import { useMemo, useState, useEffect, useRef } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { ImageOff, Eye, Pencil, Trash2, Loader2 } from "lucide-react";
import { batchSignedUrls, extractStoragePath } from "@/utils/storageHelpers";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Transaction {
  id: string;
  created_at: string;
  created_by?: string;
  description?: string | null;
  beneficiary_name?: string | null;
  amount: number;
  status: string;
  company_id?: string;
  categories?: { name: string; classification: string } | null;
  receipts?: { id?: string; file_url: string; file_name?: string | null }[] | null;
}

interface DayGroup {
  dateKey: string;
  label: string;
  subtotal: number;
  transactions: Transaction[];
}

interface Props {
  transactions: Transaction[];
  profileMap?: Record<string, string>;
  isAdmin?: boolean;
  onReceiptChange?: () => void;
}

const formatCurrency = (v: number) =>
  `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

const statusMap: Record<string, { label: string; className: string }> = {
  completed: { label: "Concluído", className: "text-success" },
  failed: { label: "Falhou", className: "text-destructive" },
  cancelled: { label: "Cancelado", className: "text-muted-foreground" },
  pending: { label: "Pendente", className: "text-muted-foreground" },
};

export function DailyTransactionSummary({ transactions, profileMap = {}, isAdmin = false, onReceiptChange }: Props) {
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingReplace, setPendingReplace] = useState<{ transactionId: string; companyId: string; receiptId: string; oldFileUrl: string } | null>(null);

  // Group transactions by day
  const dayGroups = useMemo<DayGroup[]>(() => {
    const map: Record<string, Transaction[]> = {};
    transactions.forEach((t) => {
      const key = format(new Date(t.created_at), "yyyy-MM-dd");
      if (!map[key]) map[key] = [];
      map[key].push(t);
    });
    return Object.entries(map)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([dateKey, txs]) => ({
        dateKey,
        label: format(parseISO(dateKey), "EEEE, dd/MM/yyyy", { locale: ptBR }),
        subtotal: txs.reduce((s, t) => s + Number(t.amount), 0),
        transactions: txs,
      }));
  }, [transactions]);

  // Fetch signed URLs for all receipts
  useEffect(() => {
    const urls = transactions
      .map((t) => t.receipts?.[0]?.file_url)
      .filter(Boolean) as string[];
    if (urls.length === 0) return;
    batchSignedUrls(urls).then(setSignedUrls);
  }, [transactions]);

  const handleDeleteReceipt = async (receiptId: string, fileUrl: string) => {
    setBusyId(receiptId);
    try {
      const path = extractStoragePath(fileUrl);
      await supabase.storage.from("receipts").remove([path]);
      const { error } = await supabase.from("receipts").delete().eq("id", receiptId);
      if (error) throw error;
      toast.success("Comprovante excluído");
      onReceiptChange?.();
    } catch (e: any) {
      toast.error("Erro ao excluir: " + (e.message || "erro desconhecido"));
    } finally {
      setBusyId(null);
    }
  };

  const handleReplaceClick = (t: Transaction) => {
    const receipt = t.receipts?.[0];
    if (!receipt?.id) return;
    setPendingReplace({
      transactionId: t.id,
      companyId: t.company_id || "",
      receiptId: receipt.id,
      oldFileUrl: receipt.file_url,
    });
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !pendingReplace) {
      setPendingReplace(null);
      return;
    }
    const { transactionId, companyId, receiptId, oldFileUrl } = pendingReplace;
    setBusyId(receiptId);
    try {
      const newPath = `${companyId}/${transactionId}/${Date.now()}_${file.name}`;
      const { error: uploadErr } = await supabase.storage.from("receipts").upload(newPath, file);
      if (uploadErr) throw uploadErr;

      const { error: updateErr } = await supabase
        .from("receipts")
        .update({ file_url: newPath, file_name: file.name, file_type: file.type })
        .eq("id", receiptId);
      if (updateErr) throw updateErr;

      // Remove old file
      const oldPath = extractStoragePath(oldFileUrl);
      await supabase.storage.from("receipts").remove([oldPath]);

      toast.success("Comprovante substituído");
      onReceiptChange?.();
    } catch (e: any) {
      toast.error("Erro ao substituir: " + (e.message || "erro desconhecido"));
    } finally {
      setBusyId(null);
      setPendingReplace(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  if (dayGroups.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Resumo por Dia</CardTitle></CardHeader>
        <CardContent>
          <p className="text-center text-muted-foreground py-8">Nenhuma transação no período</p>
        </CardContent>
      </Card>
    );
  }

  const defaultOpen = [dayGroups[0].dateKey];

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Resumo por Dia ({transactions.length} transações)</CardTitle></CardHeader>
      <CardContent className="p-2 sm:p-6">
        {/* Hidden file input for replace */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileSelected}
        />

        <Dialog open={!!previewUrl} onOpenChange={(open) => !open && setPreviewUrl(null)}>
          <Accordion type="multiple" defaultValue={defaultOpen} className="space-y-2">
            {dayGroups.map((day) => (
              <AccordionItem key={day.dateKey} value={day.dateKey} className="border rounded-lg px-3">
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 text-left">
                    <span className="font-semibold capitalize">{day.label}</span>
                    <span className="text-sm text-muted-foreground">
                      Subtotal: <span className="font-mono-numbers font-medium text-foreground">{formatCurrency(day.subtotal)}</span>
                    </span>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-2">
                    {day.transactions.map((t) => {
                      const receipt = t.receipts?.[0];
                      const receiptFileUrl = receipt?.file_url || "";
                      const receiptId = receipt?.id || "";
                      const signed = receiptFileUrl ? signedUrls[receiptFileUrl] : "";
                      const st = statusMap[t.status] || statusMap.pending;
                      const isBusy = busyId === receiptId;

                      return (
                        <div
                          key={t.id}
                          className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 transition-colors"
                        >
                          {/* Thumbnail + Admin actions */}
                          <div className="relative shrink-0">
                            {signed ? (
                              <DialogTrigger asChild>
                                <button
                                  onClick={() => setPreviewUrl(signed)}
                                  className="relative w-14 h-14 rounded-md overflow-hidden border bg-muted cursor-pointer group"
                                >
                                  <img src={signed} alt="Comprovante" className="w-full h-full object-cover" />
                                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                    <Eye className="h-4 w-4 text-white" />
                                  </div>
                                </button>
                              </DialogTrigger>
                            ) : (
                              <div className="w-14 h-14 rounded-md border bg-muted flex items-center justify-center">
                                <ImageOff className="h-5 w-5 text-muted-foreground" />
                              </div>
                            )}

                            {/* Admin receipt actions */}
                            {isAdmin && receiptId && (
                              <div className="flex gap-1 mt-1 justify-center">
                                {isBusy ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                                ) : (
                                  <>
                                    <button
                                      onClick={() => handleReplaceClick(t)}
                                      title="Trocar comprovante"
                                      className="p-0.5 rounded hover:bg-muted transition-colors"
                                    >
                                      <Pencil className="h-3.5 w-3.5 text-muted-foreground hover:text-primary" />
                                    </button>
                                    <AlertDialog>
                                      <AlertDialogTrigger asChild>
                                        <button
                                          title="Excluir comprovante"
                                          className="p-0.5 rounded hover:bg-muted transition-colors"
                                        >
                                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                                        </button>
                                      </AlertDialogTrigger>
                                      <AlertDialogContent>
                                        <AlertDialogHeader>
                                          <AlertDialogTitle>Excluir comprovante?</AlertDialogTitle>
                                          <AlertDialogDescription>
                                            Esta ação não pode ser desfeita. O arquivo do comprovante será removido permanentemente.
                                          </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                          <AlertDialogAction
                                            onClick={() => handleDeleteReceipt(receiptId, receiptFileUrl)}
                                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                          >
                                            Excluir
                                          </AlertDialogAction>
                                        </AlertDialogFooter>
                                      </AlertDialogContent>
                                    </AlertDialog>
                                  </>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {t.description || t.beneficiary_name || "Sem descrição"}
                            </p>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              {t.categories?.name && <span>{t.categories.name}</span>}
                              {t.categories?.classification && (
                                <span className="px-1.5 py-0.5 rounded bg-muted text-xs">
                                  {t.categories.classification === "cost" ? "Custo" : "Despesa"}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {t.created_by && profileMap[t.created_by] ? `por ${profileMap[t.created_by]}` : ""}
                              {t.created_by && profileMap[t.created_by] ? " às " : ""}
                              {format(new Date(t.created_at), "HH:mm")}
                            </p>
                          </div>

                          {/* Amount + Status */}
                          <div className="text-right shrink-0">
                            <p className="text-sm font-mono-numbers font-medium">{formatCurrency(Number(t.amount))}</p>
                            <span className={`text-xs font-medium ${st.className}`}>{st.label}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>

          {/* Full-size receipt dialog */}
          <DialogContent className="max-w-3xl max-h-[90vh] p-2">
            {previewUrl && (
              <img
                src={previewUrl}
                alt="Comprovante ampliado"
                className="w-full h-auto max-h-[85vh] object-contain rounded"
              />
            )}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
