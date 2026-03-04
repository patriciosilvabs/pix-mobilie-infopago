import { useState, useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Plus, Pencil, Power, Building2, Mail, Phone, MapPin } from "lucide-react";

interface CompanyForm {
  name: string;
  cnpj: string;
  email: string;
  phone: string;
  address: string;
}

interface CompanyRow {
  id: string;
  name: string;
  cnpj: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  is_active: boolean;
  logo_url: string | null;
}

export default function Companies() {
  const { toast } = useToast();
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CompanyForm>({ name: "", cnpj: "", email: "", phone: "", address: "" });

  const fetchCompanies = async () => {
    setIsLoading(true);
    const { data, error } = await supabase.from("companies").select("*").order("name");
    if (data) setCompanies(data);
    if (error) toast({ variant: "destructive", title: "Erro ao carregar empresas" });
    setIsLoading(false);
  };

  useEffect(() => { fetchCompanies(); }, []);

  const openCreate = () => {
    setEditingId(null);
    setForm({ name: "", cnpj: "", email: "", phone: "", address: "" });
    setDialogOpen(true);
  };

  const openEdit = (c: CompanyRow) => {
    setEditingId(c.id);
    setForm({ name: c.name, cnpj: c.cnpj || "", email: c.email || "", phone: c.phone || "", address: c.address || "" });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setIsSaving(true);
    const payload = {
      name: form.name,
      cnpj: form.cnpj || null,
      email: form.email || null,
      phone: form.phone || null,
      address: form.address || null,
    };
    try {
      if (editingId) {
        const { error } = await supabase.from("companies").update(payload).eq("id", editingId);
        if (error) throw error;
        toast({ title: "Empresa atualizada!" });
      } else {
        const { error } = await supabase.from("companies").insert(payload);
        if (error) throw error;
        toast({ title: "Empresa criada!" });
      }
      setDialogOpen(false);
      fetchCompanies();
    } catch (error: any) {
      toast({ variant: "destructive", title: "Erro", description: error.message });
    } finally {
      setIsSaving(false);
    }
  };

  const toggleActive = async (c: CompanyRow) => {
    const { error } = await supabase.from("companies").update({ is_active: !c.is_active }).eq("id", c.id);
    if (error) toast({ variant: "destructive", title: "Erro" });
    else {
      toast({ title: c.is_active ? "Empresa desativada" : "Empresa ativada" });
      fetchCompanies();
    }
  };

  if (isLoading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="p-6 lg:p-8 max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Building2 className="h-6 w-6 text-primary" /> Empresas
            </h1>
            <p className="text-muted-foreground">Gerencie as empresas cadastradas</p>
          </div>
          <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" /> Nova Empresa</Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {companies.map((c) => (
            <Card key={c.id} className={!c.is_active ? "opacity-60" : ""}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-lg">{c.name}</CardTitle>
                  <Badge variant={c.is_active ? "default" : "outline"}>
                    {c.is_active ? "Ativa" : "Inativa"}
                  </Badge>
                </div>
                {c.cnpj && <CardDescription>{c.cnpj}</CardDescription>}
              </CardHeader>
              <CardContent>
                <div className="space-y-1 text-sm text-muted-foreground mb-4">
                  {c.email && <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5" /> {c.email}</div>}
                  {c.phone && <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5" /> {c.phone}</div>}
                  {c.address && <div className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5" /> {c.address}</div>}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => openEdit(c)}>
                    <Pencil className="h-3.5 w-3.5 mr-1" /> Editar
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => toggleActive(c)}>
                    <Power className="h-3.5 w-3.5 mr-1" /> {c.is_active ? "Desativar" : "Ativar"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {companies.length === 0 && (
            <div className="col-span-full text-center text-muted-foreground py-12">Nenhuma empresa cadastrada</div>
          )}
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingId ? "Editar Empresa" : "Nova Empresa"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Nome *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>CNPJ</Label>
                <Input value={form.cnpj} onChange={(e) => setForm({ ...form, cnpj: e.target.value })} placeholder="00.000.000/0000-00" />
              </div>
              <div className="grid gap-4 grid-cols-2">
                <div className="space-y-2">
                  <Label>E-mail</Label>
                  <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Telefone</Label>
                  <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Endereço</Label>
                <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button onClick={handleSave} disabled={isSaving || !form.name.trim()}>
                {isSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {editingId ? "Salvar" : "Criar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
