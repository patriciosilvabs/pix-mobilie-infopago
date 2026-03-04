import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

type Classification = "cost" | "expense";

interface BatchCategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  onSuccess: () => void;
}

export function BatchCategoryDialog({ open, onOpenChange, companyId, onSuccess }: BatchCategoryDialogProps) {
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState({
    names: "",
    classification: "cost" as Classification,
    keywords: "",
  });

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const keywords = form.keywords.split(",").map((k) => k.trim()).filter(Boolean);
      const names = [...new Set(
        form.names.split("\n").map((n) => n.trim()).filter(Boolean)
      )];

      if (names.length === 0) {
        toast({ variant: "destructive", title: "Nenhuma categoria informada" });
        return;
      }

      const rows = names.map((name) => ({
        name,
        classification: form.classification,
        keywords: keywords.length > 0 ? keywords : null,
        company_id: companyId,
      }));

      const { error } = await supabase.from("categories").insert(rows);
      if (error) throw error;

      toast({ title: `${names.length} categoria(s) criada(s) com sucesso!` });
      setForm({ names: "", classification: "cost", keywords: "" });
      onOpenChange(false);
      onSuccess();
    } catch (error: any) {
      toast({ variant: "destructive", title: "Erro", description: error.message });
    } finally {
      setIsSaving(false);
    }
  };

  const lineCount = form.names.split("\n").map((n) => n.trim()).filter(Boolean).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Importar Categorias em Lote</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Nomes das categorias (uma por linha)</Label>
            <Textarea
              value={form.names}
              onChange={(e) => setForm({ ...form, names: e.target.value })}
              placeholder={"Aluguel\nEnergia\nÁgua\nInternet"}
              rows={8}
            />
            {lineCount > 0 && (
              <p className="text-xs text-muted-foreground">{lineCount} categoria(s)</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Classificação (aplicada a todas)</Label>
            <Select value={form.classification} onValueChange={(v) => setForm({ ...form, classification: v as Classification })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cost">Custo</SelectItem>
                <SelectItem value="expense">Despesa</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Keywords opcionais (separadas por vírgula)</Label>
            <Input
              value={form.keywords}
              onChange={(e) => setForm({ ...form, keywords: e.target.value })}
              placeholder="aluguel, energia, água"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={isSaving || lineCount === 0}>
            {isSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Criar Todas ({lineCount})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
