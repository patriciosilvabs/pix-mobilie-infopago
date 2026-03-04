import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { 
  ArrowLeft, 
  Save, 
  Loader2, 
  Key, 
  Link2, 
  CheckCircle2, 
  AlertCircle,
  Eye,
  EyeOff,
  TestTube,
  ArrowDownToLine,
  ArrowUpFromLine,
  Webhook,
} from "lucide-react";

const PIX_PROVIDERS = [
  { value: "transfeera", label: "Transfeera" },
];

const PIX_KEY_TYPES = [
  { value: "cpf", label: "CPF" },
  { value: "cnpj", label: "CNPJ" },
  { value: "email", label: "E-mail" },
  { value: "phone", label: "Telefone" },
  { value: "random", label: "Chave Aleatória" },
];

// Provider-specific configuration
const PROVIDER_CONFIG: Record<string, {
  clientIdLabel: string;
  clientIdPlaceholder: string;
  clientIdHelp: string;
  showClientSecret: boolean;
  clientSecretLabel?: string;
  clientSecretHelp?: string;
  showCertificate: boolean;
  showCompanyId: boolean;
  credentialsTitle: string;
  credentialsDescription: string;
  urls: { production: string; sandbox: string };
}> = {
  transfeera: {
    clientIdLabel: 'Client ID',
    clientIdPlaceholder: 'seu_client_id_transfeera',
    clientIdHelp: 'Obtido no painel Transfeera > Configurações > API.',
    showClientSecret: true,
    clientSecretLabel: 'Client Secret',
    clientSecretHelp: 'Obtido no painel Transfeera > Configurações > API.',
    showCertificate: false,
    showCompanyId: false,
    credentialsTitle: 'Credenciais Transfeera',
    credentialsDescription: 'Credenciais OAuth2 (Client Credentials)',
    urls: {
      production: 'https://api.transfeera.com',
      sandbox: 'https://api-sandbox.transfeera.com',
    },
  },
};

type PixConfigPurpose = "cash_in" | "cash_out" | "both";

interface PixConfig {
  id?: string;
  provider: string;
  client_id: string;
  client_secret_encrypted: string;
  base_url: string;
  pix_key: string;
  pix_key_type: "cpf" | "cnpj" | "email" | "phone" | "random";
  certificate_encrypted?: string;
  certificate_key_encrypted?: string;
  certificate_cash_in?: string;
  certificate_key_cash_in?: string;
  certificate_cash_out?: string;
  certificate_key_cash_out?: string;
  provider_company_id?: string;
  webhook_url?: string;
  webhook_secret?: string;
  purpose: PixConfigPurpose;
  is_sandbox: boolean;
  is_active: boolean;
}

const EMPTY_CONFIG: PixConfig = {
  provider: "",
  client_id: "",
  client_secret_encrypted: "",
  base_url: "",
  pix_key: "",
  pix_key_type: "cpf",
  purpose: "both",
  is_sandbox: true,
  is_active: true,
};

function ProviderConfigForm({
  config,
  setConfig,
  purposeLabel,
  purposeIcon,
  currentCompany,
  webhookUrl,
  onSaved,
}: {
  config: PixConfig;
  setConfig: (c: PixConfig) => void;
  purposeLabel: string;
  purposeIcon: React.ReactNode;
  currentCompany: any;
  webhookUrl: string;
  onSaved?: () => void;
}) {
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<"success" | "error" | null>(null);
  const [testMessage, setTestMessage] = useState<string>("");
  const [showSecrets, setShowSecrets] = useState(false);

  const providerConfig = config.provider ? PROVIDER_CONFIG[config.provider] : null;

  const getDefaultBaseUrl = (provider: string, sandbox: boolean): string => {
    const pc = PROVIDER_CONFIG[provider];
    return pc ? (sandbox ? pc.urls.sandbox : pc.urls.production) : "";
  };

  const handleProviderChange = (provider: string) => {
    const baseUrl = getDefaultBaseUrl(provider, config.is_sandbox);
    setConfig({
      ...config,
      provider,
      base_url: baseUrl || config.base_url,
      certificate_encrypted: PROVIDER_CONFIG[provider]?.showCertificate ? config.certificate_encrypted : undefined,
      certificate_key_encrypted: PROVIDER_CONFIG[provider]?.showCertificate ? config.certificate_key_encrypted : undefined,
      client_secret_encrypted: provider === 'woovi' ? (config.client_secret_encrypted || 'not_required') : config.client_secret_encrypted,
    });
  };

  const handleSandboxChange = (sandbox: boolean) => {
    const baseUrl = getDefaultBaseUrl(config.provider, sandbox);
    setConfig({ ...config, is_sandbox: sandbox, base_url: baseUrl || config.base_url });
  };

  const handleSave = async (showNotification = true) => {
    if (!currentCompany) return;
    setIsSaving(true);

    try {
      const configData: Record<string, any> = {
        company_id: currentCompany.id,
        provider: config.provider,
        client_id: config.client_id,
        client_secret_encrypted: config.client_secret_encrypted || (config.provider === 'woovi' ? 'not_required' : ''),
        base_url: config.base_url,
        pix_key: config.pix_key,
        pix_key_type: config.pix_key_type,
        webhook_url: config.webhook_url || null,
        webhook_secret: config.webhook_secret || null,
        purpose: config.purpose,
        is_sandbox: config.is_sandbox,
        is_active: config.is_active,
      };

      if (providerConfig?.showCompanyId) {
        configData.provider_company_id = config.provider_company_id || null;
      }
      if (providerConfig?.showCertificate) {
        configData.certificate_encrypted = config.certificate_encrypted || null;
        configData.certificate_key_encrypted = config.certificate_key_encrypted || null;
        configData.certificate_cash_in = config.certificate_cash_in || null;
        configData.certificate_key_cash_in = config.certificate_key_cash_in || null;
        configData.certificate_cash_out = config.certificate_cash_out || null;
        configData.certificate_key_cash_out = config.certificate_key_cash_out || null;
      }

      let error;
      if (config.id) {
        const result = await supabase.from("pix_configs").update(configData as any).eq("id", config.id);
        error = result.error;
      } else {
        const result = await supabase.from("pix_configs").insert(configData as any).select().single();
        if (result.data) setConfig({ ...config, id: result.data.id });
        error = result.error;
      }

      if (error) throw error;

      if (showNotification) {
        toast({ title: "Configurações salvas!", description: `${purposeLabel} atualizado.` });
      }
      onSaved?.();
    } catch (error: any) {
      console.error("Error saving config:", error);
      toast({ variant: "destructive", title: "Erro ao salvar", description: error.message || "Tente novamente." });
    } finally {
      setIsSaving(false);
    }
  };

  const [isRegisteringWebhook, setIsRegisteringWebhook] = useState(false);

  const handleRegisterWebhook = async (silent = false) => {
    if (!currentCompany) return;
    setIsRegisteringWebhook(true);
    try {
      const { data, error } = await supabase.functions.invoke("register-transfeera-webhook", {
        body: { company_id: currentCompany.id },
      });

      if (error) {
        let errorDetail = "Falha ao registrar webhook.";
        try {
          if (error.context && typeof error.context.json === 'function') {
            const body = await error.context.json();
            errorDetail = body?.error || body?.details || errorDetail;
          } else if (error.message) {
            errorDetail = error.message;
          }
        } catch { /* use default */ }
        if (!silent) {
          toast({ variant: "destructive", title: "Erro ao registrar webhook", description: errorDetail });
        }
        console.error('[webhook-register]', errorDetail);
        return false;
      }

      if (data?.success) {
        if (!silent) {
          toast({ title: "Webhook registrado!", description: data.message || "Webhook configurado na Transfeera." });
        }
        return true;
      } else {
        if (!silent) {
          toast({ variant: "destructive", title: "Erro", description: data?.error || "Resposta inesperada." });
        }
        return false;
      }
    } catch (e: any) {
      if (!silent) {
        toast({ variant: "destructive", title: "Erro", description: e?.message || "Falha ao registrar webhook." });
      }
      return false;
    } finally {
      setIsRegisteringWebhook(false);
    }
  };

  const handleTestConnection = async () => {
    if (!currentCompany) return;
    setIsTesting(true);
    setTestResult(null);
    setTestMessage("");

    try {
      await handleSave(false);
      const { data, error } = await supabase.functions.invoke("pix-auth", {
        body: { company_id: currentCompany.id, purpose: config.purpose },
      });

      if (error) {
        let errorDetail = "Não foi possível autenticar.";
        try {
          if (error.context && typeof error.context.json === 'function') {
            const body = await error.context.json();
            errorDetail = body?.error || body?.details || errorDetail;
          } else if (error.message) {
            errorDetail = error.message;
          }
        } catch { /* use default */ }
        
        setTestResult("error");
        setTestMessage(errorDetail);
        toast({ variant: "destructive", title: "Falha na conexão", description: errorDetail });
      } else if (!data?.access_token) {
        const msg = data?.error || "Resposta sem access_token.";
        setTestResult("error");
        setTestMessage(msg);
        toast({ variant: "destructive", title: "Falha na conexão", description: msg });
      } else {
        setTestResult("success");
        setTestMessage(`Token obtido com sucesso via ${PIX_PROVIDERS.find(p => p.value === config.provider)?.label}.`);
        toast({ title: "Conexão OK!", description: `Credenciais validadas. Registrando webhook...` });
        
        // Auto-register webhook after successful connection test
        const webhookOk = await handleRegisterWebhook(true);
        if (webhookOk) {
          setTestMessage(prev => prev + ' Webhook registrado automaticamente.');
          toast({ title: "Tudo pronto!", description: "Conexão validada e webhook registrado na Transfeera." });
        }
      }
    } catch (e: any) {
      setTestResult("error");
      const msg = e?.message || "Falha ao testar a conexão.";
      setTestMessage(msg);
      toast({ variant: "destructive", title: "Erro", description: msg });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Provider Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {purposeIcon}
            {purposeLabel}
          </CardTitle>
          <CardDescription>
            Selecione o provedor e configure as credenciais
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Provedor</Label>
              <Select value={config.provider} onValueChange={handleProviderChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o provedor" />
                </SelectTrigger>
                <SelectContent>
                  {PIX_PROVIDERS.map((provider) => (
                    <SelectItem key={provider.value} value={provider.value}>{provider.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Ambiente</Label>
              <div className="flex items-center gap-4 h-10">
                <Switch checked={config.is_sandbox} onCheckedChange={handleSandboxChange} />
                <span className="text-sm">
                  {config.is_sandbox ? <span className="text-warning">Sandbox (Testes)</span> : <span className="text-success">Produção</span>}
                </span>
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <Label>URL Base da API</Label>
            <Input value={config.base_url} onChange={(e) => setConfig({ ...config, base_url: e.target.value })} placeholder="https://api.provedor.com.br" />
            {providerConfig && (
              <p className="text-xs text-muted-foreground">
                Padrão: {config.is_sandbox ? providerConfig.urls.sandbox : providerConfig.urls.production}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Credentials */}
      {providerConfig && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Key className="h-5 w-5 text-primary" />{providerConfig.credentialsTitle}</CardTitle>
            <CardDescription>{providerConfig.credentialsDescription}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className={`grid gap-4 ${providerConfig.showClientSecret ? 'sm:grid-cols-2' : 'sm:grid-cols-1'}`}>
              <div className="space-y-2">
                <Label>{providerConfig.clientIdLabel}</Label>
                <Input value={config.client_id} onChange={(e) => setConfig({ ...config, client_id: e.target.value })} placeholder={providerConfig.clientIdPlaceholder} />
                <p className="text-xs text-muted-foreground">{providerConfig.clientIdHelp}</p>
              </div>
              {providerConfig.showClientSecret && (
                <div className="space-y-2">
                  <Label>{providerConfig.clientSecretLabel}</Label>
                  <div className="relative">
                    <Input type={showSecrets ? "text" : "password"} value={config.client_secret_encrypted} onChange={(e) => setConfig({ ...config, client_secret_encrypted: e.target.value })} placeholder="Seu Client Secret" className="pr-10" />
                    <button type="button" onClick={() => setShowSecrets(!showSecrets)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      {showSecrets ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {providerConfig.clientSecretHelp && <p className="text-xs text-muted-foreground">{providerConfig.clientSecretHelp}</p>}
                </div>
              )}
            </div>
            {providerConfig.showCompanyId && (
              <div className="space-y-2">
                <Label>{config.provider === 'inter' ? 'Conta Corrente (x-conta-corrente)' : 'Company ID (X-Company-ID)'}</Label>
                <Input value={config.provider_company_id || ""} onChange={(e) => setConfig({ ...config, provider_company_id: e.target.value })} placeholder={config.provider === 'inter' ? 'Número da conta corrente (apenas números)' : 'Ex: 12345'} />
                <p className="text-xs text-muted-foreground">{config.provider === 'inter' ? 'Número da conta corrente no Banco Inter. Necessário quando a aplicação está associada a mais de uma conta.' : 'Encontrado no painel Paggue ao gerar as credenciais. Se deixar em branco, será extraído automaticamente.'}</p>
              </div>
            )}
            {providerConfig.showCertificate && config.purpose !== 'both' && (
              <>
                <div className="space-y-2">
                  <Label>Certificado mTLS - PEM (Base64)</Label>
                  <Textarea value={config.certificate_encrypted || ""} onChange={(e) => setConfig({ ...config, certificate_encrypted: e.target.value })} placeholder="Cole aqui o certificado .pem em Base64" rows={3} />
                </div>
                <div className="space-y-2">
                  <Label>Chave Privada do Certificado - PEM (Base64, opcional)</Label>
                  <Textarea value={config.certificate_key_encrypted || ""} onChange={(e) => setConfig({ ...config, certificate_key_encrypted: e.target.value })} placeholder="Se o .pem acima contiver cert+key, deixe em branco." rows={3} />
                </div>
              </>
            )}
            {providerConfig.showCertificate && config.purpose === 'both' && (
              <>
                <div className="border rounded-lg p-4 space-y-3">
                  <p className="text-sm font-medium flex items-center gap-2"><ArrowDownToLine className="h-4 w-4 text-primary" /> Certificado para Recebimento (Cash-in)</p>
                  <div className="space-y-2">
                    <Label>Certificado mTLS Cash-in - PEM (Base64)</Label>
                    <Textarea value={config.certificate_cash_in || ""} onChange={(e) => setConfig({ ...config, certificate_cash_in: e.target.value })} placeholder="Cole aqui o certificado .pem para cash-in" rows={3} />
                  </div>
                  <div className="space-y-2">
                    <Label>Chave Privada Cash-in - PEM (Base64, opcional)</Label>
                    <Textarea value={config.certificate_key_cash_in || ""} onChange={(e) => setConfig({ ...config, certificate_key_cash_in: e.target.value })} placeholder="Se o .pem acima contiver cert+key, deixe em branco." rows={3} />
                  </div>
                </div>
                <div className="border rounded-lg p-4 space-y-3">
                  <p className="text-sm font-medium flex items-center gap-2"><ArrowUpFromLine className="h-4 w-4 text-primary" /> Certificado para Pagamento (Cash-out)</p>
                  <div className="space-y-2">
                    <Label>Certificado mTLS Cash-out - PEM (Base64)</Label>
                    <Textarea value={config.certificate_cash_out || ""} onChange={(e) => setConfig({ ...config, certificate_cash_out: e.target.value })} placeholder="Cole aqui o certificado .pem para cash-out" rows={3} />
                  </div>
                  <div className="space-y-2">
                    <Label>Chave Privada Cash-out - PEM (Base64, opcional)</Label>
                    <Textarea value={config.certificate_key_cash_out || ""} onChange={(e) => setConfig({ ...config, certificate_key_cash_out: e.target.value })} placeholder="Se o .pem acima contiver cert+key, deixe em branco." rows={3} />
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Pix Key */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Key className="h-5 w-5 text-primary" />Chave Pix</CardTitle>
          <CardDescription>Chave Pix associada a este provedor</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Tipo de Chave</Label>
              <Select value={config.pix_key_type} onValueChange={(v) => setConfig({ ...config, pix_key_type: v as any })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PIX_KEY_TYPES.map((type) => (<SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Chave Pix</Label>
              <Input value={config.pix_key} onChange={(e) => setConfig({ ...config, pix_key: e.target.value })} placeholder="Sua chave Pix" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Webhook */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Link2 className="h-5 w-5 text-primary" />Webhook</CardTitle>
          <CardDescription>Configure o webhook para receber notificações</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>URL do Webhook (copie para configurar no provedor)</Label>
            <div className="flex gap-2">
              <Input value={webhookUrl} readOnly className="flex-1" />
              <Button variant="outline" onClick={() => { navigator.clipboard.writeText(webhookUrl); toast({ title: "URL copiada!" }); }}>Copiar</Button>
              <Button variant="outline" onClick={() => handleRegisterWebhook(false)} disabled={isRegisteringWebhook || !config.provider || !config.client_id}>
                {isRegisteringWebhook ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Webhook className="mr-2 h-4 w-4" />}
                Registrar
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Secret do Webhook {config.provider === 'paggue' ? '(obrigatório para Paggue - usado para assinar pagamentos)' : '(opcional)'}</Label>
            <Input type={showSecrets ? "text" : "password"} value={config.webhook_secret || ""} onChange={(e) => setConfig({ ...config, webhook_secret: e.target.value })} placeholder="Chave secreta para validar webhooks" />
          </div>
        </CardContent>
      </Card>

      {/* Status & Actions */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Switch checked={config.is_active} onCheckedChange={(v) => setConfig({ ...config, is_active: v })} />
              <span>Integração {config.is_active ? "ativa" : "desativada"}</span>
            </div>
            {testResult && (
              <div className={`flex items-center gap-2 text-sm ${testResult === "success" ? "text-success" : "text-destructive"}`}>
                {testResult === "success" ? <CheckCircle2 className="h-5 w-5 shrink-0" /> : <AlertCircle className="h-5 w-5 shrink-0" />}
                <span className="line-clamp-2">{testMessage || (testResult === "success" ? "Conexão OK" : "Falha na conexão")}</span>
              </div>
            )}
          </div>
          <div className="flex gap-4">
            <Button variant="outline" onClick={handleTestConnection} disabled={isTesting || !config.provider || !config.client_id}>
              {isTesting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Testando...</> : <><TestTube className="mr-2 h-4 w-4" />Testar Conexão</>}
            </Button>
            <Button className="flex-1 bg-gradient-primary hover:opacity-90" onClick={() => handleSave(true)} disabled={isSaving}>
              {isSaving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Salvando...</> : <><Save className="mr-2 h-4 w-4" />Salvar</>}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}


export default function PixIntegration() {
  const { currentCompany, isAdmin } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("both");
  
  // Configs for each purpose
  const [bothConfig, setBothConfig] = useState<PixConfig>({ ...EMPTY_CONFIG, purpose: "both" });
  const [cashInConfig, setCashInConfig] = useState<PixConfig>({ ...EMPTY_CONFIG, purpose: "cash_in" });
  const [cashOutConfig, setCashOutConfig] = useState<PixConfig>({ ...EMPTY_CONFIG, purpose: "cash_out" });
  
  const [hasSeparateConfigs, setHasSeparateConfigs] = useState(false);
  const [configVersion, setConfigVersion] = useState(0);

  useEffect(() => {
    if (!isAdmin) navigate("/");
  }, [isAdmin, navigate]);

  const reloadConfigs = useCallback(() => {
    setConfigVersion((v) => v + 1);
  }, []);

  // Load existing configs
  const currentCompanyId = currentCompany?.id;
  useEffect(() => {
    async function loadConfigs() {
      if (!currentCompanyId) return;
      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from("pix_configs")
          .select("*")
          .eq("company_id", currentCompanyId);

        if (data && data.length > 0) {
          let foundSeparate = false;
          for (const cfg of data) {
            const mapped: PixConfig = {
              id: cfg.id,
              provider: cfg.provider,
              client_id: cfg.client_id,
              client_secret_encrypted: cfg.client_secret_encrypted,
              base_url: cfg.base_url,
              pix_key: cfg.pix_key,
              pix_key_type: cfg.pix_key_type,
              certificate_encrypted: cfg.certificate_encrypted || undefined,
              certificate_key_encrypted: cfg.certificate_key_encrypted || undefined,
              certificate_cash_in: (cfg as any).certificate_cash_in || undefined,
              certificate_key_cash_in: (cfg as any).certificate_key_cash_in || undefined,
              certificate_cash_out: (cfg as any).certificate_cash_out || undefined,
              certificate_key_cash_out: (cfg as any).certificate_key_cash_out || undefined,
              provider_company_id: (cfg as any).provider_company_id || undefined,
              webhook_url: cfg.webhook_url || undefined,
              webhook_secret: cfg.webhook_secret || undefined,
              purpose: (cfg as any).purpose || "both",
              is_sandbox: cfg.is_sandbox ?? true,
              is_active: cfg.is_active ?? true,
            };

            if (mapped.purpose === "cash_in") { setCashInConfig(mapped); foundSeparate = true; }
            else if (mapped.purpose === "cash_out") { setCashOutConfig(mapped); foundSeparate = true; }
            else { setBothConfig(mapped); }
          }
          
          if (foundSeparate) {
            setHasSeparateConfigs(true);
            setActiveTab("cash_in");
          }
        }
      } catch (error) {
        // No configs found
      } finally {
        setIsLoading(false);
      }
    }
    loadConfigs();
  }, [currentCompanyId, configVersion]);

  const handleToggleSeparateConfigs = (separate: boolean) => {
    setHasSeparateConfigs(separate);
    if (separate) {
      // If switching to separate and cash_in/cash_out are empty, pre-fill from both
      if (!cashInConfig.provider && bothConfig.provider) {
        setCashInConfig({ ...bothConfig, id: undefined, purpose: "cash_in" });
      }
      if (!cashOutConfig.provider && bothConfig.provider) {
        setCashOutConfig({ ...bothConfig, id: undefined, purpose: "cash_out" });
      }
      setActiveTab("cash_in");
    } else {
      setActiveTab("both");
    }
  };

  const webhookUrl = currentCompany 
    ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pix-webhook`
    : "";

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
      <div className="p-6 lg:p-8 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Button variant="ghost" size="icon" onClick={() => navigate("/settings")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Integração Pix</h1>
            <p className="text-muted-foreground">
              Configure a conexão com seu provedor de pagamentos Pix
            </p>
          </div>
        </div>

        {/* Toggle separate providers */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Usar provedores separados</p>
                <p className="text-sm text-muted-foreground">
                  Habilite para usar um provedor para recebimentos (Cash-in) e outro para pagamentos (Cash-out)
                </p>
              </div>
              <Switch checked={hasSeparateConfigs} onCheckedChange={handleToggleSeparateConfigs} />
            </div>
          </CardContent>
        </Card>

        {hasSeparateConfigs ? (
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-2 mb-6">
              <TabsTrigger value="cash_in" className="flex items-center gap-2">
                <ArrowDownToLine className="h-4 w-4" />
                Recebimento (Cash-in)
              </TabsTrigger>
              <TabsTrigger value="cash_out" className="flex items-center gap-2">
                <ArrowUpFromLine className="h-4 w-4" />
                Pagamento (Cash-out)
              </TabsTrigger>
            </TabsList>
            <TabsContent value="cash_in">
              <ProviderConfigForm
                config={cashInConfig}
                setConfig={setCashInConfig}
                purposeLabel="Provedor de Recebimento (Cash-in)"
                purposeIcon={<ArrowDownToLine className="h-5 w-5 text-primary" />}
                currentCompany={currentCompany}
                webhookUrl={webhookUrl}
                onSaved={reloadConfigs}
              />
            </TabsContent>
            <TabsContent value="cash_out">
              <ProviderConfigForm
                config={cashOutConfig}
                setConfig={setCashOutConfig}
                purposeLabel="Provedor de Pagamento (Cash-out)"
                purposeIcon={<ArrowUpFromLine className="h-5 w-5 text-primary" />}
                currentCompany={currentCompany}
                webhookUrl={webhookUrl}
                onSaved={reloadConfigs}
              />
            </TabsContent>
          </Tabs>
        ) : (
          <ProviderConfigForm
            config={bothConfig}
            setConfig={setBothConfig}
            purposeLabel="Provedor de Pagamentos"
            purposeIcon={<Key className="h-5 w-5 text-primary" />}
            currentCompany={currentCompany}
            webhookUrl={webhookUrl}
            onSaved={reloadConfigs}
          />
        )}
      </div>
    </MainLayout>
  );
}
